//! In-process transport for sandboxed Apple hosts. No filesystem authority is
//! obtained here: the host must hold its authorized bookmark scope throughout
//! execution. The private JSON protocol is identical to the desktop helper.
// Descriptor-backed inventory currently targets Unix native hosts.
#![cfg(unix)]

use std::{
    ffi::c_void,
    io::{self, Cursor, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[no_mangle]
pub extern "C" fn commander_inventory_abi_version() -> u32 {
    1
}

pub struct InventorySession {
    database: PathBuf,
    cancelled: Arc<AtomicBool>,
    busy: AtomicBool,
    error_code: Mutex<&'static str>,
}
pub type Output = unsafe extern "C" fn(*mut c_void, *const u8, usize) -> bool;

/// The returned session belongs to the caller. Database bytes must be valid UTF-8.
/// Execute once, optionally cancel concurrently, then destroy after execute joins.
#[no_mangle]
pub unsafe extern "C" fn commander_inventory_create(
    path: *const u8,
    length: usize,
) -> *mut InventorySession {
    if path.is_null() || length == 0 {
        return std::ptr::null_mut();
    }
    let Ok(path) = std::str::from_utf8(std::slice::from_raw_parts(path, length)) else {
        return std::ptr::null_mut();
    };
    if path.contains('\0') || !std::path::Path::new(path).is_absolute() {
        return std::ptr::null_mut();
    }
    Box::into_raw(Box::new(InventorySession {
        database: PathBuf::from(path),
        cancelled: Arc::new(AtomicBool::new(false)),
        busy: AtomicBool::new(false),
        error_code: Mutex::new(""),
    }))
}
struct CallbackWriter {
    context: *mut c_void,
    output: Output,
    cancelled: Arc<AtomicBool>,
}
impl Write for CallbackWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.cancelled.load(Ordering::Acquire)
            || !unsafe { (self.output)(self.context, bytes.as_ptr(), bytes.len()) }
        {
            self.cancelled.store(true, Ordering::Release);
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "inventory output cancelled",
            ));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
/// Status: 0 success, 1 invalid invocation, 2 concurrent execution, 3 cancelled,
/// 4 operation failed, 5 Rust panic. Never return private paths or raw errors.
#[no_mangle]
pub unsafe extern "C" fn commander_inventory_execute(
    session: *mut InventorySession,
    request: *const u8,
    length: usize,
    context: *mut c_void,
    output: Option<Output>,
) -> i32 {
    if session.is_null() || request.is_null() || length == 0 || output.is_none() {
        return 1;
    }
    let session = &*session;
    if session.busy.swap(true, Ordering::AcqRel) {
        return 2;
    }
    struct Busy<'a>(&'a AtomicBool);
    impl Drop for Busy<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _busy = Busy(&session.busy);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        commander_indexer::backup::inventory::serve_with_cancellation(
            &session.database,
            Cursor::new(std::slice::from_raw_parts(request, length)),
            CallbackWriter {
                context,
                output: output.unwrap(),
                cancelled: session.cancelled.clone(),
            },
            session.cancelled.clone(),
        )
    }));
    if session.cancelled.load(Ordering::Acquire) {
        return 3;
    }
    match result {
        Ok(Ok(())) => 0,
        Ok(Err(error)) => {
            if let Ok(mut code) = session.error_code.lock() {
                *code = error.code;
            }
            4
        }
        Err(_) => 5,
    }
}
/// Copies only a stable machine code; never includes source paths or messages.
#[no_mangle]
pub unsafe extern "C" fn commander_inventory_error_code(
    session: *mut InventorySession,
    output: *mut u8,
    capacity: usize,
) -> usize {
    let Some(session) = session.as_ref() else {
        return 0;
    };
    if output.is_null() {
        return 0;
    }
    let Ok(code) = session.error_code.lock() else {
        return 0;
    };
    if code.len() > capacity
        || !code
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return 0;
    }
    std::ptr::copy_nonoverlapping(code.as_ptr(), output, code.len());
    code.len()
}
#[no_mangle]
pub unsafe extern "C" fn commander_inventory_cancel(session: *mut InventorySession) {
    if let Some(session) = session.as_ref() {
        session.cancelled.store(true, Ordering::Release);
    }
}
/// Caller must join execute and all cancel calls before destruction.
#[no_mangle]
pub unsafe extern "C" fn commander_inventory_destroy(session: *mut InventorySession) {
    if !session.is_null() {
        drop(Box::from_raw(session));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    unsafe extern "C" fn collect(context: *mut c_void, bytes: *const u8, length: usize) -> bool {
        (&mut *(context as *mut Vec<u8>))
            .extend_from_slice(std::slice::from_raw_parts(bytes, length));
        true
    }
    unsafe extern "C" fn refuse(_: *mut c_void, _: *const u8, _: usize) -> bool {
        false
    }
    #[test]
    fn output_refusal_terminates_write_all_instead_of_retrying_forever() {
        unsafe {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("index.sqlite3");
            let path = path.to_str().unwrap();
            let session = commander_inventory_create(path.as_ptr(), path.len());
            let request = b"{\"version\":1,\"operation\":\"status\",\"scope\":{\"origin\":\"https://thingtime.com\",\"accountId\":\"test\",\"deviceId\":\"test\",\"rootId\":\"test\"},\"generation\":\"missing\"}\n";
            assert_eq!(
                commander_inventory_execute(
                    session,
                    request.as_ptr(),
                    request.len(),
                    std::ptr::null_mut(),
                    Some(refuse)
                ),
                3
            );
            commander_inventory_destroy(session);
        }
    }
    #[test]
    fn rejects_relative_database_and_invalid_utf8() {
        unsafe {
            assert!(commander_inventory_create(b"relative".as_ptr(), 8).is_null());
            assert!(commander_inventory_create([255].as_ptr(), 1).is_null());
        }
    }
    #[test]
    fn scans_through_real_core_and_cancellation_is_sticky() {
        unsafe {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("files");
            std::fs::create_dir(&root).unwrap();
            std::fs::write(root.join("hello.txt"), b"hello").unwrap();
            let root = root.canonicalize().unwrap();
            use std::os::unix::fs::MetadataExt;
            let metadata = std::fs::metadata(&root).unwrap();
            let path = dir.path().join("index.sqlite3");
            let path = path.to_str().unwrap();
            let session = commander_inventory_create(path.as_ptr(), path.len());
            assert!(!session.is_null());
            let request = format!(
                "{}\n",
                serde_json::json!({"version":1,"operation":"scan","scope":{"origin":"https://thingtime.com","accountId":"synthetic","deviceId":"test","rootId":"root"},"generation":"ffi-test","mode":"backup","root":root,"rootIdentity":format!("{}:{}",metadata.dev(),metadata.ino()),"excludedPaths":[]})
            );
            let mut output = Vec::<u8>::new();
            assert_eq!(
                commander_inventory_execute(
                    session,
                    request.as_ptr(),
                    request.len(),
                    &mut output as *mut _ as *mut c_void,
                    Some(collect)
                ),
                0
            );
            let text = String::from_utf8(output).unwrap();
            assert!(text.contains("hello.txt"));
            assert!(text.contains("complete"));
            commander_inventory_cancel(session);
            assert_eq!(
                commander_inventory_execute(
                    session,
                    request.as_ptr(),
                    request.len(),
                    std::ptr::null_mut(),
                    Some(collect)
                ),
                3
            );
            commander_inventory_destroy(session);
        }
    }
}
