//! All macOS permission checks for markupR. `check` never prompts.
use crate::ffi::*;
use objc2::{class, msg_send, runtime::Bool};
use objc2_foundation::NSString;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PermissionState { pub screen: bool, pub accessibility: bool, pub input_monitoring: bool, pub microphone: bool }

impl PermissionState {
    pub fn to_json(&self) -> Value {
        json!({ "screen": self.screen, "accessibility": self.accessibility, "input_monitoring": self.input_monitoring, "microphone": self.microphone })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pane { ScreenRecording, Accessibility, InputMonitoring, Microphone }

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    static AVMediaTypeAudio: &'static NSString;
}

const MIC_NOT_DETERMINED: isize = 0;
const MIC_AUTHORIZED: isize = 3;

fn mic_status() -> isize {
    unsafe { msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: AVMediaTypeAudio] }
}

pub fn check() -> PermissionState {
    unsafe {
        PermissionState {
            screen: CGPreflightScreenCaptureAccess(),
            accessibility: AXIsProcessTrusted(),
            input_monitoring: CGPreflightListenEventAccess(),
            microphone: mic_status() == MIC_AUTHORIZED,
        }
    }
}

/// Triggers the system prompt for each missing permission. Prompts the OS has already answered
/// (denied) do not reappear; use `open_settings` for those.
pub fn request_missing() {
    let s = check();
    unsafe {
        if !s.screen { CGRequestScreenCaptureAccess(); }
        if !s.accessibility {
            let keys = [kAXTrustedCheckOptionPrompt as CFTypeRef];
            let values = [kCFBooleanTrue];
            let opts = CFDictionaryCreate(std::ptr::null(), keys.as_ptr(), values.as_ptr(), 1,
                &kCFTypeDictionaryKeyCallBacks as *const _ as _, &kCFTypeDictionaryValueCallBacks as *const _ as _);
            AXIsProcessTrustedWithOptions(opts);
            if !opts.is_null() { CFRelease(opts); }
        }
        if !s.input_monitoring { CGRequestListenEventAccess(); }
        if mic_status() == MIC_NOT_DETERMINED {
            let block = block2::RcBlock::new(|_granted: Bool| {});
            let _: () = msg_send![class!(AVCaptureDevice), requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*block];
        }
    }
}

pub fn open_settings(which: Pane) {
    let anchor = match which {
        Pane::ScreenRecording => "Privacy_ScreenCapture",
        Pane::Accessibility => "Privacy_Accessibility",
        Pane::InputMonitoring => "Privacy_ListenEvent",
        Pane::Microphone => "Privacy_Microphone",
    };
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
    if let Ok(mut child) = std::process::Command::new("/usr/bin/open").arg(url).spawn() {
        let _ = child.wait();
    }
}
