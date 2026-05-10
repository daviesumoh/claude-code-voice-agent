import Cocoa
import Foundation
import AVFoundation

class WaveformView: NSView {
    var audioLevel: CGFloat = 0.0
    var phase: CGFloat = 0.0
    private var timer: Timer?

    override init(frame: NSRect) {
        super.init(frame: frame)
        startAnimation()
    }
    required init?(coder: NSCoder) { super.init(coder: coder) }

    func startAnimation() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            self.phase += 0.15
            self.needsDisplay = true
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2)
        NSColor(calibratedRed: 0.12, green: 0.12, blue: 0.14, alpha: 0.92).setFill()
        path.fill()
    }
}
