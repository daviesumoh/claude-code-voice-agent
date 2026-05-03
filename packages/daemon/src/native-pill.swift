import Cocoa
import Foundation
import AVFoundation

class FloatingPillWindow: NSPanel {
    var initialLocation: NSPoint = .zero

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
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    }
    
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    override func mouseDown(with event: NSEvent) {
        initialLocation = event.locationInWindow
    }

    override func mouseDragged(with event: NSEvent) {
        var newOrigin = self.frame.origin
        let currentLocation = event.locationInWindow
        newOrigin.x += (currentLocation.x - initialLocation.x)
        newOrigin.y += (currentLocation.y - initialLocation.y)
        self.setFrameOrigin(newOrigin)
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
