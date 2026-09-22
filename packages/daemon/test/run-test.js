import assert from 'node:assert';
import { extractVoiceContent, normalizeSpokenSlashCommands, sanitizeForTTS, normalizeEllipses } from '../dist/voice-extractor.js';
import { EarconPolicy } from '../dist/earcon-policy.js';
import { generateContextualAcknowledgment } from '../dist/contextual-ack.js';
import { OSInjector } from '../dist/os-injector.js';
import { SymbolIndexer } from '../dist/symbol-indexer.js';

console.log('Running Claude Voice Core Tests...\n');

// 1. Test Voice Extractor with <voice> tag
const textWithVoiceTag = `
Here is the code to fix the authentication issue:

\`\`\`typescript
export function validateToken(token: string) {
  return jwt.verify(token, SECRET);
}
\`\`\`

<voice>
I fixed the token validation logic in auth dot ts by checking expiration before verifying the signature.
</voice>
`;

const result1 = extractVoiceContent(textWithVoiceTag);
console.log('Test 1: Explicit <voice> tag:');
console.log('  Spoken text:', result1.spokenText);
console.log('  Is visual only:', result1.isVisualOnly);
assert.strictEqual(result1.isVisualOnly, false);
assert(result1.spokenText.includes('token validation logic'));
assert(!result1.spokenText.includes('```'));
console.log('  ✅ Passed\n');

// 2. Test Voice Extractor with Fallback (No <voice> tag, heavy markdown/code)
const textFallback = `
### Summary of Changes
| File | Status |
| --- | --- |
| src/index.ts | Modified |

We refactored the database client to use connection pooling. All unit tests passed.

\`\`\`bash
pnpm test
\`\`\`
`;

const result2 = extractVoiceContent(textFallback);
console.log('Test 2: Fallback prose extraction:');
console.log('  Spoken text:', result2.spokenText);
console.log('  Is visual only:', result2.isVisualOnly);
assert.strictEqual(result2.isVisualOnly, false);
assert(result2.spokenText.includes('database client to use connection pooling'));
assert(!result2.spokenText.includes('|'));
assert(!result2.spokenText.includes('pnpm test'));
console.log('  ✅ Passed\n');

// 3. Test Slash Command Normalization
console.log('Test 3: Slash command normalization:');
const tests = [
  ['slash plan add rate limiting to api', '/plan add rate limiting to api'],
  ['please run slash compact', '/compact'],
  ['forward slash bug in auth', '/bug in auth'],
  ['slash commit and push', '/commit and push'],
  ['slash review this pr', '/review this pr'],
];

for (const [input, expected] of tests) {
  const norm = normalizeSpokenSlashCommands(input);
  console.log(`  "${input}" -> "${norm}"`);
  assert.strictEqual(norm, expected);
}
console.log('  ✅ Passed\n');

// 4. Test Earcon Policy (Strict Silence + Cooldown Gate)
console.log('Test 4: Earcon Policy:');
const policy = new EarconPolicy(true);

// Exploration tools should be 100% silent
assert.strictEqual(policy.onToolUse('Read'), null);
assert.strictEqual(policy.onToolUse('Grep'), null);
assert.strictEqual(policy.onToolUse('Glob'), null);
console.log('  Read/Grep/Glob are silent: ✅ Passed');

// First Edit triggers EDIT_TICK
const tick1 = policy.onToolUse('Edit');
assert.strictEqual(tick1, 'EDIT_TICK');
console.log('  First Edit gives EDIT_TICK: ✅ Passed');

// Immediate second Edit must be suppressed by cooldown (12s)
const tick2 = policy.onToolUse('Edit');
assert.strictEqual(tick2, null);
console.log('  Immediate second Edit suppressed by cooldown: ✅ Passed');

// Failure tap
const fail1 = policy.onToolFailure('Bash');
assert.strictEqual(fail1, 'FAIL_TAP');
console.log('  Command failure gives FAIL_TAP: ✅ Passed');

// 5. Test Spoken De-Duplication Logic
console.log('Test 5: Assistant speech de-duplication:');
let lastSpoken = 'I updated the config file for you.';
let lastSpokenTime = Date.now();

const incoming1 = 'I updated the config file for you.';
const normLast = lastSpoken.trim().toLowerCase();
const normIncoming = incoming1.trim().toLowerCase();
const isDup = normLast && (Date.now() - lastSpokenTime < 15000) && (normLast === normIncoming || normLast.includes(normIncoming) || normIncoming.includes(normLast));
assert.strictEqual(isDup, true);
console.log('  Exact duplicate within window detected: ✅ Passed');

const incoming2 = 'Sure, I modified the tests.';
const normIncoming2 = incoming2.trim().toLowerCase();
const isDiff = normLast && (Date.now() - lastSpokenTime < 15000) && (normLast === normIncoming2 || normLast.includes(normIncoming2) || normIncoming2.includes(normLast));
assert.strictEqual(isDiff, false);
console.log('  Distinct message permitted: ✅ Passed');

// 6. Test Contextual Acknowledgment Generator
console.log('Test 6: Contextual Acknowledgment Generator:');
const ackGreeting = generateContextualAcknowledgment('hello');
assert.strictEqual(ackGreeting, 'Hey there!');
console.log(`  "hello" -> "${ackGreeting}": ✅ Passed (natural greeting, no robotic filler)`);

const ackGeneral = generateContextualAcknowledgment('What did I ask earlier?');
assert.strictEqual(ackGeneral, '');
console.log(`  "What did I ask earlier?" -> "${ackGeneral}": ✅ Passed (silent, no robotic filler)`);

const ack1 = generateContextualAcknowledgment('Can you check symbol.ts for any broken imports?');
assert(ack1.includes('symbol dot T S'));
console.log(`  "check symbol.ts" -> "${ack1}": ✅ Passed`);

const ack2 = generateContextualAcknowledgment('Can you look at the tests and see what can be optimized?');
assert(ack2.includes('tests') || ack2.includes('optimizations'));
console.log(`  "look at tests and optimize" -> "${ack2}": ✅ Passed`);

const ack3 = generateContextualAcknowledgment('I think there is a bug causing the server to fail');
assert(ack3.includes('issue'));
console.log(`  "bug causing server fail" -> "${ack3}": ✅ Passed\n`);

// 7. Test OSInjector AppleScript String Escaping
console.log('Test 7: OSInjector AppleScript string escaping:');
const trickyStrings = [
  'fix the function called "handleAuth" in index.ts',
  "don't fail on single quotes or apostrophes",
  'line 1\nline 2 with tabs:\t"val"',
  'unicode test: 🚀 ✨ 100%',
  'path with backslash: C:\\temp\\file.txt',
];

for (const raw of trickyStrings) {
  const escaped = OSInjector.formatAppleScriptString(raw);
  assert(escaped.startsWith('"') && escaped.endsWith('"'));
  // JSON.parse must recover the exact trimmed original text
  assert.strictEqual(JSON.parse(escaped), raw.trim());
}
console.log('  AppleScript string escaping preserves quotes, newlines, and unicode: ✅ Passed\n');

// 8. Test Deepgram Reconnect Exponential Backoff Calculation
console.log('Test 8: Exponential backoff calculation:');
function calculateBackoffDelay(attempt) {
  return Math.min(1000 * Math.pow(2, attempt - 1), 15000);
}

assert.strictEqual(calculateBackoffDelay(1), 1000);
assert.strictEqual(calculateBackoffDelay(2), 2000);
assert.strictEqual(calculateBackoffDelay(3), 4000);
assert.strictEqual(calculateBackoffDelay(4), 8000);
assert.strictEqual(calculateBackoffDelay(5), 15000); // capped at 15s
assert.strictEqual(calculateBackoffDelay(10), 15000);
console.log('  Exponential backoff progression (1s, 2s, 4s, 8s, 15s cap): ✅ Passed\n');

// 9. Test SymbolIndexer Workspace Indexing
console.log('Test 9: SymbolIndexer workspace indexing:');
const indexer = new SymbolIndexer();
const keyterms = await indexer.indexWorkspace(process.cwd());
assert(Array.isArray(keyterms));
assert(keyterms.length > 0);
console.log(`  Indexed ${keyterms.length} workspace keyterms for Deepgram STT boosting: ✅ Passed\n`);

// 10. Test Deepgram Natural Pauses (Ellipses in groups of 3)
console.log('Test 10: Deepgram Natural Pauses & Ellipsis Normalization:');
// Unicode ellipsis … -> 3 ASCII dots
assert.strictEqual(normalizeEllipses('Wait… I see the bug.'), 'Wait... I see the bug.');
// 2 dots -> snap to 3 dots
assert.strictEqual(normalizeEllipses('Let me think.. okay.'), 'Let me think... okay.');
// 4 dots -> snap to 3 dots
assert.strictEqual(normalizeEllipses('Searching.... found it.'), 'Searching... found it.');
// 5 dots -> snap to 6 dots (extended pause)
assert.strictEqual(normalizeEllipses('Stopping daemon..... restarting.'), 'Stopping daemon...... restarting.');
// 6 dots -> preserved
assert.strictEqual(normalizeEllipses('Step 1 complete...... Starting step 2.'), 'Step 1 complete...... Starting step 2.');

// Protected streaming boundary regex preserves 3 dots without breaking on first dot
const streamRegex = /^([\s\S]+?(?:\.{3,}|(?<!\.)[.!?](?!\.)))(?:\s+|$)([\s\S]*)$/;
const streamInput = 'Let me inspect that file... Okay, I found the issue.';
const streamMatch = streamInput.match(streamRegex);
assert(streamMatch);
assert.strictEqual(streamMatch[1], 'Let me inspect that file...');
assert.strictEqual(streamMatch[2], 'Okay, I found the issue.');
console.log('  Ellipses snap to groups of 3 and streaming boundary keeps pauses intact: ✅ Passed');

console.log('\nAll core unit tests passed successfully! 🎉');

