import { VoiceDaemonServer } from './server.js';
import { loadConfig } from './config.js';
import { launchPillWindow } from './launcher.js';

async function main() {
  const config = loadConfig();

  if (!config.deepgramApiKey) {
    console.warn('\n⚠️  Deepgram API Key not found!');
    console.warn('Set it in ~/.claude-voice/config.json ("deepgramApiKey": "...") or DEEPGRAM_API_KEY environment variable.\n');
  }

  const daemon = new VoiceDaemonServer(config);

  const shutdown = () => {
    daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await daemon.start();
    if (process.env.NO_PILL !== '1') {
      await launchPillWindow(config.port || 4545);
    }
  } catch (err: any) {
    console.error('[Claude Voice Daemon] Fatal error starting server:', err.message);
    process.exit(1);
  }
}

main();

