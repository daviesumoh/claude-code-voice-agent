import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { VoiceConfig, RuntimeState } from '@claude-voice/shared';

function resolveConfigDir(): string {
  const homeDir = path.join(os.homedir(), '.claude-voice');
  try {
    if (!fs.existsSync(homeDir)) {
      fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    }
    return homeDir;
  } catch {
    // Fallback if home directory is restricted/sandboxed
    const fallbackDir = path.join('/tmp', '.claude-voice');
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true, mode: 0o700 });
    }
    return fallbackDir;
  }
}

export function getConfigPaths() {
  const dir = resolveConfigDir();
  return {
    dir,
    config: path.join(dir, 'config.json'),
    runtime: path.join(dir, 'runtime.json'),
  };
}

export function loadEnvFiles() {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.join(os.homedir(), '.claude-voice', '.env'),
    path.join(os.homedir(), 'Documents', 'claude-voice', '.env'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        if (typeof (process as any).loadEnvFile === 'function') {
          (process as any).loadEnvFile(envPath);
        } else {
          const lines = fs.readFileSync(envPath, 'utf8').split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
              const [key, ...rest] = trimmed.split('=');
              const val = rest.join('=').trim().replace(/^['"](.*)['"]$/, '$1');
              if (key && !process.env[key.trim()]) {
                process.env[key.trim()] = val;
              }
            }
          }
        }
      } catch {
        // Ignore load errors
      }
    }
  }
}

const DEFAULT_CONFIG: VoiceConfig = {
  voiceModel: 'flux-tanner-en',
  sttModel: 'flux-general-en',
  speed: 1.0,
  expressivity: 0,
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  eotThreshold: '0.65',
  eotTimeoutMs: '700',
  earconsEnabled: true,
  inputMode: 'ACTIVE_CHAT' as any,
  port: 4545,
};

export function loadConfig(): VoiceConfig {
  loadEnvFiles();
  const { config: configFile } = getConfigPaths();
  let config = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      config = { ...config, ...data };
      if (!config.voiceModel || config.voiceModel === 'flux-alexis-en') {
        config.voiceModel = 'flux-tanner-en';
      }
      if (config.expressivity === undefined) {
        config.expressivity = 0;
      }
      // Ensure snappy turn detection thresholds
      if (Number(config.eotTimeoutMs) > 1200) {
        config.eotTimeoutMs = '800';
      }
      if (!config.eotThreshold || Number(config.eotThreshold) > 0.75) {
        config.eotThreshold = '0.7';
      }
    } catch (err) {
      console.warn('[Config] Failed to parse config.json, using defaults:', err);
    }
  } else {
    try {
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
    } catch {
      // Ignore write errors
    }
  }

  // Prefer process.env.DEEPGRAM_API_KEY from .env if present
  if (process.env.DEEPGRAM_API_KEY) {
    config.deepgramApiKey = process.env.DEEPGRAM_API_KEY.trim();
  }

  return config;
}

export function saveConfig(updates: Partial<VoiceConfig>): VoiceConfig {
  const { config: configFile } = getConfigPaths();
  const current = loadConfig();
  const updated = { ...current, ...updates };
  try {
    fs.writeFileSync(configFile, JSON.stringify(updated, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[Config] Failed to save config updates:', err);
  }
  return updated;
}

export function initRuntimeState(port: number): RuntimeState {
  const { runtime: runtimeFile } = getConfigPaths();
  const token = crypto.randomBytes(24).toString('hex');
  const state: RuntimeState = {
    token,
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(runtimeFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[Config] Failed to write runtime.json:', err);
  }
  return state;
}

export function cleanupRuntimeState() {
  const { runtime: runtimeFile } = getConfigPaths();
  try {
    if (fs.existsSync(runtimeFile)) {
      fs.unlinkSync(runtimeFile);
    }
  } catch {
    // Ignore cleanup errors
  }
}
