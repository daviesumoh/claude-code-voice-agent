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
    return { speechText: matches.join(' '), hasExplicitVoiceTag: true };
  }
  return { speechText: rawText, hasExplicitVoiceTag: false };
}
