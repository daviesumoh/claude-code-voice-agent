import Cocoa
import Foundation
import AVFoundation

class AudioCaptureManager {
    let engine = AVAudioEngine()
    let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!
    var onPCMData: ((Data) -> Void)?

    func start() throws {
        let inputNode = engine.inputNode
        let inputFormat = inputNode.inputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            fatalError("Cannot create 16kHz converter")
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self else { return }
            let convertedBuffer = AVAudioPCMBuffer(pcmFormat: self.targetFormat, frameCapacity: 1024)!
            var error: NSError?
            converter.convert(to: convertedBuffer, error: &error) { _, outStatus in
                outStatus.pointee = .haveData
                return buffer
            }
            if let channelData = convertedBuffer.int16ChannelData?[0] {
                let bytes = Data(bytes: channelData, count: Int(convertedBuffer.frameLength) * 2)
                self.onPCMData?(bytes)
            }
        }
        try engine.start()
    }
}
