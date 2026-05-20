import Cocoa
import Foundation
import AVFoundation

class DaemonWebSocketClient {
    private var webSocketTask: URLSessionWebSocketTask?

    func connect(port: Int = 4545, token: String) {
        guard let url = URL(string: "ws://127.0.0.1:\(port)/ws?token=\(token)") else { return }
        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()
    }
}
