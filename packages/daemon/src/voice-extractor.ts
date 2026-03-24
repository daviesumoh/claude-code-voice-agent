export function stripMarkdownFormatting(text: string): string {
  return text
    // Strip fenced code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Strip inline code backticks
    .replace(/`([^`]+)`/g, '$1')
    // Strip bold/italics
    .replace(/\*\*([^\*]+)\*\*/g, '$1')
    .replace(/\*([^\*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Strip links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    // Strip markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
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
  return { speechText: stripMarkdownFormatting(rawText), hasExplicitVoiceTag: false };
}
