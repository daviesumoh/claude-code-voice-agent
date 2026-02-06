# Claude Code Voice Agent (Prototype)

An experimental real-time voice interface prototype for Claude Code.

## Architecture Notes
- Native macOS microphone capture using `AVAudioEngine`
- Speech-to-text via Deepgram Nova-2
- Speech synthesis via Deepgram Aura
- Terminal keystroke injection via AppleScript System Events
