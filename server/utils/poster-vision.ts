/**
 * #5: Gemini Vision poster verification
 *
 * Uses Gemini Flash Vision to verify poster images:
 * - OCR check: event name appears in image
 * - Date cross-check: dates in image match event dates
 * - Safety check: no horror/adult content
 *
 * Fallback chain: wife key → own key (both using gemini-2.5-flash vision)
 */

import { GoogleGenAI } from '@google/genai'

const VISION_MODEL = 'gemini-2.5-flash'

interface VisionKeyEntry {
  client: GoogleGenAI
  label: string
}

let _visionClients: VisionKeyEntry[] | null = null

function getVisionClients(): VisionKeyEntry[] {
  if (_visionClients) return _visionClients
  const entries: VisionKeyEntry[] = []
  const primary = process.env.GEMINI_API_KEY
  const fallback = process.env.GEMINI_FALLBACK_KEY
  if (primary) entries.push({ client: new GoogleGenAI({ apiKey: primary }), label: 'wife' })
  if (fallback) entries.push({ client: new GoogleGenAI({ apiKey: fallback }), label: 'own' })
  if (entries.length === 0) throw new Error('[poster-vision] No GEMINI API keys set')
  _visionClients = entries
  return entries
}

export interface PosterVisionResult {
  eventNameFound: boolean
  dateMatch: 'match' | 'mismatch' | 'no_date'
  safetyIssue: boolean
  safetyDetail?: string
  ocrText: string[]
  confidence: number
  rawResponse: string
}

// quota 소진(일일 free-tier 20/day · RPM) = 동일 key backoff 무의미 → 즉시 다른 key 로 전환
const isQuotaExhausted = (m: string) => /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota|PerDay|free_tier_requests|quota.{0,20}exceed/i.test(m)
// 일시 장애(5xx/네트워크) = 동일 key 지수 backoff 재시도 가치 있음
const isRetryable = (m: string) => /\b(500|502|503)\b|UNAVAILABLE|overloaded|high demand|deadline|ETIMEDOUT|ECONNRESET/i.test(m)
// 둘 다 = 다음 key 시도 / 전 key 소진 시 'RETRY'(pending 유지 → 다음 루프)
const isTransient = (m: string) => isQuotaExhausted(m) || isRetryable(m)

/**
 * Verify a poster image using Gemini Vision.
 *
 * @param imageUrl URL of the poster image
 * @param eventName Expected event name
 * @param eventDates Expected date range (e.g., "2026-03-01 ~ 2026-03-31")
 * @returns PosterVisionResult | 'RETRY'(일시 장애 — pending 유지 후 다음 루프 재시도) | null(영구 실패)
 */
export async function verifyPosterImage(
  imageUrl: string,
  eventName: string,
  eventDates?: string,
): Promise<PosterVisionResult | 'RETRY' | null> {
  const prompt = `당신은 아기/어린이 앱의 포스터 검증 시스템입니다.
이 이미지를 분석하여 JSON으로 답하세요:

검증 대상 이벤트: "${eventName}"
${eventDates ? `예상 날짜: ${eventDates}` : ''}

응답 형식:
{
  "event_name_found": true/false,  // 이미지에 이벤트명(또는 핵심 키워드)이 있는가
  "ocr_text": ["이미지에서 읽은 주요 텍스트"],
  "date_in_image": "이미지에 표시된 날짜 (없으면 null)",
  "date_match": "match" | "mismatch" | "no_date",
  "safety_issue": false,  // 공포/성인/폭력 콘텐츠 여부
  "safety_detail": null,  // 안전 문제 시 설명
  "confidence": 0.0~1.0   // 이 이미지가 해당 이벤트의 공식 포스터일 확률
}

판단 기준:
- 이벤트명의 핵심 단어가 이미지에 있으면 event_name_found=true
- 이미지의 날짜가 이벤트 날짜와 다른 연도면 date_match="mismatch"
- 공포/호러/성인/폭력/선정적 이미지면 safety_issue=true
- 공식 포스터(디자인된 홍보물)면 confidence 높게, 현장사진/뉴스사진이면 낮게

JSON만 응답하세요.`

  try {
    // Fetch image and convert to base64 for Gemini Vision
    const imageResponse = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyPlace/1.0)' },
      signal: AbortSignal.timeout(10000),
    })
    if (!imageResponse.ok) {
      console.error(`[poster-vision] Image fetch failed: ${imageResponse.status} ${imageUrl}`)
      return null
    }

    const rawContentType = imageResponse.headers.get('content-type') || ''
    let mimeType = rawContentType.split(';')[0].trim()
    // Fallback: infer MIME type from URL extension or default to jpeg
    if (!mimeType || !mimeType.startsWith('image/')) {
      const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase()
      const extMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
      mimeType = extMap[ext ?? ''] || 'image/jpeg'
    }
    const buffer = Buffer.from(await imageResponse.arrayBuffer())
    const base64 = buffer.toString('base64')

    if (buffer.length < 1000) {
      console.error(`[poster-vision] Image too small (${buffer.length} bytes): ${imageUrl}`)
      return null
    }

    // Try each key in fallback order (wife → own), same model
    const clients = getVisionClients()
    let lastErr: Error | null = null
    // transient → 동일 key 지수 backoff 재시도 후 next key (isTransient = module-level)
    for (const entry of clients) {
      try {
        let response
        for (let attempt = 0; ; attempt++) {
          try {
            response = await entry.client.models.generateContent({
              model: VISION_MODEL,
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: prompt },
                    { inlineData: { mimeType, data: base64 } },
                  ],
                },
              ],
              config: {
                maxOutputTokens: 2048,
                temperature: 0,
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: 0 },
              },
            })
            break
          } catch (e: unknown) {
            const m = e instanceof Error ? e.message : String(e)
            // quota 소진(429/RESOURCE_EXHAUSTED)은 backoff 무의미 → 즉시 throw → outer catch 에서 next key 전환
            if (attempt >= 3 || !isRetryable(m)) throw e
            const wait = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 400)
            console.warn(`[poster-vision] retryable on ${entry.label} (attempt ${attempt + 1}) → ${wait}ms backoff: ${m.slice(0, 80)}`)
            await new Promise(r => setTimeout(r, wait))
          }
        }

        const text = response.text ?? ''
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          const jsonStr = jsonMatch ? jsonMatch[0] : text
          const parsed = JSON.parse(jsonStr)
          return {
            eventNameFound: parsed.event_name_found ?? false,
            dateMatch: parsed.date_match ?? 'no_date',
            safetyIssue: parsed.safety_issue ?? false,
            safetyDetail: parsed.safety_detail ?? undefined,
            ocrText: parsed.ocr_text ?? [],
            confidence: parsed.confidence ?? 0,
            rawResponse: text,
          }
        } catch {
          console.error('[poster-vision] Failed to parse response:', text.slice(0, 300))
          return null
        }
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : String(err)
        if (isTransient(m)) {
          console.warn(`[poster-vision] ${entry.label} exhausted retries → next key: ${m.slice(0, 80)}`)
          lastErr = err instanceof Error ? err : new Error(String(err))
          continue
        }
        throw err
      }
    }
    console.error(`[poster-vision] All keys exhausted (transient) → RETRY (pending 유지): ${lastErr?.message}`)
    return 'RETRY'
  } catch (err: any) {
    const m = err?.message ? String(err.message) : String(err)
    if (isTransient(m)) {
      console.error(`[poster-vision] transient error → RETRY (pending 유지): ${m.slice(0, 100)}`)
      return 'RETRY'
    }
    console.error(`[poster-vision] Vision API error (permanent): ${m}`)
    return null
  }
}
