import { DeepgramSTTClient } from './deepgram-flux-stt.js';
import { injectTextToTerminal } from './os-injector.js';

console.log('[Claude Voice] Starting early prototype loop...');
const apiKey = process.env.DEEPGRAM_API_KEY || '';
if (!apiKey) {
  console.warn('DEEPGRAM_API_KEY is not set');
}

const stt = new DeepgramSTTClient(apiKey);
stt.connect({
  onTranscript: (text, isFinal) => {
    console.log(`[STT] ${isFinal ? '(FINAL)' : '(interim)'}: ${text}`);
    if (isFinal && text.trim().length > 0) {
      injectTextToTerminal(text.trim());
    }
  },
  onError: (err) => console.error('[STT Error]', err)
});
