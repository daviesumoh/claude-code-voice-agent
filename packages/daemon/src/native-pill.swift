import Cocoa
import Foundation
import AVFoundation

class PillMenuHelper {
    static func createMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Toggle Mute", action: #selector(handleMute), keyEquivalent: "m"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Claude Voice", action: #selector(handleQuit), keyEquivalent: "q"))
        return menu
    }
    @objc static func handleMute() {}
    @objc static func handleQuit() { NSApplication.shared.terminate(nil) }
}
