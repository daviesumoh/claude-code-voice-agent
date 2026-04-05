import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export class VoiceServer {
  private port: number;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private isSpeaking = false;

  constructor(port = 4545) {
    this.port = port;
  }

  setSpeakingState(speaking: boolean) {
    this.isSpeaking = speaking;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', isSpeaking: this.isSpeaking }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({ server: this.server });
      this.wss.on('connection', (ws) => {
        ws.on('message', (data, isBinary) => {
          // Acoustic echo ducking: ignore microphone input while assistant is speaking
          if (isBinary && this.isSpeaking) {
            return;
          }
        });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[Voice Daemon] Listening on 127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    this.wss?.close();
    this.server?.close();
  }
}
