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
import { collection, addDoc, updateDoc, doc, serverTimestamp, getDocs, query, where, limit, getDoc } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { generateHCID } from '@/features/hc-request/hcId'
import { sendToWebhook, sendCeoApprovalRequest, reportClientError } from '@/libs/webhook'
import { logAudit } from '@/features/audit-log/auditLog'
import { uploadJDFile, getJDSignedUrl, validateJDFile } from '@/libs/supabase'
import { Loader2, CheckCircle, AlertTriangle, ChevronDown, X, Paperclip, FileText, ExternalLink } from 'lucide-react'
import { HQ_JG_LEVELS, OPERATION_JG_LEVELS } from '@/config/jobGrades'
import { fetchSheetsData, getDepartmentByEmail, getEmployeesByDepartment, getPositionsByDepartment } from '@/libs/sheetsData'
import { DIVISIONS, getDepartments, getSections, getBusinessUnits, getDivisionByDepartment } from '@/config/orgStructure'
import { grantedKeys } from '@/utils/grants'
import { toOrgDepts, toOrgSection } from '@/config/deptMapping'

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
  workDaysPerWeek: '',           // จำนวนวันทำงานต่อสัปดาห์ (TA-only, ไม่ส่ง Sheets)
  shift: '',                     // กะการทำงาน (TA-only, ไม่ส่ง Sheets)
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
          className="h-10 w-full rounded-lg border border-neutral-100 bg-white px-4 pr-10 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
        />
        <ChevronDown size={16} strokeWidth={1} absoluteStrokeWidth className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-neutral-100 bg-white shadow-md">
          {filtered.length > 0 ? (
            filtered.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => select(p)}
                className={`w-full rounded text-left px-3 py-2 text-sm transition-colors hover:bg-dark-green-50 ${
                  p === value ? 'bg-dark-green-50 text-dark-green-900' : 'text-neutral-900'
                }`}
              >
                {p}
              </button>
            ))
          ) : (
            // ไม่พบตำแหน่งในรายการ → แจ้งว่าจะถูกบันทึกเป็นตำแหน่งใหม่
            <div className="px-4 py-3 text-sm text-neutral-400">
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
  const [grantedDepts, setGrantedDepts] = useState([])         // แผนกที่ Admin grant ให้ manager คนนี้ (settings/deptManagers) — ถ้ามี จะจำกัด Division/แผนกที่เลือกได้
  const [grantedDivisions, setGrantedDivisions] = useState([]) // division ที่ Admin grant ทั้งสาย (settings/divisionManagers) — Head of Division เห็นทุกแผนกในนั้น
  const [grantedSections, setGrantedSections] = useState([])   // section ที่ grant มาแบบเจาะคลัง (เช่น grant 'Distribution Center-LKB' → 'LKB') — ว่าง = ไม่จำกัด
  // Beta: รายชื่อ email ที่ต้องผ่าน CEO approve ก่อน (settings/ceoApprovalBeta) — จำกัดเฉพาะกลุ่มทดสอบ
  // ไม่กระทบ Manager คนอื่น ที่ยังได้ status 'Open' ทันทีเหมือนเดิม
  const [ceoApprovalBetaEmails, setCeoApprovalBetaEmails] = useState([])
  const [allDepts, setAllDepts] = useState(DEPARTMENTS)       // รายชื่อแผนกทั้งหมด (อัพเดตจาก Sheets)
  const [customPositions, setCustomPositions] = useState([])  // ตำแหน่งที่เพิ่มเองจาก Firestore 'custom_positions'
  const [customDepts, setCustomDepts] = useState([])          // แผนกที่เพิ่มเองผ่านหน้า Custom Positions (ไม่อยู่ใน orgStructure.js)

  // ─── Preset State ─────────────────────────────────────────────────────────
  // บันทึก/โหลด template fields ที่ใช้บ่อยใน localStorage (per user)
  const PRESET_KEY    = `hc_presets_${user.email}`
  const PRESET_FIELDS = ['requestType','employmentType','division','department','section','businessUnit','orgTrack','jg','position','requirements']
  const [presets,       setPresets]       = useState(() => { try { return JSON.parse(localStorage.getItem(`hc_presets_${user.email}`) || '[]') } catch(_) { return [] } })
  const [showSaveInput, setShowSaveInput] = useState(false)   // แสดง input ตั้งชื่อ preset
  const [presetName,    setPresetName]    = useState('')       // ชื่อ preset ที่กำลังตั้ง
  const [presetMsg,     setPresetMsg]     = useState('')       // feedback "บันทึกแล้ว" / "โหลดแล้ว"

  function persistPresets(list) {
    setPresets(list)
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)) } catch(_) {}
  }
  function savePreset() {
    const name = presetName.trim()
    if (!name) return
    const fields = {}
    PRESET_FIELDS.forEach(k => { if (form[k] !== '' && form[k] !== undefined) fields[k] = form[k] })
    const entry = { id: Date.now().toString(), name, fields }
    persistPresets([...presets.filter(p => p.name !== name), entry])
    setPresetName(''); setShowSaveInput(false)
    setPresetMsg('บันทึก Preset แล้ว ✓'); setTimeout(() => setPresetMsg(''), 2000)
  }
  function loadPreset(preset) {
    setForm(prev => ({ ...prev, ...preset.fields }))
    setPresetMsg(`โหลด "${preset.name}" แล้ว ✓`); setTimeout(() => setPresetMsg(''), 2000)
  }
  function deletePreset(id) { persistPresets(presets.filter(p => p.id !== id)) }

  // ─── JD File Upload State ──────────────────────────────────────────────────
  const [jdFile, setJdFile] = useState(null)            // ไฟล์ JD ที่ user เลือก (File object)
  const [uploadProgress, setUploadProgress] = useState('') // ข้อความแสดงสถานะการ upload
  const [jdWarning, setJdWarning] = useState('')        // อัพโหลด JD ไม่สำเร็จ แต่คำขอบันทึก + เข้า Sheets แล้ว
  const [replacementCustomMode, setReplacementCustomMode] = useState(false) // true = พิมพ์ชื่อเอง
  const [shiftCustomMode, setShiftCustomMode] = useState(false) // true = เลือก "อื่นๆ" ในกะการทำงาน → กรอกเวลาเอง

  // ─── JD Sidebar / Preview State ───────────────────────────────────────────
  const [existingJD, setExistingJD] = useState(null)    // ข้อมูล request ที่มี JD อยู่แล้วสำหรับตำแหน่งเดียวกัน
  const [checkingJD, setCheckingJD] = useState(false)   // กำลังค้นหา existing JD อยู่
  const [openingJD, setOpeningJD] = useState(false)     // กำลังดึง signed URL จาก Supabase
  const [previewUrl, setPreviewUrl] = useState(null)    // Supabase signed URL สำหรับแสดงใน iframe sidebar

  // ─── Library JD State ─────────────────────────────────────────────────────
  const [libraryJD, setLibraryJD] = useState(null)      // JD จาก jd_library ที่ตรงกับตำแหน่งที่เลือก

  // ─── Effect: โหลด Positions + Employees จาก Google Sheets ─────────────────
  // เรียกครั้งเดียวตอน mount พร้อม auto-fill department จาก email ของ user
  // fetchSheetsData() ดึงข้อมูลจาก Google Apps Script endpoint
  useEffect(() => {
    Promise.all([
      fetchSheetsData(),
      getDoc(doc(db, 'settings', 'deptManagers')),
      getDoc(doc(db, 'settings', 'divisionManagers')),
      getDoc(doc(db, 'settings', 'ceoApprovalBeta')),
    ])
      .then(([{ managers, positions: pos, employees: emp }, deptManagersSnap, divisionManagersSnap, ceoApprovalBetaSnap]) => {
        // Beta group สำหรับ CEO approval gate — allow-list เดียว จัดการผ่าน Admin Tools
        setCeoApprovalBetaEmails(
          ceoApprovalBetaSnap.exists() ? (ceoApprovalBetaSnap.data().testEmails || []).map(e => e.toLowerCase().trim()) : []
        )
        // อัพเดต positions map (department → string[]) จาก Sheets
        if (pos && typeof pos === 'object') {
          setPositionsByDept(pos)
          setAllDepts(Object.keys(pos).sort())
        }
        // อัพเดต employees map สำหรับ Replacement dropdown
        if (emp) setEmployees(emp)

        // grantedKeys รองรับทั้งค่าเก่า (อีเมลเดี่ยว) และใหม่ (array — 1 แผนกหลาย Manager)
        // แผนกที่ Admin grant ให้ user คนนี้โดยตรง (settings/deptManagers ที่หน้า Users)
        const deptManagersMap = deptManagersSnap.exists() ? deptManagersSnap.data() : {}
        // grant เก็บชื่อแผนกตามที่พบใน hc_requests ซึ่งอาจเป็นชื่อแบบ Maindata (เช่น 'Distribution Center-LKB')
        // ที่ไม่มีใน orgStructure → ต้อง map กลับเป็นชื่อ Org Chart ก่อน ไม่งั้นหา division ไม่เจอ
        // แล้ว dropdown Division จะว่าง (มีแต่ option เปล่า) จนยื่นคำขอไม่ได้
        const rawGranted = grantedKeys(deptManagersMap, user.email)
        const granted = [...new Set(rawGranted.flatMap(toOrgDepts))]
        setGrantedDepts(granted)
        // grant ที่เจาะระดับคลัง → จำกัด Section ให้เหลือเฉพาะคลังที่ได้รับสิทธิ์
        setGrantedSections(rawGranted.map(toOrgSection).filter(Boolean))

        // Division ที่ Admin grant ทั้งสายให้ user คนนี้ (Head of Division — settings/divisionManagers)
        const divisionManagersMap = divisionManagersSnap.exists() ? divisionManagersSnap.data() : {}
        const grantedDivs = grantedKeys(divisionManagersMap, user.email)
        setGrantedDivisions(grantedDivs)

        // Auto-fill priority: แผนกที่ grant ตรงๆ ก่อน → ถ้าไม่มีแต่มี division grant ให้เติมแค่ division
        // (ปล่อยแผนกว่างไว้ให้เลือกเอง เพราะ Head of Division ดูแลหลายแผนก) → สุดท้าย fallback ไป Sheets
        const dept = granted[0] || getDepartmentByEmail(managers, user.email)
        if (dept) {
          const cfg = getTrackConfigByDepartment(dept)
          const div = getDivisionByDepartment(dept)   // หา division จาก department
          setForm((prev) => ({ ...prev, department: dept, division: div, orgTrack: cfg.defaultTrack }))
          setDeptAutoFilled(true)
        } else if (grantedDivs.length > 0) {
          setForm((prev) => ({ ...prev, division: grantedDivs[0] }))
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

  // ─── Effect: โหลดแผนกที่เพิ่มเองผ่านหน้า Custom Positions ─────────────────
  // แผนกใหม่ที่ไม่อยู่ใน orgStructure.js (เพิ่มผ่าน /custom-positions) ต้องโผล่ใน dropdown แผนกด้วย
  // re-run ทุกครั้งที่ division เปลี่ยน
  useEffect(() => {
    if (!form.division) {
      setCustomDepts([])
      return
    }

    let cancelled = false
    async function loadCustomDepts() {
      try {
        const q = query(collection(db, 'custom_positions'), where('division', '==', form.division))
        const snap = await getDocs(q)
        if (cancelled) return
        setCustomDepts([...new Set(snap.docs.map((d) => d.data().department).filter(Boolean))])
      } catch (e) {
        console.error('Error loading custom departments:', e)
      }
    }

    loadCustomDepts()
    return () => { cancelled = true }
  }, [form.division])

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

  // ─── Effect: ค้นหา Library JD จาก jd_library ─────────────────────────────
  // Debounce 400ms: query Firestore เมื่อ position เปลี่ยน
  useEffect(() => {
    if (!form.position?.trim()) {
      setLibraryJD(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const normalized = form.position.trim().toLowerCase()
        const q = query(
          collection(db, 'jd_library'),
          where('normalizedPosition', '==', normalized),
          limit(1),
        )
        const snap = await getDocs(q)
        if (cancelled) return
        setLibraryJD(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() })
      } catch (e) {
        console.error('Error loading library JD:', e)
        if (!cancelled) setLibraryJD(null)
      }
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [form.position])

  // ─── Effect: Scroll ไปหา Feedback Banner ─────────────────────────────────
  // เมื่อ success / error / jdWarning เปลี่ยนค่า → scroll smooth ไปด้านบนของฟอร์ม
  useEffect(() => {
    if (!success && !error && !jdWarning) return
    feedbackTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [success, error, jdWarning])

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

  // ─── handleJdFileSelect ────────────────────────────────────────────────────
  // Validate ไฟล์ JD ทันทีตอนเลือก (type + size) — fail fast เพื่อ UX ที่ดี
  // user แก้ไฟล์ได้ก่อนกด submit ไม่ต้องกรอกฟอร์มเสร็จแล้วมาเจอ error ทีหลัง
  // (ไม่ใช่กลไกกัน request กำพร้าแล้ว — Step 3 ใน handleSubmit กันเองในตัว)
  function handleJdFileSelect(e) {
    const file = e.target.files?.[0] ?? null
    if (!file) return
    const invalid = validateJDFile(file)
    if (invalid) {
      setError(invalid)
      e.target.value = '' // เคลียร์ input ให้เลือกไฟล์เดิมซ้ำได้หลังแก้
      return
    }
    setError('')
    setJdFile(file)
  }

  // ─── handleSubmit ──────────────────────────────────────────────────────────
  // ขั้นตอนการ submit ฟอร์ม:
  // 1. generateHCID → สร้าง HCID ในรูปแบบ REQ-YYYY-NNN (atomic counter)
  // 2. addDoc → สร้าง Firestore document ใน 'hc_requests' (ได้ docRef.id)
  // 3. (ถ้ามีไฟล์ JD) uploadJDFile → อัพโหลดไป Supabase ด้วย folder = docRef.id
  //    แล้ว updateDoc เพิ่ม jdFileUrl, jdFilePath, jdFileName ลงใน Firestore
  //    ★ ขั้นนี้ล้มเหลวได้โดยไม่ล้มทั้ง submit → ไปต่อ Step 4-6 พร้อมตั้ง jdWarning
  // 4. ตรวจสอบว่าตำแหน่งเป็น custom position หรือไม่ → addDoc ใน 'custom_positions' ถ้าใช่
  // 5. sendToWebhook → แจ้งเตือน Slack / LINE / GAS Sheet
  // 6. logAudit → บันทึก audit trail (action='Submit', toStatus='Open')
  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setJdWarning('')

    // hcId อยู่นอก try เพื่อให้ catch ส่งเข้า reportClientError ได้ — ใช้ตามหา doc กำพร้าใน Firestore
    let hcId = null

    try {
      // ── Step 1: สร้าง HCID ในรูปแบบ REQ-YYYY-NNN ─────────────────────────────
      // ต้องทำก่อน addDoc เพื่อให้ hcId พร้อมอยู่ใน payload ตั้งแต่ต้น
      hcId = await generateHCID()

      // Beta: New HC ที่ยื่นโดยใครก็ตามในกลุ่มทดสอบ ต้องรอ CEO approve ก่อน — ไม่ยกเว้น role
      // (แม้ admin ยื่นเอง ถ้า email อยู่ใน allow-list ก็ต้องผ่านการอนุมัติเหมือนกัน)
      // Replacement ไม่เข้าเงื่อนไขนี้เลย ไม่ว่าใครยื่น
      // คนอื่นที่ไม่อยู่ใน allow-list ได้ status 'Open' ทันทีเหมือนเดิมทุกอย่าง
      //
      // [ปิดชั่วคราว] CEO Approval flow ถูกปิด — ทุก request เด้งเข้า TA ทันที (status Open)
      // เปิดกลับ: ลบ 2 บรรทัดล่าง แล้ว uncomment บล็อกที่ comment ไว้ด้านล่าง
      // ponytail: kill-switch บรรทัดเดียว โค้ด approve ที่เหลือ (หน้า /approve, GAS, rules) นอนเงียบไว้
      const needsCeoApproval = false
      const approvalToken = null
      // let currentBetaEmails = ceoApprovalBetaEmails
      // if (form.requestType === 'New HC') {
      //   const freshSnap = await getDoc(doc(db, 'settings', 'ceoApprovalBeta'))
      //   currentBetaEmails = freshSnap.exists() ? (freshSnap.data().testEmails || []).map(e => e.toLowerCase().trim()) : []
      // }
      // const needsCeoApproval = form.requestType === 'New HC'
      //   && currentBetaEmails.includes(user.email.toLowerCase())
      // const approvalToken = needsCeoApproval ? crypto.randomUUID() : null

      // สร้าง payload จาก form state + metadata ของ user
      const payload = {
        ...form,
        headcount: Number(form.headcount),   // แปลงเป็น number (input คืน string)
        requesterName: user.displayName,
        requesterEmail: user.email.toLowerCase(),  // lowercase เพื่อ Firestore query ตรงกันเสมอ
        status: needsCeoApproval ? 'PendingApproval' : 'Open',
        hcId,                                 // HCID ที่ generate: REQ-YYYY-NNN
        createdAt: serverTimestamp(),          // ให้ Firestore ใส่ timestamp server
        ...(approvalToken ? { approvalToken } : {}),
      }

      // ── Step 2: สร้าง Firestore document ──────────────────────────────────
      // ต้องสร้างก่อนเพื่อได้ docRef.id ใช้เป็น folder name ใน Supabase
      const docRef = await addDoc(collection(db, 'hc_requests'), payload)

      // ── Step 3: อัพโหลดไฟล์ JD (ถ้ามี) ───────────────────────────────────
      // uploadJDFile(file, docId) → อัพโหลดไป Supabase bucket ที่ path: jd/{docId}/{filename}
      // แล้ว updateDoc เพิ่ม jdFileUrl, jdFilePath, jdFileName กลับเข้า Firestore
      //
      // ห้าม throw ออกจากบล็อกนี้ — doc ถูกสร้างที่ Step 2 แล้ว ถ้า throw จะข้าม Step 4-6
      // ซึ่งรวม sendToWebhook (ตัวเขียน Sheets + แจ้ง Slack ทีม TA) → เคสค้างอยู่แค่ใน
      // Firestore ไม่มีใน Sheets และ TA ไม่รู้ตัวเลย (เคส "request กำพร้า")
      // ไฟล์แนบพัง = เรื่องเล็กกว่าคำขอหลุด pipeline → บันทึกคำขอต่อ แล้วเตือน manager
      if (jdFile) {
        setUploadProgress('กำลังอัพโหลดไฟล์ JD...')
        try {
          const { url, path, error: uploadErr } = await uploadJDFile(jdFile, docRef.id)
          if (uploadErr) throw new Error(uploadErr)
          await updateDoc(doc(db, 'hc_requests', docRef.id), {
            jdFileUrl:  url,   // public URL หรือ storage path
            jdFilePath: path,  // path ใน Supabase bucket (ใช้สร้าง signed URL ภายหลัง)
            jdFileName: jdFile.name,
          })
        } catch (jdErr) {
          // ponytail: ไม่ retry — upload พังซ้ำที่เดิมส่วนใหญ่คือ policy/ไฟล์ ไม่ใช่ network fluke
          // ponytail: ยังไม่มี flow แนบ JD ย้อนหลังต่อเคส → บอก manager ให้ส่งไฟล์ตรงให้ TA
          console.error('JD upload failed (คำขอถูกบันทึกแล้ว):', jdErr)
          reportClientError('uploadJD', jdErr, { hcId, docId: docRef.id })
          setJdWarning(`คำขอ ${hcId} ถูกส่งเข้าระบบ TA เรียบร้อยแล้ว แต่แนบไฟล์ JD ไม่สำเร็จ (${jdErr.message}) — กรุณาส่งไฟล์ JD ให้ทีม TA โดยตรง หรืออัพโหลดเข้า JD Library`)
        } finally {
          setUploadProgress('') // เคลียร์ทุกกรณี ไม่ให้ข้อความ "กำลังอัพโหลด..." ค้างบนหน้าจอ
        }
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
      // needsCeoApproval = true → ยังไม่แจ้ง TA/Sheets เลย รอ CEO approve ก่อน
      // (sendToWebhook จะถูกเรียกตอน approve สำเร็จแทน จากหน้า ApproveNewHcPage/PendingApprovalsPage)
      // ปกติ → sendToWebhook ไปยัง Google Apps Script ซึ่งจะบันทึกลง Sheets + แจ้ง Slack ทีม TA
      // maintenance: true → GAS จะ skip การส่งแจ้งเตือน
      // workDaysPerWeek และ shift ไม่ส่งไป Sheets — เก็บใน Firestore อย่างเดียว
      if (needsCeoApproval) {
        sendCeoApprovalRequest(docRef.id, approvalToken, payload)
      } else {
        const { workDaysPerWeek: _w, shift: _s, ...webhookPayload } = payload
        await sendToWebhook({ ...webhookPayload, id: docRef.id, createdAt: new Date().toISOString(), maintenance: maintenanceMode })
      }

      // ── Step 6: บันทึก Audit Log ──────────────────────────────────────────
      // logAudit บันทึกลง Firestore collection 'hc_logs' สำหรับ activity tracking
      logAudit({
        requestId:  docRef.id,
        action:     needsCeoApproval ? 'SubmitPendingApproval' : 'Submit',
        by:         user.email,
        byName:     user.displayName,
        toStatus:   payload.status,
        position:   payload.position,
        department: payload.department,
      })

      // ── Reset state หลัง submit สำเร็จ ────────────────────────────────────
      setSuccess(true)
      // คง division/department/section/orgTrack ไว้เพื่อสะดวกถ้าจะยื่นหลายคำขอต่อกัน
      setForm((prev) => ({ ...INITIAL_FORM, division: prev.division, department: prev.department, section: prev.section, orgTrack: prev.orgTrack }))
      setJdFile(null)        // ล้างไฟล์ JD ที่แนบมา
      setPreviewUrl(null)    // ปิด JD preview sidebar
      setShiftCustomMode(false) // กลับไปโหมดเลือกกะจาก dropdown
      setTimeout(() => setSuccess(false), 4000) // ซ่อน success banner หลัง 4 วินาที
    } catch (err) {
      console.error('Submit error:', err)
      reportClientError('submitHCRequest', err, { hcId })
      // error อัพโหลด JD ไม่ผ่านมาทางนี้แล้ว (Step 3 จับเองแล้วไปต่อ) → เหลือแต่ error ที่
      // ทำให้คำขอไม่ถูกบันทึกจริงๆ เช่น generateHCID / addDoc พัง → ข้อความ generic พอ
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  // ─── Derived Values ────────────────────────────────────────────────────────
  // deptRestricted: true ถ้า Admin grant แผนกหรือ division ให้ manager คนนี้
  // (settings/deptManagers = แผนกเดี่ยว, settings/divisionManagers = ทั้งสาย — Head of Division)
  // → จำกัด Division/แผนกที่เลือกได้เฉพาะที่ grant ไว้เท่านั้น (ไม่ใช้กับ admin ที่ยื่นแทนได้ทุกแผนก)
  const deptRestricted = role === 'manager' && (grantedDepts.length > 0 || grantedDivisions.length > 0)
  const visibleDivisions = deptRestricted
    ? [...new Set([...grantedDepts.map(getDivisionByDepartment), ...grantedDivisions])].filter(Boolean)
    : DIVISIONS

  // trackConfig: config ของ Location track ตาม department ที่เลือก
  const trackConfig = getTrackConfigByDepartment(form.department)

  // jgLevels: รายการ Job Grade ตาม orgTrack (HQ vs OPERATION มี level ต่างกัน)
  const jgLevels = form.orgTrack === 'OPERATION' ? OPERATION_JG_LEVELS : HQ_JG_LEVELS

  // canInlinePreview: เบราว์เซอร์ render ใน iframe ได้เฉพาะ PDF กับรูปภาพ
  // ไฟล์ Word จะได้กรอบเปล่า (บาง browser สั่ง download แทน) → ต้องเปิดแท็บใหม่
  // ไม่มีชื่อไฟล์ → เดาว่าเป็น PDF ตามพฤติกรรมเดิม (doc เก่าก่อนรับ Word/รูป)
  const canInlinePreview = !existingJD?.jdFileName || /\.(pdf|png|jpe?g)$/i.test(existingJD.jdFileName)

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
      <div ref={feedbackTopRef} className="rounded-3xl border border-neutral-100 bg-white p-8">
        {/* ── Header row: Title + Preset button ── */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-neutral-900">ยื่นคำขออัตรากำลัง (HC Request)</h2>
          <button
            type="button"
            onClick={() => { setShowSaveInput(v => !v); setPresetName('') }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-dark-green-50 px-3 py-1.5 text-xs font-bold text-dark-green-800 transition-colors hover:bg-dark-green-100"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Preset {presets.length > 0 && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-dark-green-600 text-[9px] text-neutral-50">{presets.length}</span>}
          </button>
        </div>

        {/* ── Preset Panel ── */}
        {(showSaveInput || presets.length > 0) && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-neutral-100 bg-neutral-50 p-4">

            {/* รายการ Presets ที่บันทึกไว้ */}
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <div key={p.id} className="flex items-center overflow-hidden rounded-lg border border-neutral-100 bg-white">
                    <button
                      type="button"
                      onClick={() => loadPreset(p)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-neutral-700 transition-colors hover:bg-dark-green-50 hover:text-dark-green-800"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
                      {p.name}
                      {p.fields.position && <span className="font-normal text-neutral-400">· {p.fields.position.length > 18 ? p.fields.position.slice(0, 18) + '…' : p.fields.position}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePreset(p.id)}
                      className="px-2 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-red-50 hover:text-red-600"
                      title="ลบ Preset"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Save Preset Input */}
            {showSaveInput && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); savePreset() } if (e.key === 'Escape') setShowSaveInput(false) }}
                  placeholder="ชื่อ Preset เช่น พนักงานประจำ-Sales, Daily-DC..."
                  autoFocus
                  className="h-9 flex-1 rounded-lg border border-neutral-100 bg-white px-3 text-sm text-neutral-900 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
                <button type="button" onClick={savePreset}
                  className="rounded-lg bg-dark-green-600 px-3 py-1.5 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:bg-neutral-50 disabled:text-neutral-300"
                  disabled={!presetName.trim()}
                >บันทึก</button>
                <button type="button" onClick={() => setShowSaveInput(false)}
                  className="rounded-lg bg-neutral-50 px-3 py-1.5 text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-100"
                >ยกเลิก</button>
              </div>
            )}

            {/* Feedback message */}
            {presetMsg && (
              <p className="text-xs font-bold text-dark-green-700">{presetMsg}</p>
            )}
          </div>
        )}

        {/* ── Success Banner: แสดง 4 วินาทีหลัง submit สำเร็จ ── */}
        {/* ซ่อนถ้ามี jdWarning — โชว์ banner เหลืองใบเดียวพอ ไม่ต้องเขียว+เหลืองซ้อนกัน */}
        {success && !jdWarning && (
          <div className="mb-8 flex items-center gap-3 rounded-lg bg-green-fresh-50 px-5 py-4 text-green-fresh-900">
            <CheckCircle size={20} strokeWidth={1} absoluteStrokeWidth />
            <p className="font-bold">ยื่นคำขอสำเร็จแล้ว! ข้อมูลถูกส่งเข้าระบบเรียบร้อย</p>
          </div>
        )}

        {/* ── JD Warning Banner: คำขอบันทึก + เข้า Sheets แล้ว แต่แนบไฟล์ JD ไม่ผ่าน ── */}
        {/* ไม่ auto-hide (ต่างจาก success ที่หายใน 4 วิ) — manager ต้องอ่านทันแล้วไปทำต่อ */}
        {jdWarning && (
          <div className="mb-8 flex items-start gap-3 rounded-lg bg-yellow-50 px-5 py-4 text-yellow-950">
            <AlertTriangle size={20} strokeWidth={1} absoluteStrokeWidth className="mt-0.5 shrink-0" />
            <p className="font-bold">{jdWarning}</p>
          </div>
        )}

        {/* ── Error Banner: แสดงเมื่อ submit ล้มเหลว ── */}
        {error && (
          <div className="mb-8 rounded-lg bg-red-50 px-5 py-4 font-bold text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* ── ประเภทคำขอ (Radio) ──────────────────────────────────────────
           * 'Replacement': ทดแทนพนักงานที่ลาออก → แสดงฟิลด์ replacementFor + lastWorkingDay
           * 'New HC': เพิ่มอัตราใหม่ → แสดงฟิลด์ headcount (จำนวน)
           */}
          <div>
            <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">ประเภทคำขอ *</label>
            <div className="flex gap-6">
              {['Replacement', 'New HC'].map((type) => (
                <label key={type} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="radio"
                    name="requestType"
                    value={type}
                    checked={form.requestType === type}
                    onChange={handleChange}
                    className="w-4 h-4 accent-dark-green-600 cursor-pointer"
                  />
                  <span className={`text-sm font-bold transition-colors ${form.requestType === type ? 'text-neutral-900' : 'text-neutral-400 group-hover:text-neutral-600'}`}>{type}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Emp. Type ──────────────────────────────────────────────────── */}
          <div>
            <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">Emp. Type *</label>
            <div className="flex gap-5">
              {['Monthly', 'Daily', 'Contract', 'Intern'].map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="employmentType"
                    value={t}
                    checked={form.employmentType === t}
                    onChange={handleChange}
                    className="w-4 h-4 accent-dark-green-600 cursor-pointer"
                  />
                  <span className={`text-sm font-bold transition-colors ${form.employmentType === t ? 'text-neutral-900' : 'text-neutral-400 group-hover:text-neutral-600'}`}>{t}</span>
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
              <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">Division *</label>
              <select
                name="division"
                value={form.division}
                onChange={handleChange}
                required
                className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              >
                <option value="">เลือก Division</option>
                {visibleDivisions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Department: cascade จาก Division, disabled ถ้ายังไม่ได้เลือก Division */}
            <div>
              <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">
                แผนก *
                {/* Badge "Auto Filled" แสดงเฉพาะ non-admin ที่มีการ auto-fill จาก email */}
                {deptAutoFilled && role !== 'admin' && (
                  <span className="ml-2 rounded-full bg-dark-green-50 px-2 py-0.5 text-[10px] font-bold text-dark-green-800">
                    {deptRestricted ? 'Admin กำหนด' : 'Auto filled'}
                  </span>
                )}
              </label>
              <select
                name="department"
                value={form.department}
                onChange={handleChange}
                required
                disabled={!form.division}
                className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{form.division ? 'เลือกแผนก' : 'เลือก Division ก่อน'}</option>
                {[...new Set([...getDepartments(form.division), ...customDepts])]
                  .filter((d) => !deptRestricted || grantedDepts.includes(d) || grantedDivisions.includes(getDivisionByDepartment(d)))
                  .map((d) => (
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
                <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">Section</label>
                <select
                  name="section"
                  value={form.section}
                  onChange={handleChange}
                  className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                >
                  <option value="">เลือก Section (ถ้ามี)</option>
                  {getSections(form.division, form.department)
                    .filter((s) => !grantedSections.length || grantedSections.includes(s))
                    .map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Business Unit: cascade จาก Section, แสดงเฉพาะเมื่อมี BU สำหรับ section นั้น */}
              {form.section && getBusinessUnits(form.division, form.department, form.section).length > 0 && (
                <div>
                  <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">Business Unit</label>
                  <select
                    name="businessUnit"
                    value={form.businessUnit}
                    onChange={handleChange}
                    className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
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
              <label className="text-[13px] font-bold text-neutral-900 ml-1">ตำแหน่งที่ต้องการ *</label>
              <PositionCombobox
                value={form.position}
                onChange={(val) => setForm((prev) => ({ ...prev, position: val }))}
                positions={positionOptions}
                required
              />
              {form.department && positionOptions.length === 0 && (
                <p className="ml-1 text-xs text-neutral-400">กำลังโหลด...</p>
              )}
            </div>

            {/* Location (orgTrack): locked = readonly input, ไม่ locked = dropdown */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-bold text-neutral-900 ml-1">Location *</label>
              {trackConfig.locked ? (
                // แสดงเป็น readonly input เมื่อ track ถูกกำหนดอัตโนมัติจาก department
                <input
                  type="text"
                  value={trackConfig.defaultTrack || '—'}
                  readOnly
                  className="h-10 w-full cursor-not-allowed rounded-lg border border-neutral-100 bg-neutral-50 px-4 text-sm text-neutral-500"
                />
              ) : (
                // แสดง dropdown เฉพาะแผนก hybrid (ยังไม่มีในปัจจุบัน)
                <select
                  name="orgTrack"
                  value={form.orgTrack}
                  onChange={handleChange}
                  required
                  className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
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
              <label className="text-[13px] font-bold text-neutral-900 ml-1">Job Grade *</label>
              <select
                name="jg"
                value={form.jg}
                onChange={handleChange}
                required
                disabled={!form.orgTrack}
                className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
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
              <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">จำนวนที่ต้องการ (HC) *</label>
              <input
                type="number"
                name="headcount"
                value={form.headcount}
                onChange={handleChange}
                min={1}
                required
                className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none tabular-nums"
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
                <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">พนักงานที่ต้องการทดแทน *</label>
                {!replacementCustomMode ? (
                  <>
                    <select
                      name="replacementFor"
                      value={form.replacementFor}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setReplacementCustomMode(true)
                          setForm(p => ({ ...p, replacementFor: '' }))
                        } else {
                          handleChange(e)
                        }
                      }}
                      required
                      className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                    >
                      <option value="">เลือกพนักงาน</option>
                      {getEmployeesByDepartment(employees, form.department, form.section).map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      <option value="__custom__">— พิมพ์ชื่อเอง (พนักงานที่ลาออกแล้ว) —</option>
                    </select>
                    {form.department && getEmployeesByDepartment(employees, form.department, form.section).length === 0 && (
                      <p className="ml-1 mt-1.5 text-xs text-yellow-700">ไม่พบพนักงานใน Maindata</p>
                    )}
                  </>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      name="replacementFor"
                      value={form.replacementFor}
                      onChange={handleChange}
                      required
                      autoFocus
                      placeholder="พิมพ์ชื่อพนักงาน..."
                      className="h-10 flex-1 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => { setReplacementCustomMode(false); setForm(p => ({ ...p, replacementFor: '' })) }}
                      className="rounded-lg border border-neutral-100 px-3 text-xs font-bold text-neutral-500 transition-colors hover:text-neutral-700"
                    >
                      ← รายการ
                    </button>
                  </div>
                )}
              </div>
              <div>
                {/* ใช้ชื่อ field เดียวกัน (targetStartDate) แต่ label แตกต่างตาม requestType */}
                <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">วันลาออก (Last Working Day) *</label>
                <input
                  type="date"
                  name="targetStartDate"
                  value={form.targetStartDate}
                  onChange={handleChange}
                  required
                  className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* ── วันทำงาน + กะ ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">วันทำงานต่อสัปดาห์ *</label>
              <select
                name="workDaysPerWeek"
                value={form.workDaysPerWeek}
                onChange={handleChange}
                required
                className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              >
                <option value="">เลือกจำนวนวัน</option>
                {[3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>{d} วัน/สัปดาห์</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">กะการทำงาน *</label>
              {/* เลือกช่วงเวลามาตรฐาน หรือ "อื่นๆ" เพื่อกรอกเวลาเอง (pattern เดียวกับ replacementCustomMode) */}
              <select
                name="shift"
                value={shiftCustomMode ? 'อื่นๆ' : form.shift}
                onChange={(e) => {
                  if (e.target.value === 'อื่นๆ') {
                    setShiftCustomMode(true)
                    setForm((prev) => ({ ...prev, shift: '' }))   // เคลียร์ให้กรอกเองใน input ด้านล่าง
                  } else {
                    setShiftCustomMode(false)
                    handleChange(e)
                  }
                }}
                required={!shiftCustomMode}
                className="w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              >
                <option value="">เลือกกะ</option>
                <option value="07:00-16:00">07:00-16:00</option>
                <option value="08:00-17:00">08:00-17:00</option>
                <option value="09:00-18:00">09:00-18:00</option>
                <option value="10:00-19:00">10:00-19:00</option>
                <option value="อื่นๆ">อื่นๆ (กรอกเอง)</option>
              </select>
              {shiftCustomMode && (
                <input
                  type="text"
                  name="shift"
                  value={form.shift}
                  onChange={handleChange}
                  required
                  placeholder="ระบุช่วงเวลา เช่น 06:00-15:00"
                  className="mt-2 w-full h-10 rounded-lg border border-neutral-100 bg-white px-4 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
              )}
            </div>
          </div>

          {/* ── เหตุผลในการขอ (Required) ──────────────────────────────────── */}
          <div>
            <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">เหตุผลในการขอ *</label>
            <textarea
              name="reason"
              value={form.reason}
              onChange={handleChange}
              required
              rows={3}
              placeholder="อธิบายเหตุผลและความจำเป็นในการขออัตรากำลัง..."
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-3 text-sm text-neutral-900 transition-colors resize-none focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            />
          </div>

          {/* ── คุณสมบัติที่ต้องการ (Optional) ───────────────────────────── */}
          <div>
            <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">Requirement (optional)</label>
            <textarea
              name="requirements"
              value={form.requirements}
              onChange={handleChange}
              rows={4}
              placeholder={`เช่น\n- ประสบการณ์ 3+ ปี ในสายงานตรง\n- ทักษะการสื่อสารดีเยี่ยม\n- ตรงต่อเวลาและรับผิดชอบสูง`}
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-3 text-sm text-neutral-900 transition-colors resize-none focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            />
          </div>

          {/* ── JD File Upload ──────────────────────────────────────────────
           * รองรับ: PDF, Word (.doc/.docx), รูปภาพ (PNG, JPG) ขนาดไม่เกิน 10MB
           * ไฟล์จะถูกอัพโหลดไปยัง Supabase Storage ที่ path: jd/{docRef.id}/{filename}
           * หลัง upload สำเร็จ: อัพเดต jdFileUrl + jdFilePath + jdFileName ลง Firestore
           */}
          <div>
            <label className="block text-[13px] font-bold text-neutral-900 ml-1 mb-1">
              แนบไฟล์ JD (Optional)
            </label>
            {jdFile ? (
              // แสดง preview ของไฟล์ที่เลือก พร้อมปุ่ม X เพื่อลบออก
              <div className="flex items-center gap-3 rounded-2xl bg-dark-green-50 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dark-green-100 text-dark-green-700">
                  <FileText size={20} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-dark-green-900">{jdFile.name}</p>
                  <p className="text-xs text-dark-green-700">{(jdFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => setJdFile(null)}
                  className="rounded-lg p-2 text-dark-green-600 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <X size={18} strokeWidth={1} absoluteStrokeWidth />
                </button>
              </div>
            ) : libraryJD ? (
              // มี JD ใน Library สำหรับตำแหน่งนี้ — แสดง card พร้อมตัวเลือกอัพโหลดใหม่
              <div className="overflow-hidden rounded-2xl border border-dark-green-100">
                <div className="flex items-center gap-3 bg-dark-green-50 px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dark-green-100 text-dark-green-700">
                    <FileText size={20} strokeWidth={1} absoluteStrokeWidth />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-dark-green-900">มี JD สำหรับตำแหน่งนี้</p>
                    <p className="truncate text-xs text-dark-green-700">{libraryJD.fileName || 'JD Library'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const url = await getJDSignedUrl(libraryJD.filePath)
                      if (url) window.open(url, '_blank')
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-dark-green-600 px-3 py-1.5 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700"
                  >
                    <ExternalLink size={13} strokeWidth={1} absoluteStrokeWidth />
                    ดู JD
                  </button>
                </div>
                <label className="group flex cursor-pointer items-center justify-center gap-2 border-t border-dark-green-100 bg-white px-5 py-3 transition-colors hover:bg-dark-green-50">
                  <Paperclip size={14} strokeWidth={1} absoluteStrokeWidth className="text-neutral-400 transition-colors group-hover:text-dark-green-600" />
                  <p className="text-xs font-bold text-neutral-400 transition-colors group-hover:text-dark-green-700">
                    อัพโหลดใหม่เพื่อ update JD
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={handleJdFileSelect}
                  />
                </label>
              </div>
            ) : (
              // Drop zone สำหรับเลือกไฟล์ใหม่
              <label className="group flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-neutral-100 px-8 py-8 transition-colors hover:border-dark-green-600 hover:bg-dark-green-50">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-50 text-neutral-400 transition-colors group-hover:bg-dark-green-600 group-hover:text-neutral-50">
                  <Paperclip size={20} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-neutral-700">คลิกเพื่ออัพโหลดไฟล์ JD</p>
                  <p className="mt-1 text-xs text-neutral-400">PDF, Word, images (up to 10MB)</p>
                </div>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleJdFileSelect}
                />
              </label>
            )}
            {/* แสดง progress text ขณะกำลัง upload ไปยัง Supabase */}
            {uploadProgress && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-dark-green-50 px-3 py-1.5 text-xs font-bold text-dark-green-700">
                <Loader2 size={14} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> {uploadProgress}
              </div>
            )}
          </div>

          {/* ── Requester Info Card ─────────────────────────────────────────
           * แสดงชื่อและ email ของผู้ยื่น (ดึงจาก Firebase Auth user object)
           * ข้อมูลนี้จะถูกบันทึกเป็น requesterName + requesterEmail ใน Firestore
           */}
          <div className="flex items-center gap-4 rounded-2xl border border-neutral-100 bg-neutral-50 px-5 py-4">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="h-10 w-10 rounded-full" style={{ border: '1px solid rgba(0,128,101,0.2)' }} referrerPolicy="no-referrer" />
            ) : (
              // Fallback avatar ใช้ตัวอักษรแรกของชื่อ
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dark-green-600 text-lg font-bold text-neutral-50">{user.displayName?.[0]}</div>
            )}
            <div className="leading-tight">
              <p className="text-xs font-bold text-neutral-400">Requester</p>
              <p className="text-sm font-bold text-neutral-700">{user.displayName} <span className="mx-1 text-xs font-normal text-neutral-400">|</span> {user.email}</p>
            </div>
          </div>

          {/* ── Submit Button ── */}
          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-3 rounded-2xl bg-dark-green-600 py-4 text-base font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-300"
          >
            {loading ? <Loader2 size={18} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> : <FileText size={18} strokeWidth={1} absoluteStrokeWidth />}
            {loading ? 'กำลังส่งข้อมูลเข้าระบบ...' : 'ยื่นคำขออัตรากำลัง'}
          </button>
        </form>
      </div>
      </div>{/* end flex-1 */}

      {/* ── JD Preview Sidebar ──────────────────────────────────────────────
       * แสดงเฉพาะบนหน้าจอ lg ขึ้นไป (hidden lg:flex)
       * แสดงเมื่อมี existingJD (request ที่มีไฟล์ JD อยู่แล้วสำหรับตำแหน่ง/แผนกเดียวกัน)
       * ผู้ใช้สามารถ:
       *   - กดดูไฟล์ใน iframe (ดึง signed URL จาก Supabase อายุ 1 ชั่วโมง)
       *   - เปิดในแท็บใหม่ผ่าน ExternalLink icon
       *   - อัพโหลด JD ใหม่ทับได้จากฟอร์มด้านซ้าย
       */}
      {existingJD && (
        <div className="hidden lg:flex w-[460px] shrink-0 flex-col sticky top-6 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="flex flex-col overflow-hidden rounded-3xl border border-dark-green-100 bg-dark-green-50">

            {/* Header row: ชื่อไฟล์ + ปุ่มเปิดในแท็บใหม่ + ปุ่ม toggle preview */}
            <div className="flex items-center justify-between border-b border-dark-green-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-dark-green-100 text-dark-green-700">
                  <FileText size={14} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-dark-green-700">JD ที่มีในระบบ</p>
                  <p className="max-w-[280px] truncate text-xs font-bold text-neutral-700">{existingJD.jdFileName || 'ไฟล์ JD'}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* ปุ่มเปิดในแท็บใหม่: แสดงเฉพาะเมื่อมี previewUrl แล้ว */}
                {previewUrl && (
                  <a href={previewUrl} target="_blank" rel="noreferrer"
                    className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-dark-green-100 hover:text-dark-green-700"
                    title="เปิดในแท็บใหม่"
                  >
                    <ExternalLink size={14} strokeWidth={1} absoluteStrokeWidth />
                  </a>
                )}
                {/* ปุ่ม toggle: ถ้า previewUrl มีอยู่ → ซ่อน (X), ถ้าไม่มี → เปิด (FileText) */}
                <button
                  type="button"
                  onClick={previewUrl ? () => setPreviewUrl(null) : handleOpenExistingJD}
                  disabled={openingJD}
                  className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-dark-green-100 hover:text-dark-green-700 disabled:opacity-50"
                  title={previewUrl ? 'ซ่อนไฟล์ JD' : 'ดูไฟล์ JD'}
                >
                  {openingJD ? <Loader2 size={14} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> : previewUrl ? <X size={14} strokeWidth={1} absoluteStrokeWidth /> : <FileText size={14} strokeWidth={1} absoluteStrokeWidth />}
                </button>
              </div>
            </div>

            {/* File Viewer: iframe แสดงไฟล์จาก Supabase signed URL (PDF/รูปภาพเท่านั้น)
             * height คำนวณจาก viewport เพื่อให้พอดีหน้าจอโดยไม่ต้อง scroll
             * ไฟล์ Word → iframe render ไม่ได้ แสดงปุ่มเปิดแท็บใหม่แทนกรอบเปล่า
             * หรือแสดง placeholder พร้อมปุ่ม "เปิดดูไฟล์ JD" ถ้ายังไม่มี previewUrl
             */}
            {previewUrl && canInlinePreview ? (
              <iframe
                src={previewUrl}
                className="w-full border-0 bg-neutral-100"
                style={{ height: 'calc(100vh - 160px)', minHeight: '600px' }}
                title="JD Preview"
              />
            ) : previewUrl ? (
              <div className="flex flex-col items-center justify-center gap-3 px-5 py-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-dark-green-100 text-dark-green-700">
                  <FileText size={22} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <p className="text-center text-xs text-neutral-500">
                  ไฟล์ Word ดูในหน้านี้ไม่ได้<br />กดเปิดในแท็บใหม่เพื่อดาวน์โหลด
                </p>
                {/* ใช้สไตล์ secondary เหมือนปุ่ม "เปิดดูไฟล์ JD" ด้านล่าง — Primary CTA
                    ของหน้านี้คือปุ่มยื่นคำขอ ห้ามมี dark-green-600 ตัวที่ 2 ใน viewport */}
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dark-green-100 bg-white px-4 py-2.5 text-sm font-bold text-dark-green-700 transition-colors hover:bg-dark-green-50"
                >
                  <ExternalLink size={14} strokeWidth={1} absoluteStrokeWidth />
                  เปิดไฟล์ JD
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 px-5 py-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-dark-green-100 text-dark-green-700">
                  <FileText size={22} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <div className="text-center">
                  <p className="text-xs text-neutral-500">
                    อัพโหลดเมื่อ {existingJD.createdAt?.toDate?.().toLocaleDateString('th-TH') || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenExistingJD}
                  disabled={openingJD}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dark-green-100 bg-white px-4 py-2.5 text-sm font-bold text-dark-green-700 transition-colors hover:bg-dark-green-50 disabled:opacity-60"
                >
                  {openingJD ? <Loader2 size={14} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> : <FileText size={14} strokeWidth={1} absoluteStrokeWidth />}
                  เปิดดูไฟล์ JD
                </button>
                <p className="text-center text-xs text-dark-green-700/60">
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
