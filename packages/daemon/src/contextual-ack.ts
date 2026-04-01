/**
 * Generates an ultra-fast, natural 1-sentence spoken verbal acknowledgment
 * in direct context of the developer's request.
 *
 * Returns empty string "" if no acknowledgment is needed (e.g. for general chatter),
 * letting the model's actual answer stream without robotic filler.
 */
export function generateContextualAcknowledgment(prompt: string): string {
  const p = prompt.trim().toLowerCase();

  // 1. Greetings (hello, hi, hey, etc.)
  if (/^(hello|hi|hey|good morning|good afternoon|howdy|yo)\b/i.test(p)) {
    return 'Hey there!';
  }

  // 2. Audio / Connection checks
  if (/\b(can you hear me|are you there|hear me|testing)\b/i.test(p)) {
    return 'Loud and clear.';
  }

  // 3. Thanks / Appreciation
  if (/\b(thank you|thanks|appreciate it)\b/i.test(p)) {
    return 'Anytime!';
  }

  // 4. Specific file name mentioned (e.g. symbol.ts, config.json, native-pill.swift)
  const fileMatch = prompt.match(/\b([a-zA-Z0-9_\-]+\.(?:ts|js|json|swift|py|md|html|css|yaml|yml))\b/i);
  if (fileMatch) {
    const filename = fileMatch[1]
      .replace(/\.ts$/i, ' dot T S')
      .replace(/\.js$/i, ' dot J S')
      .replace(/\.json$/i, ' dot J S O N')
      .replace(/\.swift$/i, ' dot swift');
    return `Let me check ${filename} for you.`;
  }

  // 5. Tests / Suite / Assertions
  if (/\b(test|tests|test suite|unit test|jest|pnpm test|coverage)\b/i.test(p)) {
    return 'Checking the tests now.';
  }

  // 6. Optimize / Performance / Refactor / Review
  if (/\b(optimize|optimization|optimizations|performance|latency|speed up|clean up|refactor)\b/i.test(p)) {
    return 'Scanning the codebase for optimizations.';
  }

  // 7. Bugs / Errors / Issues / Fails / Broken
  if (/\b(bug|error|broken|failing|fail|fails|crash|issue|problem|fix|debug)\b/i.test(p)) {
    return 'Investigating that issue now.';
  }

  // 8. Symbol / Indexer
  if (/\b(symbol|indexer|symbol-indexer)\b/i.test(p)) {
    return 'Checking the symbol definitions now.';
  }

  // 9. Build / Compile / Bundle / TypeScript
  if (/\b(build|compile|bundle|type error|tsc)\b/i.test(p)) {
    return 'Checking the build status now.';
  }

  // 10. Git / Branch / Commit / Diff / PR
  if (/\b(git|commit|push|diff|branch|pr|pull request|merge)\b/i.test(p)) {
    return 'Checking git status for you.';
  }

  // 11. Voice / Pill / Mic / Audio / Speaker
  if (/\b(pill|voice|mic|microphone|audio|speaker|tanner|deepgram|turn detection|barge in|interrupt)\b/i.test(p)) {
    return 'Checking the voice settings now.';
  }

  // 12. If none of the above match, do NOT blurt out a generic filler phrase;
  // return empty string so the model's actual answer delivers cleanly.
  return '';
}
