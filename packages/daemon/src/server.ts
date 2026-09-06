import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  VoiceConfig,
  RuntimeState,
  ClientToDaemonMessage,
  DaemonToClientMessage,
} from '@claude-voice/shared';
import { loadConfig, saveConfig, initRuntimeState, cleanupRuntimeState } from './config.js';
import { TurnCoordinator } from './turn-coordinator.js';
import { OSInjector } from './os-injector.js';

export class VoiceDaemonServer {
  private config: VoiceConfig;
  private runtime: RuntimeState | null = null;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private coordinator: TurnCoordinator;
  private osInjector: OSInjector;
  private clients = new Set<WebSocket>();

  constructor(config?: VoiceConfig) {
    this.config = config || loadConfig();
    this.coordinator = new TurnCoordinator({ config: this.config });
    this.osInjector = new OSInjector();
    this.setupCoordinatorListeners();
  }

  async start(): Promise<void> {
    const port = this.config.port || 4545;
    this.runtime = initRuntimeState(port);

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      this.handleWsConnection(ws, req);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, '127.0.0.1', () => {
        console.log(`[Claude Voice Daemon] Listening on http://127.0.0.1:${port}`);
        console.log(`[Claude Voice Daemon] Deepgram Flux STT model: ${this.config.sttModel}`);
        console.log(`[Claude Voice Daemon] Deepgram Flux TTS voice: ${this.config.voiceModel}`);
        this.coordinator.start();
        resolve();
      });

      this.server!.on('error', (err) => {
        reject(err);
      });
    });
  }

  private setupCoordinatorListeners() {
    this.coordinator.on('state_change', (data) => {
      this.broadcast({
        type: 'state',
        state: data.state,
        muted: data.muted,
        inputMode: data.inputMode,
        activeSessionId: data.activeSessionId,
        activeCwd: (data as any).activeCwd,
      });
    });

    this.coordinator.on('transcript', (data) => {
      this.broadcast({
        type: 'transcript',
        role: data.role,
        text: data.text,
        isFinal: data.isFinal,
      });
    });

    this.coordinator.on('tts_audio', (pcmBuffer: Buffer) => {
      // Broadcast raw binary PCM audio frame to all connected audio clients
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(pcmBuffer);
        }
      }
    });

    this.coordinator.on('flush_client_audio', () => {
      // Instruct client to clear its local playback buffer immediately
      this.broadcast({ type: 'state', state: 'INTERRUPTED', muted: false, inputMode: this.config.inputMode });
    });

    this.coordinator.on('earcon', (sound) => {
      this.broadcast({ type: 'earcon', sound });
    });

    this.coordinator.on('permission_prompt', (prompt) => {
      this.broadcast({
        type: 'permission_prompt',
        id: prompt.id,
        tool: prompt.tool,
        summary: prompt.summary,
      });
    });

    this.coordinator.on('submit_prompt', async (promptText) => {
      console.log(`[TurnCoordinator] Submitting spoken prompt: "${promptText}"`);
      // 1. Paste into active text box so the developer sees their transcribed text appear in chat
      let ok = false;
      try {
        ok = await this.osInjector.injectPrompt(promptText);
      } catch (err) {
        console.warn('[Server] Prompt injection warning:', err);
      }

      // 2. If prompt injection failed (e.g. no active window/text box focused), fallback to direct voice streaming
      if (!ok) {
        console.log('[Server] Prompt injection not focused, falling back to standalone voice stream...');
        this.coordinator.askClaudeStream(promptText);
      }
    });

    this.coordinator.on('error', (err) => {
      console.error('[TurnCoordinator Error]', err);
      this.broadcast({ type: 'error', message: err.message || 'TurnCoordinator Error' });
    });
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname.toLowerCase();

    // WebAudio UI Frontend
    if ((pathname === '/' || pathname === '/index.html') && req.method === 'GET') {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const publicPath = path.resolve(__dirname, '..', 'public', 'index.html');

      if (fs.existsSync(publicPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(publicPath));
        return;
      }
    }

    // Health check endpoint (open on localhost)
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', state: this.coordinator.getState() }));
      return;
    }

    // Config endpoint for UI (open on localhost)
    if (pathname === '/api/config') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            hasKey: !!this.config.deepgramApiKey,
            voiceModel: this.config.voiceModel,
            sttModel: this.config.sttModel,
            speed: this.config.speed,
            inputMode: this.config.inputMode,
          })
        );
        return;
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const updates = JSON.parse(body || '{}');
            this.config = saveConfig(updates);
            if (updates.deepgramApiKey) {
              this.coordinator.updateApiKey(updates.deepgramApiKey);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', hasKey: !!this.config.deepgramApiKey }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
    }

    // Authenticate hooks using runtime bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${this.runtime?.token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      let payload: any = {};
      try {
        if (body.trim()) payload = JSON.parse(body);
      } catch {
        payload = {};
      }

      try {
        if (pathname.includes('/sessionstart')) {
          const resp = await this.coordinator.handleSessionStart(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
        } else if (pathname.includes('/userpromptsubmit')) {
          const resp = await this.coordinator.handleUserPromptSubmit(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
        } else if (pathname.includes('/pretooluse')) {
          const resp = await this.coordinator.handlePreToolUse(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
        } else if (pathname.includes('/posttooluse')) {
          await this.coordinator.handlePostToolUse(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        } else if (pathname.includes('/permissionrequest')) {
          const resp = await this.coordinator.handlePermissionRequest(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
        } else if (pathname.includes('/stop')) {
          await this.coordinator.handleStop(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found' }));
        }
      } catch (err: any) {
        console.error('[HTTP Hook Error]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
      }
    });
  }

  private handleWsConnection(ws: WebSocket, req: http.IncomingMessage) {
    // Authenticate WebSocket connection using runtime bearer token
    if (this.runtime?.token) {
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || '127.0.0.1'}`);
      const tokenParam = parsedUrl.searchParams.get('token');
      const authHeader = req.headers.authorization;
      const providedToken = tokenParam || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

      if (!providedToken || providedToken !== this.runtime.token) {
        console.warn('[WS Security] Rejected unauthorized WebSocket connection attempt');
        ws.close(4001, 'Unauthorized');
        return;
      }
    }

    this.clients.add(ws);

    // Send initial state
    const initialMsg: DaemonToClientMessage = {
      type: 'state',
      state: this.coordinator.getState(),
      muted: false,
      inputMode: this.config.inputMode,
    };
    ws.send(JSON.stringify(initialMsg));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Binary audio chunk (16kHz linear16 PCM from microphone)
        this.coordinator.sendAudioFrame(Buffer.from(data as any));
      } else {
        // Control JSON
        try {
          const msg = JSON.parse(data.toString()) as ClientToDaemonMessage;
          this.coordinator.handleClientMessage(msg);
        } catch (err) {
          console.error('[WS Parse Error]', err);
        }
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  private broadcast(msg: DaemonToClientMessage) {
    const text = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    }
  }

  stop() {
    this.coordinator.stop();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    cleanupRuntimeState();
    console.log('[Claude Voice Daemon] Stopped cleanly.');
  }
}

// Ensure active chat submission prevents concurrent standalone stream
