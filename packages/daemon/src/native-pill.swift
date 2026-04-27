import Cocoa
import Foundation
import AVFoundation

class FloatingPillWindow: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(x: 200, y: 200, width: 140, height: 42),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        self.isOpaque = false
        self.backgroundColor = .clear
        self.level = .floating
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: FloatingPillWindow?
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = FloatingPillWindow()
        window?.makeKeyAndOrderFront(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
