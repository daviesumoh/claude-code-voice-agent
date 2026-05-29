import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

export async function launchPillWindow(port = 4545) {
  const url = `http://127.0.0.1:${port}`;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const appBundle = path.resolve(__dirname, 'ClaudeVoice.app');
  const nativeBinary = path.resolve(__dirname, 'claude-voice-pill');

  if (os.platform() === 'darwin') {
    // Kill any stale floating pill instances first so there is only ever 1 pill on screen
    try {
      await execAsync('pkill -f claude-voice-pill || true');
    } catch {
      // Ignore
    }

    // 1. Prefer macOS .app bundle (has NSMicrophoneUsageDescription Info.plist for mic permissions)
    const appExecutable = path.join(appBundle, 'Contents', 'MacOS', 'claude-voice-pill');
    const binaryToRun = fs.existsSync(appExecutable) ? appExecutable : nativeBinary;

    if (fs.existsSync(binaryToRun)) {
      try {
        const child = spawn(binaryToRun, [], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, PORT: `${port}` },
        });
        child.unref();
        console.log(`[Claude Voice Pill] Native draggable macOS floating pill launched (PID: ${child.pid})!`);
        return;
      } catch (err) {
        console.warn('[Claude Voice Pill] Failed to spawn native binary, falling back to app window:', err);
      }
    }

    try {
      // 2. Fallback to Chrome standalone minimalist App Window mode
      await execAsync(`open -na "Google Chrome" --args --app="${url}" --window-size=480,440`);
      console.log(`[Claude Voice Pill] Floating Pill window opened at ${url}`);
      return;
    } catch {
      // 3. Fallback to default browser
      await execAsync(`open "${url}"`);
      console.log(`[Claude Voice Pill] Opened in browser at ${url}`);
      return;
    }
  }

  // Other platforms fallback
  await execAsync(`open "${url}" || xdg-open "${url}"`);
}

if (process.argv[1] && process.argv[1].endsWith('launcher.js')) {
  launchPillWindow();
}
