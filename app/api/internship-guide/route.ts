import { NextResponse } from "next/server"
import { promptOpenAI } from "@/lib/openai"
import { getRelevantReviews } from "@/lib/interndb"

const MAX_REVIEWS_FOR_PROMPT = 15

function formatReviewForPrompt(r: {
  CompanyName?: string
  PositionTitle: string
  IsOffer: string
  Location: string
  WorkOption: string
  Role: string
  Salary?: number
  Currency?: string
  InterviewProcess?: string
  InterviewInformation?: string
  Comments?: string
}): string {
  const parts: string[] = [
    `[${r.CompanyName || "?"}] ${r.PositionTitle} (${r.Role})`,
    `Offer: ${r.IsOffer} | ${r.Location} | ${r.WorkOption}`,
  ]
  if (r.Salary && r.Currency) parts.push(`Compensation: ${r.Salary} ${r.Currency}/hr`)
  if (r.InterviewProcess) parts.push(`Interview: ${r.InterviewProcess}`)
  if (r.InterviewInformation) parts.push(`Details: ${r.InterviewInformation}`)
  if (r.Comments) parts.push(`Comments: ${r.Comments}`)
  return parts.join("\n")
}

export async function POST(req: Request) {
  try {
    const hasKey =
      process.env.OPENAI_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()
    if (!hasKey) {
      return NextResponse.json(
        {
          error:
            "No API key set. Add OPENAI_API_KEY or OPENROUTER_API_KEY to your environment.",
        },
        { status: 503 }
      )
    }

    const body = await req.json()
    const targetRole = (body.targetRole as string)?.trim()
    const companyName = (body.companyName as string)?.trim() || undefined

    if (!targetRole) {
      return NextResponse.json(
        { error: "Missing targetRole." },
        { status: 400 }
      )
    }

    const reviews = getRelevantReviews(targetRole, companyName)

    if (reviews.length === 0) {
      return NextResponse.json({
        guide: null,
        reviewCount: 0,
        message: "No internship reviews found for this role. Run `npm run fetch-internships` to populate data, or try a different role.",
      })
    }

    const selected = reviews.slice(0, MAX_REVIEWS_FOR_PROMPT)
    const reviewsText = selected.map(formatReviewForPrompt).join("\n\n---\n\n")

    const systemPrompt = `You are an internship advisor. Given real internship reviews from InternDB, synthesize a short "Internship Procurement Supplement" with actionable advice. Be concise and practical.`
    const userPrompt = `Target role: ${targetRole}${companyName ? ` at ${companyName}` : ""}

Here are ${selected.length} internship reviews from InternDB:

${reviewsText}

Synthesize an "Internship Procurement Supplement" (3–5 short bullet points) covering:
1. Common interview formats and what to expect
2. Skills/experiences that helped interns succeed
3. Compensation insights (if mentioned)
4. Work-life balance and culture (if mentioned)
5. Practical tips from past interns

Keep it concise. Use plain text, no markdown headers.`

    const guide = await promptOpenAI(userPrompt, { system: systemPrompt })

    return NextResponse.json({
      guide: guide.trim(),
      reviewCount: reviews.length,
    })
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json(
        { error: process.env.NODE_ENV === "development" ? err.message : "Failed to generate guide" },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { error: "Failed to generate guide" },
      { status: 500 }
    )
  }
}
