import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { normalizeEllipses } from './voice-extractor.js';

export interface FluxTTSOptions {
  apiKey: string;
  model: string; // e.g. "flux-tanner-en" - REQUIRED and must start with flux-
  sampleRate?: number; // default 24000
  speed?: number; // 0.85 - 1.15 in 0.05 steps
  expressivity?: number; // -2 to 2, e.g. 0
}

export interface SpeechInterruptedEvent {
  speech_id: string;
  text_spoken: string;
  text_remaining: string;
}

export interface SpeechMetadataEvent {
  speech_id: string;
  duration?: number;
  characters?: number;
}

export class DeepgramFluxTTS extends EventEmitter {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private currentSpeechId: string | null = null;
  private isSpeaking = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isAuthError = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private pendingMessages: string[] = [];
  private options: Required<Omit<FluxTTSOptions, 'expressivity'>> & { expressivity?: number };

  constructor(options: FluxTTSOptions) {
    super();

    let model = options.model || 'flux-tanner-en';
    if (!model.startsWith('flux-')) {
      console.warn(`[Flux TTS] Model '${model}' must start with 'flux-'. Defaulting to 'flux-tanner-en'.`);
      model = 'flux-tanner-en';
    }

    this.options = {
      apiKey: options.apiKey,
      model,
      sampleRate: options.sampleRate || 24000,
      speed: options.speed || 1.0,
      expressivity: options.expressivity ?? 0,
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

    const url = new URL('wss://api.deepgram.com/v2/speak');
    url.searchParams.set('model', this.options.model);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', this.options.sampleRate.toString());
    if (this.options.expressivity !== undefined) {
      url.searchParams.set('expressivity', this.options.expressivity.toString());
    }

    this.ws = new WebSocket(url.toString(), {
      headers: {
        Authorization: `Token ${this.options.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.isAuthError = false;
      this.startKeepAlive();
      this.emit('connected');

      // Send initial speed configure if different from 1.0
      if (this.options.speed !== 1.0) {
        this.configureSpeed(this.options.speed);
      }

      // Flush any queued Speak / Flush messages waiting on connection
      while (this.pendingMessages.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
        const msg = this.pendingMessages.shift()!;
        this.ws.send(msg);
      }
    });

    this.ws.on('unexpected-response', (_req, res) => {
      const statusCode = res.statusCode;
      if (statusCode === 401 || statusCode === 403) {
        this.isAuthError = true;
        console.error(`[Deepgram Flux TTS] Authentication failed (HTTP ${statusCode}). Please check your DEEPGRAM_API_KEY in .env.`);
      }
    });

    // Audio packets arrive as binary linear16 PCM frames
    this.ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        // Raw linear16 PCM binary audio chunk
        const pcmBuf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        this.emit('audio', pcmBuf);
      } else {
        // Control message in JSON
        try {
          const msg = JSON.parse(data.toString());
          this.handleServerMessage(msg);
        } catch (err) {
          this.emit('error', err);
        }
      }
    });

    this.ws.on('error', (err: any) => {
      if (err.message && (err.message.includes('401') || err.message.includes('403'))) {
        this.isAuthError = true;
        console.error('[Deepgram Flux TTS] Authentication error:', err.message);
      }
      this.emit('error', err);
    });

    this.ws.on('close', (code, reason) => {
      this.isConnected = false;
      this.isSpeaking = false;
      this.stopKeepAlive();
      const reasonStr = reason.toString();
      this.emit('disconnected', { code, reason: reasonStr });

      if (code === 4001 || code === 4401 || code === 1008 || reasonStr.toLowerCase().includes('unauthorized')) {
        this.isAuthError = true;
        console.error(`[Deepgram Flux TTS] Auth rejected by server (code ${code}): ${reasonStr}`);
      }

      if (code !== 1000 && !this.isAuthError) {
        this.scheduleReconnect();
      }
    });
  }

  private handleServerMessage(msg: any) {
    const type = msg.type;

    switch (type) {
      case 'SpeechStarted':
        this.currentSpeechId = msg.speech_id || null;
        this.isSpeaking = true;
        this.emit('speech_started', { speech_id: this.currentSpeechId });
        break;

      case 'Flushed':
        this.emit('flushed');
        break;

      case 'SpeechMetadata':
        // Signals end of the turn's audio stream!
        this.isSpeaking = false;
        const meta: SpeechMetadataEvent = {
          speech_id: msg.speech_id,
          duration: msg.audio_duration_ms ?? msg.duration,
          characters: msg.input_character_count ?? msg.characters,
        };
        this.emit('speech_metadata', meta);
        break;

      case 'SpeechInterrupted':
        this.isSpeaking = false;
        const interrupted: SpeechInterruptedEvent = {
          speech_id: msg.speech_id,
          text_spoken: msg.text_spoken || '',
          text_remaining: msg.text_remaining || '',
        };
        this.emit('speech_interrupted', interrupted);
        break;

      case 'ConfigureSuccess':
        this.emit('configure_success', msg);
        break;

      case 'ConfigureFailure':
      case 'Error':
        console.warn('[DeepgramFluxTTS Server Error]', msg);
        this.emit('configure_failure', msg);
        break;

      case 'Warning':
        this.emit('warning', msg);
        break;

      default:
        break;
    }
  }

  /**
   * Speak a text chunk. Note: Deepgram requires non-empty text, and concatenates
   * successive Speak messages verbatim. We ensure trailing whitespace is added!
   */
  speak(text: string) {
    const normalized = normalizeEllipses(text).trim();
    if (!normalized) {
      return; // Do not send empty text as that returns a 400 error!
    }

    // Always append a single space to avoid word-boundary collisions on concatenation
    const payload = JSON.stringify({
      type: 'Speak',
      text: `${normalized} `,
    });

    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingMessages.push(payload);
      this.connect();
      return;
    }

    this.ws.send(payload);
  }

  /**
   * Ends the current turn. Deepgram will flush the audio and emit SpeechMetadata.
   */
  flush() {
    const payload = JSON.stringify({ type: 'Flush' });
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingMessages.push(payload);
      this.connect();
      return;
    }
    this.ws.send(payload);
  }

  /**
   * Barge-in interruption. Deepgram immediately stops generating audio for this turn
   * and returns SpeechInterrupted with text_spoken and text_remaining!
   */
  interrupt() {
    this.pendingMessages = [];
    this.isSpeaking = false;
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type: 'Interrupt' }));
  }

  /**
   * Configure speed mid-session. Supported values: 0.85 to 1.15 in 0.05 steps.
   */
  configureSpeed(speed: number) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Snap to nearest 0.05 step between 0.85 and 1.15
    const clamped = Math.max(0.85, Math.min(1.15, speed));
    const snapped = Math.round(clamped * 20) / 20;

    this.ws.send(
      JSON.stringify({
        type: 'Configure',
        speed: snapped,
      })
    );
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  getCurrentSpeechId(): string | null {
    return this.currentSpeechId;
  }

  private scheduleReconnect() {
    if (this.isAuthError) {
      console.warn('[Deepgram Flux TTS] Reconnection cancelled due to authentication error.');
      return;
    }
    if (this.reconnectTimeout) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > 10) {
      console.warn('[Deepgram Flux TTS] Maximum reconnect attempts (10) reached. Giving up.');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);
    console.log(`[Deepgram Flux TTS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/10)...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 5000);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  close() {
    this.stopKeepAlive();
    this.pendingMessages = [];
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Intentional Close');
      this.ws = null;
    }
    this.isConnected = false;
    this.isSpeaking = false;
  }
}

// Reconciles text_spoken on SpeechInterrupted for seamless conversational barge-in
