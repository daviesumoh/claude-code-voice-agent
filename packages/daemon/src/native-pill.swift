// Audio Downsampler & PCM converter: Float32 -> Int16 16kHz mono
import Foundation
import AVFoundation

let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!
let engine = AVAudioEngine()
let inputNode = engine.inputNode
let inputFormat = inputNode.inputFormat(forBus: 0)

guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
    fatalError("Failed to create audio converter for 16kHz Int16 PCM")
}

inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { buffer, _ in
    let convertedBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: 1024)!
    var error: NSError?
    converter.convert(to: convertedBuffer, error: &error) { _, outStatus in
        outStatus.pointee = .haveData
        return buffer
    }
}
try? engine.start()
RunLoop.main.run()
