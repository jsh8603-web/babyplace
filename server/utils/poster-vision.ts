/**
 * #5: Gemini Vision poster verification
 *
 * Uses Gemini Flash Vision to verify poster images:
 * - OCR check: event name appears in image
 * - Date cross-check: dates in image match event dates
 * - Safety check: no horror/adult content
 *
 * Cost: ~$0.002/image (Gemini Flash Vision)
 */

import { GoogleGenAI } from '@google/genai'

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('[poster-vision] GEMINI_API_KEY not set')
    client = new GoogleGenAI({ apiKey })
  }
  return client
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

/**
 * Verify a poster image using Gemini Vision.
 *
 * @param imageUrl URL of the poster image
 * @param eventName Expected event name
 * @param eventDates Expected date range (e.g., "2026-03-01 ~ 2026-03-31")
 */
export async function verifyPosterImage(
  imageUrl: string,
  eventName: string,
  eventDates?: string,
): Promise<PosterVisionResult | null> {
  const ai = getClient()

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
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: '' } },
            { fileData: { mimeType: 'image/jpeg', fileUri: imageUrl } },
          ],
        },
      ],
      config: {
        maxOutputTokens: 1024,
        temperature: 0,
        responseMimeType: 'application/json',
      },
    })

    const text = response.text ?? ''
    try {
      const parsed = JSON.parse(text)
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
      console.error('[poster-vision] Failed to parse response:', text.slice(0, 200))
      return null
    }
  } catch (err: any) {
    // Gemini Vision may not support direct URL — fall back to URL-based fetch
    console.error(`[poster-vision] Vision API error: ${err.message}`)

    // Try with image URL as text context instead
    try {
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${prompt}\n\n이미지 URL: ${imageUrl}\n\n(URL만으로 판단할 수 없으면 confidence=0으로 답하세요)`,
        config: {
          maxOutputTokens: 1024,
          temperature: 0,
          responseMimeType: 'application/json',
        },
      })

      const text = fallbackResponse.text ?? ''
      try {
        const parsed = JSON.parse(text)
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
        return null
      }
    } catch {
      return null
    }
  }
}
