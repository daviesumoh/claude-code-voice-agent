import { EventEmitter } from 'node:events';
import path from 'node:path';
import type {
  TurnState,
  VoiceConfig,
  EarconType,
  SessionStartPayload,
  UserPromptSubmitPayload,
  PreToolUsePayload,
  PostToolUsePayload,
  PermissionRequestPayload,
  StopPayload,
  HookDecisionResponse,
  ClientToDaemonMessage,
  DaemonToClientMessage,
} from '@claude-voice/shared';
import { DeepgramFluxSTT } from './deepgram-flux-stt.js';
import { DeepgramFluxTTS, type SpeechInterruptedEvent, type SpeechMetadataEvent } from './deepgram-flux-tts.js';
import { EarconPolicy } from './earcon-policy.js';
import { SymbolIndexer } from './symbol.js';
import { extractVoiceContent, normalizeSpokenSlashCommands } from './voice-extractor.js';
import { ClaudeStreamAgent } from './claude-stream-agent.js';
import { generateContextualAcknowledgment } from './contextual-ack.js';

export interface TurnCoordinatorOptions {
  config: VoiceConfig;
}

export class TurnCoordinator extends EventEmitter {
  private config: VoiceConfig;
  private state: TurnState = 'IDLE';
  private stt: DeepgramFluxSTT;
  private tts: DeepgramFluxTTS;
  private earconPolicy: EarconPolicy;
  private symbolIndexer: SymbolIndexer;
  private isMuted = false;
  private activeSessionId: string | null = null;
  private activeCwd: string = process.cwd();
  private lastInterruptedTextSpoken: string | null = null;
  private pendingPermissionResolver: ((decision: { behavior: 'allow' | 'deny'; message?: string }) => void) | null = null;
  private streamAgent: ClaudeStreamAgent;
  private pendingBargeIn = false;
  private lastSubmittedPrompt = '';
  private lastSubmittedPromptTime = 0;
  private isInternalStreaming = false;
  private lastSpokenAssistantText = '';
  private lastSpokenAssistantTime = 0;
  private currentlyPlayingText = '';
  private hasEmittedFinalText = false;
  private lastProgressReportTime = 0;

  constructor(options: TurnCoordinatorOptions) {
    super();
    this.config = options.config;

    this.earconPolicy = new EarconPolicy(this.config.earconsEnabled);
    this.symbolIndexer = new SymbolIndexer();
    this.streamAgent = new ClaudeStreamAgent();

    this.stt = new DeepgramFluxSTT({
      apiKey: this.config.deepgramApiKey || '',
      model: this.config.sttModel,
      sampleRate: this.config.inputSampleRate,
      eotThreshold: this.config.eotThreshold,
      eotTimeoutMs: this.config.eotTimeoutMs,
    });

    this.tts = new DeepgramFluxTTS({
      apiKey: this.config.deepgramApiKey || '',
      model: this.config.voiceModel,
      sampleRate: this.config.outputSampleRate,
      speed: this.config.speed,
      expressivity: this.config.expressivity ?? 0,
    });

    this.setupSTTEvents();
    this.setupTTSEvents();
  }

  start() {
    this.stt.connect();
    this.tts.connect();
  }

  updateApiKey(apiKey: string) {
    this.config.deepgramApiKey = apiKey;
    this.stt.close();
    this.tts.close();
    this.stt = new DeepgramFluxSTT({
      apiKey,
      model: this.config.sttModel,
      sampleRate: this.config.inputSampleRate,
      eotThreshold: this.config.eotThreshold,
      eotTimeoutMs: this.config.eotTimeoutMs,
    });
    this.tts = new DeepgramFluxTTS({
      apiKey,
      model: this.config.voiceModel,
      sampleRate: this.config.outputSampleRate,
      speed: this.config.speed,
      expressivity: this.config.expressivity ?? 0,
    });
    this.setupSTTEvents();
    this.setupTTSEvents();
    this.start();
  }

  stop() {
    this.stt.close();
    this.tts.close();
  }

  private setState(newState: TurnState) {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('state_change', {
        state: this.state,
        muted: this.isMuted,
        inputMode: this.config.inputMode,
        activeSessionId: this.activeSessionId || undefined,
        activeCwd: this.activeCwd,
      });
    }
  }

  getActiveCwd(): string {
    return this.activeCwd;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  setActiveCwd(cwd: string) {
    this.activeCwd = cwd;
    this.streamAgent.setCwd(cwd);
    this.setState(this.state);
  }

  getState(): TurnState {
    return this.state;
  }

  private setupSTTEvents() {
    this.stt.on('start_of_turn', () => {
      // If user starts speaking while Claude is talking, don't barge in yet:
      // wait until the transcript shows real words (see maybeBargeIn).
      if (this.isClaudeSpeaking()) {
        this.pendingBargeIn = true;
      } else if (this.state === 'IDLE' || this.state === 'THINKING') {
        this.setState('LISTENING');
      }
    });

    this.stt.on('eager_end_of_turn', (partial) => {
      this.maybeBargeIn(partial);
      if (partial.trim()) {
        this.emit('transcript', { role: 'user', text: partial, isFinal: false });
      }
    });

    this.stt.on('transcript_partial', (partial) => {
      this.maybeBargeIn(partial);
      if (partial.trim()) {
        this.emit('transcript', { role: 'user', text: partial, isFinal: false });
      }
    });

    this.stt.on('end_of_turn', (finalTranscript) => {
      if (this.isClaudeSpeaking()) {
        if (!this.maybeBargeIn(finalTranscript)) {
          // Too short to be a real interruption (likely echo or noise): ignore it.
          this.pendingBargeIn = false;
          return;
        }
      }
      this.pendingBargeIn = false;

      if (!finalTranscript.trim()) {
        this.setState('IDLE');
        return;
      }

      // Check if we are awaiting a permission decision
      if (this.state === 'AWAITING_PERMISSION' && this.pendingPermissionResolver) {
        const lower = finalTranscript.toLowerCase();
        if (lower.includes('allow') || lower.includes('yes') || lower.includes('go ahead') || lower.includes('proceed')) {
          this.pendingPermissionResolver({ behavior: 'allow' });
          this.pendingPermissionResolver = null;
          this.setState('THINKING');
          return;
        } else if (lower.includes('deny') || lower.includes('no') || lower.includes('cancel') || lower.includes('stop')) {
          this.pendingPermissionResolver({ behavior: 'deny', message: `User denied: "${finalTranscript}"` });
          this.pendingPermissionResolver = null;
          this.setState('IDLE');
          return;
        }
      }

      // Normalize any dictated slash commands (e.g. "slash plan" -> "/plan")
      const normalized = normalizeSpokenSlashCommands(finalTranscript).trim();

      if (!normalized) {
        this.setState('IDLE');
        return;
      }

      // De-duplicate: ignore if exact same prompt was already submitted within 3.5 seconds
      const now = Date.now();
      if (normalized === this.lastSubmittedPrompt && now - this.lastSubmittedPromptTime < 3500) {
        console.log(`[TurnCoordinator] Suppressing duplicate EndOfTurn prompt: "${normalized}"`);
        return;
      }
      this.lastSubmittedPrompt = normalized;
      this.lastSubmittedPromptTime = now;

      this.emit('transcript', { role: 'user', text: normalized, isFinal: true });

      // Check inputMode:
      // If mode is 'STANDALONE_VOICE', run direct voice loop with ClaudeStreamAgent
      // Otherwise (DEFAULT): Inject prompt into user's active Claude chat window!
      if ((this.config.inputMode as string) === 'STANDALONE_VOICE') {
        this.askClaudeStream(normalized);
      } else {
        console.log(`[TurnCoordinator] Submitting spoken prompt to active Claude chat: "${normalized}"`);
        this.emit('submit_prompt', normalized);
        this.setState('THINKING');
      }
    });

    this.stt.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private setupTTSEvents() {
    this.tts.on('audio', (pcmBuffer: Buffer) => {
      // Forward 24kHz linear16 PCM audio directly to connected Audio Client
      this.emit('tts_audio', pcmBuffer);
    });

    this.tts.on('speech_started', () => {
      this.setState('SPEAKING');
    });

    this.tts.on('speech_metadata', (meta: SpeechMetadataEvent) => {
      // Audio stream complete
      if (this.state === 'SPEAKING') {
        this.setState('IDLE');
      }
    });

    this.tts.on('speech_interrupted', (interrupted: SpeechInterruptedEvent) => {
      this.lastInterruptedTextSpoken = interrupted.text_spoken;
      console.log(`[Barge-In] Interrupted after speaking: "${interrupted.text_spoken}"`);
    });

    this.tts.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private isClaudeSpeaking(): boolean {
    return this.state === 'SPEAKING' || this.tts.getIsSpeaking();
  }

  /**
   * Check if transcript is an acoustic echo of what Claude is currently speaking.
   */
  private isEchoOfAssistant(transcript: string): boolean {
    const cleanIncoming = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!cleanIncoming) return true;
    const cleanPlaying = (this.currentlyPlayingText + ' ' + this.lastSpokenAssistantText)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
    return cleanPlaying.includes(cleanIncoming);
  }

  /**
   * Real-time barge-in detector.
   * Immediately interrupts Claude if the user speaks a stop command or a genuine new instruction.
   */
  private maybeBargeIn(transcript: string): boolean {
    if (!this.isClaudeSpeaking()) return false;
    const trimmed = transcript.trim();
    if (!trimmed) return false;

    // 1. Immediate barge-in on standard single-word voice commands
    if (/\b(stop|wait|hold on|pause|cancel|shut up|quiet|no|hang on)\b/i.test(trimmed)) {
      console.log(`[Barge-In] Stop command detected: "${trimmed}"`);
      this.handleBargeIn();
      return true;
    }

    // 2. Ignore speaker echo if the transcript matches what Claude is currently speaking
    if (this.isEchoOfAssistant(trimmed)) {
      return false;
    }

    // 3. User is speaking a genuine new instruction! Barge-in immediately!
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    if (words >= 1) {
      console.log(`[Barge-In] User speech detected during playback: "${trimmed}"`);
      this.handleBargeIn();
      return true;
    }

    return false;
  }

  private handleBargeIn() {
    this.pendingBargeIn = false;
    this.setState('INTERRUPTED');

    // 1. Interrupt any active LLM stream generation immediately!
    this.streamAgent.interrupt();

    // 2. Tell audio client to immediately flush/silence its speaker buffer
    this.emit('flush_client_audio');

    // 3. Tell Deepgram Flux TTS to cancel speech generation
    this.tts.interrupt();

    // 4. Transition to LISTENING for the user's spoken instruction
    this.setState('LISTENING');
  }

  /**
   * Provides brief, throttled progress updates while Claude is analyzing or using tools,
   * keeping the user informed without yapping.
   */
  private maybeReportProgress(toolName: string, input?: any) {
    if (this.hasEmittedFinalText) return;
    const now = Date.now();
    // Throttle progress updates to at most once every 7.5 seconds
    if (now - this.lastProgressReportTime < 7500) {
      return;
    }
    this.lastProgressReportTime = now;

    let update = '';
    if (toolName === 'Bash') {
      const cmd = typeof input?.command === 'string' ? input.command : '';
      if (cmd.includes('test')) {
        update = 'Running the test suite now.';
      } else if (cmd.includes('build') || cmd.includes('tsc')) {
        update = 'Compiling the build now.';
      } else {
        update = 'Running the terminal command.';
      }
    } else if (toolName === 'Read') {
      const p = typeof input?.path === 'string' ? path.basename(input.path) : '';
      if (p) {
        update = `Reading ${p.replace(/\.ts$/i, ' dot T S').replace(/\.js$/i, ' dot J S')}.`;
      } else {
        update = 'Reading the file.';
      }
    } else if (toolName === 'Grep' || toolName === 'Glob') {
      update = 'Searching the codebase.';
    } else if (toolName === 'Edit') {
      update = 'Applying changes to the file.';
    }

    if (update) {
      console.log(`[TurnCoordinator] Progress update: "${update}"`);
      this.currentlyPlayingText = update;
      this.tts.speak(update);
      this.tts.flush();
    }
  }

  async askClaudeStream(prompt: string) {
    this.isInternalStreaming = true;
    this.hasEmittedFinalText = false;
    this.setState('THINKING');

    // 1. Immediate Contextual Acknowledgment (only when specific task context is detected)
    const ack = generateContextualAcknowledgment(prompt);
    if (ack) {
      this.currentlyPlayingText = ack;
      this.emit('transcript', { role: 'assistant', text: ack, isFinal: false });
      this.tts.speak(ack);
      this.tts.flush();
    }

    let fullResponse = '';

    await this.streamAgent.ask(prompt, {
      cwd: this.activeCwd || process.cwd(),
      sessionId: this.activeSessionId,
      onSessionId: (sid) => {
        this.activeSessionId = sid;
      },
      onSentence: (sentence) => {
        this.hasEmittedFinalText = true;
        this.currentlyPlayingText = sentence;
        fullResponse += (fullResponse ? ' ' : '') + sentence;
        this.emit('transcript', { role: 'assistant', text: sentence, isFinal: false });
        this.tts.speak(sentence);
      },
      onToolUse: (toolName, input) => {
        const earcon = this.earconPolicy.onToolUse(toolName);
        if (earcon) this.triggerEarcon(earcon);
        this.maybeReportProgress(toolName, input);
      },
      onComplete: () => {
        this.tts.flush();
        this.lastSpokenAssistantText = fullResponse.trim();
        this.lastSpokenAssistantTime = Date.now();
        // Keep isInternalStreaming true for 6 seconds to absorb any trailing Stop hook from Claude Code
        setTimeout(() => {
          this.isInternalStreaming = false;
        }, 6000);
        if (fullResponse) {
          this.emit('transcript', { role: 'assistant', text: fullResponse, isFinal: true });
        } else {
          this.setState('IDLE');
        }
      },
      onError: (err) => {
        this.isInternalStreaming = false;
        console.error('[ClaudeStreamAgent Error]', err);
        this.setState('IDLE');
      },
    });
  }

  // --- Hook Handlers ---

  async handleSessionStart(payload: SessionStartPayload): Promise<HookDecisionResponse> {
    if (payload.session_id) {
      this.activeSessionId = payload.session_id;
      this.streamAgent.setSessionId(payload.session_id);
    }
    if (payload.cwd) {
      this.activeCwd = payload.cwd;
      this.streamAgent.setCwd(payload.cwd);
    }

    if (payload.cwd) {
      // Boost repository symbols asynchronously
      this.symbolIndexer.indexWorkspace(payload.cwd).then((keyterms: string[]) => {
        if (keyterms && keyterms.length > 0) {
          this.stt.configure({ keyterms });
        }
      });
    }

    // Instruct Claude about the dual-channel format
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          'You are connected to an interactive real-time voice interface speaking with Tanner voice. Be natural, warm, and conversational — like an expert pair programmer speaking over voice. In every response, provide a concise conversational summary (1-2 crisp sentences) wrapped in <voice>...</voice> tags. Never read raw markdown, backticks, or code blocks in the <voice> block. Keep full code diffs and detailed terminal outputs outside the voice block for the visual chat.',
      },
    };
  }

  async handleUserPromptSubmit(payload: UserPromptSubmitPayload): Promise<HookDecisionResponse> {
    this.setState('THINKING');

    if (this.lastInterruptedTextSpoken) {
      const interruptedContext = `[Voice Context: The user barged in and interrupted while hearing: "${this.lastInterruptedTextSpoken}". Address their new instruction seamlessly.]`;
      this.lastInterruptedTextSpoken = null;

      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: interruptedContext,
        },
      };
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          'Speak conversationally and naturally (1-2 crisp sentences in <voice>...</voice>). If editing or inspecting files, tell the user what you did in plain English.',
      },
    };
  }

  async handlePreToolUse(payload: PreToolUsePayload): Promise<HookDecisionResponse> {
    const toolName = payload.tool_name || '';

    // Check if Claude Code is asking a clarifying or /plan question!
    if (toolName === 'AskUserQuestion') {
      const questions = payload.tool_input?.questions as any[];
      let questionText = 'Claude Code has a question.';
      if (Array.isArray(questions) && questions.length > 0) {
        questionText = questions[0].question || questionText;
        if (Array.isArray(questions[0].options) && questions[0].options.length > 0) {
          questionText += ` Options are: ${questions[0].options.slice(0, 3).join(', ')}.`;
        }
      }

      this.triggerEarcon('CHIME_PROMPT');
      this.tts.speak(questionText);
      this.tts.flush();
      return {};
    }

    // Evaluate subtle earcon for file mutation
    const earcon = this.earconPolicy.onToolUse(toolName);
    if (earcon) {
      this.triggerEarcon(earcon);
    }

    return {};
  }

  async handlePostToolUse(payload: PostToolUsePayload): Promise<void> {
    if (payload.hook_event_name === 'PostToolUseFailure' || payload.error) {
      const earcon = this.earconPolicy.onToolFailure(payload.tool_name);
      if (earcon) {
        this.triggerEarcon(earcon);
      }
    }
  }

  async handlePermissionRequest(payload: PermissionRequestPayload): Promise<HookDecisionResponse> {
    this.setState('AWAITING_PERMISSION');
    this.triggerEarcon('CHIME_PROMPT');

    const tool = payload.tool_name || 'action';
    let summary = `Allow running ${tool}?`;
    if (tool === 'Bash' && typeof payload.tool_input?.command === 'string') {
      summary = `Allow running: ${payload.tool_input.command}?`;
    }

    this.emit('permission_prompt', {
      id: `${Date.now()}`,
      tool,
      summary,
    });

    // Speak the permission question
    this.tts.speak(`Permission check: ${summary} Say allow or deny.`);
    this.tts.flush();

    // Wait up to 5 seconds for user voice or UI decision
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingPermissionResolver = null;
        if (this.state === 'AWAITING_PERMISSION') {
          this.setState('THINKING');
        }
        // Fall through to native Claude Code UI prompt
        resolve({});
      }, 5000);

      this.pendingPermissionResolver = (decision) => {
        clearTimeout(timeout);
        resolve({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision,
          },
        });
      };
    });
  }

  async handleStop(payload: StopPayload): Promise<void> {
    // If the answer was ALREADY streamed and spoken out loud by askClaudeStream, do NOT speak it again!
    if (this.isInternalStreaming) {
      console.log('[TurnCoordinator] Skipping handleStop voice output: already spoken via direct streaming.');
      return;
    }

    const message = payload.last_assistant_message || '';
    const { spokenText, isVisualOnly } = extractVoiceContent(message);

    if (spokenText) {
      const now = Date.now();
      const normSpoken = spokenText.trim().toLowerCase();
      const normLast = this.lastSpokenAssistantText.trim().toLowerCase();

      // De-duplicate: If this exact or overlapping assistant message was spoken within 15 seconds, skip!
      if (
        normLast &&
        now - this.lastSpokenAssistantTime < 15000 &&
        (normLast === normSpoken || normLast.includes(normSpoken) || normSpoken.includes(normLast))
      ) {
        console.log('[TurnCoordinator] Skipping duplicate voice output in handleStop (already spoken recently).');
        return;
      }
      this.lastSpokenAssistantText = spokenText;
      this.lastSpokenAssistantTime = now;

      console.log(`[TurnCoordinator] Speaking assistant message from Claude Code hook: "${spokenText}"`);
      this.emit('transcript', { role: 'assistant', text: spokenText, isFinal: true });
      this.tts.speak(spokenText);
      this.tts.flush();
    } else if (isVisualOnly) {
      const earcon = this.earconPolicy.onVisualCompletion();
      if (earcon) {
        this.triggerEarcon(earcon);
      }
      this.setState('IDLE');
    }
  }

  // --- Client Audio & Control Handlers ---

  sendAudioFrame(chunk: Buffer) {
    if (this.isMuted) return;
    // Duck mic input while Claude is speaking to prevent Mac speaker acoustic echo feedback loops
    if (this.state === 'SPEAKING' || this.tts.getIsSpeaking()) {
      return;
    }
    this.stt.sendAudio(chunk);
  }

  handleClientMessage(msg: ClientToDaemonMessage) {
    switch (msg.type) {
      case 'ping':
        this.emit('client_message', { type: 'pong' });
        break;

      case 'set_cwd':
        if (msg.cwd) {
          this.setActiveCwd(msg.cwd);
        }
        break;

      case 'set_mute':
        this.isMuted = msg.muted;
        this.setState(this.state);
        break;

      case 'set_input_mode':
        this.config.inputMode = msg.mode as any;
        this.setState(this.state);
        break;

      case 'set_speed':
        this.config.speed = msg.speed;
        this.tts.configureSpeed(msg.speed);
        break;

      case 'manual_interrupt':
        this.handleBargeIn();
        break;

      case 'force_end_turn':
        this.stt.forceEndTurn();
        break;

      case 'speak_text':
        if (msg.text && msg.text.trim()) {
          this.emit('transcript', { role: 'user', text: msg.text.trim(), isFinal: true });
          this.askClaudeStream(msg.text.trim());
        }
        break;

      case 'permission_decision':
        if (this.pendingPermissionResolver) {
          this.pendingPermissionResolver({
            behavior: msg.behavior,
            message: msg.message,
          });
          this.pendingPermissionResolver = null;
        }
        break;
    }
  }

  private triggerEarcon(sound: EarconType) {
    this.emit('earcon', sound);
  }
}

