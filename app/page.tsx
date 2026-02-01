"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { UploadTranscript } from "./components/UploadTranscript"
import { CourseResults } from "./components/CourseResults"
import { AnimatedPathBackground } from "./components/AnimatedPathBackground"
import type { ParsedTranscript } from "@/lib/types"
import type { RecommendCoursesResponse } from "@/lib/types"

const SUGGESTED_ROLES = [
  "Software Engineer",
  "Data Scientist",
  "Web Developer",
  "Machine Learning Engineer",
  "Product Manager",
]

export default function Home() {
  const [parsedTranscript, setParsedTranscript] = useState<ParsedTranscript | null>(null)
  const [targetRole, setTargetRole] = useState("")
  const [pace, setPace] = useState<"normal" | "speedrun">("normal")
  const [recommendResult, setRecommendResult] = useState<RecommendCoursesResponse | null>(null)
  const [loadingRecommend, setLoadingRecommend] = useState(false)
  const [recommendError, setRecommendError] = useState<string | null>(null)

  function startOver() {
    setParsedTranscript(null)
    setRecommendResult(null)
    setRecommendError(null)
  }

  async function handleGetRecommendations() {
    const role = targetRole.trim()
    if (!parsedTranscript || !role) return
    setRecommendError(null)
    setLoadingRecommend(true)
    try {
      const res = await fetch("/api/recommend-courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedTranscript, targetRole: role, pace }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRecommendError(data.error ?? "Failed to get recommendations")
        return
      }
      setRecommendResult(data)
    } catch {
      setRecommendError("Network error. Please try again.")
    } finally {
      setLoadingRecommend(false)
    }
  }

  return (
    <main className="relative z-0 min-h-screen bg-slate-950 text-slate-100 py-12 px-4">
      <AnimatedPathBackground />

      <motion.div
        className="max-w-3xl mx-auto text-center mb-10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <h1 className="text-3xl md:text-4xl font-bold text-slate-100 mb-2 tracking-tight">
          GoSFU Smart Course Planner
        </h1>
        <p className="text-slate-400 text-sm md:text-base">
          Upload your transcript, pick a target job, and get SFU course recommendations that help you graduate and move toward that role.
        </p>
      </motion.div>

      {!recommendResult ? (
        <motion.div
          className="w-full max-w-2xl mx-auto space-y-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <UploadTranscript onParsed={setParsedTranscript} />

          <motion.div
            className="bg-slate-800/95 border border-slate-700 rounded-xl p-6 space-y-4 shadow-lg shadow-black/20"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <label htmlFor="targetRole" className="block text-sm font-medium text-slate-400">
              Target job role
            </label>
            <p className="text-slate-500 text-sm -mt-1">
              Recommendations will be tailored to this role (only relevant courses are shown).
            </p>
            <input
              id="targetRole"
              type="text"
              value={targetRole}
              onChange={(e) => {
                setTargetRole(e.target.value)
                setRecommendError(null)
              }}
              placeholder="e.g. Data Scientist, Software Engineer"
              className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
              list="suggested-roles"
            />
            <datalist id="suggested-roles">
              {SUGGESTED_ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-400">
                Pace
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="pace"
                    checked={pace === "normal"}
                    onChange={() => setPace("normal")}
                    className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-slate-300 text-sm">Normal (3 courses/semester)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="pace"
                    checked={pace === "speedrun"}
                    onChange={() => setPace("speedrun")}
                    className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-slate-300 text-sm">Speedrun (5 courses/semester)</span>
                </label>
              </div>
            </div>

            {parsedTranscript && (
              <p className="text-slate-400 text-sm">
                Transcript parsed: <span className="text-slate-200 font-medium">{parsedTranscript.student_major}</span>
                {" · "}
                {parsedTranscript.completed_courses?.length ?? 0} courses
              </p>
            )}

            {recommendError && (
              <p className="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2 border border-red-900/30">
                {recommendError}
              </p>
            )}

            <button
              type="button"
              disabled={!parsedTranscript || !targetRole.trim() || loadingRecommend}
              onClick={handleGetRecommendations}
              className="w-full py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium transition-all duration-200 hover:scale-[1.01] hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.99] disabled:hover:scale-100 disabled:hover:shadow-none"
            >
              {loadingRecommend ? "Getting recommendations…" : "Get course recommendations"}
            </button>
          </motion.div>
        </motion.div>
      ) : (
        <CourseResults result={recommendResult} onStartOver={startOver} />
      )}
    </main>
  )
}
