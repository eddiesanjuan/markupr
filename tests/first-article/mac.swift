// Small native probes and actual virtual-key events; compiled only in a temp directory.
import AppKit
import CoreAudio
import CoreGraphics

func check(_ status: OSStatus) {
    if status != noErr { fputs("CoreAudio error: \(status)\n", stderr); exit(1) }
}
struct PasteboardRepresentation: Codable {
    let type: String
    let data: Data
}

switch CommandLine.arguments[1] {
case "clipboard-save", "clipboard-restore":
    let file = URL(fileURLWithPath: CommandLine.arguments[2])
    let pasteboard = CommandLine.arguments.count > 3
        ? NSPasteboard(name: NSPasteboard.Name(CommandLine.arguments[3])) : NSPasteboard.general
    if CommandLine.arguments[1] == "clipboard-save" {
        let items = try (pasteboard.pasteboardItems ?? []).map { item in
            try item.types.map { type -> PasteboardRepresentation in
                guard let data = item.data(forType: type) else {
                    throw NSError(domain: "markupr-first-article", code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Cannot save pasteboard type \(type.rawValue)"])
                }
                return PasteboardRepresentation(type: type.rawValue, data: data)
            }
        }
        try JSONEncoder().encode(items).write(to: file, options: .atomic)
    } else {
        do {
            // Decode and materialize everything before clearing anything.
            let saved = try JSONDecoder().decode([[PasteboardRepresentation]].self, from: Data(contentsOf: file))
            let items = try saved.map { representations -> NSPasteboardItem in
                let item = NSPasteboardItem()
                for representation in representations {
                    guard item.setData(representation.data, forType: NSPasteboard.PasteboardType(representation.type)) else {
                        throw NSError(domain: "markupr-first-article", code: 2,
                            userInfo: [NSLocalizedDescriptionKey: "Cannot restore type \(representation.type)"])
                    }
                }
                return item
            }
            pasteboard.clearContents()
            if !items.isEmpty && !pasteboard.writeObjects(items) {
                pasteboard.clearContents()
                guard pasteboard.writeObjects(items) else {
                    throw NSError(domain: "markupr-first-article", code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "Pasteboard write failed twice"])
                }
            }
        } catch {
            fputs("Clipboard restore failed; saved file: \(file.path): \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
case "mic":
    var device = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device))
    if device == 0 { fputs("No default input device\n", stderr); exit(1) }
    var running: UInt32 = 0
    size = UInt32(MemoryLayout<UInt32>.size)
    address.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
    check(AudioObjectGetPropertyData(device, &address, 0, nil, &size, &running))
    print("{\"device_id\":\(device),\"running_somewhere\":\(running != 0)}")
case "screens":
    let screens = NSScreen.screens
    let top = screens[0].frame.maxY
    func rect(_ r: NSRect) -> [String: CGFloat] {
        return ["x": r.minX, "y": top - r.maxY, "w": r.width, "h": r.height]
    }
    let result: [[String: Any]] = screens.enumerated().map { index, screen in
        return ["index": index, "id": screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]!,
                "rect": rect(screen.frame), "visible": rect(screen.visibleFrame),
                "scale": screen.backingScaleFactor]
    }
    print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
case "front":
    let pid = pid_t(CommandLine.arguments[2])!
    guard let app = NSRunningApplication(processIdentifier: pid) else { exit(1) }
    app.activate(options: [])
    Thread.sleep(forTimeInterval: 0.5)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
        fputs("Dedicated Chrome is not frontmost\n", stderr); exit(1)
    }
case "mark":
    let source = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: 7, keyDown: down)!
        event.flags = [.maskControl, .maskAlternate]
        event.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.05)
    }
default: exit(2)
}
