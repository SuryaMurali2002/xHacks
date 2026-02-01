"use client"

import { motion } from "framer-motion"
import type { RecommendCoursesResponse } from "@/lib/types"

type CourseResultsProps = {
  result: RecommendCoursesResponse
  onStartOver?: () => void
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
}

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
}

export function CourseResults({ result, onStartOver }: CourseResultsProps) {
  const { major, target_role, total_credits_completed = 0, credits_remaining = 0, recommended_courses, semester_plan = [] } = result

  return (
    <motion.div
      className="w-full max-w-2xl mx-auto space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold text-slate-100">
          Your course plan
        </h2>
        {onStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="text-sm text-emerald-400 hover:text-emerald-300 border border-slate-600 hover:border-emerald-500/50 px-3 py-1.5 rounded-lg transition-all duration-200 hover:bg-slate-800/50"
          >
            Start over
          </button>
        )}
      </div>

      <motion.div
        className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-2 shadow-lg shadow-black/20"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
      >
        <h3 className="font-medium text-slate-200 text-sm">
          Transcript details
        </h3>
        <ul className="text-slate-300 text-sm space-y-1">
          <li>
            <span className="text-slate-500">Major:</span>{" "}
            <span className="text-slate-100">{major}</span>
          </li>
          <li>
            <span className="text-slate-500">Units completed:</span>{" "}
            <span className="text-slate-100">{total_credits_completed}</span>
          </li>
          <li>
            <span className="text-slate-500">Units left until 120 credits:</span>{" "}
            <span className="text-slate-100">{credits_remaining}</span>
          </li>
          <li>
            <span className="text-slate-500">Target role:</span>{" "}
            <span className="text-slate-100">{target_role}</span>
          </li>
        </ul>
      </motion.div>

      {semester_plan.length > 0 && (
        <motion.div
          className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3 shadow-lg shadow-black/20"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4 }}
        >
          <h3 className="font-medium text-slate-200 text-sm">
            Semester plan (when courses are offered)
          </h3>
          <p className="text-slate-400 text-xs">
            Based on SFU Course Outlines API; future semesters use prediction from past offerings.
          </p>
          <ul className="space-y-2">
            {semester_plan.map((s, i) => (
              <li
                key={`${s.year}-${s.term}-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-200 shrink-0">{s.label}</span>
                {s.fromPrediction ? (
                  <span className="shrink-0 text-xs font-medium text-amber-400">Predicted</span>
                ) : (
                  <span className="shrink-0 text-xs font-medium text-emerald-400">Official</span>
                )}
                {s.courses.length > 0 ? (
                  <span className="text-slate-300">{s.courses.join(", ")}</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {recommended_courses.length === 0 ? (
        <motion.p
          className="text-slate-400 bg-slate-800/50 border border-slate-700 rounded-xl p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          No additional courses to recommend right now. You may have already completed the most relevant ones, or try a different target role.
        </motion.p>
      ) : (
        <motion.ul
          className="space-y-3"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {recommended_courses.map((c, i) => (
            <motion.li
              key={`${c.course_code}-${i}`}
              variants={item}
              className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 shadow-lg shadow-black/10 hover:border-slate-600 hover:shadow-emerald-500/5 transition-all duration-200"
            >
              <div className="font-mono font-medium text-emerald-400/90 text-base">
                {c.course_code}
                {c.course_name ? (
                  <span className="font-sans text-slate-200 font-normal ml-1">
                    — {c.course_name}
                  </span>
                ) : ""}
              </div>
              <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                {c.reason}
              </p>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </motion.div>
  )
}
