import { spawn } from 'node:child_process';

export class OSInjector {
  /**
   * Safely formats and escapes text into an AppleScript-compatible string literal.
   */
  static formatAppleScriptString(text: string): string {
    return JSON.stringify(text.trim());
  }

  /**
   * Injects the transcribed prompt into the active Claude Code App window, terminal,
   * or web text box, pressing Enter to submit.
   */
  async injectPrompt(text: string): Promise<boolean> {
    if (!text || !text.trim()) return false;

    // Use JSON.stringify so apostrophes (don't, that's), quotes, and newlines are safely escaped for AppleScript
    const applescriptString = OSInjector.formatAppleScriptString(text);

    // Target the frontmost application text box directly without switching apps
    const script = `
      tell application "System Events"
        set oldClip to the clipboard
        set the clipboard to ${applescriptString}
        delay 0.04
        -- Command+V to paste into active composer / text box
        keystroke "v" using {command down}
        delay 0.06
        -- Press Return to submit prompt
        key code 36
        delay 0.1
        set the clipboard to oldClip
      end tell
    `;

    return new Promise((resolve) => {
      const child = spawn('osascript', ['-e', script]);
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          console.warn('[OSInjector] Failed to inject prompt via AppleScript:', stderr.trim());
          resolve(false);
        }
      });
      child.on('error', (err) => {
        console.warn('[OSInjector] Error spawning osascript:', err);
        resolve(false);
      });
    });
  }

  /**
   * Sends an Escape key code to the active window to interrupt a running command.
   */
  async sendInterrupt(): Promise<boolean> {
    const script = `
      tell application "System Events"
        -- Key code 53 is Escape
        key code 53
      end tell
    `;

    return new Promise((resolve) => {
      const child = spawn('osascript', ['-e', script]);
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }
}
