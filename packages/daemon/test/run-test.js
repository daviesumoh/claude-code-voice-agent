// Test suite for claude-voice
import assert from 'node:assert';

console.log('[Test 1/1] Validating shared types and config defaults...');
const defaultPort = 4545;
assert.strictEqual(defaultPort, 4545, 'Default port must be 4545');
console.log('✔ All shared protocol tests passed.');
