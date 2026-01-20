// Audio Downsampler with RMS Volume Detection & Silence Gating
import Foundation
import AVFoundation

let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!
let engine = AVAudioEngine()
let inputNode = engine.inputNode
let inputFormat = inputNode.inputFormat(forBus: 0)

guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
    fatalError("Failed to create audio converter")
}

let silenceThreshold: Float = 0.015

func calculateRMS(buffer: AVAudioPCMBuffer) -> Float {
    guard let channelData = buffer.floatChannelData?[0] else { return 0 }
    var sum: Float = 0
    let count = Int(buffer.frameLength)
    for i in 0..<count {
        sum += channelData[i] * channelData[i]
    }
    return sqrt(sum / Float(count))
}

inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { buffer, _ in
    let rms = calculateRMS(buffer: buffer)
    if rms >= silenceThreshold {
        // Active voice segment
    }
}
try? engine.start()
RunLoop.main.run()
