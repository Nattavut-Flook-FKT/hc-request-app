/**
 * ImportPage.jsx — Batch Historical Data Import (Admin Only)
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าสำหรับ Admin นำเข้าข้อมูล HC Request ย้อนหลังจากไฟล์ Excel (.xlsx) หรือ CSV (.csv)
 * เข้าสู่ Firestore collection 'hc_requests' แบบ batch
 *
 * Props / Key Features:
 *   - user, role, isDarkMode, toggleDarkMode — ส่งต่อไปยัง Layout component
 *   - รองรับไฟล์ Excel หลาย sheet (เลือก sheet ที่ชื่อ "job opening" อัตโนมัติ)
 *   - รองรับ CSV (อ่านเป็น string UTF-8)
 *   - แปลง status จาก CSV/Excel → Firestore status ด้วย STATUS_MAP
 *   - แปลงวันที่ด้วย toDate() + toLocalDateStr() + toNoon() เพื่อแก้ปัญหา timezone
 *   - สร้าง _statusHistory จาก openDate, offeringDate, onboardDate อัตโนมัติ
 *   - หลัง import เสร็จ → auto-call syncBatchToSheets() เพื่อ push ข้อมูลไป Google Sheets
 *   - ปุ่ม "Sync ไป Sheets อีกครั้ง" สำหรับ re-sync โดยไม่ต้อง import ซ้ำ
 *   - แสดง preview table ก่อน import จริง
 *
 * Notes:
 *   - Firestore writeBatch จำกัด 500 operations/batch → ใช้ chunk ขนาด 400 เพื่อ safety margin
 *   - toNoon() ตั้งเวลาเป็น 12:00 local เพื่อป้องกัน UTC boundary shift (สำคัญมากสำหรับ UTC+7)
 *   - getEmailFromPicName() ค้นหา email TA จาก Firestore users collection แทนการ hardcode
 *   - ไม่กรองตามปี — import ทุก row ที่มี Position (ยกเว้น row ที่ position ว่าง)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect } from 'react'
import { doc, collection, writeBatch, getDocs, query, where, limit, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { syncBatchToSheets } from '../../services/webhook'
import { FolderOpen, Plus, Settings2, RefreshCw, Link, Loader2 } from 'lucide-react'
import Layout from '../Shared/Layout'

// ─── convertToCSVUrl — แปลง Google Sheets URL → CSV export URL ───────────────
// รองรับ: /edit, /view, /pub, หรือ export URL โดยตรง
// ถ้าไม่ใช่ Google Sheets URL → return URL เดิม
function convertToCSVUrl(url) {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!m) return url  // ไม่ใช่ Google Sheets → ใช้ URL ตรงๆ

  const id  = m[1]
  // ดึง gid (sheet tab ID) ถ้ามีใน URL (เช่น #gid=123456789 หรือ gid=123456789)
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] || '0'
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
}

// ─── STATUS_MAP: แปลง status จาก CSV/Excel → Firestore status ─────────────────
// key: ค่า status ใน CSV (lowercase ทั้งหมด) ที่มักมีหลากหลาย variant
// value: Firestore status ที่ใช้ใน hc_requests (ตามที่ระบบกำหนด)
//
// เหตุผลที่ต้องมี map นี้: ข้อมูลเก่าใน CSV ไม่ได้ standardize
// เช่น 'onboard', 'onboarded' ทั้งคู่ map เป็น 'Closed'
// หรือ 'active sourcing', 'active search', 'sourcing' ทั้งหมด map เป็น 'Recruiting'
const STATUS_MAP = {
  'onboard':           'Closed',       // รับเข้าทำงานแล้ว → ปิด request
  'onboarded':         'Closed',       // รูปแบบ past tense ของ onboard
  'pending onboard':   'Onboarding',   // รอขึ้น onboard → สถานะ Onboarding
  'offering':          'Offering',     // อยู่ระหว่างเสนอ offer
  'pending offer':     'Offering',     // รอ offer → ยังอยู่ใน Offering
  'interviewing':      'Interviewing', // กำลัง interview อยู่
  'in progress':       'Recruiting',   // กำลัง recruit ทั่วไป
  'active sourcing':   'Recruiting',   // กำลัง source candidate
  'active search':     'Recruiting',   // กำลัง search candidate
  'sourcing':          'Recruiting',   // รูปแบบสั้นของ active sourcing
  'on hold':           'Open',         // พัก → ยังเปิดอยู่แต่หยุดหา
  'hold':              'Open',         // รูปแบบสั้นของ on hold
  'open':              'Open',         // เปิด request ใหม่
  'cancelled':         'Cancelled',    // ยกเลิก request
  'job cancelled':     'Cancelled',    // ยกเลิก job
  'turndown':          'Cancelled',    // candidate ปฏิเสธ offer
  'turn down':         'Cancelled',    // รูปแบบมีช่องว่าง
  'rejected':          'Cancelled',    // ถูกปฏิเสธ
}

// ─── getEmailFromPicName — ค้นหา email ของ TA จากชื่อ PIC ─────────────────────
// ดึง email จาก Firestore users collection แทนการ hardcode เพื่อรองรับการเปลี่ยนแปลง
//
// กลยุทธ์การค้นหาแบบ fallback (เรียงจาก precise → fuzzy):
//   1. exact name match (case-insensitive)
//   2. exact email prefix match (ส่วนก่อน @)
//   3. partial name match (includes)
//   4. partial email match (includes)
//
// @param {string} picName  — ชื่อ PIC ที่อ่านได้จาก CSV (อาจมี parenthesis เช่น "Name (TA)")
// @param {Array}  allTAs   — array of { email, name } จาก Firestore users collection
// @returns {string} email lowercase หรือ '' ถ้าหาไม่พบ
function getEmailFromPicName(picName, allTAs = []) {
  if (!picName) return ''
  const name = picName.toLowerCase().trim()
  // ตัดเฉพาะ firstName (ก่อนช่องว่างหรือวงเล็บ) เพื่อ fuzzy match
  const firstName = name.split(/[\s(]/)[0]
  // ถ้า firstName สั้นมาก (≤ 2 ตัวอักษร) → อาจ match ผิด ให้ return ว่างแทน
  if (firstName.length <= 2) return ''

  // ลอง exact match ก่อน (ชื่อเต็มหรือ email prefix ตรงพอดี)
  const exact = allTAs.find(t =>
    (t.name && t.name.toLowerCase() === name) ||
    (t.email && t.email.toLowerCase().split('@')[0] === firstName)
  )
  if (exact) return exact.email.toLowerCase()

  // ถ้าไม่มี exact → ลอง partial match
  const partial = allTAs.find(t =>
    (t.name && t.name.toLowerCase().includes(firstName)) ||
    (t.email && t.email.toLowerCase().includes(firstName))
  )
  return partial?.email.toLowerCase() ?? ''
}

// ─── TYPE_MAP: แปลง job type จาก CSV → Firestore requestType ──────────────────
// ข้อมูล CSV อาจใช้ 'replacement', 'replace', 'new hc', 'new' สลับกัน
const TYPE_MAP = {
  'replacement': 'Replacement', // ทดแทนพนักงาน
  'replace':     'Replacement', // รูปแบบสั้น
  'new hc':      'New HC',      // เพิ่มอัตราใหม่
  'new':         'New HC',      // รูปแบบสั้น
}

// ─── STATUS_COLOR: Tailwind classes สำหรับแสดง status badge ──────────────────
// ใช้ใน preview table เพื่อให้แยกแยะ status ได้ด้วยสี
const STATUS_COLOR = {
  Closed:       'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Onboarding:   'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  Offering:     'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  Recruiting:   'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Interviewing: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  Cancelled:    'bg-slate-100 text-slate-500',
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * ImportPage — Main Admin Import Component
 *
 * Props:
 *   - user         — Firebase Auth user object
 *   - role         — บทบาทผู้ใช้ (ควรเป็น 'admin')
 *   - isDarkMode   — boolean สำหรับ theme
 *   - toggleDarkMode — function สำหรับสลับ theme
 */
export default function ImportPage({ user, role, isDarkMode, toggleDarkMode }) {
  // ─── State: File Parsing ───────────────────────────────────────────────────
  const [rows, setRows] = useState([])        // ข้อมูลที่ parse และ map แล้ว พร้อม import (preview)
  const [fileName, setFileName] = useState('') // ชื่อไฟล์ที่เลือก (แสดงใน UI)

  // ─── State: Import Progress ────────────────────────────────────────────────
  const [importing, setImporting] = useState(false)  // กำลัง import อยู่ (disable ปุ่ม + แสดง spinner)
  const [imported, setImported] = useState(0)         // จำนวน rows ที่ import สำเร็จแล้ว (progress counter)
  const [errors, setErrors] = useState([])            // รายการ error message จาก batch commits ที่ล้มเหลว
  const [done, setDone] = useState(false)             // import เสร็จสมบูรณ์แล้ว → แสดง success screen

  // ─── State: Google Sheets Sync ────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false)       // กำลัง sync ไป Sheets อยู่
  const [syncDone, setSyncDone] = useState(false)     // sync ไป Sheets เสร็จแล้ว
  const [importedRows, setImportedRows] = useState([]) // เก็บ rows ที่ import สำเร็จ สำหรับ re-sync

  // ─── State: TA Lookup ──────────────────────────────────────────────────────
  const [allTAs, setAllTAs] = useState([]) // รายชื่อ TA/Admin ทั้งหมดจาก Firestore สำหรับ getEmailFromPicName()

  // ─── State: URL Import ────────────────────────────────────────────────────
  const [csvUrl,      setCsvUrl]      = useState('')  // URL ที่ user วางไว้
  const [urlLoading,  setUrlLoading]  = useState(false) // กำลัง fetch URL อยู่
  const [urlError,    setUrlError]    = useState('')  // error message จาก fetch URL

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const fileRef = useRef(null) // ref ของ hidden file input (ยังไม่ได้ใช้งาน แต่เตรียมไว้)

  // ─── Effect: โหลดรายชื่อ TA ทั้งหมดจาก Firestore ──────────────────────────
  // ดึงเฉพาะ users ที่มี role 'ta' หรือ 'admin' (จำกัด 100 คน)
  // เพื่อใช้ใน getEmailFromPicName() ตอน import
  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', 'in', ['ta', 'admin']), limit(100))
    getDocs(q).then(snap => {
      // map แต่ละ doc เป็น { email: doc.id, name: doc.data().name }
      // (Firestore users ใช้ email เป็น document ID)
      setAllTAs(snap.docs.map(d => ({ email: d.id, name: d.data().name })))
    }).catch(e => console.error('Error fetching TAs for import:', e))
  }, [])

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * processRawRows — แปลง raw rows จาก XLSX library → mapped objects พร้อม import
   *
   * ขั้นตอน:
   * 1. กรองเฉพาะ rows ที่มี Position (ไม่ว่าง)
   * 2. map แต่ละ row → object ที่มี field ตรงกับ Firestore schema
   * 3. แปลง status ด้วย STATUS_MAP
   * 4. แปลงวันที่ด้วย toDate() + toLocalDateStr()
   * 5. สร้าง _statusHistory จาก openDate, offeringDate, onboardDate
   * 6. อัพเดต state: rows, fileName, reset done/imported/errors
   *
   * @param {Object[]} raw  — array of raw row objects จาก XLSX.utils.sheet_to_json()
   * @param {File}     file — ไฟล์ต้นฉบับ (ใช้แค่ชื่อ)
   */
  function processRawRows(raw, file) {
    console.log('[Import] raw rows:', raw.length, '| sample keys:', raw[0] ? Object.keys(raw[0]) : 'empty')

    // กรองเฉพาะ rows ที่มี Position (รองรับทั้ง column 'Position' และ 'Positions')
    // ไม่กรองตามปี → import ทุก row ที่มีข้อมูลตำแหน่ง
    const filtered = raw.filter(r => {
      const pos = r['Position'] || r['Positions'] || ''
      return pos.toString().trim() !== ''
    })
    console.log('[Import] filtered (has position):', filtered.length)

    const mapped = filtered.map((r, i) => {
      // แปลง status เป็น lowercase ก่อน lookup ใน STATUS_MAP
      const rawStatus = (r['Status'] || '').toString().toLowerCase().trim()
      // รองรับทั้ง 'Job Type' และ 'Emp. Type' สำหรับ employment type
      const rawType = (r['Job Type'] || r['Emp. Type'] || '').toString().toLowerCase().trim()

      // ── Column Name Aliases ──────────────────────────────────────────────
      // รองรับหลาย column name เพราะ CSV/Excel แต่ละปีอาจใช้ชื่อต่างกัน
      const openDate       = r['Open Jobs'] || r['Start Progress Date'] || ''    // วันเปิด request
      const onboardDate    = r['Onboard Date'] || r['Onboarded Date'] || ''      // วันเริ่มงาน (onboard)
      const offeringDateRaw = r['Offering Date'] || r['Offering\nDate'] || ''    // วัน offer (newline variant)
      const contractEndRaw  = r['Contract End Date'] || r['Contract\nEnd Date'] || '' // วันหมดสัญญา

      // ── toLocalDateStr ────────────────────────────────────────────────────
      /**
       * แปลง Date object → "YYYY-MM-DD" string โดยใช้ local time
       *
       * เหตุผลที่ไม่ใช้ toISOString().slice(0,10):
       * toISOString() ใช้ UTC ทำให้วันที่ใน UTC+7 ถอยหลัง 1 วัน
       * เช่น 2024-01-15 00:00:00 ICT = 2024-01-14T17:00:00Z → แสดงเป็น "2024-01-14" ผิด
       *
       * @param {Date} d — Date object
       * @returns {string} "YYYY-MM-DD" ใช้ local time หรือ '' ถ้า d เป็น null
       */
      function toLocalDateStr(d) {
        if (!d) return ''
        const pad = n => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      }

      // ── toDate ────────────────────────────────────────────────────────────
      /**
       * แปลงค่าจาก Excel/CSV หลากหลายรูปแบบ → Date object
       *
       * รูปแบบที่รองรับ:
       *   - Date object (จาก xlsx cellDates: true)
       *   - number (Excel serial date เช่น 45291 = 2024-01-15)
       *     สูตร: (serial - 25569) * 86400 * 1000 ms
       *     25569 = วัน epoch offset ระหว่าง Excel (1/1/1900) กับ JS (1/1/1970)
       *   - string (ISO date string เช่น "2024-01-15")
       *
       * Validation:
       *   - ปีต้องอยู่ในช่วง 2000-2100 (ป้องกัน Excel serial ที่ไม่ใช่วันที่ เช่น SLA ค่า=0)
       *   - ถ้าแปลงแล้ว isNaN → return null
       *
       * @param {Date|number|string} val — ค่าวันที่จาก Excel/CSV
       * @returns {Date|null}
       */
      function toDate(val) {
        if (!val) return null
        let d
        if (val instanceof Date)          d = val
        else if (typeof val === 'number') d = new Date(Math.round((val - 25569) * 86400 * 1000))
        else if (typeof val === 'string' && val.trim()) d = new Date(val.trim())
        else return null
        if (!d || isNaN(d)) return null
        // ป้องกัน Excel serial ที่ไม่ใช่วันที่จริง (เช่น SLA=1899 → 1905)
        const yr = d.getFullYear()
        if (yr < 2000 || yr > 2100) return null
        return d
      }

      // แปลงวันที่ทุกฟิลด์ → Date object (หรือ null ถ้าไม่มี/แปลงไม่ได้)
      const createdAt      = toDate(openDate) || new Date()  // fallback เป็น now ถ้าไม่มีวันเปิด
      const startDateObj    = toDate(onboardDate)
      const offeringDateObj = toDate(offeringDateRaw)
      const contractEndObj  = toDate(contractEndRaw)

      // แปลง status CSV → Firestore status ด้วย STATUS_MAP
      // ถ้าไม่มีใน map → default เป็น 'Closed' (safe fallback สำหรับ request เก่า)
      const mappedStatus = STATUS_MAP[rawStatus] || 'Closed'

      // ── toNoon ────────────────────────────────────────────────────────────
      /**
       * ตั้งเวลาของ Date object เป็น 12:00:00.000 (noon) local time
       *
       * เหตุผล: เมื่อแปลงวันที่ไปเป็น ISO string สำหรับบันทึกลง Firestore
       * ถ้าเวลาเป็น 00:00 local (ICT UTC+7) จะกลายเป็น 17:00 วันก่อน (UTC)
       * ทำให้เมื่อแสดงผลใน timezone อื่นวันที่อาจผิดไป 1 วัน
       * การตั้งเป็น noon (12:00) ให้ buffer ±12 ชั่วโมงสำหรับทุก timezone
       *
       * @param {Date} d — Date object ต้นฉบับ
       * @returns {Date} Date ใหม่ที่มีเวลาเป็น 12:00 local หรือ null ถ้า d เป็น null
       */
      function toNoon(d) {
        if (!d) return null
        const n = new Date(d)
        n.setHours(12, 0, 0, 0) // ตั้ง hour=12, min=0, sec=0, ms=0 ใน local time
        return n
      }

      // ── _statusHistory Reconstruction ────────────────────────────────────
      // สร้าง statusHistory array จากข้อมูลวันที่ที่มีอยู่ใน CSV
      // เพื่อให้ Firestore record มี history ที่ถูกต้องแม้จะเป็นข้อมูลย้อนหลัง
      //
      // กฎการสร้าง history:
      //   1. เริ่มต้นด้วย 'Open' ที่ createdAt เสมอ (openDate จาก CSV)
      //   2. ถ้ามี offeringDate → เพิ่ม 'Offering' entry
      //   3. ถ้ามี onboardDate และ status เป็น Closed หรือ Onboarding → เพิ่ม 'Onboarding'
      //   4. ถ้า status เป็น Closed → เพิ่ม 'Closed' (ใช้ startDate หรือ createdAt)
      //
      // changedBy: 'import' และ changedByName: 'Import' ระบุว่าสร้างจาก import
      const history = [{ status: 'Open', changedAt: toNoon(createdAt).toISOString(), changedByName: 'Import', changedBy: 'import' }]
      if (offeringDateObj) history.push({ status: 'Offering', changedAt: toNoon(offeringDateObj).toISOString(), changedByName: 'Import', changedBy: 'import' })
      if (startDateObj && (mappedStatus === 'Closed' || mappedStatus === 'Onboarding')) {
        history.push({ status: 'Onboarding', changedAt: toNoon(startDateObj).toISOString(), changedByName: 'Import', changedBy: 'import' })
      }
      if (mappedStatus === 'Closed') {
        // ปิด request ณ วัน onboard (หรือ createdAt ถ้าไม่มี onboardDate)
        history.push({ status: 'Closed', changedAt: toNoon(startDateObj || createdAt).toISOString(), changedByName: 'Import', changedBy: 'import' })
      }

      // ── สร้าง mapped object ──────────────────────────────────────────────
      return {
        _rowNum: i + 1,                                                                    // เลขแถวใน CSV (แสดงใน preview)
        position:        (r['Position'] || r['Positions'] || '').toString().trim(),        // ตำแหน่งงาน
        department:      (r['Department'] || '').toString().trim(),                        // แผนก
        businessUnit:    (r['Business Unit'] || '').toString().trim(),                     // Business Unit
        jg:              (r['Rank'] || '').toString().trim(),                              // Job Grade (column 'Rank' ใน CSV)
        assignedToName:  (r['PIC'] || '').toString().trim(),                              // ชื่อ TA ที่รับผิดชอบ
        status:          mappedStatus,                                                     // Firestore status (จาก STATUS_MAP)
        candidateName:   (r['Offered Candidate'] || r['Candidate Name-Surname'] || '').toString().trim(), // ชื่อ candidate
        startDate:       toLocalDateStr(startDateObj),                                     // วัน onboard (YYYY-MM-DD local)
        offeringDate:    toLocalDateStr(offeringDateObj),                                  // วัน offer (YYYY-MM-DD local)
        contractEndDate: toLocalDateStr(contractEndObj),                                   // วันหมดสัญญา (สำหรับ contract)
        requestType:     TYPE_MAP[rawType] || 'New HC',                                    // ประเภท request (จาก TYPE_MAP)
        employmentType:  (r['Emp. Type'] || '').toString().trim(),                        // ประเภทการจ้าง (Monthly/Daily)
        hcId:            (r['HCID'] || r['HcID'] || '').toString().trim(),                // รหัส HC (ถ้ามี)
        createdAt,                                                                         // Date object สำหรับบันทึกใน Firestore
        closedAt:        mappedStatus === 'Closed' ? (startDateObj || createdAt) : null,  // วันปิด request
        _statusHistory:  history,                                                          // history array ที่สร้างขึ้น
      }
    }).filter(r => r.position) // กรองออก rows ที่ position ว่างหลังจาก trim

    console.log('[Import] mapped rows (non-empty position):', mapped.length)
    if (mapped.length === 0) console.warn('[Import] ⚠️ 0 rows — ตรวจสอบ column names และ year filter')

    // อัพเดต state ด้วย mapped rows และ reset progress
    setRows(mapped)
    setFileName(file.name)
    setDone(false)
    setImported(0)
    setErrors([])
  }

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * parseFile — อ่านไฟล์ CSV หรือ Excel ด้วย FileReader แล้วส่งต่อให้ processRawRows()
   *
   * การอ่านไฟล์แตกต่างกันตามประเภท:
   *   - CSV: readAsText (UTF-8) → XLSX.read(string, {type: 'string'})
   *   - Excel: readAsArrayBuffer → XLSX.read(buffer, {type: 'array'})
   *
   * Sheet selection สำหรับ Excel:
   *   1. ค้นหา sheet ที่ชื่อขึ้นต้นด้วย "job opening" ตามด้วยปี (regex: /job opening.*(20\d\d)/)
   *   2. ถ้าไม่พบ → ค้นหา sheet ที่มีคำว่า "job opening" (case-insensitive)
   *   3. ถ้าไม่พบทั้งสอง → ใช้ sheet แรก
   *
   * @param {File} file — File object จาก input หรือ drag-and-drop
   */
  function parseFile(file) {
    const isCsv = file.name.toLowerCase().endsWith('.csv')
    console.log('[Import] parseFile:', file.name, isCsv ? 'CSV' : 'Excel')
    const reader = new FileReader()
    reader.onerror = (e) => console.error('[Import] FileReader error:', e)

    reader.onload = async (e) => {
      try {
        // Dynamic import ของ xlsx library เพื่อ lazy load (ลดขนาด bundle)
        const mod = await import('xlsx')
        const XLSX = mod.default ?? mod

        let raw
        if (isCsv) {
          // CSV: parse จาก string UTF-8, cellDates: true → แปลง date column เป็น Date object อัตโนมัติ
          const wb = XLSX.read(e.target.result, { type: 'string', cellDates: true })
          const ws = wb.Sheets[wb.SheetNames[0]] // CSV มี sheet เดียวเสมอ
          raw = XLSX.utils.sheet_to_json(ws, { defval: '' }) // defval: '' → cell ว่างกลายเป็น '' ไม่ใช่ undefined
          console.log('[Import] CSV sheet:', wb.SheetNames[0])
        } else {
          // Excel: parse จาก ArrayBuffer, cellDates: true → แปลง date cell เป็น Date object
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
          console.log('[Import] workbook sheets:', wb.SheetNames)
          // เลือก sheet ที่เหมาะสม (fallback chain ดังอธิบายข้างบน)
          const sheetName =
            wb.SheetNames.find(s => /job opening.*(20\d\d)/i.test(s)) ||
            wb.SheetNames.find(s => s.toLowerCase().includes('job opening')) ||
            wb.SheetNames[0]
          console.log('[Import] using sheet:', sheetName)
          const ws = wb.Sheets[sheetName]
          raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
        }

        processRawRows(raw, file)
      } catch (err) {
        console.error('[Import] ❌ parse error:', err)
        alert('อ่านไฟล์ไม่ได้: ' + err.message)
      }
    }

    // เลือก read method ตามประเภทไฟล์
    if (isCsv) {
      reader.readAsText(file, 'UTF-8') // CSV ต้องระบุ encoding ให้ถูกต้อง
    } else {
      reader.readAsArrayBuffer(file)   // Excel ต้องอ่านเป็น binary
    }
  }

  /**
   * handleFile — event handler สำหรับ file input onChange
   * รับไฟล์ที่เลือกและส่งต่อให้ parseFile()
   */
  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    parseFile(file)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * fetchFromUrl — fetch CSV จาก URL แล้วส่งต่อให้ processRawRows()
   *
   * - รองรับ Google Sheets URL → auto-convert เป็น CSV export URL
   * - รองรับ URL ของไฟล์ CSV โดยตรง
   * - ถ้า fetch ไม่ได้ (CORS, private sheet ฯลฯ) → แสดง error ให้ user ดาวน์โหลดเองแทน
   */
  async function fetchFromUrl() {
    const raw = csvUrl.trim()
    if (!raw) return
    setUrlLoading(true)
    setUrlError('')
    try {
      const { getAuth } = await import('firebase/auth')
      const idToken = await getAuth().currentUser?.getIdToken()
      const gasProxy = async (action, params = {}) => {
        const res = await fetch('/api/gas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ type: 'get', action, params }),
        })
        return res.json()
      }

      // ── ตรวจว่าเป็น Google Sheets URL ────────────────────────────────────
      const sheetsMatch = raw.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
      if (sheetsMatch) {
        // ใช้ fetchSheetById — GAS เปิด Sheet โดยตรงด้วย SpreadsheetApp (ไม่ต้อง public)
        const spreadsheetId = sheetsMatch[1]
        const gid           = raw.match(/[#&?]gid=(\d+)/)?.[1] || '0'
        const json = await gasProxy('fetchSheetById', { spreadsheetId, gid })
        if (!json.success) throw new Error(json.error || 'เปิด Sheet ไม่ได้')

        // แปลง headers + rows array → array of objects (เหมือน sheet_to_json)
        const { headers, rows: rawRows } = json
        const objects = rawRows
          .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
          .map(row => {
            const obj = {}
            headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
            return obj
          })

        processRawRows(objects, { name: 'Google Sheets' })
        setCsvUrl('')

      } else {
        // ── URL อื่น (CSV โดยตรง) → ใช้ fetchCSV proxy ────────────────────
        const json = await gasProxy('fetchCSV', { url: raw })
        if (!json.success) throw new Error(json.error || 'Fetch ไม่สำเร็จ')

        const mod  = await import('xlsx')
        const XLSX = mod.default ?? mod
        const wb   = XLSX.read(json.csv, { type: 'string', cellDates: true })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

        processRawRows(rows, { name: raw.split('/').pop() || 'URL Import' })
        setCsvUrl('')
      }
    } catch (err) {
      console.error('[fetchFromUrl]', err)
      setUrlError(err.message || 'Fetch ไม่สำเร็จ')
    }
    setUrlLoading(false)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * handleImport — นำเข้าข้อมูลทั้งหมดใน rows เข้า Firestore ด้วย writeBatch
   *
   * ขั้นตอน:
   * 1. แบ่ง rows เป็น chunk ขนาด 400 (Firestore batch limit = 500)
   * 2. สำหรับแต่ละ chunk: สร้าง writeBatch, batch.set() แต่ละ row, commit()
   * 3. นับ count และเก็บ error ถ้า batch ใดล้มเหลว
   * 4. หลัง import ทั้งหมดเสร็จ → auto-call syncBatchToSheets() (ถ้าไม่มี error)
   *
   * Fields ที่บันทึกลง Firestore hc_requests:
   *   - ข้อมูลจาก row: position, department, businessUnit, jg, assignedToName,
   *     assignedTo (email lookup), status, candidateName, startDate, contractEndDate,
   *     requestType, employmentType, hcId, createdAt, closedAt, statusHistory
   *   - Metadata: headcount=1, reason='นำเข้าข้อมูลย้อนหลัง', requesterName='Imported',
   *     requesterEmail=user.email, importedAt=now, importedBy=user.email
   */
  async function handleImport() {
    if (!rows.length) return
    setImporting(true)
    setErrors([])
    let count = 0
    const errs = []
    const BATCH_SIZE = 400 // Firestore batch limit = 500 operations, ใช้ 400 เพื่อ safety margin
    const rowsWithIds = [] // เก็บ rows พร้อม Firestore ID สำหรับ sync ไป Sheets

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE) // ตัด rows เป็น chunk
      const batch = writeBatch(db)
      const chunkRefs = [] // เก็บ ref แต่ละ row เพื่อดึง ID หลัง commit

      chunk.forEach(r => {
        const ref = doc(collection(db, 'hc_requests')) // auto-generate document ID ใหม่
        chunkRefs.push({ r, ref })
        batch.set(ref, {
          position:        r.position,
          department:      r.department,
          businessUnit:    r.businessUnit,
          jg:              r.jg,
          assignedToName:  r.assignedToName,
          // ค้นหา email ของ TA จากชื่อ PIC โดย fuzzy match กับ allTAs
          assignedTo:      getEmailFromPicName(r.assignedToName, allTAs),
          status:          r.status,
          candidateName:   r.candidateName,
          startDate:       r.startDate,
          offeringDate:    r.offeringDate    || '',  // วัน offering (ใช้ใน SLA + Sheets)
          contractEndDate: r.contractEndDate || '',
          requestType:     r.requestType,
          employmentType:  r.employmentType || 'Monthly', // default Monthly ถ้าไม่มีข้อมูล
          hcId:            r.hcId,
          headcount:       1,                   // import ทีละ 1 เสมอ (CSV ไม่มีฟิลด์ headcount)
          reason:          'นำเข้าข้อมูลย้อนหลัง', // reason standard สำหรับ imported records
          requirements:    '',                  // ไม่มีข้อมูล requirements ใน CSV เก่า
          requesterName:   'Imported',
          requesterEmail:  user.email,          // email ของ admin ที่ทำการ import
          createdAt:       r.createdAt,         // Date object จาก CSV (ไม่ใช่ serverTimestamp)
          closedAt:        r.closedAt || null,
          statusHistory:   r._statusHistory,    // history ที่สร้างขึ้นจาก processRawRows()
          importedAt:      new Date(),           // วันที่ import
          importedBy:      user.email,           // ใครเป็นคน import
        })
      })

      try {
        await batch.commit() // commit batch ทั้ง chunk
        count += chunk.length
        setImported(count) // อัพเดต progress counter (re-render ทุก batch)
        // หลัง commit: เก็บ row พร้อม Firestore ID (ถ้า hcId ว่าง → ใช้ doc ID แทน)
        chunkRefs.forEach(({ r, ref }) => {
          rowsWithIds.push({ ...r, hcId: r.hcId || ref.id })
        })
      } catch (err) {
        errs.push(`Batch ${i / BATCH_SIZE + 1}: ${err.message}`)
      }
    }

    setErrors(errs)
    setImporting(false)
    setDone(true)

    // ── Auto-sync ลง Google Sheets หลัง import สำเร็จ ────────────────────
    // จะ sync เฉพาะเมื่อไม่มี error และมี rows ที่ import ได้
    // syncBatchToSheets() ส่ง rows ทั้งหมดไปยัง Google Apps Script webhook
    // เพื่ออัพเดต Google Sheets tracker ให้ตรงกับ Firestore
    if (errs.length === 0 && rowsWithIds.length > 0) {
      // อัพเดต HCID counter ให้สูงกว่า max ที่ import มา
      // ป้องกัน generateHCID() ใน form submission generate HCID ซ้ำกับ imported rows
      const currentYear = new Date().getFullYear()
      let maxSeq = 0
      rowsWithIds.forEach(r => {
        const parts = (r.hcId || '').split('-')
        if (parts.length === 3 && parts[1] === String(currentYear)) {
          const seq = parseInt(parts[2]) || 0
          if (seq > maxSeq) maxSeq = seq
        }
      })
      if (maxSeq > 0) {
        const counterRef = doc(db, 'meta', 'hcid_counter')
        const counterSnap = await getDoc(counterRef)
        const currentSeq = counterSnap.exists() ? (counterSnap.data().seq || 0) : 0
        if (maxSeq > currentSeq) {
          await setDoc(counterRef, { year: currentYear, seq: maxSeq })
        }
      }

      setImportedRows(rowsWithIds) // เก็บไว้สำหรับ re-sync ภายหลัง
      setSyncing(true)
      await syncBatchToSheets(rowsWithIds)
      setSyncing(false)
      setSyncDone(true)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * handleResync — re-sync importedRows ไปยัง Google Sheets อีกครั้ง
   * ใช้เมื่อ auto-sync ครั้งแรกล้มเหลว หรือต้องการ sync ซ้ำโดยไม่ต้อง import ใหม่
   */
  async function handleResync() {
    if (!importedRows.length) return
    setSyncing(true)
    setSyncDone(false)
    await syncBatchToSheets(importedRows)
    setSyncing(false)
    setSyncDone(true)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="max-w-5xl mx-auto py-8 px-4">
        {/* ── Page Header ── */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20"><FolderOpen size={20} className="text-blue-600 dark:text-blue-400"/></div>
          <div>
            <h1 className="text-lg font-black text-gray-900 dark:text-gray-100">Import ข้อมูลย้อนหลัง</h1>
            <p className="text-xs text-gray-500 dark:text-slate-400">รองรับ Excel (.xlsx) และ CSV (.csv) — import ทุกปี</p>
          </div>
        </div>

        {/* ── Step 1: Input Zone (URL + File) ───────────────────────────────
         * แสดงเฉพาะเมื่อยังไม่มี rows และ import ยังไม่เสร็จ
         */}
        {!rows.length && !done && (
          <div className="flex flex-col gap-3">
            {/* URL input — วาง Google Sheets link ได้เลย */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none"/>
                <input
                  type="url"
                  value={csvUrl}
                  onChange={e => { setCsvUrl(e.target.value); setUrlError('') }}
                  onKeyDown={e => e.key === 'Enter' && !urlLoading && csvUrl.trim() && fetchFromUrl()}
                  placeholder="วาง Google Sheets URL หรือ CSV link แล้วกด Load..."
                  className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                />
              </div>
              <button
                onClick={fetchFromUrl}
                disabled={!csvUrl.trim() || urlLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-black rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition shadow-md shadow-blue-500/20"
              >
                {urlLoading ? <Loader2 size={14} className="animate-spin"/> : <Link size={14}/>}
                {urlLoading ? 'Loading...' : 'Load'}
              </button>
            </div>

            {/* Error message จาก URL fetch */}
            {urlError && (
              <p className="text-xs font-bold text-red-500 dark:text-red-400 px-1">
                ⚠ {urlError}
              </p>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-slate-600">
              <div className="flex-1 border-t border-gray-200 dark:border-slate-800"/>
              <span className="font-bold uppercase tracking-widest">หรืออัปโหลดไฟล์</span>
              <div className="flex-1 border-t border-gray-200 dark:border-slate-800"/>
            </div>

            {/* File Drop Zone */}
            <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-2xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors">
              <FolderOpen size={28} className="text-gray-300 dark:text-slate-600 mb-2"/>
              <p className="text-sm font-bold text-gray-500 dark:text-slate-400">คลิกหรือลากไฟล์มาวาง</p>
              <p className="text-xs text-gray-400 dark:text-slate-600 mt-0.5">.xlsx หรือ .csv</p>
              <input id="import-file" name="import-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} ref={fileRef}/>
            </label>
          </div>
        )}

        {/* ── Step 2: Preview Table + Import Button ──────────────────────────
         * แสดงเมื่อมี rows แต่ยังไม่ได้ import (done = false)
         * ให้ user ตรวจสอบข้อมูลก่อนกด Import จริง
         */}
        {rows.length > 0 && !done && (
          <div>
            {/* Header: ชื่อไฟล์, จำนวน rows, ปุ่มเปลี่ยนไฟล์, ปุ่ม Import */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-black text-gray-700 dark:text-gray-200">{fileName}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">พบ <span className="font-black text-blue-600 dark:text-blue-400">{rows.length}</span> รายการ</p>
              </div>
              <div className="flex gap-2">
                {/* ปุ่มเปลี่ยนไฟล์ */}
                <button onClick={() => { setRows([]); setFileName('') }}
                  className="px-3 py-1.5 text-xs font-bold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  เปลี่ยนไฟล์
                </button>
                {/* ปุ่ม Sync ไป Sheets เท่านั้น (ไม่แตะ Firestore) */}
                <button onClick={async () => {
                    setSyncing(true); setSyncDone(false)
                    await syncBatchToSheets(rows)
                    setSyncing(false); setSyncDone(true)
                    setTimeout(() => setSyncDone(false), 5000)
                  }}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-black rounded-xl border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-50">
                  {syncing ? <><RefreshCw size={12} className="animate-spin"/> Syncing...</> : syncDone ? <>✓ Synced!</> : <><RefreshCw size={12}/> Sheets Only</>}
                </button>
                {/* ปุ่ม Import: แสดง progress (imported/total) ขณะกำลัง import */}
                <button onClick={handleImport} disabled={importing}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-black rounded-xl bg-[#008065] text-white hover:bg-[#006b54] transition-colors shadow-md shadow-emerald-500/20 disabled:opacity-60">
                  {importing ? <><Settings2 size={12} className="animate-spin"/> กำลัง Import {imported}/{rows.length}</> : <><Plus size={12}/> Import {rows.length} รายการ</>}
                </button>
              </div>
            </div>

            {/* Preview Table: แสดงข้อมูลหลักของแต่ละ row ก่อน import */}
            <div className="rounded-2xl border border-gray-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
                    <tr>
                      {['#','ตำแหน่ง','แผนก','JG','TA (PIC)','Status','Candidate','วันเริ่ม'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2 text-gray-400 dark:text-slate-600 tabular-nums">{r._rowNum}</td>
                        <td className="px-3 py-2 font-bold text-gray-800 dark:text-gray-200 max-w-[160px] truncate">{r.position}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-400 max-w-[120px] truncate">{r.department}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-slate-500">{r.jg}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.assignedToName}</td>
                        <td className="px-3 py-2">
                          {/* Status badge สีตาม STATUS_COLOR */}
                          <span className={`inline-flex px-2 py-0.5 rounded-full font-bold text-[10px] ${STATUS_COLOR[r.status] || ''}`}>{r.status}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-400 max-w-[120px] truncate">{r.candidateName}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-slate-500 whitespace-nowrap">{r.startDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Success Screen ──────────────────────────────────────────
         * แสดงเมื่อ import เสร็จสมบูรณ์ (done = true)
         * แสดง: จำนวน rows ที่ import, Sheets sync status, error list (ถ้ามี)
         * ปุ่ม: Import ไฟล์ใหม่ (reset ทั้งหมด), Sync ไป Sheets อีกครั้ง
         */}
        {done && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-8 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">Import เสร็จสมบูรณ์</p>
            <p className="text-sm text-emerald-600 dark:text-emerald-500 mt-1">นำเข้าแล้ว <span className="font-black">{imported}</span> รายการเข้า Firestore</p>

            {/* Google Sheets sync status indicator */}
            <div className={`mt-4 flex items-center justify-center gap-2 text-sm font-bold ${
              syncing ? 'text-indigo-500' : syncDone ? 'text-[#008065]' : 'text-gray-400'
            }`}>
              {syncing
                ? <><Settings2 size={14} className="animate-spin" /> กำลัง Sync ไป Google Sheets...</>
                : syncDone
                ? <>✓ Sync ไป Google Sheets แล้ว ({importedRows.length} rows)</>
                : null
              }
            </div>

            {/* Error list: แสดงเฉพาะเมื่อมี batch ที่ล้มเหลว */}
            {errors.length > 0 && (
              <div className="mt-4 text-left bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
                {errors.map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>)}
              </div>
            )}

            <div className="flex items-center justify-center gap-3 mt-5">
              {/* ปุ่ม Import ไฟล์ใหม่: reset state ทั้งหมดกลับไปหน้าเลือกไฟล์ */}
              <button onClick={() => { setRows([]); setFileName(''); setDone(false); setImported(0); setSyncDone(false); setImportedRows([]) }}
                className="px-5 py-2 text-sm font-bold rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors">
                Import ไฟล์ใหม่
              </button>
              {/* ปุ่ม Re-sync: แสดงเฉพาะเมื่อมี importedRows (import สำเร็จแล้ว) */}
              {importedRows.length > 0 && (
                <button onClick={handleResync} disabled={syncing}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold rounded-xl bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50">
                  <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                  Sync ไป Sheets อีกครั้ง
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
