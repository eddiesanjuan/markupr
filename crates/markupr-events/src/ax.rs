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

/// Copy a string attribute. `Ok(None)` when absent; `Err(())` on any other error (timeout, cannot complete).
fn attr_string(el: AXUIElementRef, name: &str) -> Result<Option<String>, ()> {
    let key = cfstr(name);
    let mut out: CFTypeRef = std::ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(el, Retained::as_ptr(&key).cast(), &mut out) };
    if err == AX_ERROR_NO_VALUE || err == AX_ERROR_ATTRIBUTE_UNSUPPORTED || (err == 0 && out.is_null()) { return Ok(None); }
    if err != 0 { return Err(()); }
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

/// What a mouse_down landed on.
#[derive(Debug, PartialEq)]
pub enum Hit {
    /// An element of this very process (markupR's menu bar item or pop-up): tag `self`, no `el`.
    Own,
    /// Anything else; `el` when it could be read.
    Other(Option<Value>),
}

/// The tagging decision. An unreadable pid is never tagged.
pub fn is_own(el_pid: Option<i32>, own_pid: u32) -> bool { el_pid.is_some_and(|p| p > 0 && p as u32 == own_pid) }

/// Element under a global point: role, subrole, title, label (AXDescription), and value only for
/// static text. Our own elements are not queried further (our main thread may be busy with the menu).
pub fn element_at(x: f64, y: f64) -> Hit {
    objc2::rc::autoreleasepool(|_| {
        let sys = Cf(unsafe { AXUIElementCreateSystemWide() });
        unsafe { AXUIElementSetMessagingTimeout(sys.0, EL_TIMEOUT_S) };
        let mut el: AXUIElementRef = std::ptr::null();
        if unsafe { AXUIElementCopyElementAtPosition(sys.0, x as f32, y as f32, &mut el) } != 0 || el.is_null() {
            return Hit::Other(None);
        }
        let el = Cf(el);
        // Local read, no message to the owning app.
        let mut pid = 0;
        let pid = (unsafe { AXUIElementGetPid(el.0, &mut pid) } == 0).then_some(pid);
        if is_own(pid, std::process::id()) { return Hit::Own; }
        Hit::Other(element_info(el.0))
    })
}

fn element_info(el: AXUIElementRef) -> Option<Value> {
    unsafe { AXUIElementSetMessagingTimeout(el, EL_TIMEOUT_S) };
    let role = attr_string(el, "AXRole").ok()??;
    let mut m = Map::new();
    m.insert("role".into(), Value::String(cap(&role, EL_MAX_CHARS)));
    let mut fields = vec![("subrole", "AXSubrole")];
    if !walk_says_inside(ancestors(el)) {
        fields.extend([("title", "AXTitle"), ("label", "AXDescription")]);
        // Allowlist: the only role whose value is read.
        if role == "AXStaticText" { fields.push(("value", "AXValue")); }
    }
    for (key, attr) in fields {
        match attr_string(el, attr) {
            Ok(Some(v)) => { m.insert(key.into(), Value::String(cap(&v, EL_MAX_CHARS))); }
            Ok(None) => {}
            Err(()) => break,
        }
    }
    Some(Value::Object(m))
}

/// One step of the walk up AXParent.
#[derive(Debug)]
enum Ancestor {
    /// A parent exists; its role and subrole (None when the attribute is absent).
    Node { role: Option<String>, subrole: Option<String> },
    /// AXParent is absent (no value / unsupported): the top of the tree.
    Top,
    /// The parent or its role could not be read (timeout, cannot complete, any other error).
    Unknown,
}

const WALK_MAX_DEPTH: usize = 20;
const TEXT_ENTRY: [&str; 4] = ["AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"];
const SAFE_BOUNDARY: [&str; 3] = ["AXWebArea", "AXWindow", "AXApplication"];

/// Fail closed: "not inside" only on reaching the top or a web area / window / application
/// boundary. A text-entry ancestor, an unreadable step, or running past the depth limit is inside.
fn walk_says_inside(steps: impl IntoIterator<Item = Ancestor>) -> bool {
    for step in steps.into_iter().take(WALK_MAX_DEPTH) {
        match step {
            Ancestor::Top => return false,
            Ancestor::Unknown => return true,
            Ancestor::Node { role, subrole } => {
                let names = [role.as_deref(), subrole.as_deref()];
                if names.iter().flatten().any(|n| TEXT_ENTRY.contains(n)) { return true; }
                if role.as_deref().is_some_and(|r| SAFE_BOUNDARY.contains(&r)) { return false; }
            }
        }
    }
    true
}

/// Lazily reads ancestors of `el`, stopping after Top or Unknown.
fn ancestors(el: AXUIElementRef) -> impl Iterator<Item = Ancestor> {
    let mut cur: Option<Cf> = None;
    let mut done = false;
    std::iter::from_fn(move || {
        if done { return None; }
        let from = cur.as_ref().map_or(el, |c| c.0);
        let key = cfstr("AXParent");
        let mut out: CFTypeRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(from, Retained::as_ptr(&key).cast(), &mut out) };
        let step = match (err, out.is_null()) {
            (0, false) => {
                let p = Cf(out);
                unsafe { AXUIElementSetMessagingTimeout(p.0, EL_TIMEOUT_S) };
                let step = match (attr_string(p.0, "AXRole"), attr_string(p.0, "AXSubrole")) {
                    (Ok(role), Ok(subrole)) => Ancestor::Node { role, subrole },
                    _ => Ancestor::Unknown,
                };
                cur = Some(p);
                step
            }
            (AX_ERROR_NO_VALUE | AX_ERROR_ATTRIBUTE_UNSUPPORTED, _) | (0, true) => Ancestor::Top,
            _ => Ancestor::Unknown,
        };
        done = !matches!(step, Ancestor::Node { .. });
        Some(step)
    })
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

#[cfg(test)]
mod tests {
    /// Bug guarded: a click on markupR's own menu bar item or pop-up is reported as a user click.
    #[test]
    fn click_on_our_own_menu_is_reported_as_a_user_click() {
        let me = std::process::id();
        assert!(super::is_own(Some(me as i32), me), "our own element is tagged");
        assert!(!super::is_own(Some(me as i32 + 1), me), "another app's element is not");
        assert!(!super::is_own(None, me), "unreadable pid is not tagged");
        assert!(!super::is_own(Some(-1), u32::MAX), "negative pid never matches");
    }

    use super::{walk_says_inside, Ancestor::{self, *}, WALK_MAX_DEPTH};
    fn node(role: &str) -> Ancestor { Node { role: Some(role.into()), subrole: None } }

    /// Bug guarded: static text inside a rich editor had its AXValue written because a failed
    /// parent lookup, or a walk deeper than the limit, ended as "not inside a text field".
    #[test]
    fn failed_parent_lookup_lets_static_text_through() {
        assert!(walk_says_inside([node("AXGroup"), Unknown]), "timeout / cannot complete");
        assert!(walk_says_inside([Unknown]), "first parent lookup fails");
        assert!(walk_says_inside([Node { role: None, subrole: None }, Unknown]), "role unreadable then failure");
        assert!(walk_says_inside((0..WALK_MAX_DEPTH + 5).map(|_| node("AXGroup"))), "deeper than the limit");
        assert!(walk_says_inside([node("AXGroup"), node("AXTextArea"), node("AXWindow")]), "text area ancestor");
        assert!(walk_says_inside([Node { role: Some("AXTextField".into()), subrole: Some("AXSecureTextField".into()) }]), "secure field");
        assert!(walk_says_inside([Node { role: Some("AXGroup".into()), subrole: Some("AXSecureTextField".into()) }]), "secure by subrole");
        assert!(walk_says_inside(Vec::<Ancestor>::new()), "no steps at all");
        assert!(!walk_says_inside([node("AXGroup"), node("AXWebArea"), node("AXTextArea")]), "web area boundary first");
        assert!(!walk_says_inside([node("AXGroup"), node("AXWindow")]), "window boundary");
        assert!(!walk_says_inside([node("AXApplication")]), "application boundary");
        assert!(!walk_says_inside([node("AXGroup"), Top]), "reached the top");
    }
}
