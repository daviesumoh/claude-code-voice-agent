import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function injectTextToTerminal(text: string): Promise<boolean> {
  const script = `
    tell application "System Events"
      keystroke "${text.replace(/"/g, '\\"')}"
      key code 36 -- Return key
    end tell
  `;
  try {
    await execFileAsync('osascript', ['-e', script]);
    return true;
  } catch (err) {
    console.error('[OSInjector] Failed to keystroke:', err);
    return false;
  }
}
