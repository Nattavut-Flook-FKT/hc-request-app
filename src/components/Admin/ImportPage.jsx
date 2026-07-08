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
import { doc, collection, writeBatch, getDocs, query, where, limit, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { syncBatchToSheets } from '../../services/webhook'
import { FolderOpen, Plus, Settings2, RefreshCw, Link, Loader2, Wrench } from 'lucide-react'
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
  Closed:       'bg-green-fresh-50 text-green-fresh-900',
  Onboarding:   'bg-teal-50 text-teal-900',
  Offering:     'bg-purple-50 text-purple-900',
  Recruiting:   'bg-blue-50 text-blue-900',
  Interviewing: 'bg-orange-50 text-orange-900',
  Cancelled:    'bg-neutral-100 text-neutral-500',
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

  // ─── State: Patch Onboard Dates ───────────────────────────────────────────
  const [patching,      setPatching]      = useState(false)
  const [patchDone,     setPatchDone]     = useState(false)
  const [patchCount,    setPatchCount]    = useState(0)
  const [patchSkipped,  setPatchSkipped]  = useState(0)
  const [patchNotFound, setPatchNotFound] = useState(0)

  // ─── State: Find Extra REQ-2026 Closed ────────────────────────────────────
  const [findingExtra,  setFindingExtra]  = useState(false)
  const [extraResult,   setExtraResult]   = useState(null) // null | { firestoreIds, extra, csvIds }

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
        if (val instanceof Date) {
          d = val
        } else if (typeof val === 'number') {
          d = new Date(Math.round((val - 25569) * 86400 * 1000))
        } else if (typeof val === 'string' && val.trim()) {
          const s = val.trim()
          // handle "28-Oct-2024" หรือ "1-Jan-2025" (DD-MMM-YYYY / D-MMM-YYYY)
          // new Date() ไม่ parse format นี้ได้ใน V8 → ต้อง parse explicit
          const DMY = s.match(/^(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{4})$/)
          if (DMY) {
            const MON = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11}
            const mo = MON[DMY[2].toLowerCase()]
            d = mo !== undefined ? new Date(+DMY[3], mo, +DMY[1], 12, 0, 0) : null
          } else {
            d = new Date(s)
          }
        } else {
          return null
        }
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
        // email เจ้าของคำขอจริง (optional column) — ถ้าไม่มีจะเก็บ '' ห้าม fallback เป็น email แอดมิน
        // ไม่งั้นคำขอจะไปโผล่ใน "คำขอของฉัน" ของแอดมินแทนเจ้าของจริง
        requesterEmail:  (r['Requester Email'] || r['Requester'] || '').toString().trim().toLowerCase(),
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
      const gasDataUrl = import.meta.env.VITE_GAS_DATA_URL
      const gasSecret  = import.meta.env.VITE_GAS_SECRET
      const gasProxy = async (action, params = {}) => {
        const p = new URLSearchParams({ action, ...params })
        if (gasSecret) p.set('secret', gasSecret)
        const res = await fetch(`${gasDataUrl}?${p.toString()}`)
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
   *     requesterEmail=จาก column 'Requester Email' หรือ '' (ห้ามใช้ email แอดมิน), importedAt=now, importedBy=user.email
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
          requesterEmail:  r.requesterEmail || '', // email เจ้าของจริงจาก column (ถ้ามี) — ไม่ใช่ของแอดมิน
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
  /**
   * handlePatchDates — แก้ไข startDate + closedAt ใน Firestore โดย match กับ hcId
   *
   * ใช้เมื่อ import ครั้งก่อนไม่มี Onboard Date → closedAt ถูก fallback เป็น createdAt (ผิดปี)
   * ทำให้ Dashboard crossover ปีไม่ทำงาน (เคสปี 2025 ที่ปิดปี 2026 ไม่แสดงใน filter 2026)
   *
   * ขั้นตอน:
   *   1. กรอง rows ที่มี hcId + startDate (Onboard Date) + status Closed
   *   2. Query Firestore ด้วย hcId
   *   3. Update startDate + closedAt เฉพาะ record ที่ startDate ต่างจาก Firestore
   */
  async function handlePatchDates() {
    // กรองเฉพาะ rows ที่มี hcId + status Closed (ไม่จำเป็นต้องมี startDate)
    const patchable = rows.filter(r => r.hcId && r.status === 'Closed')
    if (!patchable.length) return

    setPatching(true)
    setPatchDone(false)
    let patched = 0
    let skipped = 0
    let notFound = 0

    for (const r of patchable) {
      try {
        // ค้นหา document ใน Firestore ที่มี hcId ตรงกัน
        const q = query(collection(db, 'hc_requests'), where('hcId', '==', r.hcId), limit(1))
        const snap = await getDocs(q)

        if (snap.empty) { notFound++; continue }

        const docSnap = snap.docs[0]
        const existing = docSnap.data()

        const updates = {}

        // อัปเดต startDate + closedAt ถ้า startDate ต่างกัน
        if (r.startDate && existing.startDate !== r.startDate) {
          const [sy, sm, sd] = r.startDate.split('-').map(Number)
          updates.startDate = r.startDate
          updates.closedAt  = new Date(sy, sm - 1, sd, 12, 0, 0, 0)
        }

        // อัปเดต createdAt ถ้าปีที่เก็บใน Firestore ≠ ปีที่ HCID บอก
        // (เกิดจาก toDate() parse "DD-MMM-YYYY" ไม่ได้ → fallback เป็น new Date() ผิดปี)
        const hcidYear = parseInt((r.hcId || '').split('-')[1], 10)
        const storedCreatedYear = existing.createdAt?.toDate?.()?.getFullYear()
        if (hcidYear >= 2020 && storedCreatedYear && storedCreatedYear !== hcidYear) {
          // ใช้ createdAt จาก rows ที่ parse ใหม่ (ด้วย toDate ที่แก้แล้ว)
          if (r.createdAt instanceof Date && r.createdAt.getFullYear() === hcidYear) {
            updates.createdAt = r.createdAt
          }
        }

        if (Object.keys(updates).length === 0) { skipped++; continue }

        await updateDoc(docSnap.ref, updates)
        patched++
      } catch (err) {
        console.error('[PatchDates] error on', r.hcId, err)
        skipped++
      }
    }

    setPatchCount(patched)
    setPatchSkipped(skipped)
    setPatchNotFound(notFound)
    setPatching(false)
    setPatchDone(true)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * handleFindExtra — หา REQ-2026 Closed ที่อยู่ใน Firestore แต่ไม่อยู่ใน CSV ที่โหลดมา
   * ถ้ายังไม่โหลด CSV → ดึง REQ-2026 Closed จาก Firestore ล้วนๆ แล้ว log ออกมา
   */
  async function handleFindExtra() {
    setFindingExtra(true)
    setExtraResult(null)
    try {
      // ดึง Closed ทั้งหมดจาก Firestore
      const q = query(collection(db, 'hc_requests'), where('status', '==', 'Closed'))
      const snap = await getDocs(q)
      const firestoreAll = snap.docs.map(d => {
        const data = d.data()
        const closedAtDate = data.closedAt?.toDate?.() ?? null
        const createdAtDate = data.createdAt?.toDate?.() ?? null
        return {
          hcId: data.hcId || '',
          position: data.position || '',
          startDate: data.startDate || '',
          department: data.department || '',
          candidateName: data.candidateName || '',
          createdAt: createdAtDate?.toISOString?.()?.slice(0,10) ?? '',
          closedAtYear: closedAtDate?.getFullYear() ?? null,
          closedAtStr: closedAtDate?.toISOString?.()?.slice(0,10) ?? '',
        }
      })

      // ── REQ-2026 ──────────────────────────────────────────────────────────
      const firestore2026 = firestoreAll
        .filter(r => r.hcId.startsWith('REQ-2026-'))
        .sort((a, b) => a.hcId.localeCompare(b.hcId))

      const csvSet2026 = new Set(
        rows
          .filter(r => r.hcId && r.hcId.startsWith('REQ-2026-') && r.status === 'Closed')
          .map(r => r.hcId)
      )

      const extra2026 = rows.length > 0
        ? firestore2026.filter(r => !csvSet2026.has(r.hcId))
        : firestore2026

      // ── REQ-2025 crossover (closedAt ปี 2026) ────────────────────────────
      const firestore2025cross = firestoreAll
        .filter(r => r.hcId.startsWith('REQ-2025-') && r.closedAtYear === 2026)
        .sort((a, b) => a.hcId.localeCompare(b.hcId))

      // CSV REQ-2025 ที่ startDate (Onboard Date) อยู่ในปี 2026
      const csvSet2025cross = new Set(
        rows
          .filter(r => {
            if (!r.hcId?.startsWith('REQ-2025-') || r.status !== 'Closed') return false
            const yr = r.startDate ? parseInt(r.startDate.slice(0, 4), 10) : 0
            return yr === 2026
          })
          .map(r => r.hcId)
      )

      // REQ-2025 ที่ Firestore นับว่า crossover แต่ CSV ไม่มี (หรือ CSV ไม่ถือว่า 2026)
      const extra2025 = rows.length > 0
        ? firestore2025cross.filter(r => !csvSet2025cross.has(r.hcId))
        : firestore2025cross

      setExtraResult({
        firestoreIds: firestore2026,
        extra: extra2026,
        csvIds: csvSet2026,
        // crossover
        firestore2025cross,
        csvSet2025cross,
        extra2025,
      })
    } catch (err) {
      console.error('[FindExtra]', err)
      setExtraResult({ error: err.message })
    }
    setFindingExtra(false)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="max-w-5xl mx-auto py-8 px-4">
        {/* ── Page Header ── */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-blue-50"><FolderOpen size={20} strokeWidth={1} absoluteStrokeWidth className="text-blue-600"/></div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900">Import ข้อมูลย้อนหลัง</h1>
            <p className="text-xs text-neutral-500">รองรับ Excel (.xlsx) และ CSV (.csv) — import ทุกปี</p>
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
                <Link size={14} strokeWidth={1} absoluteStrokeWidth className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"/>
                <input
                  type="url"
                  value={csvUrl}
                  onChange={e => { setCsvUrl(e.target.value); setUrlError('') }}
                  onKeyDown={e => e.key === 'Enter' && !urlLoading && csvUrl.trim() && fetchFromUrl()}
                  placeholder="วาง Google Sheets URL หรือ CSV link แล้วกด Load..."
                  className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-neutral-100 bg-white text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                />
              </div>
              <button
                onClick={fetchFromUrl}
                disabled={!csvUrl.trim() || urlLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition"
              >
                {urlLoading ? <Loader2 size={14} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> : <Link size={14} strokeWidth={1} absoluteStrokeWidth/>}
                {urlLoading ? 'Loading...' : 'Load'}
              </button>
            </div>

            {/* Error message จาก URL fetch */}
            {urlError && (
              <p className="text-xs font-bold text-red-600 px-1">
                ⚠ {urlError}
              </p>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <div className="flex-1 border-t border-neutral-100"/>
              <span className="font-bold">หรืออัปโหลดไฟล์</span>
              <div className="flex-1 border-t border-neutral-100"/>
            </div>

            {/* File Drop Zone */}
            <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-neutral-200 rounded-2xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
              <FolderOpen size={28} strokeWidth={1} absoluteStrokeWidth className="text-neutral-300 mb-2"/>
              <p className="text-sm font-bold text-neutral-500">คลิกหรือลากไฟล์มาวาง</p>
              <p className="text-xs text-neutral-400 mt-0.5">.xlsx หรือ .csv</p>
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
                <p className="text-sm font-bold text-neutral-700">{fileName}</p>
                <p className="text-xs text-neutral-500 mt-0.5">พบ <span className="font-bold text-blue-600">{rows.length}</span> รายการ</p>
              </div>
              <div className="flex gap-2">
                {/* ปุ่มเปลี่ยนไฟล์ */}
                <button onClick={() => { setRows([]); setFileName('') }}
                  className="px-3 py-1.5 text-xs font-bold rounded-xl border border-neutral-100 text-neutral-500 hover:bg-neutral-50 transition-colors">
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
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl border border-purple-100 text-purple-700 hover:bg-purple-50 transition-colors disabled:opacity-50">
                  {syncing ? <><RefreshCw size={12} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> Syncing...</> : syncDone ? <>✓ Synced!</> : <><RefreshCw size={12} strokeWidth={1} absoluteStrokeWidth/> Sheets Only</>}
                </button>
                {/* ปุ่ม Import: แสดง progress (imported/total) ขณะกำลัง import */}
                <button onClick={handleImport} disabled={importing}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl bg-dark-green-600 text-white hover:bg-dark-green-700 transition-colors disabled:opacity-60">
                  {importing ? <><Settings2 size={12} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลัง Import {imported}/{rows.length}</> : <><Plus size={12} strokeWidth={1} absoluteStrokeWidth/> Import {rows.length} รายการ</>}
                </button>
              </div>
            </div>

            {/* Preview Table: แสดงข้อมูลหลักของแต่ละ row ก่อน import */}
            <div className="rounded-2xl border border-neutral-100 overflow-hidden">
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-100">
                    <tr>
                      {['#','ตำแหน่ง','แผนก','JG','TA (PIC)','Status','Candidate','วันเริ่ม'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left font-bold text-neutral-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-neutral-50">
                        <td className="px-3 py-2 text-neutral-400 tabular-nums">{r._rowNum}</td>
                        <td className="px-3 py-2 font-bold text-neutral-800 max-w-[160px] truncate">{r.position}</td>
                        <td className="px-3 py-2 text-neutral-600 max-w-[120px] truncate">{r.department}</td>
                        <td className="px-3 py-2 text-neutral-500">{r.jg}</td>
                        <td className="px-3 py-2 text-neutral-600">{r.assignedToName}</td>
                        <td className="px-3 py-2">
                          {/* Status badge สีตาม STATUS_COLOR */}
                          <span className={`inline-flex px-2 py-0.5 rounded-full font-bold text-[10px] ${STATUS_COLOR[r.status] || ''}`}>{r.status}</span>
                        </td>
                        <td className="px-3 py-2 text-neutral-600 max-w-[120px] truncate">{r.candidateName}</td>
                        <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{r.startDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Patch Onboard Dates ────────────────────────────────────────────
         * แสดงเมื่อ load CSV แล้ว (rows มีข้อมูล)
         * ใช้แก้ไข startDate + closedAt ของ records ที่ import ครั้งก่อนไม่มี Onboard Date
         * → ทำให้ Dashboard crossover ปีทำงานถูกต้อง (เคสปี 2025 ที่ปิดปี 2026)
         */}
        {rows.length > 0 && (() => {
          const patchable = rows.filter(r => r.hcId && r.status === 'Closed')
          if (!patchable.length) return null
          return (
            <div className="mt-4 p-4 rounded-2xl border border-banana-100 bg-banana-50">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Wrench size={16} strokeWidth={1} absoluteStrokeWidth className="text-banana-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-banana-900">Patch Onboard Dates</p>
                    <p className="text-xs text-banana-700 mt-0.5">
                      พบ <span className="font-bold">{patchable.length}</span> records ที่มี Onboard Date —
                      อัปเดต <code className="font-mono">startDate</code> + <code className="font-mono">closedAt</code> ใน Firestore โดย match กับ HCID
                    </p>
                    {patchDone && (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <p className="text-xs font-bold text-dark-green-700">
                          ✓ อัปเดตแล้ว {patchCount} records
                        </p>
                        {patchSkipped > 0 && (
                          <p className="text-xs text-banana-700">
                            ข้าม {patchSkipped} (startDate เหมือนเดิม / createdAt ถูกแล้ว)
                          </p>
                        )}
                        {patchNotFound > 0 && (
                          <p className="text-xs text-red-600 font-bold">
                            ⚠ ไม่พบใน Firestore {patchNotFound} records (hcId ไม่ match)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={handlePatchDates}
                  disabled={patching}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-banana-600 text-white hover:bg-banana-700 transition-colors disabled:opacity-60 shrink-0"
                >
                  {patching
                    ? <><Loader2 size={12} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> กำลัง Patch...</>
                    : <><Wrench size={12} strokeWidth={1} absoluteStrokeWidth /> Patch {patchable.length} records</>
                  }
                </button>
              </div>
            </div>
          )
        })()}

        {/* ── Step 3: Success Screen ──────────────────────────────────────────
         * แสดงเมื่อ import เสร็จสมบูรณ์ (done = true)
         * แสดง: จำนวน rows ที่ import, Sheets sync status, error list (ถ้ามี)
         * ปุ่ม: Import ไฟล์ใหม่ (reset ทั้งหมด), Sync ไป Sheets อีกครั้ง
         */}
        {done && (
          <div className="rounded-2xl border border-green-fresh-100 bg-green-fresh-50 p-8 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-lg font-bold text-green-fresh-900">Import เสร็จสมบูรณ์</p>
            <p className="text-sm text-green-fresh-700 mt-1">นำเข้าแล้ว <span className="font-bold">{imported}</span> รายการเข้า Firestore</p>

            {/* Google Sheets sync status indicator */}
            <div className={`mt-4 flex items-center justify-center gap-2 text-sm font-bold ${
              syncing ? 'text-purple-600' : syncDone ? 'text-dark-green-700' : 'text-neutral-400'
            }`}>
              {syncing
                ? <><Settings2 size={14} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> กำลัง Sync ไป Google Sheets...</>
                : syncDone
                ? <>✓ Sync ไป Google Sheets แล้ว ({importedRows.length} rows)</>
                : null
              }
            </div>

            {/* Error list: แสดงเฉพาะเมื่อมี batch ที่ล้มเหลว */}
            {errors.length > 0 && (
              <div className="mt-4 text-left bg-red-50 rounded-xl p-3">
                {errors.map((e, i) => <p key={i} className="text-xs text-red-700">{e}</p>)}
              </div>
            )}

            <div className="flex items-center justify-center gap-3 mt-5">
              {/* ปุ่ม Import ไฟล์ใหม่: reset state ทั้งหมดกลับไปหน้าเลือกไฟล์ */}
              <button onClick={() => { setRows([]); setFileName(''); setDone(false); setImported(0); setSyncDone(false); setImportedRows([]) }}
                className="px-5 py-2 text-sm font-bold rounded-xl bg-white border border-green-fresh-100 text-green-fresh-900 hover:bg-green-fresh-50 transition-colors">
                Import ไฟล์ใหม่
              </button>
              {/* ปุ่ม Re-sync: แสดงเฉพาะเมื่อมี importedRows (import สำเร็จแล้ว) */}
              {importedRows.length > 0 && (
                <button onClick={handleResync} disabled={syncing}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold rounded-xl bg-white border border-purple-100 text-purple-700 hover:bg-purple-50 transition-colors disabled:opacity-50">
                  <RefreshCw size={13} strokeWidth={1} absoluteStrokeWidth className={syncing ? 'animate-spin' : ''} />
                  Sync ไป Sheets อีกครั้ง
                </button>
              )}
            </div>
          </div>
        )}
        {/* ── Find Extra REQ-2026 Closed ─────────────────────────────────────
         * Diagnostic: หา record ที่อยู่ใน Firestore แต่ไม่อยู่ใน CSV (extra +1)
         * โหลด CSV ก่อนเพื่อเทียบ — หรือถ้าไม่มี CSV จะแสดง REQ-2026 Closed ทั้งหมด
         */}
        <div className="mt-6 p-4 rounded-2xl border border-neutral-100 bg-neutral-50">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <p className="text-sm font-bold text-neutral-700">ค้นหา REQ-2026 Closed ที่ไม่อยู่ใน CSV</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {rows.length > 0
                  ? `โหลด CSV แล้ว (${rows.filter(r => r.hcId?.startsWith('REQ-2026-') && r.status === 'Closed').length} REQ-2026 Closed ใน CSV) — กดเพื่อเทียบกับ Firestore`
                  : 'ยังไม่โหลด CSV — กดเพื่อดึง REQ-2026 Closed ทั้งหมดจาก Firestore'}
              </p>
            </div>
            <button
              onClick={handleFindExtra}
              disabled={findingExtra}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-neutral-600 text-white hover:bg-neutral-700 transition-colors disabled:opacity-60 shrink-0"
            >
              {findingExtra ? <><Loader2 size={12} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> กำลังค้นหา...</> : 'ค้นหา'}
            </button>
          </div>

          {extraResult && !extraResult.error && (
            <div className="mt-2 space-y-3">
              {/* Summary */}
              <div className="flex gap-3 text-xs font-bold">
                <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-900">
                  Firestore: {extraResult.firestoreIds.length} REQ-2026 Closed
                </span>
                {rows.length > 0 && (
                  <span className="px-2 py-1 rounded-lg bg-neutral-100 text-neutral-600">
                    CSV: {extraResult.csvIds.size} REQ-2026 Closed
                  </span>
                )}
                <span className={`px-2 py-1 rounded-lg font-bold ${extraResult.extra.length > 0 ? 'bg-red-50 text-red-700' : 'bg-green-fresh-50 text-green-fresh-900'}`}>
                  Extra: {extraResult.extra.length} records
                </span>
              </div>

              {/* CSV records NOT in Firestore */}
              {rows.length > 0 && (() => {
                const firestoreSet = new Set(extraResult.firestoreIds.map(r => r.hcId))
                const missingInFirestore = rows.filter(r =>
                  r.hcId?.startsWith('REQ-2026-') && r.status === 'Closed' && !firestoreSet.has(r.hcId)
                )
                if (!missingInFirestore.length) return null
                return (
                  <div className="rounded-xl border border-orange-100 overflow-hidden">
                    <p className="px-3 py-2 text-xs font-bold text-orange-900 bg-orange-50">
                      อยู่ใน CSV แต่ยังไม่อยู่ใน Firestore ({missingInFirestore.length} records) — ยังไม่ได้ import!
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-orange-50">
                          <tr>
                            {['HCID','ตำแหน่ง','แผนก','Candidate','Onboard Date'].map(h => (
                              <th key={h} className="px-3 py-1.5 text-left font-bold text-orange-700 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-orange-100">
                          {missingInFirestore.map(r => (
                            <tr key={r.hcId} className="bg-white">
                              <td className="px-3 py-2 font-bold text-orange-900 whitespace-nowrap">{r.hcId}</td>
                              <td className="px-3 py-2 text-neutral-800 max-w-[180px] truncate">{r.position}</td>
                              <td className="px-3 py-2 text-neutral-600">{r.department}</td>
                              <td className="px-3 py-2 text-neutral-600 max-w-[140px] truncate">{r.candidateName}</td>
                              <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{r.startDate}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Extra records list */}
              {extraResult.extra.length > 0 && (
                <div className="rounded-xl border border-red-100 overflow-hidden">
                  <p className="px-3 py-2 text-xs font-bold text-red-700 bg-red-50">
                    อยู่ใน Firestore แต่ไม่อยู่ใน CSV ({extraResult.extra.length} records)
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-red-50">
                        <tr>
                          {['HCID','ตำแหน่ง','แผนก','Candidate','Onboard Date','Created'].map(h => (
                            <th key={h} className="px-3 py-1.5 text-left font-bold text-red-700 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-100">
                        {extraResult.extra.map(r => (
                          <tr key={r.hcId} className="bg-white">
                            <td className="px-3 py-2 font-bold text-red-700 whitespace-nowrap">{r.hcId}</td>
                            <td className="px-3 py-2 text-neutral-800 max-w-[180px] truncate">{r.position}</td>
                            <td className="px-3 py-2 text-neutral-600">{r.department}</td>
                            <td className="px-3 py-2 text-neutral-600 max-w-[140px] truncate">{r.candidateName}</td>
                            <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{r.startDate}</td>
                            <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{r.createdAt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── REQ-2025 Crossover Section ──────────────────────────── */}
              {extraResult.firestore2025cross && (
                <div className="mt-1 space-y-2">
                  <div className="flex gap-3 text-xs font-bold">
                    <span className="px-2 py-1 rounded-lg bg-purple-50 text-purple-900">
                      Firestore REQ-2025 crossover (closedAt 2026): {extraResult.firestore2025cross.length}
                    </span>
                    {rows.length > 0 && (
                      <span className="px-2 py-1 rounded-lg bg-neutral-100 text-neutral-600">
                        CSV REQ-2025 crossover: {extraResult.csvSet2025cross.size}
                      </span>
                    )}
                    {rows.length > 0 && (
                      <span className={`px-2 py-1 rounded-lg font-bold ${extraResult.extra2025.length > 0 ? 'bg-red-50 text-red-700' : 'bg-green-fresh-50 text-green-fresh-900'}`}>
                        Extra crossover: {extraResult.extra2025.length}
                      </span>
                    )}
                  </div>

                  {/* REQ-2025 ที่ Firestore นับว่า crossover แต่ CSV ไม่นับ */}
                  {extraResult.extra2025.length > 0 && (
                    <div className="rounded-xl border border-purple-100 overflow-hidden">
                      <p className="px-3 py-2 text-xs font-bold text-purple-700 bg-purple-50">
                        REQ-2025 ที่ Firestore closedAt ปี 2026 แต่ CSV Onboard Date ไม่ตรง ({extraResult.extra2025.length} records)
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-purple-50">
                            <tr>
                              {['HCID','ตำแหน่ง','แผนก','Candidate','startDate (Firestore)','closedAt (Firestore)','CSV startDate'].map(h => (
                                <th key={h} className="px-3 py-1.5 text-left font-bold text-purple-700 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-purple-100">
                            {extraResult.extra2025.map(r => {
                              const csvRow = rows.find(cr => cr.hcId === r.hcId)
                              return (
                                <tr key={r.hcId} className="bg-white">
                                  <td className="px-3 py-2 font-bold text-purple-700 whitespace-nowrap">{r.hcId}</td>
                                  <td className="px-3 py-2 text-neutral-800 max-w-[160px] truncate">{r.position}</td>
                                  <td className="px-3 py-2 text-neutral-600">{r.department}</td>
                                  <td className="px-3 py-2 text-neutral-600 max-w-[140px] truncate">{r.candidateName}</td>
                                  <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{r.startDate}</td>
                                  <td className="px-3 py-2 font-bold text-purple-700 whitespace-nowrap">{r.closedAtStr}</td>
                                  <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{csvRow?.startDate ?? '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* All REQ-2025 crossover in Firestore (collapsed) */}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-neutral-500 font-bold hover:text-neutral-700">
                      ดู REQ-2025 crossover ทั้งหมดใน Firestore ({extraResult.firestore2025cross.length} records)
                    </summary>
                    <div className="mt-2 rounded-xl border border-neutral-100 overflow-hidden">
                      <div className="overflow-x-auto max-h-64">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-neutral-100">
                            <tr>
                              {['HCID','ตำแหน่ง','Candidate','startDate (Firestore)','closedAt (Firestore)','CSV startDate'].map(h => (
                                <th key={h} className="px-3 py-1.5 text-left font-bold text-neutral-500 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100">
                            {extraResult.firestore2025cross.map(r => {
                              const csvRow = rows.find(cr => cr.hcId === r.hcId)
                              const isExtra = rows.length > 0 && !extraResult.csvSet2025cross.has(r.hcId)
                              return (
                                <tr key={r.hcId} className={isExtra ? 'bg-purple-50' : ''}>
                                  <td className={`px-3 py-1.5 font-bold whitespace-nowrap ${isExtra ? 'text-purple-700' : 'text-neutral-700'}`}>{r.hcId}</td>
                                  <td className="px-3 py-1.5 text-neutral-600 max-w-[160px] truncate">{r.position}</td>
                                  <td className="px-3 py-1.5 text-neutral-500 max-w-[130px] truncate">{r.candidateName}</td>
                                  <td className="px-3 py-1.5 text-neutral-500 whitespace-nowrap">{r.startDate}</td>
                                  <td className="px-3 py-1.5 text-purple-700 whitespace-nowrap">{r.closedAtStr}</td>
                                  <td className="px-3 py-1.5 text-neutral-400 whitespace-nowrap">{csvRow?.startDate ?? '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {/* All Firestore REQ-2026 list (collapsed) */}
              <details className="text-xs">
                <summary className="cursor-pointer text-neutral-500 font-bold hover:text-neutral-700">
                  ดู REQ-2026 Closed ทั้งหมดใน Firestore ({extraResult.firestoreIds.length} records)
                </summary>
                <div className="mt-2 rounded-xl border border-neutral-100 overflow-hidden">
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-neutral-100">
                        <tr>
                          {['HCID','ตำแหน่ง','แผนก','Candidate','Onboard Date'].map(h => (
                            <th key={h} className="px-3 py-1.5 text-left font-bold text-neutral-500 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {extraResult.firestoreIds.map(r => (
                          <tr key={r.hcId} className={`${rows.length > 0 && !extraResult.csvIds.has(r.hcId) ? 'bg-red-50' : ''}`}>
                            <td className={`px-3 py-1.5 font-bold whitespace-nowrap ${rows.length > 0 && !extraResult.csvIds.has(r.hcId) ? 'text-red-700' : 'text-neutral-700'}`}>{r.hcId}</td>
                            <td className="px-3 py-1.5 text-neutral-600 max-w-[180px] truncate">{r.position}</td>
                            <td className="px-3 py-2 text-neutral-500">{r.department}</td>
                            <td className="px-3 py-2 text-neutral-500 max-w-[140px] truncate">{r.candidateName}</td>
                            <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{r.startDate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </div>
          )}

          {extraResult?.error && (
            <p className="text-xs font-bold text-red-700 mt-2">⚠ Error: {extraResult.error}</p>
          )}
        </div>

      </div>
    </Layout>
  )
}
