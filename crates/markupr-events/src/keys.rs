//! Key privacy policy. The only input is a hardware keycode and modifier flags; no character
//! API is ever called. A printable key leaves this module as `Printable`, which carries nothing.

const SHIFT: u64 = 0x0002_0000;
const CTRL: u64 = 0x0004_0000;
const OPT: u64 = 0x0008_0000;
const CMD: u64 = 0x0010_0000;

#[derive(Debug, PartialEq, Eq)]
pub enum KeyClass {
    /// Write nothing (secure input on, or an autorepeat of a named key or chord).
    Ignore,
    /// Count toward a typing burst. No payload by construction.
    Printable,
    /// Log by name with modifiers.
    Named { name: &'static str, mods: Mods },
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Mods(u8);
impl Mods {
    pub fn names(self) -> Vec<&'static str> {
        [(1, "cmd"), (2, "ctrl"), (4, "opt"), (8, "shift")].into_iter().filter(|(b, _)| self.0 & b != 0).map(|(_, n)| n).collect()
    }
}

pub fn classify(keycode: u16, flags: u64, autorepeat: bool, secure: bool) -> KeyClass {
    if secure { return KeyClass::Ignore; }
    let mods = Mods(
        (flags & CMD != 0) as u8 | ((flags & CTRL != 0) as u8) << 1 | ((flags & OPT != 0) as u8) << 2 | ((flags & SHIFT != 0) as u8) << 3,
    );
    if let Some(name) = named_key(keycode) {
        return if autorepeat { KeyClass::Ignore } else { KeyClass::Named { name, mods } };
    }
    if flags & (CMD | CTRL) != 0 {
        return if autorepeat { KeyClass::Ignore } else { KeyClass::Named { name: chord_key(keycode), mods } };
    }
    KeyClass::Printable
}

/// Keys that never produce text. ANSI virtual keycodes (HIToolbox Events.h).
fn named_key(code: u16) -> Option<&'static str> {
    Some(match code {
        36 | 76 => "Enter",
        48 => "Tab",
        51 => "Delete",
        53 => "Escape",
        117 => "ForwardDelete",
        114 => "Help",
        115 => "Home",
        119 => "End",
        116 => "PageUp",
        121 => "PageDown",
        123 => "Left",
        124 => "Right",
        125 => "Down",
        126 => "Up",
        122 => "F1", 120 => "F2", 99 => "F3", 118 => "F4", 96 => "F5", 97 => "F6", 98 => "F7", 100 => "F8",
        101 => "F9", 109 => "F10", 103 => "F11", 111 => "F12", 105 => "F13", 107 => "F14", 113 => "F15",
        106 => "F16", 64 => "F17", 79 => "F18", 80 => "F19", 90 => "F20",
        _ => return None,
    })
}

/// Name of the key in a cmd/ctrl chord, from the US ANSI layout (layout-independent by design).
fn chord_key(code: u16) -> &'static str {
    const ANSI: [&str; 51] = [
        "A", "S", "D", "F", "H", "G", "Z", "X", "C", "V", "", "B", "Q", "W", "E", "R", "Y", "T", "1", "2", "3", "4", "6",
        "5", "=", "9", "7", "-", "8", "0", "]", "O", "U", "[", "I", "P", "", "L", "J", "'", "K", ";", "\\", ",", "/", "N",
        "M", ".", "", "Space", "`",
    ];
    match ANSI.get(code as usize) {
        Some(n) if !n.is_empty() => n,
        _ => "Unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bug guarded: a printable key (letter, digit, punctuation, with or without shift/opt)
    /// reaching events.jsonl as its own text, or anything about keys leaking under secure input.
    #[test]
    fn printable_key_reaches_output_as_text() {
        let named: Vec<u16> = (0..128).filter(|c| named_key(*c).is_some()).collect();
        for code in (0u16..128).filter(|c| !named.contains(c)) {
            for flags in [0, SHIFT, OPT, SHIFT | OPT] {
                assert_eq!(classify(code, flags, false, false), KeyClass::Printable, "keycode {code} flags {flags:x}");
                assert_eq!(classify(code, flags, true, false), KeyClass::Printable);
            }
        }
        // "hunter2" by keycode: h u n t e r 2
        for code in [4u16, 32, 45, 17, 14, 15, 19] {
            assert_eq!(classify(code, SHIFT, false, false), KeyClass::Printable);
        }
        for code in 0u16..128 {
            for flags in [0, CMD, CTRL, SHIFT] {
                assert_eq!(classify(code, flags, false, true), KeyClass::Ignore);
            }
        }
        assert_eq!(classify(36, CMD, false, false), KeyClass::Named { name: "Enter", mods: Mods(1) });
        assert_eq!(classify(8, CMD, false, false), KeyClass::Named { name: "C", mods: Mods(1) });
    }
}
