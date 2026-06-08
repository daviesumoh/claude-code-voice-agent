import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HookBasePayload, HookDecisionResponse, RuntimeState } from '@claude-voice/shared';

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', () => {
      resolve('{}');
    });
    // If no input on stdin within 50ms, resolve empty
    setTimeout(() => {
      if (!data) resolve('{}');
    }, 50);
  });
}

function getRuntimeState(): RuntimeState | null {
  const candidatePaths = [
    path.join(os.homedir(), '.claude-voice', 'runtime.json'),
    path.join('/tmp', '.claude-voice', 'runtime.json'),
  ];

  for (const runtimePath of candidatePaths) {
    try {
      if (fs.existsSync(runtimePath)) {
        const content = fs.readFileSync(runtimePath, 'utf8');
        return JSON.parse(content) as RuntimeState;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
}

async function main() {
  const eventName = process.argv[2] || 'Generic';
  const stdinRaw = await readStdin();
  let payload: HookBasePayload;
  try {
    payload = stdinRaw.trim() ? JSON.parse(stdinRaw) : { hook_event_name: eventName };
  } catch {
    payload = { hook_event_name: eventName };
  }

  // Ensure event name is populated
  payload.hook_event_name = eventName;

  const runtime = getRuntimeState();
  if (!runtime || !runtime.port) {
    // Daemon is not running. Exit cleanly with no-op.
    process.exit(0);
  }

  // PermissionRequest might wait for spoken allow/deny, give it more time (up to 6s)
  const timeoutMs = eventName === 'PermissionRequest' ? 6000 : 350;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `http://127.0.0.1:${runtime.port}/api/hook/${eventName.toLowerCase()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runtime.token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.ok) {
      const json = (await res.json()) as HookDecisionResponse;
      if (json && Object.keys(json).length > 0) {
        process.stdout.write(JSON.stringify(json));
      }
    }
  } catch {
    // If daemon request times out or fails, fail open (exit 0) so Claude is never blocked
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
