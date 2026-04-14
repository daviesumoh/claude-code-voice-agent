import WebSocket from 'ws';

export function calculateBackoff(attempt: number, baseMs = 500, maxMs = 5000): number {
  return Math.min(baseMs * Math.pow(2, attempt), maxMs);
}

export class DeepgramSTTClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private retryCount = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  connect() {
    const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.apiKey}` }
    });
    this.ws.on('open', () => {
      this.retryCount = 0;
    });
    this.ws.on('close', () => {
      const delay = calculateBackoff(this.retryCount++);
      setTimeout(() => this.connect(), delay);
    });
  }
}
