import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function getFrontmostAppName(): Promise<string> {
  const script = 'tell application "System Events" to get name of first application process whose frontmost is true';
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script]);
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function injectTextToTerminal(text: string): Promise<boolean> {
  const script = `
    tell application "System Events"
      keystroke "${text.replace(/"/g, '\\"')}"
      key code 36
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
