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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registration {
    identity: String,
    birth: String,
    hash: String,
    symbolic_link: Option<RegisteredLink>,
    journal: bool,
}

#[cfg(target_vendor = "apple")]
#[derive(Deserialize)]
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
        let key = format!("{:x}", Sha256::digest(identity.as_bytes()));
        let Ok(receipt_dir) = openat(
            registry,
            key.as_str(),
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) else {
            return Ok(Projection::Raw);
        };
        let uid = rustix::process::geteuid().as_raw();
        let info = rustix::fs::fstat(&receipt_dir).map_err(|_| "unreadable")?;
        if info.st_uid != uid || info.st_mode & 0o077 != 0 {
            return Ok(Projection::Raw);
        }
        let Some(data) = read_private(&receipt_dir, "record.json", uid, 65_536) else {
            return Ok(Projection::Raw);
        };
        let Ok(receipt) = serde_json::from_slice::<Registration>(&data) else {
            return Ok(Projection::Raw);
        };
        if receipt.identity != identity || receipt.birth != birth {
            return Ok(Projection::Raw);
        }
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
                    return Ok(Projection::Skip);
                }
            }
        }
        if receipt.journal || kind != FileType::RegularFile {
            return Ok(Projection::Raw);
        }
        let Some(link) = receipt.symbolic_link else {
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
                target_base64: link.target_base64,
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
