//! Narrow OS metadata adapter. No traversal, paths, process execution or IO
//! authority is added: the caller already owns the open descriptor.
#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(target_vendor = "apple")]
pub fn volume_uuid(file: &std::fs::File) -> Option<String> {
    use std::os::fd::AsRawFd;
    let mut attributes = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: 0,
        volattr: libc::ATTR_VOL_INFO | libc::ATTR_VOL_UUID,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    // getattrlist packs a four-byte length followed by the requested UUID.
    let mut bytes = [0u8; 20];
    // SAFETY: File keeps fd valid for this call. Both stack allocations are
    // live, writable and their exact sizes are supplied. No returned pointer
    // is followed; only the fixed-size UUID is read after length validation.
    let result = unsafe {
        libc::fgetattrlist(
            file.as_raw_fd(),
            (&mut attributes as *mut libc::attrlist).cast(),
            bytes.as_mut_ptr().cast(),
            bytes.len(),
            0,
        )
    };
    if result != 0 || u32::from_ne_bytes(bytes[0..4].try_into().ok()?) != 20 {
        return None;
    }
    let value: String = bytes[4..]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Some(format!(
        "{}-{}-{}-{}-{}",
        &value[0..8],
        &value[8..12],
        &value[12..16],
        &value[16..20],
        &value[20..32]
    ))
}

#[cfg(not(target_vendor = "apple"))]
pub fn volume_uuid(_: &std::fs::File) -> Option<String> {
    None
}

#[cfg(all(test, target_vendor = "apple"))]
mod tests {
    #[test]
    fn uuid_is_descriptor_scoped_and_stable_across_reopen() {
        let first = std::fs::File::open(std::env::temp_dir()).unwrap();
        let second = std::fs::File::open(std::env::temp_dir()).unwrap();
        let uuid = super::volume_uuid(&first).expect("local macOS test volume UUID");
        assert_eq!(uuid.len(), 36);
        assert_eq!(super::volume_uuid(&second), Some(uuid));
    }
}
