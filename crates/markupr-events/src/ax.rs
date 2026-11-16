//! Accessibility lookups: the element under the cursor and the focused app/window.
use crate::ffi::*;
use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
use objc2_foundation::NSString;
use serde_json::{Map, Value};

const EL_TIMEOUT_S: f32 = 0.15;
const FOCUS_TIMEOUT_S: f32 = 0.25;
const EL_MAX_CHARS: usize = 80;

pub fn cap(s: &str, n: usize) -> String { s.chars().take(n).collect() }

/// Owned CF object, released on drop.
struct Cf(CFTypeRef);
impl Drop for Cf {
    fn drop(&mut self) { if !self.0.is_null() { unsafe { CFRelease(self.0) } } }
}

fn cfstr(s: &str) -> Retained<NSString> { NSString::from_str(s) }

/// Copy a string attribute. `Err(())` means the app did not answer in time; stop asking it.
fn attr_string(el: AXUIElementRef, name: &str) -> Result<Option<String>, ()> {
    let key = cfstr(name);
    let mut out: CFTypeRef = std::ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(el, Retained::as_ptr(&key).cast(), &mut out) };
    if err == AX_ERROR_CANNOT_COMPLETE { return Err(()); }
    if err != 0 || out.is_null() { return Ok(None); }
    let out = Cf(out);
    if unsafe { CFGetTypeID(out.0) != CFStringGetTypeID() } { return Ok(None); }
    let s = unsafe { &*(out.0 as *const NSString) }.to_string();
    Ok(Some(s).filter(|s| !s.is_empty()))
}

fn attr_element(el: AXUIElementRef, name: &str) -> Option<Cf> {
    let key = cfstr(name);
    let mut out: CFTypeRef = std::ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(el, Retained::as_ptr(&key).cast(), &mut out) };
    (err == 0 && !out.is_null()).then(|| Cf(out))
}

/// Element under a global point: role, subrole, title, label (AXDescription), and value only for
/// static text. Text-entry and secure fields never have their value read. None on any failure.
pub fn element_at(x: f64, y: f64) -> Option<Value> {
    objc2::rc::autoreleasepool(|_| {
        let sys = Cf(unsafe { AXUIElementCreateSystemWide() });
        unsafe { AXUIElementSetMessagingTimeout(sys.0, EL_TIMEOUT_S) };
        let mut el: AXUIElementRef = std::ptr::null();
        if unsafe { AXUIElementCopyElementAtPosition(sys.0, x as f32, y as f32, &mut el) } != 0 || el.is_null() {
            return None;
        }
        let el = Cf(el);
        unsafe { AXUIElementSetMessagingTimeout(el.0, EL_TIMEOUT_S) };
        let role = attr_string(el.0, "AXRole").ok()??;
        let mut m = Map::new();
        m.insert("role".into(), Value::String(cap(&role, EL_MAX_CHARS)));
        let mut fields = vec![("subrole", "AXSubrole"), ("title", "AXTitle"), ("label", "AXDescription")];
        // Allowlist: the only role whose value is read. Never AXTextField/AXTextArea/AXSecureTextField,
        // and never static text that sits inside one (rich editors expose typed text that way).
        if role == "AXStaticText" && !inside_text_entry(el.0) { fields.push(("value", "AXValue")); }
        for (key, attr) in fields {
            match attr_string(el.0, attr) {
                Ok(Some(v)) => { m.insert(key.into(), Value::String(cap(&v, EL_MAX_CHARS))); }
                Ok(None) => {}
                Err(()) => break,
            }
        }
        Some(Value::Object(m))
    })
}

/// True when an ancestor (up to 6 levels) is a text-entry or secure field, or the walk fails.
fn inside_text_entry(el: AXUIElementRef) -> bool {
    const ENTRY: [&str; 4] = ["AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"];
    let mut cur = attr_element(el, "AXParent");
    for _ in 0..6 {
        let Some(p) = cur else { return false };
        unsafe { AXUIElementSetMessagingTimeout(p.0, EL_TIMEOUT_S) };
        let (Ok(role), Ok(sub)) = (attr_string(p.0, "AXRole"), attr_string(p.0, "AXSubrole")) else { return true };
        if [role, sub].iter().flatten().any(|r| ENTRY.contains(&r.as_str())) { return true; }
        cur = attr_element(p.0, "AXParent");
    }
    false
}

#[derive(Clone, PartialEq, Debug)]
pub struct Focus { pub pid: i32, pub app: Option<String>, pub bundle: Option<String>, pub window: Option<String> }

/// Frontmost app and its focused window title, from Accessibility when `use_ax`, else from the
/// window list (front-most layer-0 window).
pub fn focus(use_ax: bool) -> Option<Focus> {
    objc2::rc::autoreleasepool(|_| {
        let (pid, window) = if use_ax { focus_ax()? } else { focus_window_list()? };
        let (app, bundle) = app_names(pid);
        Some(Focus { pid, app, bundle, window: window.map(|w| cap(&w, 200)) })
    })
}

fn focus_ax() -> Option<(i32, Option<String>)> {
    let sys = Cf(unsafe { AXUIElementCreateSystemWide() });
    unsafe { AXUIElementSetMessagingTimeout(sys.0, FOCUS_TIMEOUT_S) };
    let app = attr_element(sys.0, "AXFocusedApplication")?;
    let mut pid = 0;
    if unsafe { AXUIElementGetPid(app.0, &mut pid) } != 0 { return None; }
    unsafe { AXUIElementSetMessagingTimeout(app.0, FOCUS_TIMEOUT_S) };
    let window = attr_element(app.0, "AXFocusedWindow").and_then(|w| attr_string(w.0, "AXTitle").ok().flatten());
    Some((pid, window))
}

fn focus_window_list() -> Option<(i32, Option<String>)> {
    // kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements
    let list = Cf(unsafe { CGWindowListCopyWindowInfo(1 | 16, 0) });
    if list.0.is_null() { return None; }
    let arr = list.0 as *const AnyObject;
    let n: usize = unsafe { msg_send![arr, count] };
    for i in 0..n {
        let d: *const AnyObject = unsafe { msg_send![arr, objectAtIndex: i] };
        let num = |k: &str| -> Option<i64> {
            let v: *const AnyObject = unsafe { msg_send![d, objectForKey: &*cfstr(k)] };
            (!v.is_null()).then(|| unsafe { msg_send![v, longLongValue] })
        };
        if num("kCGWindowLayer") != Some(0) { continue; }
        let pid = num("kCGWindowOwnerPID")? as i32;
        let name: *const NSString = unsafe { msg_send![d, objectForKey: &*cfstr("kCGWindowName")] };
        let window = (!name.is_null()).then(|| unsafe { &*name }.to_string()).filter(|s| !s.is_empty());
        return Some((pid, window));
    }
    None
}

fn app_names(pid: i32) -> (Option<String>, Option<String>) {
    let app: Option<Retained<AnyObject>> = unsafe { msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid] };
    let Some(app) = app else { return (None, None) };
    let name: Option<Retained<NSString>> = unsafe { msg_send![&*app, localizedName] };
    let bundle: Option<Retained<NSString>> = unsafe { msg_send![&*app, bundleIdentifier] };
    (name.map(|s| s.to_string()), bundle.map(|s| s.to_string()))
}

#[link(name = "AppKit", kind = "framework")]
extern "C" {}
