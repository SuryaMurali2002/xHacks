/**
 * OpenAI API for transcript parsing, department mapping, and course ranking.
 * Set OPENAI_API_KEY (OpenAI) or OPENROUTER_API_KEY (OpenRouter free models) in .env.local.
 */

import OpenAI from "openai"

const useOpenRouter = !!process.env.OPENROUTER_API_KEY?.trim()
const client = new OpenAI({
  apiKey: useOpenRouter ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY,
  ...(useOpenRouter ? { baseURL: "https://openrouter.ai/api/v1" } : {}),
})

const DEFAULT_MODEL =
  process.env.OPENAI_MODEL ??
  (useOpenRouter ? "meta-llama/llama-3.3-70b-instruct:free" : "gpt-4o-mini")

export type ChatOptions = {
  model?: string
  system?: string
  /** When true, request JSON output (fewer output tokens, no prose). */
  json?: boolean
}

/**
 * Send a prompt to OpenAI and return the assistant's text response.
 */
export async function promptOpenAI(
  userContent: string,
  options: ChatOptions = {}
): Promise<string> {
  const { model = DEFAULT_MODEL, system, json } = options
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = system
    ? [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ]
    : [{ role: "user", content: userContent }]

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    ...(json ? { response_format: { type: "json_object" as const } } : {}),
  })

  const text = completion.choices[0]?.message?.content?.trim()
  if (!text) throw new Error("Empty response from OpenAI")
  return text
}

/** Parse LLM response as JSON (strip markdown code blocks if present). */
export function parseOpenAIJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
  return JSON.parse(cleaned) as T
}
