/**
 * sheetsData.js — Google Sheets / GAS Data Fetching Service (บริการดึงข้อมูลจาก Google Sheets)
 * ─────────────────────────────────────────────────────────────────────────────
 * บริการนี้ดึงข้อมูลหลักของแอป (managers, positions, employees) จาก
 * Google Apps Script (GAS) endpoint ที่อ่านข้อมูลจาก Google Sheets
 * มีระบบ in-memory cache TTL 15 นาทีเพื่อลด API calls
 * และมี helper functions สำหรับ lookup ข้อมูลแผนก/ตำแหน่ง/พนักงาน
 *
 * This service fetches master data (managers, positions, employees) from a
 * Google Apps Script endpoint backed by Google Sheets. It includes a 15-minute
 * in-memory cache to reduce API calls, with graceful fallback to stale cache on error.
 *
 * Functions exported:
 *   - fetchSheetsData          : ดึงข้อมูล master data จาก GAS (พร้อม cache) / Fetch master data from GAS with in-memory caching
 *   - getDepartmentByEmail     : หาแผนกจาก email ผู้จัดการ / Look up a manager's department by email
 *   - getEmployeesByDepartment : ดึงรายชื่อพนักงานตามแผนก (รองรับ section) / Get employee list for a department, with optional section filter
 *   - getPositionsByDepartment : ดึงรายการตำแหน่งงานตามแผนก (เรียงตัวอักษร) / Get sorted position list for a department
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveDeptNames } from '../data/deptMapping'

// ── In-memory cache ──────────────────────────────────────────────────────────
// cache เก็บผลลัพธ์ล่าสุดจาก GAS endpoint เพื่อหลีกเลี่ยงการ fetch ซ้ำบ่อยๆ
// The module-level cache variable holds the most recent successful fetch result.
let cache = null

// cacheTime เก็บ Unix timestamp (ms) ของครั้งสุดท้ายที่ fetch สำเร็จ
// Stores the Unix timestamp (ms) of the last successful fetch.
let cacheTime = null

// pendingPromise — deduplicates concurrent calls: ถ้ามี in-flight request อยู่แล้ว
// callers ถัดไปจะ await promise เดิมแทนที่จะยิง HTTP ซ้ำ
let pendingPromise = null

// TTL 15 นาที: ถ้าข้อมูลในแคชอายุน้อยกว่านี้จะไม่ fetch ซ้ำ
// Cache TTL of 15 minutes: if cached data is fresher than this, skip re-fetching.
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 นาที

// sessionStorage key สำหรับเก็บ cache ข้ามการ refresh หน้า
const SESSION_KEY = 'hcapp_sheets_cache'

/**
 * ดึงข้อมูล master data จาก Google Apps Script endpoint
 * Fetches master data (managers, positions, employees) from the GAS endpoint.
 *
 * กลยุทธ์ cache / Cache strategy:
 *   1. ถ้า cache ยังไม่หมดอายุ (< 15 นาที) คืนข้อมูลจาก cache ทันที
 *      If cache is still fresh (< 15 min), return cached data immediately.
 *   2. ถ้า GAS URL ไม่ได้ตั้งค่า คืน empty structure
 *      If the GAS URL env var is not set, return an empty structure.
 *   3. fetch ข้อมูลใหม่จาก GAS แล้วอัปเดต cache
 *      Fetch fresh data from GAS and update the cache.
 *   4. ถ้า fetch ล้มเหลว คืน cache เก่า (ถ้ามี) ไม่งั้นคืนค่าว่าง
 *      On fetch failure, return stale cache if available, otherwise return empty structure.
 *      (ไม่บันทึก cache เพื่อให้ retry ครั้งถัดไป / Cache is NOT updated on failure so the next call retries)
 *
 * @returns {Promise<{managers: Object, positions: Array|Object, employees: Object}>}
 *   - managers  : map ของ email → department name / email-to-department map
 *   - positions : รายการตำแหน่งงานแยกตามแผนก / positions grouped by department
 *   - employees : รายชื่อพนักงานแยกตามแผนก / employees grouped by department
 */
export async function fetchSheetsData() {
  const now = Date.now()

  // 1. In-memory cache hit (fastest path — ไม่ต้อง deserialize)
  if (cache && cacheTime && now - cacheTime < CACHE_TTL_MS) return cache

  // 2. sessionStorage cache hit — ใช้ข้ามการ refresh หน้า (ป้องกัน GAS cold start ทุก reload)
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (stored) {
      const { data, time } = JSON.parse(stored)
      if (now - time < CACHE_TTL_MS) {
        cache = data
        cacheTime = time
        return data
      }
    }
  } catch (_) { /* sessionStorage ไม่รองรับ (private browsing ฯลฯ) — ข้ามไป */ }

  // 3. Deduplicate in-flight requests — ถ้ามี HTTP call ค้างอยู่แล้ว ให้ await อันเดิม
  //    ป้องกัน App.jsx + HCRequestForm ยิง GAS พร้อมกัน 2 ครั้งในการ load ครั้งแรก
  if (pendingPromise) return pendingPromise

  const url = import.meta.env.VITE_GAS_DATA_URL
  if (!url) {
    console.warn('VITE_GAS_DATA_URL not set')
    return { managers: {}, positions: [], employees: {} }
  }

  pendingPromise = (async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      // อัปเดต in-memory cache
      cache = data
      cacheTime = now

      // อัปเดต sessionStorage cache เพื่อให้ page refresh ครั้งถัดไปเร็ว
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ data, time: now }))
      } catch (_) { /* sessionStorage quota exceeded — ข้ามไป */ }

      return data
    } catch (err) {
      console.error('Failed to fetch sheets data:', err)
      // คืน stale cache ถ้ามี ไม่งั้นคืนค่าว่าง
      return cache ?? { managers: {}, positions: [], employees: {} }
    } finally {
      // เมื่อ request เสร็จ (ไม่ว่าจะสำเร็จหรือล้มเหลว) ล้าง pendingPromise
      // เพื่อให้ retry ครั้งถัดไปทำ HTTP call ใหม่ได้ถ้าจำเป็น
      pendingPromise = null
    }
  })()

  return pendingPromise
}

/**
 * หาชื่อแผนกจาก email ของผู้จัดการ
 * Looks up the department name for a given manager email.
 *
 * @param {Object} managers - map ของ email → department name (จาก fetchSheetsData) / email-to-department map from fetchSheetsData
 * @param {string} email    - email ของผู้จัดการที่ต้องการค้นหา / Manager email to look up
 * @returns {string} ชื่อแผนก หรือ '' ถ้าไม่พบ / Department name, or empty string if not found
 */
export function getDepartmentByEmail(managers, email) {
  if (!email || !managers) return ''
  // normalize เป็น lowercase เสมอ — Firebase Auth email เป็น lowercase แต่ key จาก Sheets
  // อาจพิมพ์ case ปนกัน ทำให้ lookup พลาดทั้งที่มีข้อมูล
  const key = email.trim().toLowerCase()
  if (managers[key] != null) return managers[key]
  // key ใน managers อาจยังไม่ lowercase (ข้อมูลจาก GAS เวอร์ชันเก่า/cache) → เทียบ case-insensitive
  const hit = Object.keys(managers).find(k => k.trim().toLowerCase() === key)
  return hit ? managers[hit] : ''
}

/**
 * ดึงรายชื่อพนักงานตามแผนก โดยรองรับ section เพื่อ narrow down
 * Gets a deduplicated list of employees for a given department, with optional
 * section-level filtering (used for Distribution Center: ANR/LKB/IYR).
 *
 * รองรับ section เพื่อ narrow down Distribution Center (ANR/LKB/IYR)
 * The section parameter narrows results for Distribution Center sub-departments.
 *
 * @param {Object} employees   - map ของ department name → string[] รายชื่อพนักงาน / department-to-employee-list map
 * @param {string} department  - ชื่อแผนกหลัก / Primary department name
 * @param {string} [section=''] - ชื่อ section ย่อย (เช่น 'ANR', 'LKB', 'IYR') / Sub-section name (e.g. 'ANR', 'LKB', 'IYR')
 * @returns {string[]} รายชื่อพนักงานที่ dedupe แล้ว / Deduplicated array of employee names
 */
// รองรับ section เพื่อ narrow down Distribution Center (ANR/LKB/IYR)
export function getEmployeesByDepartment(employees, department, section = '') {
  if (!employees || !department) return []

  // resolveDeptNames แปลง department + section เป็นชื่อแผนกที่ตรงกับ keys ใน employees map
  // resolveDeptNames translates the department/section pair into the exact keys used in the employees map
  const deptNames = resolveDeptNames(department, section)

  // รวม employees จากทุก mapped department แล้ว dedupe ด้วย Set
  // Flatten all employee arrays from every resolved department name, then deduplicate with Set
  const all = deptNames.flatMap((d) => employees[d] ?? [])
  return [...new Set(all)]
}

/**
 * ดึงรายการตำแหน่งงานตามแผนก เรียงตามตัวอักษร
 * Gets a deduplicated, alphabetically sorted list of job positions for a given department.
 *
 * @param {Object} positions  - map ของ department name → string[] ตำแหน่งงาน / department-to-positions map
 * @param {string} department - ชื่อแผนกหลัก / Primary department name
 * @returns {string[]} รายการตำแหน่งงานที่ dedupe และเรียงตัวอักษรแล้ว / Deduplicated, sorted array of position names
 */
export function getPositionsByDepartment(positions, department) {
  if (!positions || !department) return []

  // resolveDeptNames ใช้โดยไม่ส่ง section เพราะตำแหน่งไม่ขึ้นกับ section
  // No section is needed for positions — they are not sub-section specific
  const deptNames = resolveDeptNames(department)

  // รวม positions จากทุก mapped department แล้ว dedupe และเรียง
  // Flatten, deduplicate, then sort alphabetically using locale-aware comparison
  const all = deptNames.flatMap((d) => positions[d] ?? [])
  return [...new Set(all)].sort((a, b) => a.localeCompare(b))
}
