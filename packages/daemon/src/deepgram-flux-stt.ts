import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export interface FluxSTTOptions {
  apiKey: string;
  model?: string;
  sampleRate?: number;
  eotThreshold?: string | number;
  eotTimeoutMs?: string | number;
}

export class DeepgramFluxSTT extends EventEmitter {
  private ws: WebSocket | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastAudioSentTime = 0;
  private isConnected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isAuthError = false;
  private pendingAudioQueue: Buffer[] = [];
  private options: {
    apiKey: string;
    model: string;
    sampleRate: number;
    eotThreshold: number;
    eotTimeoutMs: number;
  };

  constructor(options: FluxSTTOptions) {
    super();
    this.options = {
      apiKey: options.apiKey,
      model: options.model || 'flux-general-en',
      sampleRate: options.sampleRate || 16000,
      eotThreshold: Number(options.eotThreshold ?? 0.8) || 0.8,
      eotTimeoutMs: Math.round(Number(options.eotTimeoutMs ?? 2500) || 2500),
    };
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!this.options.apiKey) {
      this.emit('error', new Error('Deepgram API key is missing. Set it in ~/.claude-voice/config.json or DEEPGRAM_API_KEY.'));
      return;
    }

    const url = new URL('wss://api.deepgram.com/v2/listen');
    url.searchParams.set('model', this.options.model);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', this.options.sampleRate.toString());

    this.ws = new WebSocket(url.toString(), {
      headers: {
        Authorization: `Token ${this.options.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.isAuthError = false;
      this.lastAudioSentTime = Date.now();
      this.startKeepAlive();
      this.emit('connected');

      // Send initial Configure threshold settings using numeric types required by /v2/listen
      this.configure({
        thresholds: {
          eot_threshold: this.options.eotThreshold,
          eot_timeout_ms: this.options.eotTimeoutMs,
        },
      });

      // Flush any buffered audio chunks captured while connecting
      while (this.pendingAudioQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
        const chunk = this.pendingAudioQueue.shift()!;
        if (chunk.length > 0) {
          this.ws.send(chunk);
          this.lastAudioSentTime = Date.now();
        }
      }
    });

    this.ws.on('unexpected-response', (_req, res) => {
      const statusCode = res.statusCode;
      if (statusCode === 401 || statusCode === 403) {
        this.isAuthError = true;
        console.error(`[Deepgram Flux STT] Authentication failed (HTTP ${statusCode}). Please check your DEEPGRAM_API_KEY in .env.`);
      }
    });

    this.ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const text = data.toString();
        const msg = JSON.parse(text);
        this.handleServerMessage(msg);
      } catch (err) {
        this.emit('error', err);
      }
    });

    this.ws.on('error', (err: any) => {
      if (err.message && (err.message.includes('401') || err.message.includes('403'))) {
        this.isAuthError = true;
        console.error('[Deepgram Flux STT] Authentication error:', err.message);
      }
      this.emit('error', err);
    });

    this.ws.on('close', (code, reason) => {
      this.isConnected = false;
      this.stopKeepAlive();
      const reasonStr = reason.toString();
      this.emit('disconnected', { code, reason: reasonStr });

      if (code === 4001 || code === 4401 || code === 1008 || reasonStr.toLowerCase().includes('unauthorized')) {
        this.isAuthError = true;
        console.error(`[Deepgram Flux STT] Auth rejected by server (code ${code}): ${reasonStr}`);
      }

      if (code !== 1000 && !this.isAuthError) {
        this.scheduleReconnect();
      }
    });
  }

  private handleServerMessage(msg: any) {
    // Deepgram /v2/listen emits TurnInfo messages with { type: "TurnInfo", event: "StartOfTurn" | "Update" | "EagerEndOfTurn" | "TurnResumed" | "EndOfTurn", transcript: "..." }
    const eventType = msg.type === 'TurnInfo' ? msg.event : msg.type;
    const transcript = this.extractTranscript(msg);

    switch (eventType) {
      case 'StartOfTurn':
        this.emit('start_of_turn');
        if (transcript.trim()) {
          this.emit('transcript_partial', transcript);
        }
        break;

      case 'Update':
        if (transcript.trim()) {
          this.emit('transcript_partial', transcript);
        }
        break;

      case 'EagerEndOfTurn':
        this.emit('eager_end_of_turn', transcript);
        break;

      case 'TurnResumed':
        this.emit('turn_resumed');
        break;

      case 'EndOfTurn':
        console.log(`[DeepgramFluxSTT] EndOfTurn: "${transcript}"`);
        this.emit('end_of_turn', transcript);
        break;

      case 'ConfigureSuccess':
        this.emit('configure_success', msg);
        break;

      case 'ConfigureFailure':
      case 'Error':
        console.warn('[DeepgramFluxSTT Server Message]', msg);
        this.emit('configure_failure', msg);
        break;

      default:
        if (transcript.trim()) {
          this.emit('transcript_partial', transcript);
        }
        break;
    }
  }

  private extractTranscript(msg: any): string {
    if (typeof msg.transcript === 'string') return msg.transcript;
    if (msg.channel?.alternatives?.[0]?.transcript) {
      return msg.channel.alternatives[0].transcript;
    }
    return '';
  }

  /**
   * Send 16-bit linear PCM audio chunk (16kHz).
   * Note: NEVER send empty byte payloads as per Deepgram rules.
   */
  sendAudio(chunk: Buffer | Uint8Array) {
    if (!chunk || chunk.length === 0) {
      return; // Never send 0-length buffer
    }

    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue up to ~3 seconds of audio while connecting so first words aren't lost
      this.pendingAudioQueue.push(buf);
      if (this.pendingAudioQueue.length > 60) {
        this.pendingAudioQueue.shift();
      }
      this.connect();
      return;
    }

    this.lastAudioSentTime = Date.now();
    this.ws.send(buf);
  }

  /**
   * Force Deepgram /v2/listen to finalize the current turn immediately (e.g. when user clicks pill to stop talking).
   */
  forceEndTurn() {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ForceEndTurn' }));
    }
  }

  /**
   * Update EOT thresholds or keyterms mid-session without reconnecting.
   */
  configure(config: {
    thresholds?: { eot_threshold?: string | number; eot_timeout_ms?: string | number };
    keyterms?: string[];
  }) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload: Record<string, any> = { type: 'Configure' };
    if (config.thresholds) {
      const thresholds: Record<string, number> = {};
      if (config.thresholds.eot_threshold !== undefined) {
        thresholds.eot_threshold = Number(config.thresholds.eot_threshold) || 0.8;
      }
      if (config.thresholds.eot_timeout_ms !== undefined) {
        thresholds.eot_timeout_ms = Math.round(Number(config.thresholds.eot_timeout_ms) || 2500);
      }
      payload.thresholds = thresholds;
    }
    if (config.keyterms && config.keyterms.length > 0) {
      payload.keyterms = config.keyterms.slice(0, 50);
    }

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Keep /v2/listen stream alive during silence by sending a tiny 20ms silent PCM frame
   * if no mic audio has been sent in the last 3.5 seconds.
   * Note: /v2/listen only accepts CloseStream, ForceEndTurn, Configure as JSON text frames,
   * so silent PCM keeps the audio stream open without triggering UNPARSABLE_CLIENT_MESSAGE!
   */
  private startKeepAlive() {
    this.stopKeepAlive();
    const silent20msFrame = Buffer.alloc(640); // 320 samples * 2 bytes = 640 bytes (20ms at 16kHz)
    this.keepAliveTimer = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const timeSinceLastAudio = Date.now() - this.lastAudioSentTime;
        if (timeSinceLastAudio >= 3500) {
          this.ws.send(silent20msFrame);
          this.lastAudioSentTime = Date.now();
        }
      }
    }, 3500);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.isAuthError) {
      console.warn('[Deepgram Flux STT] Reconnection cancelled due to authentication error.');
      return;
    }
    if (this.reconnectTimeout) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > 10) {
      console.warn('[Deepgram Flux STT] Maximum reconnect attempts (10) reached. Giving up.');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);
    console.log(`[Deepgram Flux STT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/10)...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  close() {
    this.stopKeepAlive();
    this.pendingAudioQueue = [];
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Intentional Close');
      this.ws = null;
    }
    this.isConnected = false;
  }
}
