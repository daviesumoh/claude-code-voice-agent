import { query } from '@anthropic-ai/claude-agent-sdk';
import { extractVoiceContent, normalizeEllipses } from './voice-extractor.js';

export interface StreamAgentOptions {
  cwd?: string;
  sessionId?: string | null;
  onSentence: (sentence: string) => void;
  onToolUse?: (toolName: string, input: any) => void;
  onSessionId?: (sessionId: string) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
}

export class ClaudeStreamAgent {
  private activeAbortController: AbortController | null = null;
  private isGenerating = false;
  private cwd: string;
  private sessionId: string | null = null;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  setCwd(cwd: string) {
    this.cwd = cwd;
  }

  setSessionId(sessionId: string | null) {
    this.sessionId = sessionId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  private cleanSpokenSentence(text: string): string {
    return normalizeEllipses(
      text
        .replace(/<\/?voice>/gi, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^\s*[-*#]+\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  async ask(prompt: string, callbacks: StreamAgentOptions): Promise<void> {
    this.interrupt(); // Cancel any existing generation

    this.isGenerating = true;
    this.activeAbortController = new AbortController();

    const voicePromptInstruction = `[VOICE CONVERSATION ACTIVE]
You are speaking directly with the developer in a live, real-time voice conversation using Tanner voice.
Be engaging, natural, warm, and concise — speak like a sharp, friendly colleague on a headset.
- Reply conversationally in 1 to 2 crisp, natural spoken sentences.
- Use an ellipsis (...) when taking a natural pause, thinking, or transitioning between ideas (e.g. "Let's see... I found the issue.").
- Use 6 dots (......) if you need a longer deliberate pause between two distinct steps.
- Do not speak raw markdown, bullet points, or code syntax out loud.
- If you inspect or edit files, briefly describe what you found or changed in plain conversational English.
- Keep responses engaging, collaborative, and concise.`;

    const resumeSession = this.sessionId;

    try {
      const queryOptions: Record<string, any> = {
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        cwd: callbacks.cwd || this.cwd,
      };

      if (resumeSession) {
        queryOptions.resume = resumeSession;
      }

      const q = query({
        prompt: `${voicePromptInstruction}\n\nUser said: ${prompt}`,
        options: queryOptions,
      });

      let sentenceBuffer = '';
      let insideCodeFence = false;
      let emittedAnySentence = false;
      let rawFullText = '';

      for await (const msg of q) {
        if (this.activeAbortController?.signal.aborted) {
          break;
        }

        if ((msg as any).session_id && (msg as any).session_id !== this.sessionId) {
          this.sessionId = (msg as any).session_id;
          callbacks.onSessionId?.(this.sessionId!);
        }

        if (msg.type === 'stream_event') {
          const ev = (msg as any).event;
          if (ev?.type === 'content_block_delta' && ev?.delta?.text) {
            const token: string = ev.delta.text;
            rawFullText += token;
            sentenceBuffer += token;

            // Track if we are inside a ``` code block so we never speak code out loud
            const fenceMatches = rawFullText.match(/```/g);
            insideCodeFence = fenceMatches ? fenceMatches.length % 2 === 1 : false;

            if (!insideCodeFence) {
              // Strip any partial/complete <voice> tags from the buffer
              sentenceBuffer = sentenceBuffer.replace(/<\/?voice>/gi, '');

              // Emit as soon as we hit a sentence boundary (., !, ? or ellipses ...)
              let match = sentenceBuffer.match(/^([\s\S]+?(?:\.{3,}|(?<!\.)[.!?](?!\.)))(?:\s+|$)([\s\S]*)$/);
              while (match) {
                const candidate = this.cleanSpokenSentence(match[1]);
                const remainder = match[2] || '';
                // Avoid cutting on common abbreviations like "e.g.", "i.e.", "Dr.", "Mr.", "vs."
                const isAbbreviation = /\b(e\.g|i\.e|mr|mrs|dr|ms|prof|vs|inc|ltd)\.$/i.test(candidate);
                if (isAbbreviation) {
                  break;
                }
                if (candidate) {
                  emittedAnySentence = true;
                  callbacks.onSentence(candidate);
                }
                sentenceBuffer = remainder;
                match = sentenceBuffer.match(/^([\s\S]+?(?:\.{3,}|(?<!\.)[.!?](?!\.)))(?:\s+|$)([\s\S]*)$/);
              }
            } else {
              // Discard code fence contents from spoken buffer
              sentenceBuffer = '';
            }
          } else if (ev?.type === 'content_block_start' && ev?.content_block?.type === 'tool_use') {
            const toolName = ev.content_block.name || 'tool';
            callbacks.onToolUse?.(toolName, {});
          }
        } else if ((msg as any).type === 'tool_use' || (msg as any).tool_name) {
          const tool = (msg as any).tool_name || 'tool';
          callbacks.onToolUse?.(tool, (msg as any).tool_input);
        } else if (msg.type === 'result') {
          // Flush any remaining spoken text in sentenceBuffer
          const remaining = this.cleanSpokenSentence(sentenceBuffer);
          if (remaining) {
            emittedAnySentence = true;
            callbacks.onSentence(remaining);
            sentenceBuffer = '';
          } else if (!emittedAnySentence && rawFullText.trim()) {
            const { spokenText } = extractVoiceContent(rawFullText);
            if (spokenText) {
              callbacks.onSentence(spokenText);
            }
          }
          callbacks.onComplete();
        }
      }
    } catch (err: any) {
      // If resuming an expired/invalid session failed, clear sessionId and retry once fresh
      if (resumeSession && !this.activeAbortController?.signal.aborted) {
        console.warn('[ClaudeStreamAgent] Session resume failed, starting fresh session:', err.message);
        this.sessionId = null;
        return this.ask(prompt, { ...callbacks, sessionId: null });
      }
      if (!this.activeAbortController?.signal.aborted) {
        callbacks.onError(err);
      }
    } finally {
      this.isGenerating = false;
      this.activeAbortController = null;
    }
  }

  interrupt() {
    if (this.isGenerating && this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
      this.isGenerating = false;
    }
  }

  getIsGenerating(): boolean {
    return this.isGenerating;
  }
}
