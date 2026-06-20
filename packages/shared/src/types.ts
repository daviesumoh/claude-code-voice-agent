export type TurnState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'AWAITING_PERMISSION'
  | 'INTERRUPTED';

export interface VoiceConfig {
  deepgramApiKey?: string;
  voiceModel: string; // e.g. "flux-tanner-en"
  sttModel: string; // e.g. "flux-general-en"
  speed: number; // 0.85 - 1.15 in 0.05 increments
  expressivity?: number; // -2 to 2, e.g. 0
  inputSampleRate: number; // 16000
  outputSampleRate: number; // 24000
  eotThreshold: string; // e.g. "0.7"
  eotTimeoutMs: string; // e.g. "800"
  earconsEnabled: boolean;
  inputMode: 'HANDS_FREE' | 'PUSH_TO_TALK' | 'TOGGLE' | 'ACTIVE_CHAT' | 'STANDALONE_VOICE';
  port: number; // default 4545
}

export interface RuntimeState {
  token: string;
  port: number;
  pid: number;
  startedAt: string;
}

export type EarconType =
  | 'EDIT_TICK'
  | 'FAIL_TAP'
  | 'CHIME_PROMPT'
  | 'CHIME_SUCCESS';

// Claude Code Hook Payloads & Responses
export interface HookBasePayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name: string;
}

export interface SessionStartPayload extends HookBasePayload {
  hook_event_name: 'SessionStart';
}

export interface UserPromptSubmitPayload extends HookBasePayload {
  hook_event_name: 'UserPromptSubmit';
  prompt?: string;
}

export interface PreToolUsePayload extends HookBasePayload {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PostToolUsePayload extends HookBasePayload {
  hook_event_name: 'PostToolUse' | 'PostToolUseFailure';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output?: unknown;
  error?: string;
}

export interface PermissionRequestPayload extends HookBasePayload {
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface StopPayload extends HookBasePayload {
  hook_event_name: 'Stop';
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}

export interface HookDecisionResponse {
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
    decision?: {
      behavior: 'allow' | 'deny';
      message?: string;
    };
  };
  decision?: 'allow' | 'block';
  reason?: string;
}

// WebSocket protocol between Voice Daemon and Floating Pill / Audio Client
export type ClientToDaemonMessage =
  | { type: 'ping' }
  | { type: 'set_input_mode'; mode: 'HANDS_FREE' | 'PUSH_TO_TALK' | 'TOGGLE' | 'DICTATE_TO_WINDOW' | 'VOICE_CONVERSATION' }
  | { type: 'set_cwd'; cwd: string }
  | { type: 'push_to_talk'; active: boolean }
  | { type: 'set_mute'; muted: boolean }
  | { type: 'set_speed'; speed: number }
  | { type: 'manual_interrupt' }
  | { type: 'force_end_turn' }
  | { type: 'speak_text'; text: string }
  | { type: 'permission_decision'; id: string; behavior: 'allow' | 'deny'; message?: string };

export type DaemonToClientMessage =
  | { type: 'pong' }
  | { type: 'state'; state: TurnState; muted: boolean; inputMode: string; activeSessionId?: string; activeCwd?: string }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; isFinal: boolean }
  | { type: 'earcon'; sound: EarconType }
  | { type: 'permission_prompt'; id: string; tool: string; summary: string }
  | { type: 'error'; message: string };

