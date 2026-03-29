import type { EarconType } from '@claude-voice/shared';

export class EarconPolicy {
  private lastEditTickTimestamp = 0;
  private lastFailTapTimestamp = 0;
  private readonly editCooldownMs = 12000; // 12 seconds
  private readonly failCooldownMs = 15000; // 15 seconds
  private enabled = true;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Evaluates whether a tool call should trigger a subtle earcon.
   * Enforces strict silence for routine read/grep/glob/thinking.
   */
  onToolUse(toolName: string): EarconType | null {
    if (!this.enabled) return null;

    const lower = toolName.toLowerCase();

    // Code mutations: Edit, Write, MultiEdit, Replace
    if (lower.includes('edit') || lower.includes('write') || lower.includes('patch')) {
      const now = Date.now();
      if (now - this.lastEditTickTimestamp >= this.editCooldownMs) {
        this.lastEditTickTimestamp = now;
        return 'EDIT_TICK';
      }
    }

    // All reading, listing, searching is strictly silent
    return null;
  }

  /**
   * Evaluates whether a tool failure should trigger an earcon.
   */
  onToolFailure(toolName: string): EarconType | null {
    if (!this.enabled) return null;

    const now = Date.now();
    if (now - this.lastFailTapTimestamp >= this.failCooldownMs) {
      this.lastFailTapTimestamp = now;
      return 'FAIL_TAP';
    }

    return null;
  }

  /**
   * Triggered when Claude Code is asking a question or requesting permission.
   */
  onPrompt(): EarconType | null {
    if (!this.enabled) return null;
    return 'CHIME_PROMPT';
  }

  /**
   * Triggered when Claude completes a turn that was purely visual (no spoken text).
   */
  onVisualCompletion(): EarconType | null {
    if (!this.enabled) return null;
    return 'CHIME_SUCCESS';
  }
}

