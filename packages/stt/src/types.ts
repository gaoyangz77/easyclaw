export interface SttConfig {
  provider: "volcengine" | "groq";
  /** Volcengine-specific credentials */
  volcengine?: {
    appKey: string;
    accessKey: string;
  };
  /** Groq-specific credentials */
  groq?: {
    apiKey: string;
  };
}

export interface SttResult {
  text: string;
  provider: "volcengine" | "groq";
  durationMs?: number;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: Buffer, format: string): Promise<SttResult>;
}
