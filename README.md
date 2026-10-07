# Claude Code Voice Agent

A low-latency, full-duplex conversational voice layer built specifically for the **Claude Code App** (and Claude Code CLI / terminal workflows).

Powered by **Deepgram Flux STT (`/v2/listen`)** and **Deepgram Flux TTS (`/v2/speak`)**, it wraps Claude Code as a **single brain** with zero hallucinated state drift, keeping 100% of your Claude Code workflows (Git worktrees, `/plan`, skills, subagents, MCP tools, and interactive diff approvals) completely intact.

---

## ⚡ Highlights

- **Direct Deepgram Flux v2 Pipeline:** Real-time conversational turn-taking via `flux-general-en` STT and turn-based synthesis via `flux-tanner-en` TTS.
- **Native macOS Floating Pill:** Always-on-top, draggable Cocoa overlay written in native Swift (`AVAudioEngine`), with smooth 30fps pulsating animations and automatic state syncing.
- **Unified Chat & Voice:** Dictated speech pastes directly into your active Claude composer or terminal text box, while Claude speaks back in natural real-time voice.
- **Acoustic Echo Ducking:** Microphone input is automatically muted while Claude speaks through laptop speakers, preventing acoustic loop feedback.
- **Zero Filler Acknowledgments:** Instant, natural responses (e.g. *"Hey there!"* for greetings, crisp 3-to-5 word task confirmations, and silence for general queries—no robotic canned phrases).
- **Full-Duplex Barge-In with Spoken Reconciliation:** Click the pill or talk over Claude to immediately halt audio output in `< 50ms`. Flux TTS reconciles `text_spoken` so Claude knows *exactly* what words you heard before cutting in.
- **Strict Silence + Subtle Earcons:** Stays 100% silent while Claude reads/greps/thinks. Emits soft procedural audio chimes (40–70ms) only on code edits or command retries.
- **Spoken Questions & Approvals:** Speaks aloud whenever Claude uses `AskUserQuestion` (e.g. during `/plan`) or triggers a `PermissionRequest` ("Allow running pnpm test? Say allow or deny").
- **Spoken Slash Commands:** Dictating `"slash plan add rate limiting"` automatically normalizes to `"/plan add rate limiting"`.
- **Zero-DB & Zero-Cloud Auth:** Runs purely locally on your Mac with zero external database. Reuses your existing local Claude Code session.

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐       ┌──────────────────────────────────┐
│   Native macOS Floating Pill    │       │     Claude Code App / Terminal   │
│   Swift + Cocoa (AVAudioEngine) │       │     Native Workflows, /plan,     │
│   Downsamples to 16kHz Int16    │       │     Diffs, Git Worktrees, MCP    │
│   Draggable, Persistent Origin  │       │                                  │
└──────────────┬──────────────────┘       └─────────────────┬────────────────┘
               │                                            │
               │ Authenticated WS (127.0.0.1:4545)          │ Local Hooks (~/.claude)
               ▼                                            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    Local Voice Daemon (Node.js)                            │
│  - Turn Coordinator (Barge-in, state machine, permission resolution)       │
│  - Deepgram Flux STT (/v2/listen) + workspace symbol keyterm boosting      │
│  - Deepgram Flux TTS (/v2/speak) + SpeechInterrupted text_spoken tracking  │
│  - Voice Extractor (<voice> parser + slash-command normalizer)             │
│  - Frontmost Keystroke & Clipboard Injector (AppleScript)                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **macOS 13.0+** (Apple Silicon or Intel)
- **Node.js 20+**
- **pnpm 9+** (`npm install -g pnpm`)
- **Deepgram API Key** (Get a free key with credits at [console.deepgram.com](https://console.deepgram.com))

### 2. Clone and Install
```bash
git clone https://github.com/your-username/claude-code-voice-agent.git
cd claude-code-voice-agent
pnpm install
```

### 3. Configure Environment
Copy the example environment file and insert your Deepgram API key:
```bash
cp .env.example .env
```
Edit `.env`:
```ini
DEEPGRAM_API_KEY=your_deepgram_api_key_here
VOICE_MODEL=flux-tanner-en
STT_MODEL=flux-general-en
VOICE_SPEED=1.0
VOICE_EXPRESSIVITY=0
INPUT_MODE=ACTIVE_CHAT
PORT=4545
```

### 4. Build the Project
```bash
# Builds TypeScript packages and compiles the native Swift floating pill
pnpm build
pnpm build:pill
```

### 5. Register Claude Code Hooks (Optional, for CLI workflows)
Run this once to connect the voice bridge hooks into Claude Code:
```bash
pnpm install-hooks
```
*(This adds lightweight non-blocking hooks to `~/.claude/settings.json`. If the voice daemon is ever offline, hooks exit in `< 5ms` without blocking Claude Code.)*

### 6. Start Claude Voice
Start the voice daemon in a terminal window:
```bash
pnpm daemon
```
Launch the native floating pill:
```bash
pnpm pill
```

---

## 🎮 Floating Pill Controls

- **Click Pill:** Toggle microphone listening on / off. If Claude is speaking, clicking immediately interrupts audio and begins listening to you.
- **Drag Pill:** Click and drag anywhere on the screen. The pill remembers its position across restarts.
- **Right-Click Pill:** Opens context menu:
  - Toggle Mute
  - Toggle Input Mode (`ACTIVE_CHAT` vs `STANDALONE_VOICE`)
  - Quit Claude Voice
- **Pill Visual Indicators:**
  - **Dim Amber:** Idle / Standby
  - **Bright Pulsing Amber:** Listening to your voice
  - **Rapid Pulse:** Thinking / Processing turn
  - **Continuous Waveform Pulse:** Speaking aloud to you

---

## 🔒 Security & Privacy

- **Localhost Only:** The daemon binds strictly to `127.0.0.1:4545`.
- **Runtime Bearer Authentication:** On startup, the daemon generates a unique ephemeral runtime token saved to `~/.claude-voice/runtime.json` (`mode: 0600`). All HTTP hooks and WebSocket connections require this token.
- **No Keystroke Logging:** AppleScript injection targets only the active composer text box on demand without saving or logging keystrokes.
- **Zero Leaked Secrets:** `.env` and local runtime files are strictly ignored by `.gitignore`.

---

## 🧪 Testing

Run the automated test suite covering voice extraction, slash command normalization, earcon cooldown gates, string escaping, and exponential backoff calculations:

```bash
pnpm test
```

---

## 📄 License

MIT
