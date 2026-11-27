//! Live immediate child candidates for the search overlay. Listing never
//! creates sync coverage, modifies committed search rows or follows a symlink.
use crate::{IndexConfiguration, IndexDatabase, IndexerError};
use serde::Serialize;
use std::{collections::BTreeSet, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    paths: Vec<String>,
    next_after: Option<String>,
}

fn unavailable() -> IndexerError {
    IndexerError::new(
        "directory_unavailable",
        "Directory listing is unavailable or changed.",
    )
}

pub(crate) fn list(
    database: &IndexDatabase,
    configuration: &IndexConfiguration,
    path: &Path,
    after: Option<&str>,
    limit: usize,
) -> Result<Page, IndexerError> {
    if limit == 0 || limit > 512 {
        return Err(IndexerError::new(
            "invalid_request",
            "Invalid directory page size.",
        ));
    }
    let observed = database.observe(configuration, &[path.to_owned()])?;
    if !observed
        .observations
        .first()
        .is_some_and(|value| value.descend)
    {
        return Err(unavailable());
    }
    let (previous_stamp, previous_name) = match after {
        None => (None, String::new()),
        Some(cursor) => {
            let (stamp, name): (String, String) =
                serde_json::from_str(cursor).map_err(|_| unavailable())?;
            if name.is_empty() || name.contains('/') || stamp.is_empty() {
                return Err(unavailable());
            }
            (Some(stamp), name)
        }
    };
    let mut names = BTreeSet::new();
    let mut add = |name: &str| {
        if matches!(name, "." | "..") || name <= previous_name.as_str() {
            return;
        }
        if names.len() <= limit
            || names
                .last()
                .is_some_and(|last: &String| name < last.as_str())
        {
            names.insert(name.to_owned());
            if names.len() > limit + 1 {
                names.pop_last();
            }
        }
    };
    let stamp = enumerate(configuration, path, previous_stamp.as_deref(), &mut add)?;
    let more = names.len() > limit;
    if more {
        names.pop_last();
    }
    let next_after = if more {
        Some(serde_json::to_string(&(stamp, names.last())).map_err(|_| unavailable())?)
    } else {
        None
    };
    let paths = names
        .into_iter()
        .map(|name| crate::path_text(&path.join(name)))
        .collect::<Result<_, _>>()?;
    Ok(Page { paths, next_after })
}

#[cfg(unix)]
fn enumerate(
    configuration: &IndexConfiguration,
    path: &Path,
    expected: Option<&str>,
    add: &mut impl FnMut(&str),
) -> Result<String, IndexerError> {
    use crate::backup::{inventory::open_root, open_path, stamp};
    // A configured source may use a system alias such as /var on macOS.
    // Resolve only that root; every descendant is opened from its pinned FD.
    let open = || {
        for source in &configuration.sources {
            let Ok(relative) = path.strip_prefix(&source.root) else {
                continue;
            };
            let canonical = source.root.clone();
            #[cfg(target_vendor = "apple")]
            let canonical = ["/var", "/tmp", "/etc"]
                .into_iter()
                .find_map(|alias| {
                    canonical.strip_prefix(alias).ok().map(|suffix| {
                        let root = Path::new("/private").join(alias.trim_start_matches('/'));
                        if suffix.as_os_str().is_empty() {
                            root
                        } else {
                            root.join(suffix)
                        }
                    })
                })
                .unwrap_or(canonical);
            let Ok(root) = open_root(&canonical) else {
                continue;
            };
            if relative.as_os_str().is_empty() {
                return Ok(root);
            }
            if let Some(relative) = relative.to_str() {
                if let Ok(directory) = open_path(&root, relative) {
                    if directory.metadata().is_ok_and(|meta| meta.is_dir()) {
                        return Ok(directory);
                    }
                }
            }
        }
        Err(unavailable())
    };
    let directory = open()?;
    let before = stamp(&directory.metadata()?);
    if expected.is_some_and(|expected| expected != before) {
        return Err(unavailable());
    }
    let children = rustix::fs::Dir::read_from(&directory).map_err(|_| unavailable())?;
    for child in children {
        let child = child.map_err(|_| unavailable())?;
        // Non-UTF8 paths cannot be represented in the search protocol. Treat
        // the listing as unavailable rather than infer a mixed-page absence.
        add(child.file_name().to_str().map_err(|_| unavailable())?);
    }
    if stamp(&directory.metadata()?) != before || stamp(&open()?.metadata()?) != before {
        return Err(unavailable());
    }
    Ok(before)
}

#[cfg(not(unix))]
fn enumerate(
    configuration: &IndexConfiguration,
    path: &Path,
    expected: Option<&str>,
    add: &mut impl FnMut(&str),
) -> Result<String, IndexerError> {
    let stamp = || {
        for source in &configuration.sources {
            if !path.starts_with(&source.root) {
                continue;
            }
            let mut safe = true;
            for component in path.ancestors().take_while(|p| *p != source.root) {
                if !component
                    .symlink_metadata()
                    .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
                {
                    safe = false;
                    break;
                }
            }
            if safe {
                let meta = path.symlink_metadata()?;
                if meta.is_dir() && !meta.file_type().is_symlink() {
                    return Ok(format!(
                        "{:?}:{:?}:{}",
                        meta.created().ok(),
                        meta.modified().ok(),
                        meta.len()
                    ));
                }
            }
        }
        Err(unavailable())
    };
    let before = stamp()?;
    if expected.is_some_and(|expected| expected != before) {
        return Err(unavailable());
    }
    for child in path.read_dir()? {
        add(child?.file_name().to_str().ok_or_else(unavailable)?);
    }
    if stamp()? != before {
        return Err(unavailable());
    }
    Ok(before)
}
