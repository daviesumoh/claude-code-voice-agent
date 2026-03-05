// Procedural Earcon Synthesizer: Sine wave chimes generated in real-time
export class EarconSynthesizer {
  generateTone(frequency: number, durationMs: number, sampleRate = 24000): Buffer {
    const totalSamples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(totalSamples * 2); // 16-bit PCM

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const envelope = Math.sin((Math.PI * i) / totalSamples); // Smooth sine window
      const sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.3;
      const intSample = Math.floor(sample * 32767);
      buffer.writeInt16LE(intSample, i * 2);
    }
    return buffer;
  }
}
