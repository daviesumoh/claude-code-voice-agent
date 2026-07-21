# Claude Code Voice Agent

A low-latency, full-duplex conversational voice layer for the Claude Code CLI and Terminal.

## Claude Code Plugin Hooks
Run the automated installer to connect voice hooks into `~/.claude/settings.json`:
```bash
pnpm install-hooks
```

Supported events:
- `SessionStart`: Initializes voice session and state
- `UserPromptSubmit`: Synchronizes user inputs
- `PostToolUse`: Contextual feedback and tool execution status
- `Stop`: Assistant speech finalization
