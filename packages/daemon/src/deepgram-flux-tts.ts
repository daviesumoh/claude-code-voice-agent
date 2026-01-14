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

  speak(text: string, callbacks: TTSCallbacks) {
    // Deepgram Aura TTS endpoint
    const url = `https://api.deepgram.com/v1/speak?model=${this.voice}&encoding=linear16&sample_rate=24000`;
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    }).then(async (res) => {
      if (!res.ok) throw new Error(`TTS failed with status ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) return;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) callbacks.onAudioChunk(Buffer.from(value));
      }
      callbacks.onComplete();
    }).catch(err => callbacks.onError(err));
  }
}
