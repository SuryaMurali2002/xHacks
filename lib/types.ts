/** Parsed transcript from OpenAI (from raw PDF text). */
export type ParsedTranscript = {
  student_major: string
  completed_courses: { code: string }[]
  total_credits_completed: number
}

/** One recommended course with reason (from planner). */
export type RecommendedCourse = {
  course_code: string
  course_name?: string
  reason: string
}

/** Pace: normal = 3 courses/semester, speedrun = more. */
export type Pace = "normal" | "speedrun"

/** One semester in the plan: which courses to take that semester. */
export type SemesterPlanItem = {
  year: number
  term: string
  label: string
  courses: string[]
  fromPrediction?: boolean
}

/** Response from recommend-courses API. */
export type RecommendCoursesResponse = {
  major: string
  target_role: string
  /** Units/credits completed (from transcript). */
  total_credits_completed: number
  /** Units remaining until 120 credits (SFU typical degree). */
  credits_remaining: number
  recommended_courses: RecommendedCourse[]
  /** Semester-by-semester plan (which recommended courses are offered when). */
  semester_plan: SemesterPlanItem[]
}
