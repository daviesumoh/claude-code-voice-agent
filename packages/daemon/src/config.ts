import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { VoiceConfig, RuntimeState } from '@claude-voice/shared';

export function resolveConfigDir(): string {
  const homeDir = path.join(os.homedir(), '.claude-voice');
  if (!fs.existsSync(homeDir)) {
    fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  }
  return homeDir;
}

export function getConfigPaths() {
  const dir = resolveConfigDir();
  return {
    dir,
    config: path.join(dir, 'config.json'),
    runtime: path.join(dir, 'runtime.json'),
  };
}

export function writeRuntimeState(port: number): RuntimeState {
  const { runtime } = getConfigPaths();
  const token = crypto.randomBytes(24).toString('hex');
  const state: RuntimeState = {
    token,
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(runtime, JSON.stringify(state, null, 2), { mode: 0o600 });
  return state;
}

const DEFAULT_CONFIG: VoiceConfig = {
  voiceModel: 'aura-asteria-en',
  sttModel: 'nova-2',
  speed: 1.0,
  expressivity: 0,
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  earconsEnabled: true,
  inputMode: 'ACTIVE_CHAT',
  port: 4545,
};

export function loadConfig(): VoiceConfig {
  const apiKey = process.env.DEEPGRAM_API_KEY || '';
  return {
    ...DEFAULT_CONFIG,
    deepgramApiKey: apiKey.trim(),
  };
}
