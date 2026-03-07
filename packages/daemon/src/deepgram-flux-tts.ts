import WebSocket from 'ws';

export interface TTSCallbacks {
  onAudioChunk: (chunk: Buffer) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
}

export class DeepgramTTSClient {
  private apiKey: string;
  private voice: string;

  constructor(apiKey: string, voice = 'aura-asteria-en') {
    this.apiKey = apiKey;
    this.voice = voice;
  }

  // Split text into streamable sentences for lower latency
  splitSentences(text: string): string[] {
    return text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
  }

  async speak(text: string, callbacks: TTSCallbacks) {
    const sentences = this.splitSentences(text);
    for (const sentence of sentences) {
      if (!sentence.trim()) continue;
      const url = `https://api.deepgram.com/v1/speak?model=${this.voice}&encoding=linear16&sample_rate=24000`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Token ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text: sentence.trim() })
        });
        if (!res.ok) throw new Error(`TTS failed with status ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) continue;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) callbacks.onAudioChunk(Buffer.from(value));
        }
      } catch (err: any) {
        callbacks.onError(err);
      }
    }
    callbacks.onComplete();
  }
}
