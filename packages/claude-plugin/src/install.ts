import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const hookDispatcherPath = path.resolve(__dirname, 'hook-dispatcher.js');

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
];

export function installHooks(customDir?: string) {
  const claudeDir = customDir || path.join(os.homedir(), '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  let settings: Record<string, any> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(content);
    } catch {
      settings = {};
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Backup original settings if existing and writable
  if (fs.existsSync(settingsPath)) {
    try {
      fs.copyFileSync(settingsPath, `${settingsPath}.backup-${Date.now()}`);
    } catch {
      // Ignore backup error if permissions restrict extra files
    }
  }

  for (const event of EVENTS) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
    }

    const commandStr = `node "${hookDispatcherPath}" ${event}`;

    // Check if hook is already registered
    const exists = settings.hooks[event].some((group: any) =>
      Array.isArray(group.hooks) &&
      group.hooks.some((h: any) => h.command && h.command.includes('hook-dispatcher.js') && h.command.includes(event))
    );

    if (!exists) {
      settings.hooks[event].push({
        hooks: [
          {
            type: 'command',
            command: commandStr,
          },
        ],
      });
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  console.log(`[Claude Voice] Successfully registered hooks in ${settingsPath}`);
}

export function uninstallHooks(customDir?: string) {
  const claudeDir = customDir || path.join(os.homedir(), '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    console.log(`[Claude Voice] No settings.json found at ${settingsPath}`);
    return;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.hooks) return;

    for (const event of EVENTS) {
      if (Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = settings.hooks[event].filter((group: any) => {
          if (!Array.isArray(group.hooks)) return true;
          return !group.hooks.some((h: any) => h.command && h.command.includes('hook-dispatcher.js'));
        });
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`[Claude Voice] Successfully uninstalled hooks from ${settingsPath}`);
  } catch (err) {
    console.error('[Claude Voice] Failed to uninstall hooks:', err);
  }
}

// When executed directly
if (process.argv[1] && process.argv[1].endsWith('install.js')) {
  const targetDir = process.argv[2];
  installHooks(targetDir);
}
