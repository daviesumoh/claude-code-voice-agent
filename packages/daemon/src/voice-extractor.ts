export interface ExtractedVoiceResult {
  spokenText: string;
  isVisualOnly: boolean;
}

export function extractVoiceContent(rawText: string): ExtractedVoiceResult {
  if (!rawText || !rawText.trim()) {
    return { spokenText: '', isVisualOnly: true };
  }

  // 1. Look for explicit <voice>...</voice> tags
  const voiceTagMatch = rawText.match(/<voice>([\s\S]*?)<\/voice>/i);
  if (voiceTagMatch && voiceTagMatch[1]) {
    const cleaned = sanitizeForTTS(voiceTagMatch[1]);
    if (cleaned.length > 0) {
      return { spokenText: cleaned, isVisualOnly: false };
    }
  }

  // 2. Fallback Sanitizer: strip code blocks, markdown tables, etc.
  let cleaned = rawText;

  // Remove fenced code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // Remove inline code spans if long, or backticks
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Remove markdown tables
  cleaned = cleaned.replace(/^\s*\|.*?\|\s*$/gm, '');

  // Remove horizontal rules
  cleaned = cleaned.replace(/^\s*[-*_]{3,}\s*$/gm, '');

  // Remove markdown headers
  cleaned = cleaned.replace(/^\s*#{1,6}\s+/gm, '');

  // Remove markdown links [title](url) -> title
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove raw URLs
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');

  // Remove file paths like /foo/bar/baz.ts or src/components/Button.tsx
  cleaned = cleaned.replace(/(?:\/[\w.-]+)+\.[\w]+/g, '');
  cleaned = cleaned.replace(/(?:\b\w+\/)+\w+\.[\w]+/g, '');

  // Remove HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // Remove bullet points / numbered lists prefixes
  cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, '');
  cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, '');

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If the remaining text is minimal or looks like code/diff output, treat as visual only
  if (cleaned.length < 5 || /^[0-9+\-=/*&|^~!@#$%(){}[\]:;,<>.?]+$/.test(cleaned)) {
    return { spokenText: '', isVisualOnly: true };
  }

  // Limit spoken fallback to first 2-3 sentences to avoid runaway reading
  const sentences = cleaned.match(/[\s\S]+?(?:\.{3,}|(?<!\.)[.!?](?!\.))(?:\s+|$)/g);
  if (sentences && sentences.length > 3) {
    cleaned = sentences.slice(0, 3).join('').trim();
  }

  const finalSpoken = sanitizeForTTS(cleaned);
  return {
    spokenText: finalSpoken,
    isVisualOnly: finalSpoken.length === 0,
  };
}

/**
 * Normalizes ellipses into strict groups of three dots for Deepgram natural pauses.
 * Deepgram TTS strictly recognizes 3 dots (...), 6 dots (......), or 9 dots (.........)
 * as pauses, breaths, or elongations, ignoring 2, 4, 5, etc.
 * Also converts unicode ellipsis characters (… / U+2026) to three ASCII dots (...).
 */
export function normalizeEllipses(text: string): string {
  if (!text) return '';
  // 1. Convert unicode ellipsis character … to 3 dots
  let normalized = text.replace(/[\u2026\u22EF]/g, '...');

  // 2. Snap any sequence of 2 or more dots to exact multiples of 3 (min 3 dots)
  normalized = normalized.replace(/\.{2,}/g, (match) => {
    const len = match.length;
    const count = Math.max(3, Math.round(len / 3) * 3);
    return '.'.repeat(count);
  });

  return normalized;
}

export function sanitizeForTTS(text: string): string {
  let cleaned = text;

  // Normalize ellipses for Deepgram natural pauses
  cleaned = normalizeEllipses(cleaned);

  // Remove XML/HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // Replace common technical abbreviations so TTS pronounces cleanly
  cleaned = cleaned.replace(/\bJWT\b/g, 'J W T');
  cleaned = cleaned.replace(/\bUUID\b/g, 'U U I D');
  cleaned = cleaned.replace(/\bPR\b/g, 'P R');
  cleaned = cleaned.replace(/\bPRs\b/g, 'P Rs');
  cleaned = cleaned.replace(/\bCLI\b/g, 'C L I');
  cleaned = cleaned.replace(/\bAPI\b/g, 'A P I');
  cleaned = cleaned.replace(/\bSDK\b/g, 'S D K');
  cleaned = cleaned.replace(/\bSQL\b/g, 'sequel');
  cleaned = cleaned.replace(/\bNoSQL\b/g, 'no sequel');
  cleaned = cleaned.replace(/\bCI\/CD\b/gi, 'C I C D');

  // Replace file extension mentions: .ts -> dot T S, .js -> dot J S
  cleaned = cleaned.replace(/\.ts\b/gi, ' dot T S');
  cleaned = cleaned.replace(/\.js\b/gi, ' dot J S');
  cleaned = cleaned.replace(/\.json\b/gi, ' dot J S O N');
  cleaned = cleaned.replace(/\.py\b/gi, ' dot pie');

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

export function normalizeSpokenSlashCommands(text: string): string {
  if (!text || !text.trim()) return '';

  let normalized = text.trim();

  // Match phrases like "slash plan", "forward slash plan", "run slash plan" at the beginning
  const slashPatterns: Array<[RegExp, string]> = [
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+plan\b/i, '/plan'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+compact\b/i, '/compact'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+cost\b/i, '/cost'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+clear\b/i, '/clear'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+review\b/i, '/review'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+bug\b/i, '/bug'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+commit\b/i, '/commit'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+pr\b/i, '/pr'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+help\b/i, '/help'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+resume\b/i, '/resume'],
    [/^(?:please\s+)?(?:run\s+)?(?:forward\s+)?slash\s+(\w+)\b/i, '/$1'],
  ];

  for (const [pattern, replacement] of slashPatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement);
      break;
    }
  }

  return normalized;
}


// Technical acronym pronunciation dictionary for high-fidelity TTS
