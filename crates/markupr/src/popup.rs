use crate::{ui_debug, UserEvent};
use anyhow::{anyhow, Result};
use markupr_core::{session::Status, PackDir, Session};
use objc2::{define_class, msg_send, rc::Retained, sel, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSBezelStyle, NSButton, NSColor, NSEvent, NSFont, NSPanel,
    NSPopUpMenuWindowLevel, NSScreen, NSTextField, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_foundation::{
    MainThreadMarker, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use tao::event_loop::EventLoopProxy;

#[derive(Clone, Copy, Debug)]
pub enum Action {
    Copy,
    Finder,
    Close,
}

// Buttons hold a non-retaining target; Popup retains it until the panel is gone.
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = EventLoopProxy<UserEvent>]
    struct Actions;
    unsafe impl NSObjectProtocol for Actions {}
    impl Actions {
        #[unsafe(method(copyPrompt:))]
        fn copy_prompt(&self, _sender: &NSButton) { let _ = self.ivars().send_event(UserEvent::Popup(Action::Copy)); }
        #[unsafe(method(showFinder:))]
        fn show_finder(&self, _sender: &NSButton) { let _ = self.ivars().send_event(UserEvent::Popup(Action::Finder)); }
        #[unsafe(method(closePopup:))]
        fn close_popup(&self, _sender: &NSButton) { let _ = self.ivars().send_event(UserEvent::Popup(Action::Close)); }
    }
);

// The controls must never move keyboard focus away from the owner's work.
define_class!(
    #[unsafe(super = NSPanel)]
    #[thread_kind = MainThreadOnly]
    struct PackPanel;
    impl PackPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool { false }
        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool { false }
    }
);

pub struct Popup {
    panel: Retained<PackPanel>,
    copy: Option<Retained<NSButton>>,
    _actions: Retained<Actions>,
    pub dir: PathBuf,
    pub deadline: Instant,
    pub reason: &'static str,
}
impl Popup {
    pub fn show(
        dir: PathBuf,
        report: Option<&markupr_pack::PackReport>,
        proxy: EventLoopProxy<UserEvent>,
    ) -> Result<Self> {
        let pack = PackDir::open(&dir)?;
        let session = Session::load(&pack)?;
        let failed = session.status != Status::Ready;
        let detail = if failed {
            "Pack processing failed. Open the folder for details.".to_owned()
        } else {
            let items = match report {
                Some(report) => report.items,
                None => {
                    let moments: serde_json::Value =
                        serde_json::from_slice(&fs::read(pack.moments())?)?;
                    moments["items"]
                        .as_array()
                        .ok_or_else(|| anyhow!("moments.json has no items array"))?
                        .len()
                }
            };
            format!(
                "{items} items, {:.0} s recorded, ready in {:.1} s",
                session.duration.unwrap_or(0.0),
                session.timing.stop_to_ready_ms.unwrap_or(0) as f64 / 1000.0
            )
        };
        let notice = if failed {
            None
        } else {
            let words = report.map(|report| report.words).unwrap_or_else(|| {
                fs::read(pack.transcript_json())
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                    .and_then(|transcript| {
                        transcript["segments"].as_array().map(|segments| {
                            segments
                                .iter()
                                .map(|segment| segment["words"].as_array().map_or(0, Vec::len))
                                .sum()
                        })
                    })
                    .unwrap_or(0)
            });
            let mut missing = Vec::new();
            if session.mic.is_none() {
                missing.push("No microphone audio");
            }
            if words == 0 {
                missing.push("No speech recognized");
            }
            if !session
                .sources
                .browser
                .as_ref()
                .is_some_and(|browser| browser.attached)
            {
                missing.push("No browser logs: use Open debug browser in the menu");
            }
            missing.truncate(2);
            (!missing.is_empty()).then(|| missing.join(" · "))
        };
        let mtm = MainThreadMarker::new().expect("popup runs on the main thread");
        let screens = NSScreen::screens(mtm);
        let main = screens
            .firstObject()
            .ok_or_else(|| anyhow!("no screen available"))?;
        let cursor = NSEvent::mouseLocation();
        let screen = screens
            .iter()
            .find(|screen| {
                let f = screen.frame();
                cursor.x >= f.origin.x
                    && cursor.x < f.origin.x + f.size.width
                    && cursor.y >= f.origin.y
                    && cursor.y < f.origin.y + f.size.height
            })
            .unwrap_or(main.clone());
        let visible = screen.visibleFrame();
        let width =
            (if notice.is_some() { 500.0_f64 } else { 396.0 }).min(visible.size.width - 32.0);
        let height = if notice.is_some() { 160.0 } else { 136.0 };
        let frame = rect(
            visible.origin.x + visible.size.width - width - 16.0,
            visible.origin.y + visible.size.height - height - 16.0,
            width,
            height,
        );
        let panel: Retained<PackPanel> = unsafe {
            msg_send![PackPanel::alloc(mtm),
                initWithContentRect: frame,
                styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
                backing: NSBackingStoreType::Buffered,
                defer: false]
        };
        // NSWindow's default close releases itself; Retained owns that lifetime here.
        unsafe {
            panel.setReleasedWhenClosed(false);
        }
        panel.setTitle(&NSString::from_str("markupR: context pack"));
        panel.setFloatingPanel(true);
        panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setHidesOnDeactivate(false);
        panel.setLevel(NSPopUpMenuWindowLevel);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(true);
        let view = NSVisualEffectView::initWithFrame(
            NSVisualEffectView::alloc(mtm),
            rect(0.0, 0.0, width, height),
        );
        view.setMaterial(NSVisualEffectMaterial::Popover);
        view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        view.setState(NSVisualEffectState::Active);
        view.setWantsLayer(true);
        if let Some(layer) = view.layer() {
            layer.setCornerRadius(14.0);
            layer.setMasksToBounds(true);
        }
        let title = NSTextField::labelWithString(
            &NSString::from_str(if failed {
                "markupR: context pack failed"
            } else {
                "markupR: context pack ready"
            }),
            mtm,
        );
        title.setFrame(rect(18.0, height - 42.0, width - 54.0, 23.0));
        title.setFont(Some(&NSFont::boldSystemFontOfSize(15.0)));
        let line = NSTextField::labelWithString(&NSString::from_str(&detail), mtm);
        line.setFrame(rect(18.0, height - 70.0, width - 32.0, 22.0));
        line.setFont(Some(&NSFont::systemFontOfSize(12.0)));
        line.setTextColor(Some(&NSColor::secondaryLabelColor()));
        if let Some(notice) = notice {
            let missing = NSTextField::labelWithString(&NSString::from_str(&notice), mtm);
            missing.setFrame(rect(18.0, height - 94.0, width - 32.0, 22.0));
            missing.setFont(Some(&NSFont::systemFontOfSize(11.0)));
            missing.setTextColor(Some(&NSColor::tertiaryLabelColor()));
            view.addSubview(&missing);
        }
        let actions = Actions::alloc(mtm).set_ivars(proxy);
        let actions: Retained<Actions> = unsafe { msg_send![super(actions), init] };
        let make_button = |title: &str, frame: NSRect, action| {
            let button = NSButton::initWithFrame(NSButton::alloc(mtm), frame);
            button.setTitle(&NSString::from_str(title));
            button.setBezelStyle(NSBezelStyle::Push);
            if title == "×" {
                button.setBordered(false);
                button.setFont(Some(&NSFont::systemFontOfSize(20.0)));
            }
            unsafe {
                button.setTarget(Some(&actions));
                button.setAction(Some(action));
                view.addSubview(&button);
            }
            button
        };
        let copy_rect = rect(14.0, 15.0, 130.0, 32.0);
        let finder_rect = rect(if failed { 14.0 } else { 150.0 }, 15.0, 140.0, 32.0);
        let copy = (!failed).then(|| make_button("Copy prompt", copy_rect, sel!(copyPrompt:)));
        let _finder = make_button("Show in Finder", finder_rect, sel!(showFinder:));
        let _close = make_button(
            "×",
            rect(width - 33.0, height - 35.0, 24.0, 24.0),
            sel!(closePopup:),
        );
        view.addSubview(&title);
        view.addSubview(&line);
        panel.setContentView(Some(&view));
        panel.orderFrontRegardless();
        // AppKit is bottom-left; CGEvent and the test harness use main-display top-left.
        let top = main.frame().size.height;
        let global = |r: NSRect| {
            format!(
                "{:.0},{:.0},{:.0},{:.0}",
                frame.origin.x + r.origin.x,
                top - frame.origin.y - r.origin.y - r.size.height,
                r.size.width,
                r.size.height
            )
        };
        ui_debug(format!(
            "popup: frame={:.0},{:.0},{:.0},{:.0} copy={} finder={}",
            frame.origin.x,
            top - frame.origin.y - height,
            width,
            height,
            if failed {
                "0,0,0,0".into()
            } else {
                global(copy_rect)
            },
            global(finder_rect)
        ));
        Ok(Self {
            panel,
            copy,
            _actions: actions,
            dir,
            deadline: Instant::now() + Duration::from_secs(20),
            reason: "timeout",
        })
    }
    pub fn copied(&mut self) {
        if let Some(button) = &self.copy {
            button.setTitle(&NSString::from_str("Copied"));
            button.setEnabled(false);
        }
        self.deadline = Instant::now() + Duration::from_millis(1500);
        self.reason = "copy";
    }
    pub fn can_copy(&self) -> bool {
        self.copy.as_ref().is_some_and(|button| button.isEnabled())
    }
    pub fn close(&mut self, reason: &'static str) {
        self.reason = reason;
        self.panel.orderOut(None);
    }
}
impl Drop for Popup {
    fn drop(&mut self) {
        self.panel.orderOut(None);
        ui_debug(format!("popup: closed reason={}", self.reason));
    }
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}
