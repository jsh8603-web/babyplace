/**
 * Gemini client — Google AI Studio Tier 1
 *
 * Two models by task difficulty:
 *   Flash-Lite (classification): 200 RPM, 1500 RPD
 *   Flash (extraction/NER):      150 RPM, 1500 RPD
 *
 * Env: GEMINI_API_KEY
 */

import { GoogleGenAI } from '@google/genai'

const CLASSIFY_MODEL = 'gemini-2.5-flash-lite'
const EXTRACT_MODEL = 'gemini-2.5-flash'

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('[gemini] GEMINI_API_KEY not set')
    client = new GoogleGenAI({ apiKey })
  }
  return client
}

/**
 * Flash-Lite: binary classification (event relevance, noise filter).
 * Retries up to 3 times with exponential backoff on transient errors.
 */
export async function classifyWithGemini(prompt: string): Promise<string> {
  return callGemini(CLASSIFY_MODEL, prompt, 2048)
}

/**
 * Flash: complex extraction tasks (Korean NER, place name extraction).
 * Higher output budget for structured JSON responses.
 */
export async function extractWithGemini(prompt: string): Promise<string> {
  return callGemini(EXTRACT_MODEL, prompt, 4096)
}

async function callGemini(model: string, prompt: string, maxOutputTokens: number): Promise<string> {
  const ai = getClient()
  const maxRetries = 3

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          maxOutputTokens,
          temperature: 0,
        },
      })

      return response.text ?? ''
    } catch (err: unknown) {
      const isRetryable =
        err instanceof Error &&
        (err.message.includes('429') ||
          err.message.includes('503') ||
          err.message.includes('500'))

      if (isRetryable && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 2000
        console.warn(`[gemini] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }

  return '' // unreachable
}
