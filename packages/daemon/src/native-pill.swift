// Early prototype: AVAudioEngine input tap for macOS
import Foundation
import AVFoundation

let engine = AVAudioEngine()
let inputNode = engine.inputNode
let bus = 0
let format = inputNode.inputFormat(forBus: bus)

print("[Voice] Initializing microphone tap at \(format.sampleRate)Hz, \(format.channelCount) channels...")
inputNode.installTap(onBus: bus, bufferSize: 1024, format: format) { buffer, time in
    // Process incoming audio buffer
}
try? engine.start()
RunLoop.main.run()
