//! Interpret only native, inode-bound link and journal receipts. Nothing in the
//! source tree can authorize its own omission or reinterpretation as a link.
use super::*;

pub(super) enum Projection {
    Raw,
    Skip,
    Link(Entry),
}

pub(super) struct Receipts {
    registry: Option<File>,
}

#[cfg(target_vendor = "apple")]
#[derive(Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Registration {
    identity: String,
    birth: String,
    hash: String,
    symbolic_link: Option<RegisteredLink>,
    journal: bool,
    continuity: Option<String>,
}

#[cfg(target_vendor = "apple")]
use commander_platform::volume_uuid;

#[cfg(target_vendor = "apple")]
#[derive(Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RegisteredLink {
    format: String,
    target_base64: String,
}

#[cfg(target_vendor = "apple")]
fn decode_base64(s: &str) -> Option<Vec<u8>> {
    let mut result = Vec::with_capacity(s.len() / 4 * 3);
    if s.is_empty() || s.len() % 4 != 0 {
        return None;
    }
    for group in s.as_bytes().chunks_exact(4) {
        let mut value = 0u32;
        let mut padding = 0;
        for &c in group {
            let v = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' => {
                    padding += 1;
                    0
                }
                _ => return None,
            };
            value = (value << 6) | u32::from(v);
        }
        let bytes = value.to_be_bytes();
        result.extend_from_slice(bytes.get(1..4usize.checked_sub(padding)?)?);
    }
    (!result.is_empty() && !result.contains(&0) && base64(&result) == s).then_some(result)
}

impl Receipts {
    #[cfg(target_vendor = "apple")]
    fn ambiguous_legacy_journal(
        &self,
        file: &File,
        inode: u64,
        birth: &str,
    ) -> Result<bool, &'static str> {
        let Some(registry) = &self.registry else {
            return Ok(false);
        };
        let uid = rustix::process::geteuid().as_raw();
        let Some(marker) = read_private(file, ".thingtime-owned-journal", uid, 72) else {
            return Ok(false);
        };
        if marker.len() != 72 {
            return Ok(false);
        }
        let proof = format!("{:x}", Sha256::digest(marker));
        let records = rustix::fs::Dir::read_from(registry).map_err(|_| "unreadable")?;
        for entry in records {
            let entry = entry.map_err(|_| "unreadable")?;
            if entry.file_name().to_bytes().len() != 64 {
                continue;
            }
            let Ok(directory) = openat(
                registry,
                entry.file_name(),
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ) else {
                continue;
            };
            let info = rustix::fs::fstat(&directory).map_err(|_| "unreadable")?;
            if info.st_uid != uid || info.st_mode & 0o077 != 0 {
                continue;
            }
            let Some(bytes) = read_private(&directory, "record.json", uid, 65_536) else {
                continue;
            };
            let Ok(row) = serde_json::from_slice::<Registration>(&bytes) else {
                continue;
            };
            if row.journal
                && row.birth == birth
                && row.hash == proof
                && row.identity.rsplit(':').next() == Some(inode.to_string().as_str())
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
    /// Upgrade a validated current-attachment receipt while its original inode
    /// is still attached. This is the same private receipt cache, never source
    /// content or a second filesystem index. Publication uses atomic rename.
    #[cfg(target_vendor = "apple")]
    fn remember_continuity(
        &self,
        receipt: &Registration,
        continuity: Option<&String>,
    ) -> Result<(), &'static str> {
        use rustix::fs::{mkdirat, renameat, unlinkat};
        let (Some(registry), Some(continuity)) = (&self.registry, continuity) else {
            return Ok(());
        };
        let key = format!(
            "{:x}",
            Sha256::digest(format!("persistent:{continuity}").as_bytes())
        );
        match mkdirat(registry, key.as_str(), Mode::from_raw_mode(0o700)) {
            Ok(()) => (),
            Err(rustix::io::Errno::EXIST) => (),
            Err(_) => return Err("native_receipts_unavailable"),
        }
        let directory = File::from(
            openat(
                registry,
                key.as_str(),
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| "native_receipts_unavailable")?,
        );
        let info = directory
            .metadata()
            .map_err(|_| "native_receipts_unavailable")?;
        let uid = rustix::process::geteuid().as_raw();
        if info.uid() != uid || info.mode() & 0o077 != 0 {
            return Err("native_receipts_unavailable");
        }
        let mut canonical = receipt.clone();
        canonical.continuity = Some(continuity.clone());
        if let Some(bytes) = read_private(&directory, "record.json", uid, 65_536) {
            if let Ok(existing) = serde_json::from_slice::<Registration>(&bytes) {
                // The stable alias may have been refreshed on another
                // attachment. Its device number is not part of this proof;
                // UUID/inode/birth plus marker or full envelope hash are.
                if existing.continuity == canonical.continuity
                    && existing.birth == canonical.birth
                    && existing.hash == canonical.hash
                    && existing.journal == canonical.journal
                    && existing.symbolic_link == canonical.symbolic_link
                {
                    return Ok(());
                }
            }
            return Err("native_receipts_unavailable");
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "native_receipts_unavailable")?
            .as_nanos();
        let name = format!("checkpoint-{}-{now}", std::process::id());
        let data = serde_json::to_vec(&canonical).map_err(|_| "native_receipts_unavailable")?;
        let mut file = File::from(
            openat(
                &directory,
                name.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::from_raw_mode(0o600),
            )
            .map_err(|_| "native_receipts_unavailable")?,
        );
        let result = (|| {
            file.write_all(&data)
                .map_err(|_| "native_receipts_unavailable")?;
            file.sync_all().map_err(|_| "native_receipts_unavailable")?;
            renameat(&directory, name.as_str(), &directory, "record.json")
                .map_err(|_| "native_receipts_unavailable")?;
            directory
                .sync_all()
                .map_err(|_| "native_receipts_unavailable")
        })();
        let _ = unlinkat(&directory, name.as_str(), AtFlags::empty());
        result
    }
    pub(super) fn new(path: &Path) -> Result<Self, IndexerError> {
        let registry = match inventory::open_root(path) {
            Ok(file) => Some(file),
            Err(_) if matches!(std::fs::symlink_metadata(path), Err(ref e) if e.kind() == std::io::ErrorKind::NotFound) => {
                None
            }
            Err(_) => return Err(failure("native_receipts_unavailable")),
        };
        Ok(Self { registry })
    }

    #[cfg(not(target_vendor = "apple"))]
    pub(super) fn inspect(
        &self,
        _: &File,
        _: &str,
        _: &ResourceGovernor,
        _: &AtomicBool,
    ) -> Result<Projection, &'static str> {
        let _ = &self.registry;
        Ok(Projection::Raw)
    }

    #[cfg(target_vendor = "apple")]
    pub(super) fn inspect(
        &self,
        root: &File,
        path: &str,
        governor: &ResourceGovernor,
        cancelled: &AtomicBool,
    ) -> Result<Projection, &'static str> {
        let Some(registry) = &self.registry else {
            return Ok(Projection::Raw);
        };
        let (parent_path, name) = path.rsplit_once('/').unwrap_or(("", path));
        let parent = if parent_path.is_empty() {
            root.try_clone().map_err(|_| "unreadable")?
        } else {
            open_path(root, parent_path)?
        };
        let before = statat(&parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(io_reason)?;
        let kind = FileType::from_raw_mode(before.st_mode);
        if !matches!(kind, FileType::Directory | FileType::RegularFile) {
            return Ok(Projection::Raw);
        }
        let identity = format!("{}:{}", before.st_dev, before.st_ino);
        let birth = format!("{}:{}", before.st_birthtime, before.st_birthtime_nsec);
        let parent_info = rustix::fs::fstat(&parent).map_err(|_| "unreadable")?;
        let volume = if parent_info.st_dev == before.st_dev {
            volume_uuid(&parent)
        } else {
            open_path(root, path)
                .ok()
                .and_then(|file| volume_uuid(&file))
        };
        let continuity = volume.map(|uuid| format!("{uuid}:{}:{birth}", before.st_ino));
        let keys = std::iter::once(identity.clone()).chain(
            continuity
                .as_ref()
                .map(|value| format!("persistent:{value}")),
        );
        let uid = rustix::process::geteuid().as_raw();
        let receipt = keys
            .filter_map(|key| {
                let key = format!("{:x}", Sha256::digest(key.as_bytes()));
                let receipt_dir = openat(
                    registry,
                    key.as_str(),
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )
                .ok()?;
                let info = rustix::fs::fstat(&receipt_dir).ok()?;
                if info.st_uid != uid || info.st_mode & 0o077 != 0 {
                    return None;
                }
                let data = read_private(&receipt_dir, "record.json", uid, 65_536)?;
                let receipt = serde_json::from_slice::<Registration>(&data).ok()?;
                (receipt.birth == birth
                    && ((receipt.continuity.is_none() && receipt.identity == identity)
                        || (receipt.continuity.is_some()
                            && continuity.is_some()
                            && receipt.continuity == continuity)))
                    .then_some(receipt)
            })
            .next();
        let Some(receipt) = receipt else {
            if kind == FileType::Directory {
                let file = open_path(root, path)?;
                let actual = rustix::fs::fstat(&file).map_err(|_| "unreadable")?;
                if actual.st_dev != before.st_dev
                    || actual.st_ino != before.st_ino
                    || actual.st_birthtime != before.st_birthtime
                    || actual.st_birthtime_nsec != before.st_birthtime_nsec
                {
                    return Err("changed");
                }
                if self.ambiguous_legacy_journal(&file, before.st_ino, &birth)? {
                    return Err("unreadable");
                }
            }
            return Ok(Projection::Raw);
        };
        let mut file = open_path(root, path)?;
        let opened = rustix::fs::fstat(&file).map_err(|_| "unreadable")?;
        if opened.st_dev != before.st_dev
            || opened.st_ino != before.st_ino
            || opened.st_birthtime != before.st_birthtime
            || opened.st_birthtime_nsec != before.st_birthtime_nsec
        {
            return Err("changed");
        }
        if receipt.journal && kind == FileType::Directory {
            if let Some(bytes) = read_private(&file, ".thingtime-owned-journal", uid, 72) {
                if bytes.len() == 72 && format!("{:x}", Sha256::digest(bytes)) == receipt.hash {
                    self.remember_continuity(&receipt, continuity.as_ref())?;
                    return Ok(Projection::Skip);
                }
            }
        }
        if receipt.journal || kind != FileType::RegularFile {
            return Ok(Projection::Raw);
        }
        let Some(link) = receipt.symbolic_link.as_ref() else {
            return Ok(Projection::Raw);
        };
        if link.format != "posix-symlink-v1" {
            return Ok(Projection::Raw);
        }
        let Some(target) = decode_base64(&link.target_base64) else {
            return Ok(Projection::Raw);
        };
        // The bound is for the private receipt/envelope only. Unrecognized
        // regular files, of any size, remain regular files.
        let meta = file.metadata().map_err(|_| "unreadable")?;
        if meta.size() > 65_536 || meta.size() == 0 {
            return Ok(Projection::Raw);
        }
        let mut envelope = Vec::new();
        governor
            .pace_scan(meta.size() as usize, cancelled)
            .map_err(|_| "cancelled")?;
        (&mut file)
            .take(meta.size() + 1)
            .read_to_end(&mut envelope)
            .map_err(|_| "unreadable")?;
        governor.record_scan(envelope.len());
        if envelope.len() as u64 != meta.size()
            || format!("{:x}", Sha256::digest(&envelope)) != receipt.hash
        {
            return Ok(Projection::Raw);
        }
        let version = stamp(&meta);
        if stamp(&file.metadata().map_err(|_| "unreadable")?) != version
            || stamp(
                &open_path(root, path)?
                    .metadata()
                    .map_err(|_| "unreadable")?,
            ) != version
        {
            return Err("changed");
        }
        self.remember_continuity(&receipt, continuity.as_ref())?;
        Ok(Projection::Link(Entry {
            path: path.to_owned(),
            id: identity,
            version,
            kind: "file",
            size: target.len() as u64,
            sha256: None,
            fingerprint: Some(Fingerprint {
                algorithm: "sha256-parts-v1",
                part_size_bytes: 8_388_608,
                part_count: 1,
                sha256: format!("{:x}", Sha256::digest(Sha256::digest(&target))),
            }),
            symbolic_link: Some(SymbolicLink {
                format: "posix-symlink-v1",
                target_base64: link.target_base64.clone(),
            }),
        }))
    }
}

#[cfg(target_vendor = "apple")]
fn read_private(
    directory: impl std::os::fd::AsFd,
    name: &str,
    uid: u32,
    maximum: usize,
) -> Option<Vec<u8>> {
    let fd = openat(
        directory,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    )
    .ok()?;
    let file = File::from(fd);
    let info = file.metadata().ok()?;
    if !info.is_file()
        || info.nlink() != 1
        || info.uid() != uid
        || info.mode() & 0o077 != 0
        || info.size() == 0
        || info.size() > maximum as u64
    {
        return None;
    }
    let mut data = Vec::new();
    file.take(maximum as u64 + 1).read_to_end(&mut data).ok()?;
    (data.len() as u64 == info.size()).then_some(data)
}
