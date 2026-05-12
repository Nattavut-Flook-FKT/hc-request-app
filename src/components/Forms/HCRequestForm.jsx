/**
 * HCRequestForm.jsx — Headcount Request Submission Form
 * ─────────────────────────────────────────────────────────────────────────────
 * ฟอร์มสำหรับให้ Manager ยื่นคำขออัตรากำลัง (HC Request) เข้าระบบ
 * รองรับทั้งประเภท "New HC" (เพิ่มอัตราใหม่) และ "Replacement" (ทดแทนพนักงานที่ลาออก)
 *
 * Props / Key Features:
 *   - user         — Firebase Auth user object (displayName, email, photoURL)
 *   - role         — บทบาทของผู้ใช้ ('manager' | 'admin') ใช้ตัดสินใจแสดง badge "Auto Filled"
 *   - maintenanceMode — ถ้า true ระบบจะส่ง flag ไปกับ webhook เพื่อระงับการแจ้งเตือน
 *
 *   - โครงสร้าง org แบบ cascading: Division → Department → Section → Business Unit
 *   - ดึงรายการ Positions จาก Google Sheets (GAS) ผ่าน fetchSheetsData()
 *   - ดึง Custom Positions ที่เพิ่มโดยผู้ใช้จาก Firestore collection 'custom_positions'
 *   - ตรวจสอบและแสดง JD ที่มีอยู่แล้วใน Sidebar (ดึง signed URL จาก Supabase)
 *   - อัพโหลดไฟล์ JD ใหม่ไปยัง Supabase Storage (folder = docRef.id)
 *   - บันทึก HC Request ลง Firestore collection 'hc_requests' ด้วย addDoc()
 *   - เรียก sendToWebhook() เพื่อแจ้งเตือน Slack / LINE / GAS
 *   - เรียก logAudit() เพื่อบันทึก audit trail ทุกครั้งที่ submit
 *
 * Notes:
 *   - ตำแหน่งที่พิมพ์เองและไม่มีใน Sheets จะถูกบันทึกลง 'custom_positions' อัตโนมัติ
 *   - JG levels แตกต่างกันระหว่าง HQ และ OPERATION track
 *   - หลัง submit สำเร็จ ฟอร์มจะ reset แต่คง division/department/section ไว้เพื่อความสะดวก
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { collection, addDoc, updateDoc, doc, serverTimestamp, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { sendToWebhook, getMaxHCIDFromSheets } from '../../services/webhook'
import { logAudit } from '../../services/auditLog'
import { uploadJDFile, getJDSignedUrl } from '../../services/supabase'
import { Loader2, CheckCircle, ChevronDown, X, Paperclip, FileText, ExternalLink } from 'lucide-react'
import { HQ_JG_LEVELS, OPERATION_JG_LEVELS } from '../../data/jobGrades'
import { fetchSheetsData, getDepartmentByEmail, getEmployeesByDepartment, getPositionsByDepartment } from '../../services/sheetsData'
import { DIVISIONS, getDepartments, getSections, getBusinessUnits, getDivisionByDepartment } from '../../data/orgStructure'

// ─── ค่าเริ่มต้นของฟอร์ม ───────────────────────────────────────────────────
// ใช้เป็น template สำหรับ reset หลัง submit สำเร็จ
// (division/department/section จะถูก preserve แยกต่างหาก)
const INITIAL_FORM = {
  requestType:    'Replacement', // ประเภทคำขอ: 'Replacement' หรือ 'New HC'
  employmentType: 'Monthly',     // ประเภทการจ้าง: Monthly | Daily | Contract | Intern
  division: '',                  // สายงานหลัก (เลือกจาก DIVISIONS)
  department: '',                // แผนก (cascade จาก division)
  section: '',                   // หน่วยงานย่อย (cascade จาก department)
  businessUnit: '',              // Business Unit (cascade จาก section)
  position: '',                  // ตำแหน่งงาน (combobox + free text)
  orgTrack: '',                  // Location track: 'HQ' หรือ 'OPERATION'
  jg: '',                        // Job Grade (ขึ้นกับ orgTrack)
  headcount: 1,                  // จำนวน HC ที่ต้องการ (ใช้เฉพาะ New HC)
  requirements: '',              // คุณสมบัติที่ต้องการ (optional free text)
  reason: '',                    // เหตุผลในการขอ (required)
  targetStartDate: '',           // New HC: วันที่ต้องการเริ่มงาน | Replacement: Last Working Day
  replacementFor: '',            // ชื่อพนักงานที่ต้องการทดแทน (เฉพาะ Replacement)
}

// ─── รายชื่อ Department fallback ──────────────────────────────────────────────
// ใช้เป็น default ก่อนที่ fetchSheetsData() จะดึงข้อมูลจริงมาแทน
const DEPARTMENTS = [
  'Commercial Excellence',
  'Corporate Lawyer',
  'Customer Success',
  'Data Team',
  'Distribution Center',
  'Finance & Accounting',
  'Innovation',
  'Key Account Management',
  'Logistic',
  'Marketing',
  'Merchandising',
  'Operations Support',
  'People Experience',
  'Portfolio Management',
  'Procurement',
  'Product',
  'Sales Management',
  'Software Development',
  'Strategic Finance',
  'Strategy',
  'Supply Chain & Operation Strategy',
  'Supply Chain as a Service',
]

// ─── กฎการกำหนด Location Track ตามชื่อแผนก ───────────────────────────────────
// OPERATION: Distribution Center เท่านั้น (ล็อคไม่ให้เลือก HQ)
// HQ: ทุกแผนกที่เหลือ (ล็อคเป็น HQ อัตโนมัติ)
// HYBRID: ยังไม่มีแผนกที่รองรับในขณะนี้ (array ว่าง)
const OPERATION_ONLY_DEPARTMENT_PREFIXES = ['Distribution Center']
const HYBRID_DEPARTMENT_PREFIXES = [] // ไม่มี hybrid แล้ว

/**
 * matchesDepartmentPrefix — ตรวจว่าชื่อแผนกขึ้นต้นด้วย prefix ใดใน array หรือไม่
 * ใช้ startsWith เพื่อรองรับแผนกย่อย เช่น "Distribution Center - Bangkok"
 */
function matchesDepartmentPrefix(department, prefixes) {
  return prefixes.some((prefix) => department.startsWith(prefix))
}

/**
 * getTrackConfigByDepartment — คืนค่า config ของ Location track ตามแผนกที่เลือก
 * @returns {{ options: string[], defaultTrack: string, locked: boolean }}
 *   - options: รายการ track ที่เลือกได้
 *   - defaultTrack: track ที่ถูกเลือกอัตโนมัติ ('' = ต้องเลือกเอง)
 *   - locked: true = แสดงเป็น readonly input, false = แสดง dropdown
 */
function getTrackConfigByDepartment(department) {
  if (!department) {
    // ยังไม่ได้เลือกแผนก → ล็อคและไม่มี default
    return { options: [], defaultTrack: '', locked: true }
  }

  if (matchesDepartmentPrefix(department, OPERATION_ONLY_DEPARTMENT_PREFIXES)) {
    // Distribution Center → บังคับ OPERATION เสมอ
    return { options: ['OPERATION'], defaultTrack: 'OPERATION', locked: true }
  }

  if (matchesDepartmentPrefix(department, HYBRID_DEPARTMENT_PREFIXES)) {
    // แผนก Hybrid → ให้เลือกเองระหว่าง HQ หรือ OPERATION
    return { options: ['HQ', 'OPERATION'], defaultTrack: '', locked: false }
  }

  // แผนกอื่นทั้งหมด → บังคับ HQ เสมอ
  return { options: ['HQ'], defaultTrack: 'HQ', locked: true }
}

/**
 * normalizeText — แปลงข้อความเป็น lowercase และตัด whitespace
 * ใช้เปรียบเทียบชื่อตำแหน่งโดยไม่สนใจ case และช่องว่าง
 */
function normalizeText(value) {
  return (value || '').trim().toLowerCase()
}

/**
 * getTimestampMs — แปลง Firestore Timestamp หรือ Date object เป็น milliseconds
 * ใช้สำหรับเรียงลำดับเอกสารตามเวลา (sort by createdAt)
 * คืน 0 ถ้า value เป็น null หรือไม่มี toDate method
 */
function getTimestampMs(ts) {
  return ts?.toDate?.()?.getTime?.() ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * PositionCombobox — Dropdown ที่พิมพ์ค้นหาได้ (Searchable Select)
 *
 * รวม dropdown list กับ free-text input เข้าด้วยกัน:
 * - เลือกจากรายการ positions ที่มีอยู่ → ค่าที่เลือกถูกส่งไปยัง onChange
 * - พิมพ์ชื่อที่ไม่มีในรายการ → ระบบยอมรับและจะบันทึกเป็น custom_position
 *   ใน Firestore โดยอัตโนมัติเมื่อ submit ฟอร์ม
 *
 * Props:
 *   - value: ค่าปัจจุบันของตำแหน่ง (controlled)
 *   - onChange: callback เมื่อเลือกหรือพิมพ์ชื่อตำแหน่ง
 *   - positions: รายการตำแหน่งทั้งหมดที่แสดงใน dropdown
 *   - required: ส่งต่อไปยัง HTML input
 */
function PositionCombobox({ value, onChange, positions, required }) {
  const [open, setOpen] = useState(false)           // สถานะการแสดง dropdown list
  const [searchText, setSearchText] = useState('')  // ข้อความที่พิมพ์สำหรับกรอง (ไม่ใช่ value จริง)
  const [isFocused, setIsFocused] = useState(false) // ถ้า focus อยู่ → แสดง searchText แทน value
  const ref = useRef(null)      // ref ของ container ทั้งหมด สำหรับตรวจ click outside
  const inputRef = useRef(null) // ref ของ input element

  // ปิด dropdown เมื่อ click นอก component
  useEffect(() => {
    function handleClick(e) {
      if (!ref.current?.contains(e.target)) {
        setOpen(false)
        setIsFocused(false)
        setSearchText('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // กรอง positions ด้วย searchText เมื่อพิมพ์ ถ้าไม่ได้พิมพ์ → แสดงทั้งหมด
  const filtered = searchText
    ? positions.filter((p) => p.toLowerCase().includes(searchText.toLowerCase()))
    : positions

  /** เลือกตำแหน่งจาก dropdown list */
  function select(p) {
    onChange(p)
    setSearchText('')
    setOpen(false)
    setIsFocused(false)
  }

  /** เมื่อ input ได้รับ focus → เปิด dropdown และล้าง searchText */
  function handleFocus() {
    setIsFocused(true)
    setSearchText('')
    setOpen(true)
  }

  /**
   * เมื่อพิมพ์ใน input:
   * - อัพเดต searchText เพื่อกรอง dropdown
   * - เรียก onChange ด้วยค่าที่พิมพ์โดยตรง (รองรับ free-text custom position)
   */
  function handleInput(e) {
    setSearchText(e.target.value)
    onChange(e.target.value) // ให้พิมพ์ใหม่ได้
    setOpen(true)
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        {/*
         * input แสดง searchText เมื่อ focus (เพื่อพิมพ์กรอง)
         * แสดง value จริงเมื่อไม่ได้ focus (เพื่อแสดงค่าที่เลือก)
         */}
        <input
          ref={inputRef}
          type="text"
          value={isFocused ? searchText : value}
          onChange={handleInput}
          onFocus={handleFocus}
          required={required}
          placeholder={value || 'เลือกหรือพิมพ์ตำแหน่ง...'}
          className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-medium"
        />
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-600 pointer-events-none" />
      </div>
      {open && (
        <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xl max-h-52 overflow-y-auto ring-1 ring-black/5 transition-all">
          {filtered.length > 0 ? (
            filtered.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => select(p)}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors font-medium ${
                  p === value ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-bold' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {p}
              </button>
            ))
          ) : (
            // ไม่พบตำแหน่งในรายการ → แจ้งว่าจะถูกบันทึกเป็นตำแหน่งใหม่
            <div className="px-4 py-3 text-sm text-gray-400 dark:text-slate-600 italic">
              ไม่พบ — จะใช้ "{searchText}" เป็นตำแหน่งใหม่
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * HCRequestForm — Main component ฟอร์มยื่นคำขออัตรากำลัง
 *
 * Props:
 *   - user           — Firebase Auth user object
 *   - role           — 'manager' | 'admin'
 *   - maintenanceMode — boolean: ถ้า true จะส่ง flag maintenance ไปกับ webhook
 */
export default function HCRequestForm({ user, role, maintenanceMode = false }) {
  // ─── Refs ──────────────────────────────────────────────────────────────────
  const feedbackTopRef = useRef(null) // ใช้ scroll ไปหา success/error banner หลัง submit

  // ─── Form State ────────────────────────────────────────────────────────────
  const [form, setForm] = useState(INITIAL_FORM)          // ข้อมูลทุก field ในฟอร์ม
  const [loading, setLoading] = useState(false)           // กำลัง submit อยู่ (disable ปุ่ม)
  const [success, setSuccess] = useState(false)           // submit สำเร็จ → แสดง banner เขียว
  const [error, setError] = useState('')                  // ข้อความ error (ถ้ามี)

  // ─── Data State (ดึงจาก Sheets + Firestore) ────────────────────────────────
  const [positionsByDept, setPositionsByDept] = useState({})  // map: department → string[] positions (จาก GAS Sheets)
  const [employees, setEmployees] = useState({})              // map: department → string[] employee names (จาก GAS Sheets)
  const [deptAutoFilled, setDeptAutoFilled] = useState(false) // true ถ้า department ถูก auto-fill จาก email ของ user
  const [allDepts, setAllDepts] = useState(DEPARTMENTS)       // รายชื่อแผนกทั้งหมด (อัพเดตจาก Sheets)
  const [customPositions, setCustomPositions] = useState([])  // ตำแหน่งที่เพิ่มเองจาก Firestore 'custom_positions'

  // ─── JD File Upload State ──────────────────────────────────────────────────
  const [jdFile, setJdFile] = useState(null)            // ไฟล์ JD ที่ user เลือก (File object)
  const [uploadProgress, setUploadProgress] = useState('') // ข้อความแสดงสถานะการ upload

  // ─── JD Sidebar / Preview State ───────────────────────────────────────────
  const [existingJD, setExistingJD] = useState(null)    // ข้อมูล request ที่มี JD อยู่แล้วสำหรับตำแหน่งเดียวกัน
  const [checkingJD, setCheckingJD] = useState(false)   // กำลังค้นหา existing JD อยู่
  const [openingJD, setOpeningJD] = useState(false)     // กำลังดึง signed URL จาก Supabase
  const [previewUrl, setPreviewUrl] = useState(null)    // Supabase signed URL สำหรับแสดงใน iframe sidebar

  // ─── Effect: โหลด Positions + Employees จาก Google Sheets ─────────────────
  // เรียกครั้งเดียวตอน mount พร้อม auto-fill department จาก email ของ user
  // fetchSheetsData() ดึงข้อมูลจาก Google Apps Script endpoint
  useEffect(() => {
    fetchSheetsData()
      .then(({ managers, positions: pos, employees: emp }) => {
        // อัพเดต positions map (department → string[]) จาก Sheets
        if (pos && typeof pos === 'object') {
          setPositionsByDept(pos)
          setAllDepts(Object.keys(pos).sort())
        }
        // อัพเดต employees map สำหรับ Replacement dropdown
        if (emp) setEmployees(emp)

        // ค้นหาแผนกของ user จาก managers list แล้ว auto-fill
        const dept = getDepartmentByEmail(managers, user.email)
        if (dept) {
          const cfg = getTrackConfigByDepartment(dept)
          const div = getDivisionByDepartment(dept)   // หา division จาก department
          setForm((prev) => ({ ...prev, department: dept, division: div, orgTrack: cfg.defaultTrack }))
          setDeptAutoFilled(true)
        }
      })
      .catch((err) => console.error('fetchSheetsData error:', err))
  }, [user.email])

  // ─── Effect: โหลด Custom Positions จาก Firestore ──────────────────────────
  // ดึง custom_positions ที่สร้างไว้ก่อนหน้าสำหรับแผนกที่เลือก
  // re-run ทุกครั้งที่ department เปลี่ยน
  useEffect(() => {
    if (!form.department) {
      setCustomPositions([])
      return
    }

    // cancelled flag ป้องกัน race condition (ถ้า department เปลี่ยนก่อน query เสร็จ)
    let cancelled = false
    async function loadCustomPositions() {
      try {
        // query Firestore: custom_positions WHERE department == form.department
        const q = query(collection(db, 'custom_positions'), where('department', '==', form.department))
        const snap = await getDocs(q)
        if (cancelled) return
        setCustomPositions(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      } catch (e) {
        console.error('Error loading custom positions:', e)
      }
    }

    loadCustomPositions()
    return () => { cancelled = true } // cleanup: ยกเลิกถ้า department เปลี่ยนก่อน
  }, [form.department])

  // ─── Effect: ค้นหา Existing JD สำหรับ Sidebar ─────────────────────────────
  // เมื่อ position + department เปลี่ยน → ค้นหา request ที่มี jdFilePath
  // และตรงกับ department + orgTrack เดียวกัน แล้วแสดงใน JD Preview Sidebar
  // Debounce 400ms: ป้องกัน Firestore ยิงทุก keystroke ตอนพิมพ์ชื่อตำแหน่ง
  useEffect(() => {
    if (!form.position || !form.department) {
      setExistingJD(null)
      return
    }

    let cancelled = false

    // รอให้ user หยุดพิมพ์ 400ms ก่อน query Firestore
    const timer = setTimeout(async () => {
      setCheckingJD(true)
      try {
        // query hc_requests WHERE position == form.position
        // (filter department และ orgTrack ด้วย JS เพราะ Firestore ไม่รองรับ compound query แบบนี้)
        const q = query(
          collection(db, 'hc_requests'),
          where('position', '==', form.position),
          where('jdFilePath', '!=', ''),
          limit(20),
        )
        const snap = await getDocs(q)
        if (cancelled) return

        // กรองเฉพาะ doc ที่มี jdFilePath, department ตรง, orgTrack ตรง (หรือไม่มี orgTrack)
        // แล้วเรียงจากใหม่ไปเก่า → เลือกอันล่าสุด
        const matched = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r) =>
            r.jdFilePath &&
            r.department === form.department &&
            (!form.orgTrack || !r.orgTrack || r.orgTrack === form.orgTrack)
          )
          .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt))[0] ?? null

        setExistingJD(matched)
      } catch (e) {
        console.error('Error loading existing JD:', e)
        setExistingJD(null)
      } finally {
        if (!cancelled) setCheckingJD(false)
      }
    }, 400) // debounce 400ms

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [form.position, form.department, form.orgTrack])

  // ─── Effect: Scroll ไปหา Feedback Banner ─────────────────────────────────
  // เมื่อ success หรือ error เปลี่ยนค่า → scroll smooth ไปด้านบนของฟอร์ม
  useEffect(() => {
    if (!success && !error) return
    feedbackTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [success, error])

  // ─── handleOpenExistingJD ──────────────────────────────────────────────────
  // สร้าง Supabase signed URL (อายุ 1 ชั่วโมง) สำหรับแสดง PDF ใน iframe sidebar
  // เรียกเฉพาะเมื่อ user กดปุ่ม "เปิดดูไฟล์ JD"
  async function handleOpenExistingJD() {
    if (!existingJD?.jdFilePath) return
    setOpeningJD(true)
    try {
      const url = await getJDSignedUrl(existingJD.jdFilePath)
      if (url) setPreviewUrl(url)
    } finally {
      setOpeningJD(false)
    }
  }

  // ─── handleChange ──────────────────────────────────────────────────────────
  // Unified handler สำหรับ input/select ทุก field
  // Fields ที่มี cascade dependency จะ reset ค่า child fields อัตโนมัติ
  const handleChange = useCallback((e) => {
    const { name, value } = e.target
    if (name === 'division') {
      // เปลี่ยน division → reset department, section, businessUnit, orgTrack, jg ทั้งหมด
      setForm((prev) => ({ ...prev, division: value, department: '', section: '', businessUnit: '', orgTrack: '', jg: '' }))
      return
    }
    if (name === 'department') {
      // เปลี่ยน department → reset section, businessUnit, jg และคำนวณ orgTrack ใหม่
      const cfg = getTrackConfigByDepartment(value)
      setForm((prev) => ({ ...prev, department: value, section: '', businessUnit: '', orgTrack: cfg.defaultTrack, jg: '' }))
      return
    }
    if (name === 'section') {
      // เปลี่ยน section → reset businessUnit
      setForm((prev) => ({ ...prev, section: value, businessUnit: '' }))
      return
    }
    if (name === 'orgTrack') {
      // เปลี่ยน orgTrack (HQ/OPERATION) → reset jg เพราะ level list เปลี่ยน
      setForm((prev) => ({ ...prev, orgTrack: value, jg: '' }))
      return
    }
    // Field อื่นๆ → อัพเดตตรงๆ
    setForm((prev) => ({ ...prev, [name]: value }))
  }, [])

  // ─── generateHCID ─────────────────────────────────────────────────────────
  // สร้าง HCID ในรูปแบบ REQ-YYYY-NNN โดยอิง max HCID จาก Google Sheets เป็นหลัก
  // และเปรียบเทียบกับ max จาก Firestore hc_requests เพื่อป้องกันการซ้ำ
  async function generateHCID() {
    const currentYear = new Date().getFullYear()
    const prefix      = `REQ-${currentYear}-`

    // ── อ่าน max seq จาก Google Sheets (source of truth) ────────────────────
    // ถ้า Sheets ตอบกลับได้ → ใช้ค่าจาก Sheets อย่างเดียว
    // ไม่รวม Firestore เพื่อป้องกัน ghost doc ทำให้ HCID กระโดดข้ามเลข
    const sheetsMax = await getMaxHCIDFromSheets()
    if (sheetsMax > 0) {
      return `REQ-${currentYear}-${sheetsMax + 1}`
    }

    // ── Fallback: ใช้ Firestore เฉพาะเมื่อ GAS ไม่ตอบสนอง (sheetsMax = 0) ──
    let firestoreMax = 0
    try {
      const q = query(
        collection(db, 'hc_requests'),
        where('hcId', '>=', prefix),
        where('hcId', '<',  prefix + '\uf8ff'),
        orderBy('hcId', 'desc'),
        limit(1)
      )
      const snap = await getDocs(q)
      if (!snap.empty) {
        firestoreMax = parseInt(snap.docs[0].data().hcId.split('-')[2]) || 0
      }
    } catch (_) {}

    return `REQ-${currentYear}-${firestoreMax + 1}`
  }

  // ─── handleSubmit ──────────────────────────────────────────────────────────
  // ขั้นตอนการ submit ฟอร์ม:
  // 1. generateHCID → สร้าง HCID ในรูปแบบ REQ-YYYY-NNN (atomic counter)
  // 2. addDoc → สร้าง Firestore document ใน 'hc_requests' (ได้ docRef.id)
  // 3. (ถ้ามีไฟล์ JD) uploadJDFile → อัพโหลดไป Supabase ด้วย folder = docRef.id
  //    แล้ว updateDoc เพิ่ม jdFileUrl, jdFilePath, jdFileName ลงใน Firestore
  // 4. ตรวจสอบว่าตำแหน่งเป็น custom position หรือไม่ → addDoc ใน 'custom_positions' ถ้าใช่
  // 5. sendToWebhook → แจ้งเตือน Slack / LINE / GAS Sheet
  // 6. logAudit → บันทึก audit trail (action='Submit', toStatus='Open')
  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // ── Step 1: สร้าง HCID ในรูปแบบ REQ-YYYY-NNN ─────────────────────────────
      // ต้องทำก่อน addDoc เพื่อให้ hcId พร้อมอยู่ใน payload ตั้งแต่ต้น
      const hcId = await generateHCID()

      // สร้าง payload จาก form state + metadata ของ user
      const payload = {
        ...form,
        headcount: Number(form.headcount),   // แปลงเป็น number (input คืน string)
        requesterName: user.displayName,
        requesterEmail: user.email.toLowerCase(),  // lowercase เพื่อ Firestore query ตรงกันเสมอ
        status: 'Open',                       // สถานะเริ่มต้นเสมอ
        hcId,                                 // HCID ที่ generate: REQ-YYYY-NNN
        createdAt: serverTimestamp(),          // ให้ Firestore ใส่ timestamp server
      }

      // ── Step 2: สร้าง Firestore document ──────────────────────────────────
      // ต้องสร้างก่อนเพื่อได้ docRef.id ใช้เป็น folder name ใน Supabase
      const docRef = await addDoc(collection(db, 'hc_requests'), payload)

      // ── Step 3: อัพโหลดไฟล์ JD (ถ้ามี) ───────────────────────────────────
      // uploadJDFile(file, docId) → อัพโหลดไป Supabase bucket ที่ path: jd/{docId}/{filename}
      // แล้ว updateDoc เพิ่ม jdFileUrl, jdFilePath, jdFileName กลับเข้า Firestore
      if (jdFile) {
        setUploadProgress('กำลังอัพโหลดไฟล์ JD...')
        const { url, path, error: uploadErr } = await uploadJDFile(jdFile, docRef.id)
        if (uploadErr) throw new Error('อัพโหลดไฟล์ไม่สำเร็จ: ' + uploadErr)
        await updateDoc(doc(db, 'hc_requests', docRef.id), {
          jdFileUrl:  url,   // public URL หรือ storage path
          jdFilePath: path,  // path ใน Supabase bucket (ใช้สร้าง signed URL ภายหลัง)
          jdFileName: jdFile.name,
        })
        setUploadProgress('')
      }

      // ── Step 4: บันทึก Custom Position (ถ้าไม่มีในรายการ) ─────────────────
      // ตรวจว่าตำแหน่งนี้มีใน Sheets หรือ Firestore custom_positions แล้วหรือยัง
      const normalizedPosition = normalizeText(payload.position)
      const knownFromSheet = getPositionsByDepartment(positionsByDept, payload.department)
        .some((p) => normalizeText(p) === normalizedPosition)
      const knownFromCustom = customPositions
        .some((p) => normalizeText(p.position) === normalizedPosition && (p.orgTrack || '') === (payload.orgTrack || ''))

      // ถ้าไม่มีที่ไหน → บันทึกลง 'custom_positions' เพื่อให้ request ถัดไปเลือกได้
      if (!knownFromSheet && !knownFromCustom && normalizedPosition) {
        const customDoc = {
          department: payload.department,
          orgTrack: payload.orgTrack || '',
          position: payload.position.trim(),
          normalizedPosition,       // lowercase ไว้ใช้ค้นหาแบบ case-insensitive
          createdBy: user.email,
          createdAt: serverTimestamp(),
        }
        await addDoc(collection(db, 'custom_positions'), customDoc)
        // อัพเดต local state ด้วยเพื่อแสดงใน dropdown ทันที
        setCustomPositions((prev) => [...prev, customDoc])
      }

      // ── Step 5: ส่ง Webhook notification ─────────────────────────────────
      // sendToWebhook ส่งไปยัง Google Apps Script ซึ่งจะ:
      //   - บันทึกลง Google Sheets
      //   - ส่ง LINE Notify / Slack notification ไปยัง TA team
      // maintenance: true → GAS จะ skip การส่งแจ้งเตือน
      await sendToWebhook({ ...payload, id: docRef.id, createdAt: new Date().toISOString(), maintenance: maintenanceMode })

      // ── Step 6: บันทึก Audit Log ──────────────────────────────────────────
      // logAudit บันทึกลง Firestore collection 'audit_logs' สำหรับ activity tracking
      logAudit({
        requestId:  docRef.id,
        action:     'Submit',
        by:         user.email,
        byName:     user.displayName,
        toStatus:   'Open',
        position:   payload.position,
        department: payload.department,
      })

      // ── Reset state หลัง submit สำเร็จ ────────────────────────────────────
      setSuccess(true)
      // คง division/department/section/orgTrack ไว้เพื่อสะดวกถ้าจะยื่นหลายคำขอต่อกัน
      setForm((prev) => ({ ...INITIAL_FORM, division: prev.division, department: prev.department, section: prev.section, orgTrack: prev.orgTrack }))
      setJdFile(null)        // ล้างไฟล์ JD ที่แนบมา
      setPreviewUrl(null)    // ปิด JD preview sidebar
      setTimeout(() => setSuccess(false), 4000) // ซ่อน success banner หลัง 4 วินาที
    } catch (err) {
      console.error('Submit error:', err)
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  // ─── Derived Values ────────────────────────────────────────────────────────
  // trackConfig: config ของ Location track ตาม department ที่เลือก
  const trackConfig = getTrackConfigByDepartment(form.department)

  // jgLevels: รายการ Job Grade ตาม orgTrack (HQ vs OPERATION มี level ต่างกัน)
  const jgLevels = form.orgTrack === 'OPERATION' ? OPERATION_JG_LEVELS : HQ_JG_LEVELS

  // positionOptions: รวม positions จาก Sheets + custom_positions ที่ตรงกับแผนก/track
  // sort alphabetically และ deduplicate ด้วย Set
  const positionOptions = useMemo(() => {
    // กรอง custom positions ให้ตรงกับ orgTrack ปัจจุบัน (ถ้ามี)
    const custom = customPositions
      .filter((p) => !p.orgTrack || !form.orgTrack || p.orgTrack === form.orgTrack)
      .map((p) => p.position)
    return [...new Set([
      ...getPositionsByDepartment(positionsByDept, form.department), // จาก Sheets
      ...custom,                                                       // จาก Firestore
    ])].sort((a, b) => a.localeCompare(b))
  }, [customPositions, positionsByDept, form.department, form.orgTrack])

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <>
    {/* Layout หลัก: Main Form (flex-1) + JD Preview Sidebar (fixed width) */}
    <div className="max-w-7xl mx-auto flex gap-5 items-start">
      {/* ── Main Form Card ── */}
      <div className="flex-1 min-w-0">
      <div ref={feedbackTopRef} className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-800 p-8 shadow-xl shadow-emerald-900/5 transition-all">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight mb-8">ยื่นคำขออัตรากำลัง (HC Request)</h2>

        {/* ── Success Banner: แสดง 4 วินาทีหลัง submit สำเร็จ ── */}
        {success && (
          <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-2xl px-5 py-4 mb-8 shadow-sm transition-all animate-in fade-in slide-in-from-top-4">
            <CheckCircle size={20} />
            <p className="font-bold">ยื่นคำขอสำเร็จแล้ว! ข้อมูลถูกส่งเข้าระบบเรียบร้อย</p>
          </div>
        )}

        {/* ── Error Banner: แสดงเมื่อ submit ล้มเหลว ── */}
        {error && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl px-5 py-4 mb-8 shadow-sm font-bold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* ── ประเภทคำขอ (Radio) ──────────────────────────────────────────
           * 'Replacement': ทดแทนพนักงานที่ลาออก → แสดงฟิลด์ replacementFor + lastWorkingDay
           * 'New HC': เพิ่มอัตราใหม่ → แสดงฟิลด์ headcount (จำนวน)
           */}
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">ประเภทคำขอ *</label>
            <div className="flex gap-6">
              {['Replacement', 'New HC'].map((type) => (
                <label key={type} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="radio"
                    name="requestType"
                    value={type}
                    checked={form.requestType === type}
                    onChange={handleChange}
                    className="w-4 h-4 accent-emerald-600 dark:accent-emerald-500 cursor-pointer"
                  />
                  <span className={`text-sm font-bold transition-colors ${form.requestType === type ? 'text-gray-900 dark:text-white' : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-slate-300'}`}>{type}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Emp. Type ──────────────────────────────────────────────────── */}
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">Emp. Type *</label>
            <div className="flex gap-5">
              {['Monthly', 'Daily', 'Contract', 'Intern'].map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="employmentType"
                    value={t}
                    checked={form.employmentType === t}
                    onChange={handleChange}
                    className="w-4 h-4 accent-emerald-600 dark:accent-emerald-500 cursor-pointer"
                  />
                  <span className={`text-sm font-bold transition-colors ${form.employmentType === t ? 'text-gray-900 dark:text-white' : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-slate-300'}`}>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Org Structure (Cascading Dropdowns) ─────────────────────────
           * ลำดับ: Division → Department → Section → Business Unit
           * แต่ละระดับ disabled จนกว่าจะเลือกระดับก่อนหน้า
           */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Division: ระดับสูงสุดขององค์กร */}
            <div>
              <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">Division *</label>
              <select
                name="division"
                value={form.division}
                onChange={handleChange}
                required
                className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
              >
                <option value="">เลือก Division</option>
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Department: cascade จาก Division, disabled ถ้ายังไม่ได้เลือก Division */}
            <div>
              <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">
                แผนก *
                {/* Badge "Auto Filled" แสดงเฉพาะ non-admin ที่มีการ auto-fill จาก email */}
                {deptAutoFilled && role !== 'admin' && (
                  <span className="ml-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 px-2 py-0.5 rounded-full text-[9px] uppercase font-black tracking-tighter">Auto Filled</span>
                )}
              </label>
              <select
                name="department"
                value={form.department}
                onChange={handleChange}
                required
                disabled={!form.division}
                className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{form.division ? 'เลือกแผนก' : 'เลือก Division ก่อน'}</option>
                {getDepartments(form.division).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Section + Business Unit: แสดงเฉพาะเมื่อมี sections สำหรับ division+department ที่เลือก */}
          {form.department && getSections(form.division, form.department).length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Section: cascade จาก Department */}
              <div>
                <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">Section</label>
                <select
                  name="section"
                  value={form.section}
                  onChange={handleChange}
                  className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
                >
                  <option value="">เลือก Section (ถ้ามี)</option>
                  {getSections(form.division, form.department).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Business Unit: cascade จาก Section, แสดงเฉพาะเมื่อมี BU สำหรับ section นั้น */}
              {form.section && getBusinessUnits(form.division, form.department, form.section).length > 0 && (
                <div>
                  <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">Business Unit</label>
                  <select
                    name="businessUnit"
                    value={form.businessUnit}
                    onChange={handleChange}
                    className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
                  >
                    <option value="">เลือก Business Unit (ถ้ามี)</option>
                    {getBusinessUnits(form.division, form.department, form.section).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* ── Position + Location + Job Grade ──────────────────────────────
           * ทั้งสามฟิลด์นี้มี dependency ต่อกัน:
           *   Position: combobox รวม Sheets + Firestore custom positions
           *   Location (orgTrack): กำหนดโดย department (ส่วนใหญ่ locked)
           *   Job Grade: dropdown ที่เปลี่ยน options ตาม orgTrack
           */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* ตำแหน่ง: ใช้ PositionCombobox เพื่อรองรับ free-text custom position */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1">ตำแหน่งที่ต้องการ *</label>
              <PositionCombobox
                value={form.position}
                onChange={(val) => setForm((prev) => ({ ...prev, position: val }))}
                positions={positionOptions}
                required
              />
              {form.department && positionOptions.length === 0 && (
                <p className="text-[10px] font-bold text-gray-400 ml-1 uppercase italic">กำลังโหลด...</p>
              )}
            </div>

            {/* Location (orgTrack): locked = readonly input, ไม่ locked = dropdown */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1">Location *</label>
              {trackConfig.locked ? (
                // แสดงเป็น readonly input เมื่อ track ถูกกำหนดอัตโนมัติจาก department
                <input
                  type="text"
                  value={trackConfig.defaultTrack || '—'}
                  readOnly
                  className="w-full border border-gray-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm bg-gray-50/50 dark:bg-slate-950/20 text-gray-500 dark:text-slate-400 cursor-not-allowed font-bold"
                />
              ) : (
                // แสดง dropdown เฉพาะแผนก hybrid (ยังไม่มีในปัจจุบัน)
                <select
                  name="orgTrack"
                  value={form.orgTrack}
                  onChange={handleChange}
                  required
                  className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
                >
                  <option value="">เลือก Location</option>
                  {trackConfig.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Job Grade: disabled จนกว่าจะเลือก orgTrack เพราะ options ต่างกัน */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1">Job Grade *</label>
              <select
                name="jg"
                value={form.jg}
                onChange={handleChange}
                required
                disabled={!form.orgTrack}
                className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{form.orgTrack ? 'เลือก JG' : 'เลือก Location ก่อน'}</option>
                {jgLevels.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── จำนวน HC: แสดงเฉพาะ New HC ──────────────────────────────────
           * Replacement ไม่ต้องใส่จำนวน เพราะทดแทน 1:1 เสมอ (headcount = 1 โดย default)
           */}
          {form.requestType === 'New HC' ? (
            <div>
              <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">จำนวนที่ต้องการ (HC) *</label>
              <input
                type="number"
                name="headcount"
                value={form.headcount}
                onChange={handleChange}
                min={1}
                required
                className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold tabular-nums"
              />
            </div>
          ) : null}

          {/* ── Replacement Fields: แสดงเฉพาะ Replacement ───────────────────
           * replacementFor: dropdown รายชื่อพนักงานปัจจุบันในแผนก (จาก Sheets)
           * targetStartDate: Last Working Day ของพนักงานที่ลาออก
           */}
          {form.requestType === 'Replacement' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">พนักงานที่ต้องการทดแทน *</label>
                <select
                  name="replacementFor"
                  value={form.replacementFor}
                  onChange={handleChange}
                  required
                  className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
                >
                  <option value="">เลือกพนักงาน</option>
                  {/* getEmployeesByDepartment กรองตาม department และ section */}
                  {getEmployeesByDepartment(employees, form.department, form.section).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {/* แจ้งเตือนถ้าไม่มีพนักงานในฐานข้อมูล Sheets */}
                {form.department && getEmployeesByDepartment(employees, form.department, form.section).length === 0 && (
                  <p className="text-[10px] font-bold text-amber-500 ml-1 mt-1.5 uppercase italic">ไม่พบพนักงานในฐานข้อมูล...</p>
                )}
              </div>
              <div>
                {/* ใช้ชื่อ field เดียวกัน (targetStartDate) แต่ label แตกต่างตาม requestType */}
                <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">วันลาออก (Last Working Day) *</label>
                <input
                  type="date"
                  name="targetStartDate"
                  value={form.targetStartDate}
                  onChange={handleChange}
                  required
                  className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
                />
              </div>
            </div>
          )}

          {/* ── เหตุผลในการขอ (Required) ──────────────────────────────────── */}
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">เหตุผลในการขอ *</label>
            <textarea
              name="reason"
              value={form.reason}
              onChange={handleChange}
              required
              rows={3}
              placeholder="อธิบายเหตุผลและความจำเป็นในการขออัตรากำลัง..."
              className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-medium resize-none shadow-sm"
            />
          </div>

          {/* ── คุณสมบัติที่ต้องการ (Optional) ───────────────────────────── */}
          <div>
            <label className="block text-sm uppercase font-black text-gray-400 dark:text-slate-500 tracking-wider ml-1 mb-2">Requirement (Optional)</label>
            <textarea
              name="requirements"
              value={form.requirements}
              onChange={handleChange}
              rows={4}
              placeholder={`เช่น\n- ประสบการณ์ 3+ ปี ในสายงานตรง\n- ทักษะการสื่อสารดีเยี่ยม\n- ตรงต่อเวลาและรับผิดชอบสูง`}
              className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-medium resize-none shadow-sm"
            />
          </div>

          {/* ── JD File Upload ──────────────────────────────────────────────
           * รองรับ: PDF, Word (.doc/.docx), รูปภาพ (PNG, JPG) ขนาดไม่เกิน 10MB
           * ไฟล์จะถูกอัพโหลดไปยัง Supabase Storage ที่ path: jd/{docRef.id}/{filename}
           * หลัง upload สำเร็จ: อัพเดต jdFileUrl + jdFilePath + jdFileName ลง Firestore
           */}
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest ml-1 mb-2">
              แนบไฟล์ JD (Optional)
            </label>
            {jdFile ? (
              // แสดง preview ของไฟล์ที่เลือก พร้อมปุ่ม X เพื่อลบออก
              <div className="flex items-center gap-3 border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 rounded-2xl px-4 py-3 shadow-md animate-in zoom-in-95">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 shrink-0">
                  <FileText size={20} strokeWidth={3} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 truncate">{jdFile.name}</p>
                  <p className="text-[10px] font-black text-emerald-600/60 uppercase">{(jdFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => setJdFile(null)}
                  className="p-2 text-emerald-400 hover:text-red-500 transition-all hover:rotate-90"
                >
                  <X size={18} strokeWidth={3} />
                </button>
              </div>
            ) : (
              // Drop zone สำหรับเลือกไฟล์ใหม่
              <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl px-8 py-8 cursor-pointer hover:border-emerald-500 dark:hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/5 transition-all group shadow-inner">
                <div className="w-12 h-12 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center text-gray-400 group-hover:bg-emerald-500 group-hover:text-white transition-all shadow-md">
                  <Paperclip size={20} strokeWidth={3} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-gray-600 dark:text-slate-400">คลิกเพื่ออัพโหลดไฟล์ JD</p>
                  <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mt-1">PDF, Word, Images (Up to 10MB)</p>
                </div>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
            {/* แสดง progress text ขณะกำลัง upload ไปยัง Supabase */}
            {uploadProgress && (
              <div className="flex items-center gap-2 mt-3 px-3 py-1.5 bg-emerald-500/10 text-emerald-600 rounded-lg text-xs font-black uppercase tracking-tighter animate-pulse">
                <Loader2 size={12} className="animate-spin" /> {uploadProgress}
              </div>
            )}
          </div>

          {/* ── Requester Info Card ─────────────────────────────────────────
           * แสดงชื่อและ email ของผู้ยื่น (ดึงจาก Firebase Auth user object)
           * ข้อมูลนี้จะถูกบันทึกเป็น requesterName + requesterEmail ใน Firestore
           */}
          <div className="bg-gray-50 dark:bg-slate-950/50 rounded-2xl border border-gray-100 dark:border-slate-800/50 px-5 py-4 flex items-center gap-4 transition-colors">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full ring-2 ring-emerald-500/20 shadow-md" referrerPolicy="no-referrer" />
            ) : (
              // Fallback avatar ใช้ตัวอักษรแรกของชื่อ
              <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white text-lg font-black shadow-md">{user.displayName?.[0]}</div>
            )}
            <div className="leading-tight">
              <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest">Requester</p>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200">{user.displayName} <span className="text-xs font-normal text-gray-400 mx-1">|</span> {user.email}</p>
            </div>
          </div>

          {/* ── Submit Button ── */}
          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-3 bg-[#008065] text-white text-base font-black py-4 rounded-2xl hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-emerald-500/20 active:scale-[0.98]"
          >
            {loading ? <Loader2 size={18} className="animate-spin" strokeWidth={3} /> : <FileText size={18} strokeWidth={3} />}
            {loading ? 'กำลังส่งข้อมูลเข้าระบบ...' : 'ยื่นคำขออัตรากำลัง'}
          </button>
        </form>
      </div>
      </div>{/* end flex-1 */}

      {/* ── JD Preview Sidebar ──────────────────────────────────────────────
       * แสดงเฉพาะบนหน้าจอ lg ขึ้นไป (hidden lg:flex)
       * แสดงเมื่อมี existingJD (request ที่มีไฟล์ JD อยู่แล้วสำหรับตำแหน่ง/แผนกเดียวกัน)
       * ผู้ใช้สามารถ:
       *   - กดดู PDF ใน iframe (ดึง signed URL จาก Supabase อายุ 1 ชั่วโมง)
       *   - เปิดในแท็บใหม่ผ่าน ExternalLink icon
       *   - อัพโหลด JD ใหม่ทับได้จากฟอร์มด้านซ้าย
       */}
      {existingJD && (
        <div className="hidden lg:flex w-[460px] shrink-0 flex-col sticky top-6 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="rounded-3xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 overflow-hidden shadow-sm flex flex-col">

            {/* Header row: ชื่อไฟล์ + ปุ่มเปิดในแท็บใหม่ + ปุ่ม toggle preview */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-200/60 dark:border-emerald-800/60">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  <FileText size={14} />
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-500">JD ที่มีในระบบ</p>
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate max-w-[280px]">{existingJD.jdFileName || 'ไฟล์ JD'}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* ปุ่มเปิดในแท็บใหม่: แสดงเฉพาะเมื่อมี previewUrl แล้ว */}
                {previewUrl && (
                  <a href={previewUrl} target="_blank" rel="noreferrer"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                    title="เปิดในแท็บใหม่"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
                {/* ปุ่ม toggle: ถ้า previewUrl มีอยู่ → ซ่อน (X), ถ้าไม่มี → เปิด (FileText) */}
                <button
                  type="button"
                  onClick={previewUrl ? () => setPreviewUrl(null) : handleOpenExistingJD}
                  disabled={openingJD}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
                  title={previewUrl ? 'ซ่อน PDF' : 'ดู PDF'}
                >
                  {openingJD ? <Loader2 size={13} className="animate-spin" /> : previewUrl ? <X size={13} /> : <FileText size={13} />}
                </button>
              </div>
            </div>

            {/* PDF Viewer: iframe แสดง PDF จาก Supabase signed URL
             * height คำนวณจาก viewport เพื่อให้พอดีหน้าจอโดยไม่ต้อง scroll
             * หรือแสดง placeholder พร้อมปุ่ม "เปิดดูไฟล์ JD" ถ้ายังไม่มี previewUrl
             */}
            {previewUrl ? (
              <iframe
                src={previewUrl}
                className="w-full border-0 bg-gray-100 dark:bg-slate-800"
                style={{ height: 'calc(100vh - 160px)', minHeight: '600px' }}
                title="JD Preview"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-8 px-5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-500">
                  <FileText size={22} />
                </div>
                <div className="text-center">
                  <p className="text-[11px] text-gray-400 dark:text-slate-500">
                    อัพโหลดเมื่อ {existingJD.createdAt?.toDate?.().toLocaleDateString('th-TH') || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenExistingJD}
                  disabled={openingJD}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-2xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-[#008065] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-60 shadow-sm"
                >
                  {openingJD ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                  เปิดดูไฟล์ JD
                </button>
                <p className="text-[10px] text-emerald-700/40 dark:text-emerald-500/40 text-center">
                  อัพโหลดใหม่ได้ในฟอร์มด้านซ้าย
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  )
}
