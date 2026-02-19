import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export class VoiceServer {
  private port: number;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;

  constructor(port = 4545) {
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({ server: this.server });
      this.wss.on('connection', (ws) => {
        console.log('[Server] Client connected');
        ws.on('message', (data) => {
          // Process client messages
        });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[Voice Daemon] Listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    this.wss?.close();
    this.server?.close();
  }
}
