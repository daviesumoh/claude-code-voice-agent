export type TurnState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'INTERRUPTED';

export interface VoiceConfig {
  deepgramApiKey?: string;
  voiceModel: string; // e.g. "aura-asteria-en"
  sttModel: string; // e.g. "nova-2"
  speed: number;
  expressivity?: number;
  inputSampleRate: number;
  outputSampleRate: number;
  earconsEnabled: boolean;
  inputMode: 'ACTIVE_CHAT' | 'STANDALONE_VOICE';
  port: number;
}

export interface RuntimeState {
  token: string;
  port: number;
  pid: number;
  startedAt: string;
}

export type ClientToDaemonMessage =
  | { type: 'ping' }
  | { type: 'set_input_mode'; mode: 'ACTIVE_CHAT' | 'STANDALONE_VOICE' }
  | { type: 'set_mute'; muted: boolean };
