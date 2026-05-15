/**
 * Local Qwen 1-shot delegation wrapper.
 *
 * Bridges to ~/.claude/scripts/qwen-task.sh (non-agentic: prompt in → text out).
 * Signature mirrors extractWithGemini() so it is a drop-in for batch pattern/keyword
 * generation. Throws on non-zero exit or empty output — the caller decides whether
 * to fall back (e.g. to Gemini) or abort.
 */
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const QWEN_SCRIPT = path.join(os.homedir(), '.claude', 'scripts', 'qwen-task.sh')

export function isQwenAvailable(): boolean {
  return fs.existsSync(QWEN_SCRIPT)
}

export async function callQwen(prompt: string, timeoutSec = 180): Promise<string> {
  if (!isQwenAvailable()) {
    throw new Error(`qwen-task.sh not found at ${QWEN_SCRIPT}`)
  }
  const tmp = path.join(os.tmpdir(), `qwen-prompt-${Date.now()}-${process.pid}.txt`)
  fs.writeFileSync(tmp, prompt, 'utf-8')
  try {
    const out = execSync(
      `bash "${QWEN_SCRIPT}" code "${tmp}" ${timeoutSec}`,
      { encoding: 'utf-8', timeout: (timeoutSec + 30) * 1000, maxBuffer: 10 * 1024 * 1024 },
    )
    const trimmed = (out || '').trim()
    if (!trimmed) throw new Error('Qwen returned empty output')
    return trimmed
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}
