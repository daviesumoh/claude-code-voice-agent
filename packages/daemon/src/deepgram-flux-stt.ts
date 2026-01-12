import WebSocket from 'ws';

export interface STTCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: Error) => void;
}

export class DeepgramSTTClient {
  private ws: WebSocket | null = null;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  connect(callbacks: STTCallbacks) {
    // Deepgram Nova-2 real-time STT endpoint
    const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.apiKey}` }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const alt = msg.channel?.alternatives?.[0];
        if (alt?.transcript) {
          callbacks.onTranscript(alt.transcript, Boolean(msg.is_final));
        }
      } catch (err: any) {
        callbacks.onError(err);
      }
    });

    this.ws.on('error', (err) => callbacks.onError(err));
  }

  sendAudio(chunk: Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  close() {
    this.ws?.close();
  }
}
