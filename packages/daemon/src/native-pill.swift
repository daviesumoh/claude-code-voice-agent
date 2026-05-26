import Cocoa
import AVFoundation

// MARK: - Floating Non-Activating Panel
class PillPanel: NSPanel {
    override var canBecomeKey: Bool { return true }
    override var canBecomeMain: Bool { return false }
}

// MARK: - Pill Visual States
enum VoiceState: String {
    case IDLE
    case LISTENING
    case THINKING
    case SPEAKING
    case AWAITING_PERMISSION
    case INTERRUPTED
}

// MARK: - Custom Draggable & Interactive Claude Pill View
class ClaudePillView: NSView {
    var voiceState: VoiceState = .IDLE {
        didSet {
            needsDisplay = true
        }
    }
    var isConnected: Bool = false {
        didSet {
            needsDisplay = true
        }
    }
    var isMicActive: Bool = false {
        didSet {
            needsDisplay = true
        }
    }
    var pulsePhase: CGFloat = 0.0

    var onToggleTalk: (() -> Void)?
    var onContextMenu: ((NSEvent) -> Void)?

    private var logoImage: NSImage? = {
        var candidatePaths: [String] = []
        if let res = Bundle.main.resourcePath {
            candidatePaths.append(res + "/claude-logo.png")
        }
        let exeDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().path
        candidatePaths.append(exeDir + "/claude-logo.png")
        candidatePaths.append(exeDir + "/assets/claude-logo.png")
        candidatePaths.append(exeDir + "/../assets/claude-logo.png")
        candidatePaths.append(FileManager.default.currentDirectoryPath + "/packages/daemon/assets/claude-logo.png")
        candidatePaths.append(FileManager.default.currentDirectoryPath + "/assets/claude-logo.png")
        candidatePaths.append(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude-voice/assets/claude-logo.png").path)

        for path in candidatePaths {
            if FileManager.default.fileExists(atPath: path), let img = NSImage(contentsOfFile: path) {
                return img
            }
        }
        return nil
    }()

    private var initialMouseLocation: NSPoint = .zero
    private var initialWindowOrigin: NSPoint = .zero
    private var isDraggingWindow: Bool = false
    private var isHovering: Bool = false
    private var trackingArea: NSTrackingArea?

    override var isFlipped: Bool { return false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        return true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingArea {
            removeTrackingArea(existing)
        }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        isHovering = true
        NSCursor.pointingHand.set()
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        isHovering = false
        NSCursor.arrow.set()
        needsDisplay = true
    }

    // MARK: Free Screen Dragging vs Click-to-Talk
    override func mouseDown(with event: NSEvent) {
        guard let win = self.window else { return }
        initialMouseLocation = NSEvent.mouseLocation
        initialWindowOrigin = win.frame.origin
        isDraggingWindow = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let win = self.window else { return }
        let currentLocation = NSEvent.mouseLocation
        let dx = currentLocation.x - initialMouseLocation.x
        let dy = currentLocation.y - initialMouseLocation.y

        if hypot(dx, dy) >= 3.5 {
            isDraggingWindow = true
            NSCursor.closedHand.set()
        }

        if isDraggingWindow {
            let newOrigin = NSPoint(x: initialWindowOrigin.x + dx, y: initialWindowOrigin.y + dy)
            win.setFrameOrigin(newOrigin)
        }
    }

    override func mouseUp(with event: NSEvent) {
        if isDraggingWindow {
            isDraggingWindow = false
            NSCursor.pointingHand.set()
            if let win = self.window {
                UserDefaults.standard.set(Double(win.frame.origin.x), forKey: "ClaudeVoicePillX")
                UserDefaults.standard.set(Double(win.frame.origin.y), forKey: "ClaudeVoicePillY")
            }
        } else {
            onToggleTalk?()
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        onContextMenu?(event)
    }

    // MARK: Drawing the Claude Floating Icon + State Halo
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.saveGState()

        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let baseRadius: CGFloat = isHovering ? 22.0 : 21.0

        let terracotta = NSColor(calibratedRed: 0.855, green: 0.467, blue: 0.337, alpha: 1.0)
        let cyanListen = NSColor(calibratedRed: 0.220, green: 0.741, blue: 0.973, alpha: 1.0)
        let amberThink = NSColor(calibratedRed: 0.961, green: 0.620, blue: 0.043, alpha: 1.0)
        let orangeSpeak = NSColor(calibratedRed: 1.0, green: 0.549, blue: 0.259, alpha: 1.0)

        var accentColor = terracotta
        var showPulse = false
        if voiceState == .SPEAKING {
            accentColor = orangeSpeak
            showPulse = true
        } else if voiceState == .THINKING {
            accentColor = amberThink
            showPulse = true
        } else if isMicActive || voiceState == .LISTENING {
            accentColor = cyanListen
            showPulse = true
        }

        // 1. Animated Outer Pulse Ring when Listening / Thinking / Speaking
        if showPulse {
            let wave = (sin(pulsePhase) + 1.0) * 0.5
            let pulseRadius = baseRadius + 2.0 + wave * 6.0
            let pulseAlpha = 0.65 * (1.0 - wave * 0.7)
            ctx.setStrokeColor(accentColor.withAlphaComponent(pulseAlpha).cgColor)
            ctx.setLineWidth(2.2)
            ctx.addArc(center: center, radius: pulseRadius, startAngle: 0, endAngle: .pi * 2, clockwise: false)
            ctx.strokePath()
        }

        // 2. Dark Circular Glass Pill Body
        let pillRect = CGRect(
            x: center.x - baseRadius,
            y: center.y - baseRadius,
            width: baseRadius * 2,
            height: baseRadius * 2
        )

        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -2), blur: 6, color: NSColor.black.withAlphaComponent(0.55).cgColor)
        ctx.setFillColor(NSColor(calibratedRed: 0.11, green: 0.11, blue: 0.13, alpha: 0.95).cgColor)
        ctx.fillEllipse(in: pillRect)
        ctx.restoreGState()

        // 3. Crisp Border Ring
        let borderColor = showPulse
            ? accentColor.withAlphaComponent(0.85)
            : (isHovering ? terracotta.withAlphaComponent(0.6) : NSColor.white.withAlphaComponent(0.18))
        ctx.setStrokeColor(borderColor.cgColor)
        ctx.setLineWidth(showPulse ? 1.8 : 1.2)
        ctx.strokeEllipse(in: pillRect.insetBy(dx: 1.0, dy: 1.0))

        // 4. Draw Claude Starburst Logo in Center
        let logoSize: CGFloat = (isHovering ? 28.0 : 26.0)
        let logoRect = CGRect(x: center.x - logoSize / 2.0, y: center.y - logoSize / 2.0, width: logoSize, height: logoSize)

        if let img = logoImage {
            ctx.saveGState()
            if showPulse && voiceState == .SPEAKING {
                let bounce = 1.0 + sin(pulsePhase * 2.0) * 0.05
                ctx.translateBy(x: center.x, y: center.y)
                ctx.scaleBy(x: bounce, y: bounce)
                ctx.translateBy(x: -center.x, y: -center.y)
            }
            img.draw(in: logoRect, from: .zero, operation: .sourceOver, fraction: 1.0)
            ctx.restoreGState()
        } else {
            drawClaudeSpark(ctx: ctx, center: center, scale: isHovering ? 1.06 : 1.0, color: accentColor)
        }

        // 5. Connection Status Pip (Top-Right of Bubble)
        let pipAngle: CGFloat = .pi / 4.0
        let pipCenter = CGPoint(
            x: center.x + (baseRadius - 3.0) * cos(pipAngle),
            y: center.y + (baseRadius - 3.0) * sin(pipAngle)
        )
        let pipRadius: CGFloat = 4.0
        let pipRect = CGRect(x: pipCenter.x - pipRadius, y: pipCenter.y - pipRadius, width: pipRadius * 2, height: pipRadius * 2)
        ctx.setFillColor((isConnected ? NSColor.systemGreen : NSColor.systemRed).cgColor)
        ctx.fillEllipse(in: pipRect)
        ctx.setStrokeColor(NSColor(calibratedRed: 0.11, green: 0.11, blue: 0.13, alpha: 1.0).cgColor)
        ctx.setLineWidth(1.5)
        ctx.strokeEllipse(in: pipRect)

        ctx.restoreGState()
    }

    private func drawClaudeSpark(ctx: CGContext, center: CGPoint, scale: CGFloat, color: NSColor) {
        ctx.saveGState()
        ctx.translateBy(x: center.x, y: center.y)
        ctx.scaleBy(x: scale, y: scale)

        ctx.setFillColor(color.cgColor)

        for i in 0..<6 {
            ctx.saveGState()
            ctx.rotate(by: CGFloat(i) * (.pi / 3.0))
            let path = CGMutablePath()
            let length: CGFloat = (i % 2 == 0) ? 10.5 : 8.2
            let width: CGFloat = 2.1
            path.move(to: CGPoint(x: 0, y: -length))
            path.addQuadCurve(to: CGPoint(x: width, y: 0), control: CGPoint(x: width * 0.35, y: -length * 0.25))
            path.addQuadCurve(to: CGPoint(x: 0, y: length), control: CGPoint(x: width * 0.35, y: length * 0.25))
            path.addQuadCurve(to: CGPoint(x: -width, y: 0), control: CGPoint(x: -width * 0.35, y: length * 0.25))
            path.addQuadCurve(to: CGPoint(x: 0, y: -length), control: CGPoint(x: -width * 0.35, y: -length * 0.25))
            path.closeSubpath()
            ctx.addPath(path)
            ctx.fillPath()
            ctx.restoreGState()
        }

        ctx.restoreGState()
    }
}

// MARK: - App Delegate & Native Audio / WebSocket Controller
class AppDelegate: NSObject, NSApplicationDelegate, URLSessionWebSocketDelegate {
    var panel: PillPanel!
    var pillView: ClaudePillView!
    var animTimer: Timer?

    // WebSocket to local daemon (ws://127.0.0.1:4545/ws)
    var wsSession: URLSession!
    var wsTask: URLSessionWebSocketTask?
    var port: String = "4545"
    var authToken: String? = nil
    var isConnected = false

    // State synced from daemon
    var activeCwd: String = ""
    var activeSessionId: String = ""
    var inputMode: String = "ACTIVE_CHAT"

    // Audio Engines
    let captureEngine = AVAudioEngine()
    let playbackEngine = AVAudioEngine()
    let playerNode = AVAudioPlayerNode()
    let playbackFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
    var isMicStreaming = false
    var scheduledBuffers: Int = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        port = ProcessInfo.processInfo.environment["PORT"] ?? "4545"
        readRuntimeInfo()

        setupFloatingPanel()
        setupPlaybackEngine()
        setupAudioRouteChangeObserver()
        connectWebSocket()

        animTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            if self.pillView.isMicActive || self.pillView.voiceState != .IDLE {
                self.pillView.pulsePhase += 0.16
                self.pillView.needsDisplay = true
            }
        }
    }

    private func setupAudioRouteChangeObserver() {
        NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            print("[ClaudeVoicePill] Audio route configuration changed (e.g. headphones/AirPods)")
            if !self.playbackEngine.isRunning {
                try? self.playbackEngine.start()
            }
            if self.isMicStreaming {
                self.captureEngine.inputNode.removeTap(onBus: 0)
                self.captureEngine.stop()
                self.isMicStreaming = false
                self.beginAudioEngineCapture()
            }
        }
    }

    private func readRuntimeInfo() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let runtimeURL = home.appendingPathComponent(".claude-voice/runtime.json")
        guard let data = try? Data(contentsOf: runtimeURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        if let p = json["port"] {
            self.port = String(describing: p)
        }
        if let t = json["token"] as? String {
            self.authToken = t
        }
    }

    private func setupFloatingPanel() {
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 100, y: 100, width: 1200, height: 800)
        let pillSize: CGFloat = 58

        let savedX = UserDefaults.standard.object(forKey: "ClaudeVoicePillX") as? Double
        let savedY = UserDefaults.standard.object(forKey: "ClaudeVoicePillY") as? Double

        let defaultX = screenRect.maxX - pillSize - 28
        let defaultY = screenRect.maxY - pillSize - 56

        let posX = savedX.map { CGFloat($0) } ?? defaultX
        let posY = savedY.map { CGFloat($0) } ?? defaultY

        let rect = NSRect(x: posX, y: posY, width: pillSize, height: pillSize)

        panel = PillPanel(
            contentRect: rect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.isMovableByWindowBackground = false

        pillView = ClaudePillView(frame: NSRect(x: 0, y: 0, width: pillSize, height: pillSize))
        pillView.toolTip = "Claude Voice — Drag anywhere to move • Click to talk or interrupt • Right-click for options"

        pillView.onToggleTalk = { [weak self] in
            self?.handlePillClick()
        }

        pillView.onContextMenu = { [weak self] event in
            self?.showContextMenu(with: event)
        }

        panel.contentView = pillView
        panel.orderFrontRegardless()
    }

    // MARK: Click & Context Menu Actions
    private func handlePillClick() {
        // 1. If Claude is currently speaking, clicking immediately interrupts Claude and starts listening!
        if pillView.voiceState == .SPEAKING || scheduledBuffers > 0 {
            stopAndClearPlayback()
            sendJSON(["type": "manual_interrupt"])
            if !isMicStreaming {
                startMicrophone()
            }
            return
        }

        // 2. Toggle microphone listening on/off
        if isMicStreaming {
            sendJSON(["type": "force_end_turn"])
            stopMicrophone()
        } else {
            startMicrophone()
        }
    }

    private func showContextMenu(with event: NSEvent) {
        let menu = NSMenu(title: "Claude Voice")

        let projectDisplay = (activeCwd as NSString).lastPathComponent
        let projItem = NSMenuItem(title: "📁 Project: \(projectDisplay.isEmpty ? "claude-voice" : projectDisplay)", action: nil, keyEquivalent: "")
        projItem.isEnabled = false
        menu.addItem(projItem)

        let sessionDisplay = activeSessionId.isEmpty ? "Voice Session (Direct)" : "Synced with Active CLI Session"
        let sessionItem = NSMenuItem(title: "🔗 \(sessionDisplay)", action: nil, keyEquivalent: "")
        sessionItem.isEnabled = false
        menu.addItem(sessionItem)

        menu.addItem(NSMenuItem.separator())

        // Mode toggles
        let isChatMode = (inputMode != "STANDALONE_VOICE")
        let chatModeItem = NSMenuItem(title: "💬 Active Claude Chat (Types in active chat & speaks back)", action: #selector(menuSetActiveChatMode), keyEquivalent: "")
        chatModeItem.target = self
        chatModeItem.state = isChatMode ? .on : .off
        menu.addItem(chatModeItem)

        let standaloneModeItem = NSMenuItem(title: "🎙️ Standalone Voice Brain (Direct without typing)", action: #selector(menuSetStandaloneMode), keyEquivalent: "")
        standaloneModeItem.target = self
        standaloneModeItem.state = !isChatMode ? .on : .off
        menu.addItem(standaloneModeItem)

        menu.addItem(NSMenuItem.separator())

        let chooseFolderItem = NSMenuItem(title: "Choose Project Folder...", action: #selector(menuChooseFolder), keyEquivalent: "")
        chooseFolderItem.target = self
        menu.addItem(chooseFolderItem)

        menu.addItem(NSMenuItem.separator())

        let toggleTitle = isMicStreaming ? "Stop Microphone" : "Start Talking to Claude"
        let toggleItem = NSMenuItem(title: toggleTitle, action: #selector(menuToggleMic), keyEquivalent: "")
        toggleItem.target = self
        menu.addItem(toggleItem)

        let testItem = NSMenuItem(title: "Test Voice (Say Hello to Claude)", action: #selector(menuTestVoice), keyEquivalent: "")
        testItem.target = self
        menu.addItem(testItem)

        menu.addItem(NSMenuItem.separator())
        let quitItem = NSMenuItem(title: "Quit Floating Pill", action: #selector(menuQuit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        NSMenu.popUpContextMenu(menu, with: event, for: pillView)
    }

    @objc private func menuSetActiveChatMode() {
        inputMode = "ACTIVE_CHAT"
        sendJSON(["type": "set_input_mode", "mode": "ACTIVE_CHAT"])
    }

    @objc private func menuSetStandaloneMode() {
        inputMode = "STANDALONE_VOICE"
        sendJSON(["type": "set_input_mode", "mode": "STANDALONE_VOICE"])
    }

    @objc private func menuChooseFolder() {
        let openPanel = NSOpenPanel()
        openPanel.canChooseFiles = false
        openPanel.canChooseDirectories = true
        openPanel.allowsMultipleSelection = false
        openPanel.prompt = "Select Project Folder"
        openPanel.begin { [weak self] response in
            if response == .OK, let url = openPanel.url {
                let path = url.path
                self?.activeCwd = path
                self?.sendJSON(["type": "set_cwd", "cwd": path])
            }
        }
    }

    @objc private func menuToggleMic() {
        handlePillClick()
    }

    @objc private func menuTestVoice() {
        sendJSON(["type": "speak_text", "text": "Hey there! I'm Claude, speaking with the Tanner voice and expressivity enabled."])
    }

    @objc private func menuQuit() {
        NSApp.terminate(nil)
    }

    // MARK: Native Audio Playback (24kHz PCM + Earcons)
    private func setupPlaybackEngine() {
        playbackEngine.attach(playerNode)
        playbackEngine.connect(playerNode, to: playbackEngine.mainMixerNode, format: playbackFormat)
        do {
            try playbackEngine.start()
            playerNode.play()
        } catch {
            print("[ClaudeVoicePill] Playback engine start error: \(error)")
        }
    }

    private func playPCM24kChunk(_ data: Data) {
        let sampleCount = data.count / 2
        guard sampleCount > 0 else { return }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(sampleCount)) else { return }
        buffer.frameLength = AVAudioFrameCount(sampleCount)

        guard let floatChannel = buffer.floatChannelData?[0] else { return }
        data.withUnsafeBytes { rawBuffer in
            guard let int16Ptr = rawBuffer.bindMemory(to: Int16.self).baseAddress else { return }
            for i in 0..<sampleCount {
                floatChannel[i] = Float(int16Ptr[i]) / 32768.0
            }
        }

        if !playbackEngine.isRunning {
            try? playbackEngine.start()
        }
        if !playerNode.isPlaying {
            playerNode.play()
        }

        DispatchQueue.main.async {
            if self.pillView.voiceState != .SPEAKING {
                self.pillView.voiceState = .SPEAKING
            }
        }

        scheduledBuffers += 1
        playerNode.scheduleBuffer(buffer) { [weak self] in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.scheduledBuffers = max(0, self.scheduledBuffers - 1)
                if self.scheduledBuffers == 0 && self.pillView.voiceState == .SPEAKING {
                    self.pillView.voiceState = self.isMicStreaming ? .LISTENING : .IDLE
                }
            }
        }
    }

    private func stopAndClearPlayback() {
        scheduledBuffers = 0
        playerNode.stop()
        playerNode.play()
    }

    private func playEarcon(_ type: String) {
        let sr: Double = 24000
        var duration: Double = 0.055
        var f1: Double = 1000
        var f2: Double = 700
        var amp: Float = 0.08

        switch type {
        case "EDIT_TICK":
            duration = 0.045; f1 = 1200; f2 = 650; amp = 0.07
        case "FAIL_TAP":
            duration = 0.075; f1 = 220; f2 = 160; amp = 0.12
        case "CHIME_PROMPT":
            duration = 0.09; f1 = 1046.5; f2 = 1568.0; amp = 0.08
        case "CHIME_SUCCESS":
            duration = 0.08; f1 = 1318.5; f2 = 1661.2; amp = 0.07
        default:
            return
        }

        let frames = Int(sr * duration)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frames)),
              let ch = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(frames)

        for i in 0..<frames {
            let t = Double(i) / sr
            let progress = t / duration
            let freq = progress < 0.5 ? f1 : f2
            let env = Float(1.0 - progress)
            ch[i] = sin(Float(2.0 * .pi * freq * t)) * amp * env
        }

        if !playbackEngine.isRunning { try? playbackEngine.start() }
        if !playerNode.isPlaying { playerNode.play() }
        playerNode.scheduleBuffer(buffer, completionHandler: nil)
    }

    // MARK: Native Microphone Capture (Resampled to 16kHz Int16 Mono)
    private func startMicrophone() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if !granted {
                    let alert = NSAlert()
                    alert.messageText = "Microphone Permission Required"
                    alert.informativeText = "Please allow microphone access in System Settings > Privacy & Security > Microphone so you can speak with Claude."
                    alert.runModal()
                    return
                }
                self.beginAudioEngineCapture()
            }
        }
    }

    private func beginAudioEngineCapture() {
        guard !isMicStreaming else { return }

        let inputNode = captureEngine.inputNode
        let hwFormat = inputNode.inputFormat(forBus: 0)
        guard hwFormat.sampleRate > 0 else {
            print("[ClaudeVoicePill] Invalid hardware input format")
            return
        }

        inputNode.removeTap(onBus: 0)
        let targetRate: Double = 16000.0
        let inRate = hwFormat.sampleRate

        inputNode.installTap(onBus: 0, bufferSize: 2048, format: hwFormat) { [weak self] buffer, _ in
            guard let self = self, self.isMicStreaming else { return }
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let inFrames = Int(buffer.frameLength)
            if inFrames == 0 { return }

            // Linearly downsample hardware Float32 audio to 16kHz Int16 mono
            let ratio = inRate / targetRate
            let outFrames = max(1, Int(Double(inFrames) / ratio))
            var pcm16 = [Int16](repeating: 0, count: outFrames)

            for i in 0..<outFrames {
                let srcIdx = min(inFrames - 1, Int(Double(i) * ratio))
                let sample = max(-1.0, min(1.0, channelData[srcIdx]))
                pcm16[i] = Int16(sample * 32767.0)
            }

            // ACOUSTIC ECHO SUPPRESSION:
            // Do NOT stream microphone audio to Deepgram STT while Claude is speaking or playing audio.
            // Laptop speakers bleed into the mic and cause false self-interruptions.
            // If the user wants to interrupt Claude, clicking the pill immediately stops audio and listens.
            if self.pillView.voiceState == .SPEAKING || self.scheduledBuffers > 0 {
                return
            }

            let byteData = pcm16.withUnsafeBufferPointer { Data(buffer: $0) }
            self.wsTask?.send(.data(byteData)) { _ in }
        }

        do {
            captureEngine.prepare()
            try captureEngine.start()
            isMicStreaming = true
            pillView.isMicActive = true
            pillView.voiceState = .LISTENING
            playEarcon("CHIME_PROMPT")
        } catch {
            print("[ClaudeVoicePill] Failed to start capture engine: \(error)")
        }
    }

    private func stopMicrophone() {
        guard isMicStreaming else { return }
        isMicStreaming = false
        captureEngine.inputNode.removeTap(onBus: 0)
        captureEngine.stop()
        pillView.isMicActive = false
        if pillView.voiceState == .LISTENING {
            pillView.voiceState = .IDLE
        }
    }

    // MARK: WebSocket Client to Local Daemon
    private func connectWebSocket() {
        readRuntimeInfo()
        let config = URLSessionConfiguration.default
        wsSession = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue.main)
        var urlString = "ws://127.0.0.1:\(port)/ws"
        if let token = authToken, !token.isEmpty {
            urlString += "?token=\(token)"
        }
        guard let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        if let token = authToken, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        wsTask = wsSession.webSocketTask(with: request)
        wsTask?.resume()
        receiveNextMessage()
    }

    private func receiveNextMessage() {
        wsTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                if !self.isConnected {
                    self.isConnected = true
                    DispatchQueue.main.async { self.pillView.isConnected = true }
                }
                switch message {
                case .data(let data):
                    self.playPCM24kChunk(data)
                case .string(let text):
                    self.handleServerJSON(text)
                @unknown default:
                    break
                }
                self.receiveNextMessage()

            case .failure:
                self.isConnected = false
                DispatchQueue.main.async {
                    self.pillView.isConnected = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        self.connectWebSocket()
                    }
                }
            }
        }
    }

    private func handleServerJSON(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        DispatchQueue.main.async {
            switch type {
            case "state":
                if let stateStr = json["state"] as? String {
                    if stateStr == "INTERRUPTED" {
                        self.stopAndClearPlayback()
                        self.pillView.voiceState = self.isMicStreaming ? .LISTENING : .IDLE
                    } else if let st = VoiceState(rawValue: stateStr) {
                        if st == .IDLE && self.isMicStreaming {
                            self.pillView.voiceState = .LISTENING
                        } else {
                            self.pillView.voiceState = st
                        }
                    }
                }
                if let cwd = json["activeCwd"] as? String {
                    self.activeCwd = cwd
                }
                if let sid = json["activeSessionId"] as? String {
                    self.activeSessionId = sid
                }
                if let mode = json["inputMode"] as? String {
                    self.inputMode = mode
                }
            case "earcon":
                if let sound = json["sound"] as? String {
                    self.playEarcon(sound)
                }
            default:
                break
            }
        }
    }

    private func sendJSON(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str = String(data: data, encoding: .utf8) else { return }
        wsTask?.send(.string(str)) { _ in }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        isConnected = true
        DispatchQueue.main.async {
            self.pillView.isConnected = true
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        isConnected = false
        DispatchQueue.main.async {
            self.pillView.isConnected = false
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
