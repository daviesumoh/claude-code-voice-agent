export function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^\*]+)\*\*/g, '$1')
    .replace(/\*([^\*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

export function normalizeSlashCommands(text: string): string {
  // Normalize spoken commands like "slash plan" -> "/plan"
  return text
    .replace(/^(?:slash|forward\s+slash)\s+([a-z0-9_-]+)/i, '/$1')
    .replace(/\b(?:slash|forward\s+slash)\s+([a-z0-9_-]+)/gi, '/$1');
}

export function extractVoiceTags(rawText: string): { speechText: string; hasExplicitVoiceTag: boolean } {
  const voiceTagRegex = /<voice(?:\s+[^>]*)?>([\s\S]*?)<\/voice>/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = voiceTagRegex.exec(rawText)) !== null) {
    if (match[1] && match[1].trim()) {
      matches.push(match[1].trim());
    }
  }

  if (matches.length > 0) {
    return { speechText: stripMarkdownFormatting(matches.join(' ')), hasExplicitVoiceTag: true };
  }

  const unclosedMatch = rawText.match(/<voice(?:\s+[^>]*)?>([\s\S]*)$/i);
  if (unclosedMatch && unclosedMatch[1].trim()) {
    return { speechText: stripMarkdownFormatting(unclosedMatch[1].trim()), hasExplicitVoiceTag: true };
  }

  return { speechText: stripMarkdownFormatting(rawText), hasExplicitVoiceTag: false };
}
