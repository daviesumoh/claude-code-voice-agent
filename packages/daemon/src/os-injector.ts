import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function injectViaClipboard(text: string): Promise<boolean> {
  const script = `
    set the clipboard to "${text.replace(/"/g, '\\"')}"
    tell application "System Events"
      keystroke "v" using {command down}
      delay 0.05
      key code 36 -- Return key
    end tell
  `;
  try {
    await execFileAsync('osascript', ['-e', script]);
    return true;
  } catch (err) {
    console.error('[OSInjector] Clipboard injection failed:', err);
    return false;
  }
}
