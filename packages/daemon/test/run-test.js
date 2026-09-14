import assert from 'node:assert';
import { extractVoiceTags, normalizeSlashCommands, normalizeEllipses } from '../dist/voice-extractor.js';

console.log('Running automated test suite...');
// Test 1: Voice tag extraction
const tagged = extractVoiceTags('Thinking... <voice>Hello world</voice>');
assert.strictEqual(tagged.speechText, 'Hello world');

// Test 2: Slash command normalization
assert.strictEqual(normalizeSlashCommands('slash plan add test'), '/plan add test');

// Test 3: Ellipses normalization
assert.strictEqual(normalizeEllipses('Wait... hold on...'), 'Wait, hold on,');

console.log('✔ Extractor and normalization tests passed.');
