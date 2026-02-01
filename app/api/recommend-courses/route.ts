import { NextResponse } from "next/server"
import { promptOpenAI, parseOpenAIJson } from "@/lib/openai"
import {
  fetchOutlinesForRoadmap,
  slimOutlinesForPrompt,
  type CourseOutline,
  type SlimCourse,
} from "@/lib/sfuCourses"
import {
  getCurrentSemester,
  getOfferingsForSemesterWithPrediction,
  listSemesters,
  readCache,
  type OfferingsCache,
} from "@/lib/sfuOfferings"
import type {
  ParsedTranscript,
  RecommendedCourse,
  RecommendCoursesResponse,
  SemesterPlanItem,
} from "@/lib/types"

const MAX_DEPTS = 5
const MAX_CANDIDATE_COURSES = 80
const MAX_COURSES_FOR_RANKING = 30
const RANK_DESC_MAX_LEN = 60
const TOP_N = 10
const COURSES_PER_SEMESTER_NORMAL = 3
const COURSES_PER_SEMESTER_SPEEDRUN = 5
const MAX_SEMESTERS_PLAN = 12

/** Common roles → SFU department codes. Saves one OpenAI call when role matches. */
const ROLE_TO_DEPTS: Record<string, string[]> = {
  "software engineer": ["CMPT", "MATH", "MACM", "ENSC"],
  "data scientist": ["CMPT", "STAT", "MATH", "MACM"],
  "web developer": ["CMPT", "MATH"],
  "machine learning engineer": ["CMPT", "MATH", "STAT", "MACM"],
  "product manager": ["CMPT", "BUS", "ECON"],
  "data analyst": ["STAT", "MATH", "CMPT", "ECON"],
  "backend developer": ["CMPT", "MATH", "MACM"],
  "frontend developer": ["CMPT", "MATH"],
}

/** Normalize "CMPT 120" / "CMPT120" → "CMPT 120" for comparison. */
function normalizeCode(code: string): string {
  const s = String(code || "").replace(/\s+/g, " ").trim().toUpperCase()
  const parts = s.match(/^([A-Z]+)\s*(\d.*)$/)
  if (parts) return `${parts[1]} ${parts[2]}`
  return s
}

/**
 * SFU BSc CS "pick one" groups and mutually exclusive courses.
 * If the student has completed ANY course in a group, treat ALL in that group as taken
 * so we don't recommend the alternatives (e.g. don't suggest MATH 151 if they have MATH 150).
 */
const EQUIVALENCE_GROUPS: string[][] = [
  ["MATH 150", "MATH 151", "MATH 154", "MATH 157"], // Calculus I — pick one
  ["MATH 152", "MATH 155", "MATH 158"], // Calculus II — pick one
  ["MATH 232", "MATH 240"], // Linear algebra — pick one
  ["STAT 270", "STAT 271"], // Mutually exclusive
]

function completedSet(parsed: ParsedTranscript): Set<string> {
  const set = new Set<string>()
  for (const c of parsed.completed_courses || []) {
    const code = c?.code
    if (code) set.add(normalizeCode(code))
  }
  return set
}

/** Expand taken set: if user completed any course in an equivalence group, add all in that group so we don't recommend alternatives. */
function expandedTaken(completed: Set<string>): Set<string> {
  const out = new Set<string>(completed)
  for (const group of EQUIVALENCE_GROUPS) {
    const normalizedGroup = group.map((c) => normalizeCode(c))
    const hasAny = normalizedGroup.some((c) => completed.has(c))
    if (hasAny) normalizedGroup.forEach((c) => out.add(c))
  }
  return out
}

/** Build semester-by-semester plan: which recommended courses are offered when (REST API + prediction fallback). */
async function buildSemesterPlan(
  recommendedCodes: string[],
  coursesPerSemester: number,
  normalizeCodeFn: (code: string) => string
): Promise<SemesterPlanItem[]> {
  const plan: SemesterPlanItem[] = []
  let remaining = new Set(recommendedCodes.map((c) => normalizeCodeFn(c)))
  const codeToOriginal = new Map<string, string>()
  for (const c of recommendedCodes) {
    codeToOriginal.set(normalizeCodeFn(c), c)
  }
  let cache: OfferingsCache | null = readCache()
  const { year: startYear, term: startTerm } = getCurrentSemester()
  const semesters = listSemesters(startYear, startTerm, MAX_SEMESTERS_PLAN)
  for (const { year, term, label } of semesters) {
    if (remaining.size === 0) break
    const { offerings, cache: nextCache, fromPrediction } =
      await getOfferingsForSemesterWithPrediction(year, term, cache)
    cache = nextCache
    const offeredSet = new Set(offerings.map((o) => normalizeCodeFn(o)))
    const offeredFromList = Array.from(remaining).filter((code) => offeredSet.has(code))
    const take = offeredFromList.slice(0, coursesPerSemester)
    take.forEach((code) => remaining.delete(code))
    if (take.length > 0) {
      plan.push({
        year,
        term,
        label,
        courses: take.map((code) => codeToOriginal.get(code) ?? code),
        fromPrediction: fromPrediction || undefined,
      })
    }
  }
  return plan
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not set. Add it to .env.local and restart the dev server." },
        { status: 503 }
      )
    }
    const body = await req.json()
    const parsedTranscript = body.parsedTranscript as ParsedTranscript | undefined
    const targetRole = (body.targetRole as string)?.trim()
    const pace = (body.pace as "normal" | "speedrun" | undefined) ?? "normal"

    if (!parsedTranscript?.student_major || !targetRole) {
      return NextResponse.json(
        { error: "Missing parsedTranscript or targetRole." },
        { status: 400 }
      )
    }

    const roleKey = targetRole.toLowerCase().trim()
    let departmentCodes: string[] = ROLE_TO_DEPTS[roleKey] ?? null
    if (!departmentCodes?.length) {
      const deptPrompt = `Job role: "${targetRole}". Return relevant SFU department codes as a JSON array. Example: ["CMPT","MATH","STAT"]`
      const deptResponse = await promptOpenAI(deptPrompt)
      try {
        const parsed = parseOpenAIJson<unknown>(deptResponse)
        departmentCodes = Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === "string").map((s) => String(s).trim().toUpperCase())
          : []
      } catch {
        departmentCodes = []
      }
    }
    if (departmentCodes.length === 0) departmentCodes = ["CMPT", "MATH"]

    const allOutlines = await fetchOutlinesForRoadmap(
      departmentCodes,
      MAX_CANDIDATE_COURSES,
      MAX_DEPTS
    )
    const completed = completedSet(parsedTranscript)
    const taken = expandedTaken(completed)
    const remaining: CourseOutline[] = allOutlines.filter((o) => {
      const code = `${o.dept} ${o.number}`.trim()
      return !taken.has(normalizeCode(code))
    })

    const totalCredits = typeof parsedTranscript.total_credits_completed === "number" ? parsedTranscript.total_credits_completed : 0
    const creditsRemaining = Math.max(0, 120 - totalCredits)

    if (remaining.length === 0) {
      const response: RecommendCoursesResponse = {
        major: parsedTranscript.student_major,
        target_role: targetRole,
        total_credits_completed: totalCredits,
        credits_remaining: creditsRemaining,
        recommended_courses: [],
        semester_plan: [],
      }
      return NextResponse.json(response)
    }

    const slim: SlimCourse[] = slimOutlinesForPrompt(remaining.slice(0, MAX_COURSES_FOR_RANKING), RANK_DESC_MAX_LEN)
    const courseListText = slim
      .map((s) => `${s.dept} ${s.number}: ${s.title}${s.description ? ` - ${s.description}` : ""}`)
      .join("\n")

    const rankPrompt = `Major: ${parsedTranscript.student_major}. Target role: ${targetRole}.

Courses (student has NOT taken these):
${courseListText}

Rank the TOP ${TOP_N} most useful for this role. Return JSON: {"courses":[{"course_code":"CMPT 225","reason":"one short sentence"}]}`

    const rankResponse = await promptOpenAI(rankPrompt, { json: true })
    let ranked: { course_code?: string; reason?: string }[] = []
    try {
      const parsed = parseOpenAIJson<{ courses?: unknown[] }>(rankResponse)
      const arr = Array.isArray(parsed?.courses) ? parsed.courses : Array.isArray(parsed) ? parsed : []
      ranked = arr.filter((x): x is { course_code?: string; reason?: string } => x != null && typeof x === "object" && "course_code" in x)
    } catch {
      ranked = []
    }

    const codeToOutline = new Map<string, CourseOutline>()
    for (const o of remaining) {
      const code = `${o.dept} ${o.number}`.trim()
      codeToOutline.set(normalizeCode(code), o)
    }

    const recommended_courses: RecommendedCourse[] = []
    const seen = new Set<string>()
    for (const r of ranked.slice(0, TOP_N)) {
      const code = (r.course_code || "").trim()
      if (!code || seen.has(normalizeCode(code))) continue
      seen.add(normalizeCode(code))
      const outline = codeToOutline.get(normalizeCode(code))
      recommended_courses.push({
        course_code: code,
        course_name: outline?.title,
        reason: typeof r.reason === "string" ? r.reason : "Relevant for your target role.",
      })
    }

    const coursesPerSemester =
      pace === "speedrun" ? COURSES_PER_SEMESTER_SPEEDRUN : COURSES_PER_SEMESTER_NORMAL
    const semester_plan = await buildSemesterPlan(
      recommended_courses.map((c) => c.course_code),
      coursesPerSemester,
      normalizeCode
    )

    const response: RecommendCoursesResponse = {
      major: parsedTranscript.student_major,
      target_role: targetRole,
      total_credits_completed: totalCredits,
      credits_remaining: creditsRemaining,
      recommended_courses,
      semester_plan,
    }
    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json(
        { error: process.env.NODE_ENV === "development" ? err.message : "Failed to recommend courses" },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { error: "Failed to recommend courses" },
      { status: 500 }
    )
  }
}
