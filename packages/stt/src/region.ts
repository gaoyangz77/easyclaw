/**
 * Selects the appropriate STT provider based on the user's configured region.
 *
 * - `"cn"` (mainland China) -> Volcengine (ByteDance)
 * - Everything else -> Groq Whisper
 */
export function selectSttProvider(region: string): "volcengine" | "groq" {
  return region === "cn" ? "volcengine" : "groq";
}
