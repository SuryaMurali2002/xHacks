import { NextResponse } from "next/server"
import { extractTextFromPdf } from "@/lib/pdf"
import {
  extractCompletedCoursesFromTranscript,
  extractMajorFromTranscript,
  extractTotalCreditsFromTranscript,
} from "@/lib/transcriptParser"
import { promptOpenAI, parseOpenAIJson } from "@/lib/openai"
import type { ParsedTranscript } from "@/lib/types"

const FALLBACK_HEADER_CHARS = 2500
/** When local extraction finds fewer than this many courses, use OpenAI to extract courses from transcript. */
const MIN_COURSES_FOR_LOCAL_ONLY = 5
const MAX_TRANSCRIPT_CHARS_FOR_LLM = 14000

/** Fallback: use OpenAI only for major and total_credits (small payload). */
const MAJOR_CREDITS_SYSTEM = `From this SFU transcript snippet, return JSON with:
- student_major (string, e.g. "Computing Science")
- total_credits_completed (number from Total Units or Passed)

Return ONLY valid JSON. Example: {"student_major":"Computing Science","total_credits_completed":92}`

/** Fallback: extract completed SFU courses when regex fails (e.g. pdf-parse spacing). */
const EXTRACT_COURSES_SYSTEM = `You are extracting completed SFU courses from an advising transcript.

Rules:
- Include only courses that have a final letter grade (A+, A, A-, B+, B, B-, C+, C, C-, D, F) or CR, or transfer credit (TR-C/TR-T).
- Exclude transfer courses that are high-school style (e.g. CHEM X12, MATH X12, FAN X99, FAL X99).
- Exclude in-progress courses (grade points 0.00 or no grade).
- Return course codes exactly as "DEPT NNN" or "DEPT NNNW" (e.g. CMPT 225, CMPT 105W, STAT 270).

Return JSON only, in this exact shape:
{"completed_courses":[{"code":"CMPT 120"},{"code":"CMPT 125"},{"code":"MATH 150"}]}

No other keys. No explanation.`

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") ?? formData.get("transcript")
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file. Send a PDF as 'file' or 'transcript'." },
        { status: 400 }
      )
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "File must be a PDF." },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const rawText = await extractTextFromPdf(buffer)
    if (!rawText || rawText.length < 50) {
      return NextResponse.json(
        { error: "Could not extract enough text from the PDF. Ensure it is a valid transcript." },
        { status: 400 }
      )
    }

    if (process.env.NODE_ENV === "development" || process.env.DEBUG_TRANSCRIPT === "true") {
      console.log("[parse-transcript] PDF extracted text length:", rawText.length)
      console.log("[parse-transcript] Raw text sample (first 500 chars):", rawText.slice(0, 500))
    }

    // 1) Local extraction from FULL transcript (no cap) — captures all completed courses
    let completed_courses = extractCompletedCoursesFromTranscript(rawText)

    // 2) If regex found too few courses (pdf-parse spacing/format varies), use OpenAI to extract courses
    const hasLlmKey =
      process.env.OPENAI_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()
    if (
      completed_courses.length < MIN_COURSES_FOR_LOCAL_ONLY &&
      hasLlmKey
    ) {
      const transcriptForLlm = rawText.slice(0, MAX_TRANSCRIPT_CHARS_FOR_LLM)
      try {
        const responseText = await promptOpenAI(`Transcript:\n${transcriptForLlm}`, {
          system: EXTRACT_COURSES_SYSTEM,
          json: true,
        })
        const parsed = parseOpenAIJson<{ completed_courses: { code: string }[] }>(responseText)
        if (Array.isArray(parsed.completed_courses) && parsed.completed_courses.length > 0) {
          completed_courses = parsed.completed_courses.map((c) =>
            typeof c?.code === "string" ? { code: c.code.trim() } : { code: "" }
          ).filter((c) => c.code.length > 0)
          if (process.env.NODE_ENV === "development" || process.env.DEBUG_TRANSCRIPT === "true") {
            console.log("[parse-transcript] OpenAI fallback extracted completed_courses count:", completed_courses.length)
          }
        }
      } catch (e) {
        if (process.env.NODE_ENV === "development" || process.env.DEBUG_TRANSCRIPT === "true") {
          console.warn("[parse-transcript] OpenAI course extraction fallback failed:", e)
        }
      }
    }

    if (process.env.NODE_ENV === "development" || process.env.DEBUG_TRANSCRIPT === "true") {
      console.log("[parse-transcript] extracted completed_courses count:", completed_courses.length)
      console.log("[parse-transcript] completed_courses:", completed_courses.map((c) => c.code))
    }
    let student_major = extractMajorFromTranscript(rawText)
    let total_credits_completed = extractTotalCreditsFromTranscript(rawText)

    // 3) Fallback to OpenAI only for major/credits if regex missed them
    if (!student_major || total_credits_completed == null) {
      if (hasLlmKey) {
        const snippet = rawText.slice(0, FALLBACK_HEADER_CHARS)
        const responseText = await promptOpenAI(`Transcript:\n${snippet}`, {
          system: MAJOR_CREDITS_SYSTEM,
        })
        try {
          const parsed = parseOpenAIJson<Partial<ParsedTranscript>>(responseText)
          if (parsed.student_major) student_major = parsed.student_major
          if (typeof parsed.total_credits_completed === "number") total_credits_completed = parsed.total_credits_completed
        } catch {
          // keep regex results or defaults
        }
      }
      if (!student_major) student_major = "Unknown"
      if (total_credits_completed == null) total_credits_completed = 0
    }

    return NextResponse.json({
      student_major,
      completed_courses,
      total_credits_completed,
    })
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json(
        { error: process.env.NODE_ENV === "development" ? err.message : "Failed to parse transcript" },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { error: "Failed to parse transcript" },
      { status: 500 }
    )
  }
}
