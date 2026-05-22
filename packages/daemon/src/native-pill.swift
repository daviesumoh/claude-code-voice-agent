import Cocoa
import Foundation
import AVFoundation

struct PillPosition: Codable {
    let x: Double
    let y: Double
}

class PositionStorage {
    static let fileURL: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let dir = home.appendingPathComponent(".claude-voice")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("pill-position.json")
    }()

    static func save(point: NSPoint) {
        let pos = PillPosition(x: Double(point.x), y: Double(point.y))
        if let data = try? JSONEncoder().encode(pos) {
            try? data.write(to: fileURL)
        }
    }
}
