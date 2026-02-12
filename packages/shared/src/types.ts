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
