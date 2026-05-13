import Cocoa
import Foundation
import AVFoundation

enum PillVisualState: String {
    case idle = "IDLE"
    case listening = "LISTENING"
    case thinking = "THINKING"
    case speaking = "SPEAKING"

    var accentColor: NSColor {
        switch self {
        case .idle: return NSColor(calibratedRed: 0.85, green: 0.55, blue: 0.25, alpha: 0.4)
        case .listening: return NSColor(calibratedRed: 0.95, green: 0.60, blue: 0.20, alpha: 1.0)
        case .thinking: return NSColor(calibratedRed: 0.40, green: 0.70, blue: 0.95, alpha: 1.0)
        case .speaking: return NSColor(calibratedRed: 0.95, green: 0.45, blue: 0.25, alpha: 1.0)
        }
    }
}
