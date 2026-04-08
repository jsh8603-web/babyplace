/**
 * Gemini client — 8-step fallback chain (2 accounts × 4 models)
 *
 * Fallback order (429 triggers next step):
 *   wife 3.1-flash-lite (500 RPD) → own 3.1-flash-lite (500 RPD)
 *   → wife 2.5-flash (20) → own 2.5-flash (20)
 *   → wife 3-flash (20) → own 3-flash (20)
 *   → wife 2.5-flash-lite (20) → own 2.5-flash-lite (20)
 *
 * Babyplace uses wife key first (highest volume project).
 * Env: GEMINI_API_KEY (wife free), GEMINI_FALLBACK_KEY (own free)
 */

import { GoogleGenAI } from '@google/genai'

const MODELS = [
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
] as const

interface KeyEntry {
  key: string
  label: string
}

function getKeys(): KeyEntry[] {
  const keys: KeyEntry[] = []
  const primary = process.env.GEMINI_API_KEY
  const fallback = process.env.GEMINI_FALLBACK_KEY
  if (primary) keys.push({ key: primary, label: 'wife' })
  if (fallback) keys.push({ key: fallback, label: 'own' })
  if (keys.length === 0) throw new Error('[gemini] No API keys set')
  return keys
}

/** Build the full fallback chain: keys × models */
function buildChain(): { model: string; client: GoogleGenAI; label: string }[] {
  const keys = getKeys()
  const chain: { model: string; client: GoogleGenAI; label: string }[] = []
  for (const m of MODELS) {
    for (const k of keys) {
      chain.push({ model: m, client: new GoogleGenAI({ apiKey: k.key }), label: `${k.label}/${m}` })
    }
  }
  return chain
}

let _chain: ReturnType<typeof buildChain> | null = null
function getChain() {
  if (!_chain) _chain = buildChain()
  return _chain
}

/**
 * Classification: binary tasks (event relevance, noise filter).
 */
export async function classifyWithGemini(prompt: string): Promise<string> {
  return callGeminiWithFallback(prompt, 2048)
}

/**
 * Extraction: complex tasks (Korean NER, place name extraction).
 */
export async function extractWithGemini(prompt: string): Promise<string> {
  return callGeminiWithFallback(prompt, 8192, 'application/json')
}

async function callGeminiWithFallback(
  prompt: string,
  maxOutputTokens: number,
  responseMimeType?: string
): Promise<string> {
  const chain = getChain()
  let lastError: Error | null = null

  for (const step of chain) {
    try {
      const response = await step.client.models.generateContent({
        model: step.model,
        contents: prompt,
        config: {
          maxOutputTokens,
          temperature: 0,
          ...(responseMimeType ? { responseMimeType } : {}),
        },
      })
      return response.text ?? ''
    } catch (err: unknown) {
      const is429 = err instanceof Error && err.message.includes('429')
      if (is429) {
        console.warn(`[gemini] 429 on ${step.label} → next`)
        continue
      }
      // Retry transient errors (503/500) up to 2 times on same step
      const isTransient =
        err instanceof Error &&
        (err.message.includes('503') || err.message.includes('500'))
      if (isTransient) {
        let retried = false
        for (let r = 0; r < 2; r++) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, r) * 2000))
          try {
            const response = await step.client.models.generateContent({
              model: step.model,
              contents: prompt,
              config: {
                maxOutputTokens,
                temperature: 0,
                ...(responseMimeType ? { responseMimeType } : {}),
              },
            })
            return response.text ?? ''
          } catch (retryErr: unknown) {
            const still429 = retryErr instanceof Error && retryErr.message.includes('429')
            if (still429) { retried = true; break }
          }
        }
        if (retried) {
          console.warn(`[gemini] 429 on ${step.label} after retry → next`)
          continue
        }
      }
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`[gemini] Error on ${step.label}: ${lastError.message} → next`)
    }
  }

  throw lastError ?? new Error('[gemini] All fallback steps exhausted')
}
