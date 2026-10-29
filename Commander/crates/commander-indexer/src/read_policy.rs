//! Scoped eligibility for pre-fingerprint snapshots. No foreground index scan.
use super::{CustomIgnoreMatcher, IndexConfiguration, IndexKind, IndexRecord, IndexerError};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rusqlite::{params, Connection};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) struct ReadPolicy {
    configuration: IndexConfiguration,
    matcher: CustomIgnoreMatcher,
    source_ids: String,
    git_cache: RefCell<HashMap<PathBuf, ParentIgnorePolicy>>,
    global_git: Gitignore,
}

impl ReadPolicy {
    pub(crate) fn new(configuration: IndexConfiguration) -> Result<Self, IndexerError> {
        let matcher = CustomIgnoreMatcher::compile(&configuration.custom_ignores)?;
        let source_ids = serde_json::to_string(
            &configuration
                .sources
                .iter()
                .map(|source| &source.id)
                .collect::<Vec<_>>(),
        )
        .map_err(|error| IndexerError::new("invalid_read_policy", error.to_string()))?;
        let (global_git, _) = GitignoreBuilder::new("/").build_global();
        Ok(Self {
            configuration,
            matcher,
            source_ids,
            git_cache: RefCell::new(HashMap::new()),
            global_git,
        })
    }

    pub(crate) fn allows(
        &self,
        connection: &Connection,
        record: &IndexRecord,
    ) -> Result<bool, IndexerError> {
        let candidate = Path::new(&record.path);
        // Deleted entries and broken links are different: symlink_metadata keeps
        // an existing broken link searchable without following its target.
        if fs::symlink_metadata(candidate).is_err() {
            return Ok(false);
        }
        let mut member = connection.prepare_cached(
            "SELECT EXISTS(SELECT 1 FROM main.records WHERE path = ?1 AND kind = ?2
             AND source_id IN (SELECT value FROM json_each(?3)))",
        )?;
        if !member.query_row(
            params![record.path, record.kind.as_str(), self.source_ids],
            |row| row.get::<_, bool>(0),
        )? {
            return Ok(false);
        }
        for source in &self.configuration.sources {
            if !source.kinds.contains(&record.kind) || !candidate.starts_with(&source.root) {
                continue;
            }
            let mut allowed = true;
            let mut current = candidate;
            while current != source.root {
                let relative = current.strip_prefix(&source.root).unwrap_or(current);
                if (!source.include_hidden
                    && current
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with('.')))
                    || self.matcher.is_match(current, relative)
                {
                    allowed = false;
                    break;
                }
                let Some(parent) = current.parent() else {
                    allowed = false;
                    break;
                };
                current = parent;
            }
            if !allowed {
                continue;
            }
            if source.respect_git_ignore {
                let parent = candidate.parent().unwrap_or(&source.root);
                let mut cache = self.git_cache.borrow_mut();
                if !cache.contains_key(parent) {
                    // This is a cache budget, never a searchable-data limit.
                    if cache.len() >= 1024 {
                        cache.clear();
                    }
                    cache.insert(parent.to_owned(), git_policy(parent)?);
                }
                let local_policy = cache.get(parent).expect("inserted Git policy");
                let mut ignored = false;
                for ancestor in candidate
                    .ancestors()
                    .take_while(|ancestor| *ancestor != source.root)
                {
                    let directory = ancestor != candidate || record.kind == IndexKind::Directory;
                    if local_policy.is_ignored(ancestor, directory, &self.global_git) {
                        ignored = true;
                        break;
                    }
                }
                // A nested whitelist cannot re-enter a directory the actual
                // walker would already have pruned at an ancestor boundary.
                if ignored {
                    continue;
                }
            }
            return Ok(true);
        }
        Ok(false)
    }
}

// Match the ignore walker's source-type precedence before directory depth:
// .ignore > .gitignore > .git/info/exclude > global excludes. A whitelist
// at a higher-priority tier is final, even if a lower tier says to ignore.
struct ParentIgnorePolicy {
    ignore: Gitignore,
    git: Gitignore,
    exclude: Gitignore,
    has_repository: bool,
}

impl ParentIgnorePolicy {
    fn is_ignored(&self, path: &Path, directory: bool, global: &Gitignore) -> bool {
        let matched = self
            .ignore
            .matched(path, directory)
            .or(self.git.matched(path, directory))
            .or(self.exclude.matched(path, directory));
        if matched.is_none() && self.has_repository {
            global.matched(path, directory).is_ignore()
        } else {
            matched.is_ignore()
        }
    }
}

fn git_policy(parent: &Path) -> Result<ParentIgnorePolicy, IndexerError> {
    let ancestors = parent.ancestors().collect::<Vec<_>>();
    let repository = ancestors
        .iter()
        .position(|directory| directory.join(".git").exists());
    let mut ignore_builder = GitignoreBuilder::new("/");
    let mut git_builder = GitignoreBuilder::new("/");
    let mut exclude_builder = GitignoreBuilder::new("/");
    for (index, directory) in ancestors.iter().enumerate().rev() {
        let ignore = directory.join(".ignore");
        if ignore.is_file() {
            ignore_builder.add(ignore);
        }
        if repository.is_some_and(|repo| index <= repo) {
            let gitignore = directory.join(".gitignore");
            if gitignore.is_file() {
                git_builder.add(gitignore);
            }
        }
    }
    if let Some(repository) = repository {
        let git = ancestors[repository].join(".git");
        let git_dir = if git.is_file() {
            fs::read_to_string(&git).ok().and_then(|value| {
                value.strip_prefix("gitdir:").map(|value| {
                    let path = PathBuf::from(value.trim());
                    if path.is_absolute() {
                        path
                    } else {
                        ancestors[repository].join(path)
                    }
                })
            })
        } else {
            Some(git)
        };
        if let Some(git_dir) = git_dir {
            let exclude = git_dir.join("info/exclude");
            if exclude.is_file() {
                exclude_builder.add(exclude);
            }
        }
    }
    let build = |builder: &mut GitignoreBuilder| {
        builder
            .build()
            .map_err(|error| IndexerError::new("invalid_read_policy", error.to_string()))
    };
    Ok(ParentIgnorePolicy {
        ignore: build(&mut ignore_builder)?,
        git: build(&mut git_builder)?,
        exclude: build(&mut exclude_builder)?,
        has_repository: repository.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        IgnoreRule, IgnoreRuleKind, IndexDatabase, IndexSource, IndexerOperation, IndexerRequest,
        QueryRequest,
    };
    use std::fs::{create_dir_all, write};
    use tempfile::TempDir;

    #[test]
    fn legacy_ignore_precedence_matches_the_actual_walker() {
        let cases = [
            ("private-review.txt\n", "!private-review.txt\n", "", false),
            ("!private-review.txt\n", "private-review.txt\n", "", true),
            ("", "private-review.txt\n", "!private-review.txt\n", false),
            ("", "!private-review.txt\n", "private-review.txt\n", true),
            ("private-review.txt\n", "", "!private-review.txt\n", false),
        ];
        for (ignore, gitignore, exclude, expected) in cases {
            let temp = TempDir::new().unwrap();
            let root = fs::canonicalize(temp.path()).unwrap().join("root");
            create_dir_all(root.join(".git/info")).unwrap();
            write(root.join("private-review.txt"), "fixture").unwrap();
            let mut configuration = IndexConfiguration {
                sources: vec![IndexSource {
                    id: format!("filesystem:{}", root.display()),
                    root: root.clone(),
                    kinds: vec![IndexKind::File],
                    respect_git_ignore: false,
                    include_hidden: false,
                    follow_symlinks: false,
                    max_depth: None,
                }],
                custom_ignores: vec![],
                max_entries: None,
                resource_limits: Default::default(),
                prune_source_prefixes: vec![],
                changed_paths: vec![],
                settings_fingerprint: None,
            };
            let mut old = IndexDatabase::open(temp.path().join("old.sqlite3")).unwrap();
            old.index(&configuration).unwrap();
            write(root.join(".ignore"), ignore).unwrap();
            write(root.join(".gitignore"), gitignore).unwrap();
            write(root.join(".git/info/exclude"), exclude).unwrap();
            configuration.sources[0].respect_git_ignore = true;
            old.handle_request(IndexerRequest {
                id: "policy".into(),
                operation: IndexerOperation::ReadPolicy {
                    configuration: Some(configuration.clone()),
                },
            })
            .unwrap();
            let request = QueryRequest {
                query: "private-review".into(),
                kinds: vec![IndexKind::File],
                limit: Some(160),
            };
            let legacy = old.query(&request).unwrap().records.len();
            let mut fresh = IndexDatabase::open(temp.path().join("fresh.sqlite3")).unwrap();
            fresh.index(&configuration).unwrap();
            let canonical = fresh.query(&request).unwrap().records.len();
            assert_eq!(
                canonical,
                usize::from(expected),
                "walker fixture: {ignore:?}/{gitignore:?}/{exclude:?}"
            );
            assert_eq!(
                legacy, canonical,
                "legacy must preserve walker precedence: {ignore:?}/{gitignore:?}/{exclude:?}"
            );
        }
    }

    #[test]
    fn schema_three_snapshot_remains_searchable_under_current_roots_and_ignore_policy() {
        let temp = TempDir::new().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap().join("active");
        let stale = fs::canonicalize(temp.path()).unwrap().join("old-root");
        create_dir_all(root.join(".git")).unwrap();
        create_dir_all(root.join("legacy-blocked")).unwrap();
        create_dir_all(root.join("legacy-git-parent")).unwrap();
        create_dir_all(&stale).unwrap();
        for name in [
            "legacy-valid.txt",
            "legacy-git.txt",
            "legacy-deleted.txt",
            ".legacy-hidden.txt",
            "legacy-blocked/private.txt",
            "legacy-git-parent/legacy-reincluded.txt",
        ] {
            write(root.join(name), "test").unwrap();
        }
        write(stale.join("legacy-stale.txt"), "stale").unwrap();
        let database = temp.path().join("index.sqlite3");
        let mut writer = IndexDatabase::open(&database).unwrap();
        let source = |root: &Path| IndexSource {
            id: format!("filesystem:{}", root.display()),
            root: root.to_owned(),
            kinds: vec![IndexKind::File, IndexKind::Directory],
            respect_git_ignore: true,
            include_hidden: true,
            follow_symlinks: false,
            max_depth: None,
        };
        let mut config = IndexConfiguration {
            sources: vec![source(&root), source(&stale)],
            custom_ignores: vec![],
            max_entries: None,
            resource_limits: Default::default(),
            prune_source_prefixes: vec![],
            changed_paths: vec![],
            settings_fingerprint: None,
        };
        writer.index(&config).unwrap();
        writer.connection.execute_batch("DROP TRIGGER records_unique_insert; DROP TRIGGER records_unique_delete; DROP TABLE searchable_paths; DELETE FROM metadata WHERE key LIKE 'unique_count:%' OR key LIKE 'source_count:%'; UPDATE metadata SET value = 3 WHERE key = 'schema_version';").unwrap();
        drop(writer);
        write(
            root.join(".gitignore"),
            "legacy-git.txt\nlegacy-git-parent/\n",
        )
        .unwrap();
        write(
            root.join("legacy-git-parent/.gitignore"),
            "!legacy-reincluded.txt\n",
        )
        .unwrap();
        fs::remove_file(root.join("legacy-deleted.txt")).unwrap();
        config.sources = vec![source(&root)];
        config.sources[0].include_hidden = false;
        config.custom_ignores = vec![IgnoreRule {
            kind: IgnoreRuleKind::Glob,
            pattern: "legacy-blocked/**".into(),
        }];
        let mut reader = IndexDatabase::open_reader(&database).unwrap();
        reader
            .handle_request(IndexerRequest {
                id: "policy".into(),
                operation: IndexerOperation::ReadPolicy {
                    configuration: Some(config),
                },
            })
            .unwrap();
        assert_eq!(
            reader.status().unwrap().schema_version,
            3,
            "reader never upgrades the old index synchronously"
        );
        let before = std::time::Instant::now();
        let found = reader
            .query(&QueryRequest {
                query: "legacy".into(),
                kinds: vec![IndexKind::File],
                limit: Some(160),
            })
            .unwrap();
        assert_eq!(
            found
                .records
                .iter()
                .map(|record| record.name.as_str())
                .collect::<Vec<_>>(),
            vec!["legacy-valid.txt"]
        );
        assert!(before.elapsed() < std::time::Duration::from_secs(1));
        assert!(reader
            .lookup(
                &stale.join("legacy-stale.txt").to_string_lossy(),
                IndexKind::File
            )
            .unwrap()
            .is_none());
        // A writer can now migrate while the existing reader keeps its current policy.
        let writer = IndexDatabase::open(&database).unwrap();
        assert_eq!(writer.status().unwrap().schema_version, 4);
        assert_eq!(
            reader
                .query(&QueryRequest {
                    query: "legacy-valid".into(),
                    kinds: vec![IndexKind::File],
                    limit: Some(160)
                })
                .unwrap()
                .records
                .len(),
            1
        );
    }
}
