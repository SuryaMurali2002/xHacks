/**
 * SFU official Course Outlines REST API + JSON file cache.
 * @see https://www.sfu.ca/outlines/help/api.html
 * Base: http://www.sfu.ca/bin/wcm/course-outlines
 * GET ?{year}/{term} → departments; GET ?{year}/{term}/{dept} → course numbers.
 * Cache: data/sfu-offerings-cache.json. Prediction fallback when semester not in API.
 */

import fs from "fs"
import path from "path"
import axios from "axios"

const SFU_OUTLINES_BASE = "http://www.sfu.ca/bin/wcm/course-outlines"
const CACHE_FILENAME = "sfu-offerings-cache.json"
const TERMS = ["spring", "summer", "fall"] as const
type Term = (typeof TERMS)[number]

/** SFU term by month: Spring Jan–Apr, Summer May–Aug, Fall Sep–Dec. */
export function getCurrentSemester(): { year: number; term: string } {
  const d = new Date()
  const year = d.getFullYear()
  const month = d.getMonth() + 1 // 1–12
  const term = month <= 4 ? "spring" : month <= 8 ? "summer" : "fall"
  return { year, term }
}

export type OfferingsCache = {
  lastUpdated: string
  semesters: Record<string, string[]>
}

function getCachePath(): string {
  const dir = path.join(process.cwd(), "data")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, CACHE_FILENAME)
}

export function readCache(): OfferingsCache | null {
  try {
    const p = getCachePath()
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, "utf-8")
    const data = JSON.parse(raw) as OfferingsCache
    if (!data.semesters || typeof data.semesters !== "object") return null
    return data
  } catch {
    return null
  }
}

export function writeCache(data: OfferingsCache): void {
  const p = getCachePath()
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8")
}

function semesterKey(year: number, term: string): string {
  return `${year}-${term.toLowerCase()}`
}

/** Fetch one semester from SFU API: get departments, then course numbers per dept. Returns list of "DEPT NUMBER". */
export async function fetchSemesterFromAPI(year: number, term: string): Promise<string[]> {
  const courses = new Set<string>()
  try {
    const deptsRes = await axios.get<Array<{ text?: string; value?: string }>>(
      `${SFU_OUTLINES_BASE}?${year}/${term}`,
      { timeout: 10000 }
    )
    const depts = Array.isArray(deptsRes.data) ? deptsRes.data : []
    const deptValues = depts
      .map((d) => (d.value ?? d.text ?? "").toString().trim().toLowerCase())
      .filter(Boolean)
    for (const dept of deptValues) {
      try {
        const numRes = await axios.get<Array<{ text?: string; value?: string; title?: string }>>(
          `${SFU_OUTLINES_BASE}?${year}/${term}/${dept}`,
          { timeout: 8000 }
        )
        const nums = Array.isArray(numRes.data) ? numRes.data : []
        for (const n of nums) {
          const num = (n.value ?? n.text ?? "").toString().trim()
          if (num) courses.add(`${dept.toUpperCase()} ${num}`)
        }
      } catch {
        // skip dept on failure
      }
    }
  } catch {
    // return empty on failure
  }
  return Array.from(courses)
}

/** Get offerings for semester: read cache first; if miss, fetch from API, merge into cache, write, return. */
export async function getOfferingsForSemester(
  year: number,
  term: string,
  cache: OfferingsCache | null
): Promise<{ offerings: string[]; cache: OfferingsCache }> {
  const key = semesterKey(year, term)
  const nextCache: OfferingsCache = cache
    ? { ...cache, semesters: { ...cache.semesters } }
    : { lastUpdated: new Date().toISOString(), semesters: {} }
  if (nextCache.semesters[key]?.length) {
    return { offerings: nextCache.semesters[key], cache: nextCache }
  }
  const offerings = await fetchSemesterFromAPI(year, term)
  nextCache.semesters[key] = offerings
  nextCache.lastUpdated = new Date().toISOString()
  writeCache(nextCache)
  return { offerings, cache: nextCache }
}

/** Prediction fallback: when semester not in API/cache, use same term from previous year. */
export function predictOfferingsForSemester(
  year: number,
  term: string,
  cache: OfferingsCache | null
): string[] {
  if (!cache?.semesters) return []
  const prevKey = semesterKey(year - 1, term)
  return cache.semesters[prevKey] ?? []
}

/** Get offerings for semester; if API/cache returns empty, use prediction. */
export async function getOfferingsForSemesterWithPrediction(
  year: number,
  term: string,
  cache: OfferingsCache | null
): Promise<{ offerings: string[]; cache: OfferingsCache; fromPrediction: boolean }> {
  const { offerings, cache: nextCache } = await getOfferingsForSemester(year, term, cache)
  if (offerings.length > 0) {
    return { offerings, cache: nextCache, fromPrediction: false }
  }
  const predicted = predictOfferingsForSemester(year, term, nextCache)
  return { offerings: predicted, cache: nextCache, fromPrediction: true }
}

/** Build cache for semesters from startYear/startTerm through endYear/endTerm. */
export async function buildCacheForRange(
  startYear: number,
  startTerm: string,
  endYear: number,
  endTerm: string
): Promise<OfferingsCache> {
  let cache = readCache()
  const startTermIdx = TERMS.indexOf(startTerm.toLowerCase() as Term)
  const endTermIdx = TERMS.indexOf(endTerm.toLowerCase() as Term)
  for (let y = startYear; y <= endYear; y++) {
    const start = y === startYear ? startTermIdx : 0
    const end = y === endYear ? endTermIdx : TERMS.length - 1
    for (let t = start; t <= end; t++) {
      const term = TERMS[t]
      await getOfferingsForSemester(y, term, cache)
      cache = readCache()
    }
  }
  return readCache() ?? { lastUpdated: new Date().toISOString(), semesters: {} }
}

/** List semesters in order from startYear/startTerm for up to maxSemesters. */
export function listSemesters(
  startYear: number,
  startTerm: string,
  maxSemesters: number
): Array<{ year: number; term: string; label: string }> {
  const out: Array<{ year: number; term: string; label: string }> = []
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  let termIdx = TERMS.indexOf(startTerm.toLowerCase() as Term)
  if (termIdx < 0) termIdx = 0
  let year = startYear
  for (let i = 0; i < maxSemesters; i++) {
    const term = TERMS[termIdx]
    out.push({ year, term, label: `${cap(term)} ${year}` })
    termIdx++
    if (termIdx >= TERMS.length) {
      termIdx = 0
      year++
    }
  }
  return out
}
