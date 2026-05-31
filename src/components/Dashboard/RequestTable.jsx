/**
 * @file RequestTable.jsx — ตารางคำขอ HC หลัก (Core HC Request Data Table)
 * ─────────────────────────────────────────────────────────────────────────────
 * คอมโพเนนต์หลักของระบบ HC Request สำหรับแสดง, กรอง, จัดเรียง และจัดการ
 * คำขออัตรากำลัง (Headcount Request) ทั้งหมดแบบ realtime
 *
 * The core data table component of the HC Request system — renders, filters,
 * sorts, paginates, and manages all headcount request records in real time.
 *
 * ── DATA SOURCE ───────────────────────────────────────────────────────────────
 *   - Firestore collection `hc_requests` via `onSnapshot` (realtime listener)
 *   - Query: orderBy createdAt DESC, limit 500
 *   - Page Visibility API: หยุด listener เมื่อ tab ถูกซ่อน / resume เมื่อกลับมา
 *     (pauses the listener when the browser tab is hidden, resumes on focus)
 *
 * ── SLA CALCULATION — getDaysOpen ─────────────────────────────────────────────
 *   Business rules สำหรับนับวันที่เปิดอยู่:
 *   - สถานะ Offering / Onboarding → หยุดนับ (timer paused)
 *   - กลับจาก Onboarding → Recruiting → รีเซ็ตนับใหม่ (counter resets)
 *   - สถานะอื่น → นับตาม createdAt ตามปกติ
 *
 * ── STATUS TABS ───────────────────────────────────────────────────────────────
 *   ทั้งหมด | Open | Recruiting | Interviewing | Offering |
 *   Onboarding | Rejected | Closed | Cancelled
 *
 * ── FILTERING ─────────────────────────────────────────────────────────────────
 *   - แผนก (department), ผู้รับผิดชอบ (assignee), ช่วงวันที่ (date range)
 *   - ค้นหาข้อความ (search text), focusTA (จาก TAWorkloadPanel),
 *     focusMonth (จาก MonthlyPipeline)
 *
 * ── SORTING ───────────────────────────────────────────────────────────────────
 *   คลิก header เพื่อ sort: position, department, assignedToName,
 *   createdAt, status
 *
 * ── PAGINATION ────────────────────────────────────────────────────────────────
 *   PAGE_SIZE = 50 rows per page
 *
 * ── ACTION HANDLERS ───────────────────────────────────────────────────────────
 *   handleClaim           — TA รับเคส (claim a request)
 *   handleCancel          — ยกเลิกคำขอ
 *   handleStatusChange    — เปลี่ยนสถานะทั่วไป
 *   handleOfferingConfirm — เปลี่ยนเป็น Onboarding พร้อม startDate + candidateName
 *   handleRejectConfirm   — ปฏิเสธพร้อมเหตุผล (reject with reason)
 *   handleReopen          — คืนสถานะ Rejected → Recruiting
 *   handleReassign        — มอบหมาย TA ใหม่
 *   handleDelete          — ลบ (admin only): ลบ JD จาก Supabase + ลบ doc จาก Firestore
 *
 * ── CV MANAGEMENT ─────────────────────────────────────────────────────────────
 *   handleCVUpload  — อัปโหลด CV ผ่าน Supabase Storage
 *   handleDeleteCV  — ลบ CV ออกจาก Supabase Storage
 *
 * ── MODALS ────────────────────────────────────────────────────────────────────
 *   offeringModal  — ยืนยัน Onboarding (startDate + candidateName)
 *   rejectModal    — ยืนยันการปฏิเสธพร้อมเหตุผล
 *   slaTestModal   — (admin) เปลี่ยน createdAt เพื่อทดสอบ SLA
 *   ConfirmModal   — ยืนยันการกระทำที่ไม่สามารถย้อนกลับได้ (destructive actions)
 *
 * ── PERMISSION FLAGS (per row) ────────────────────────────────────────────────
 *   canClaim, canCancel, canUpdateStatus, canReassign,
 *   isOwner, isTA, isAdmin
 *
 * ── VISIBILITY RULES ──────────────────────────────────────────────────────────
 *   - Manager: เห็นเฉพาะคำขอของตนเองและแผนกเดียวกัน
 *   - TA: เห็นทั้งหมด (หรือกรองตาม department prop ถ้าระบุ)
 *   - Admin: เห็นทั้งหมด
 *
 * @module RequestTable
 *
 * @param {Object}        props
 * @param {Object}        props.user           - Firestore user document ของผู้ใช้ปัจจุบัน
 * @param {string}        props.role           - 'admin' | 'ta' | 'manager'
 * @param {string}        [props.department]   - กรองเฉพาะแผนก (TA view แบบ dept-scoped)
 * @param {Function}      [props.onStatsChange]- callback(stats) เมื่อข้อมูลสรุปเปลี่ยน
 * @param {boolean}       [props.filterMine]   - แสดงเฉพาะคำขอของตนเอง
 * @param {boolean}       [props.filterMyCases]- แสดงเฉพาะ case ที่ TA รับผิดชอบ
 * @param {boolean}       [props.showFilters]  - แสดง/ซ่อน filter bar
 * @param {string|null}   [props.focusTA]      - กรองตาม TA ที่เลือกจาก TAWorkloadPanel
 * @param {string|null}   [props.focusMonth]   - กรองตามเดือนที่เลือกจาก MonthlyPipeline
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState, useMemo, useCallback, Fragment } from 'react'
import { collection, onSnapshot, orderBy, query, doc, updateDoc, getDocs, where, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, limit, Timestamp } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { sendStatusUpdate, sendDeleteToSheets, updateOpenDateInSheets } from '../../services/webhook'
import { getJGLabel } from '../../data/jobGrades'
import { logAudit } from '../../services/auditLog'
import { Loader2, UserCheck, XCircle, ChevronUp, ChevronDown, ChevronsUpDown, SlidersHorizontal, X, FileText, Search, ChevronRight, Users, Calendar, AlignLeft, ClipboardList, Pencil, Trash2, Upload, File } from 'lucide-react'
import { getJDSignedUrl, deleteJDFile, uploadCVFile, getCVSignedUrl, deleteCVFile } from '../../services/supabase'
import ConfirmModal from '../Shared/ConfirmModal'

// ─── สี Badge ของแต่ละสถานะ (light + dark mode) ───
const STATUS_CONFIG = {
  Open:             { label: 'Open',              bg: 'bg-yellow-50 dark:bg-yellow-500/10',   text: 'text-yellow-700 dark:text-yellow-500',  border: 'border-yellow-200 dark:border-yellow-500/20' },
  Recruiting:       { label: 'Recruiting',        bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-500', border: 'border-emerald-200 dark:border-emerald-500/20' },
  Interviewing:     { label: 'Interviewing',      bg: 'bg-orange-50 dark:bg-orange-500/10',   text: 'text-orange-700 dark:text-orange-500',  border: 'border-orange-200 dark:border-orange-500/20' },
  Offering:         { label: 'Offering',          bg: 'bg-indigo-50 dark:bg-indigo-500/10',   text: 'text-indigo-700 dark:text-indigo-500',  border: 'border-indigo-200 dark:border-indigo-500/20' },
  Onboarding:       { label: 'W.Onboarding',      bg: 'bg-teal-50 dark:bg-teal-500/10',       text: 'text-teal-700 dark:text-teal-500',      border: 'border-teal-200 dark:border-teal-500/20' },
  Rejected:         { label: 'Rejected',          bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-500',        border: 'border-red-200 dark:border-red-500/20' },
  Closed:           { label: 'Closed',            bg: 'bg-slate-100 dark:bg-slate-800',       text: 'text-slate-700 dark:text-slate-400',    border: 'border-slate-200 dark:border-slate-700' },
  Cancelled:        { label: 'Cancelled',         bg: 'bg-gray-50 dark:bg-slate-900',         text: 'text-gray-500 dark:text-slate-500',     border: 'border-gray-200 dark:border-slate-800' },
  OnHold:           { label: 'On Hold',           bg: 'bg-gray-100 dark:bg-slate-800/60',     text: 'text-gray-500 dark:text-slate-400',     border: 'border-gray-300 dark:border-slate-600' },
  Confidential:     { label: 'Confidential',      bg: 'bg-gray-800 dark:bg-gray-900',         text: 'text-white',                            border: 'border-gray-900 dark:border-black' },
  InternalTransfer: { label: 'Internal Transfer', bg: 'bg-blue-800 dark:bg-blue-900',         text: 'text-white',                            border: 'border-blue-900 dark:border-blue-950' },
}

// ─── Tab list และสถานะที่ TA สามารถเปลี่ยนได้ (ยกเว้น Open) ───
const STATUS_TABS = ['ทั้งหมด', 'Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding', 'Rejected', 'Closed', 'Cancelled', 'OnHold', 'Confidential', 'InternalTransfer']
const TA_STATUSES = ['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding', 'Closed', 'OnHold', 'Confidential', 'InternalTransfer']
const ALL_STATUSES = ['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding', 'Rejected', 'Closed', 'Cancelled', 'OnHold', 'Confidential', 'InternalTransfer']

// ค้นหา Email จากชื่อแบบ Dynamic (ตัดชื่อจริงมาเทียบกับ allTAs)
function getAssignedEmail(req, allTAs = []) {
  if (req.assignedTo) return req.assignedTo.toLowerCase()
  if (req.assignedToName) {
    const rawName = req.assignedToName.toLowerCase().trim()
    const firstName = rawName.split(/[\s(]/)[0] // e.g. "jitlada (mo)" -> "jitlada"
    if (firstName.length > 2) {
      const found = allTAs.find(t => 
        (t.name && t.name.toLowerCase().includes(firstName)) || 
        (t.email && t.email.toLowerCase().includes(firstName))
      )
      if (found) return found.email.toLowerCase()
    }
  }
  return ''
}

// คืน list สถานะที่เปลี่ยนได้ → Admin แก้ได้อิสระ, TA ไม่รวม Open
function getAvailableStatuses(currentStatus, isAdmin = false) {
  if (isAdmin) return ALL_STATUSES
  const options = TA_STATUSES.filter(s => s !== 'Open')
  if (!options.includes(currentStatus)) return [currentStatus, ...options]
  return options
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${cfg.bg} ${cfg.text} ${cfg.border} uppercase tracking-wider`}>
      {cfg.label}
    </span>
  )
}

// ─── คำนวณ Effective SLA Days ตาม business rules ───
// กฎ:
//   - Offering / Onboarding → pause (ไม่นับเวลาช่วงนี้)
//   - กลับจาก Offering → Recruiting/Interviewing → resume ต่อ (ไม่ reset)
//   - กลับจาก Onboarding → Recruiting → RESET เริ่มนับใหม่
//
// slaStartDate (optional override):
//   - ถ้า admin แก้ SLA ย้อนหลัง จะเซ็ต slaStartDate แทนการแก้ createdAt
//   - ใช้ slaStartDate ถ้ามี (ไม่มี year check) — ใช้ createdAt ถ้าไม่มี (2026+ เท่านั้น)
function getDaysOpen(req) {
  // slaStartDate override → admin ตั้งด้วยตัวเอง → นับตรงๆ ไม่มี pause/reset logic
  if (req.slaStartDate) {
    const start = new Date(req.slaStartDate)
    if (isNaN(start)) return null
    // หาวัน Closed จาก statusHistory หรือ closedAt
    const closedEntry = [...(req.statusHistory ?? [])]
      .map(e => ({ status: e.status, t: new Date(e.changedAt) }))
      .filter(e => !isNaN(e.t) && (e.status === 'Closed' || e.status === 'Cancelled'))
      .sort((a, b) => b.t - a.t)[0]
    const end = closedEntry ? closedEntry.t
      : req.closedAt?.toDate?.() ?? new Date()
    return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)))
  }

  // auto mode — ใช้ createdAt (2026+ เท่านั้น) พร้อม pause/reset logic เดิม
  const effectiveStart = req.createdAt?.toDate?.() ?? null
  if (!effectiveStart || effectiveStart.getFullYear() < 2026) return null

  const createdAt = effectiveStart   // alias ให้ logic เดิมใช้ได้ต่อ
  const DONE = new Set(['Closed', 'Cancelled'])

  const history = [...(req.statusHistory ?? [])]
    .map(e => ({ status: e.status, t: new Date(e.changedAt) }))
    .filter(e => !isNaN(e.t))
    .sort((a, b) => a.t - b.t)

  let accumulated = 0        // ms สะสม
  let activeStart = createdAt
  // flag: ครั้งล่าสุดที่หยุดนับเป็นเพราะ Onboarding (ไม่ใช่ Offering)
  // ใช้ detect reset แม้ว่าจะผ่าน Rejected ก่อนกลับมา Recruiting
  let lastPauseWasOnboarding = false

  for (const { status, t } of history) {
    if (status === 'Offering') {
      if (activeStart) { accumulated += t - activeStart; activeStart = null }
      lastPauseWasOnboarding = false
    } else if (status === 'Onboarding') {
      if (activeStart) { accumulated += t - activeStart; activeStart = null }
      lastPauseWasOnboarding = true   // mark: pause เพราะ Onboarding
    } else if (status === 'Recruiting' || status === 'Interviewing') {
      if (lastPauseWasOnboarding) {
        // RESET: Onboarding → (Rejected?) → Recruiting → เริ่มนับใหม่
        accumulated = 0
        activeStart = t
        lastPauseWasOnboarding = false
      } else if (!activeStart) {
        // RESUME: กลับจาก Offering reject
        activeStart = t
      }
      // activeStart มีอยู่แล้ว → นับต่อ
    } else if (DONE.has(status)) {
      if (activeStart) { accumulated += t - activeStart; activeStart = null }
      lastPauseWasOnboarding = false
    }
    // Rejected / Open: ไม่ทำอะไร — ปล่อย state เดิมดำเนินต่อ
  }

  if (activeStart) accumulated += new Date() - activeStart
  return Math.floor(accumulated / (1000 * 60 * 60 * 24))
}

// แสดงป้าย SLA: ⏸ pause | 🔴 >30วัน | 🟡 15-30วัน | 🟢 <15วัน
function SLABadge({ req }) {
  const days = getDaysOpen(req)
  if (days === null) return null
  const done   = ['Closed', 'Cancelled'].includes(req.status)
  const paused = ['Offering', 'Onboarding'].includes(req.status)
  if (done) return <span className="text-[10px] text-slate-400 dark:text-slate-600 font-mono">{days}d</span>
  if (paused) return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[10px] font-bold border text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
      ⏸ {days}d
    </span>
  )
  const style = days > 30
    ? 'text-red-600 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
    : days > 15
      ? 'text-yellow-600 bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20'
      : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
  const dot = days > 30 ? '🔴' : days > 15 ? '🟡' : '🟢'
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[10px] font-bold border ${style}`}>
      {dot} {days}d
    </span>
  )
}

// สร้าง entry สำหรับ statusHistory array
/**
 * shortName — ตัดนามสกุลออก เหลือแค่ชื่อ + nickname ในวงเล็บ
 * "Jitlada (Mo) Mooltha" → "Jitlada (Mo)"
 * "Somchai Smith"        → "Somchai Smith"  (ไม่มีวงเล็บ → คงเดิม)
 */
function shortName(fullName) {
  if (!fullName) return fullName
  const match = fullName.match(/^.+?\)/)
  return match ? match[0].trim() : fullName
}

function buildHistoryEntry(status, user) {
  return { status, changedAt: new Date().toISOString(), changedBy: user.email, changedByName: shortName(user.displayName) }
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ChevronsUpDown size={12} className="text-gray-300" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-[#008065]" />
    : <ChevronDown size={12} className="text-[#008065]" />
}

export default function RequestTable({
  user, role, department, onStatsChange,
  filterMine = false, filterMyCases = false, showFilters = false,
  focusTA = null,    // ชื่อ TA ที่ต้องการ filter (จาก TAWorkloadPanel)
  focusMonth = null, // "YYYY-MM" filter จาก MonthlyPipeline
}) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [allTAs, setAllTAs] = useState([])
  const [reassigningId, setReassigningId] = useState(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeTab, setActiveTab] = useState('ทั้งหมด')
  const [filterEmpType,  setFilterEmpType]  = useState('')
  const [filterJobType,  setFilterJobType]  = useState('')
  const [filterRank,     setFilterRank]     = useState('')
  const [filterDept,     setFilterDept]     = useState('')
  const [filterBU,       setFilterBU]       = useState('')
  const [filterAssigned, setFilterAssigned] = useState('')
  const [filterYear,     setFilterYear]     = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo,   setFilterDateTo]   = useState('')
  const [showFilterBar,  setShowFilterBar]  = useState(false)
  const [openChip,       setOpenChip]       = useState(null)
  const [sortField, setSortField] = useState('hcId')
  const [sortDir, setSortDir] = useState('desc')
  const [confirmState, setConfirmState] = useState({ isOpen: false, action: null, payload: null })
  // Onboarding modal: กรอกวันเริ่มงานก่อนเปลี่ยนสถานะ
  const [offeringModal, setOfferingModal] = useState({ isOpen: false, id: null, mode: 'onboarding' })
  const [offeringStartDate, setOfferingStartDate] = useState('')
  const [candidateEditId, setCandidateEditId] = useState(null)   // id ที่กำลัง edit
  const [candidateEditVal, setCandidateEditVal] = useState('')   // ค่าที่กำลังพิมพ์
  const [offeringCandidateName, setOfferingCandidateName] = useState('')
  const [offeringCvUrl, setOfferingCvUrl] = useState('')
  const [offeringCustomDate, setOfferingCustomDate] = useState('') // optional: วัน Offering ย้อนหลัง
  // Reject modal: กรอกเหตุผลก่อน Reject
  const [rejectModal, setRejectModal] = useState({ isOpen: false, id: null })
  const [rejectReason, setRejectReason] = useState('')
  // Admin: แก้ createdAt เพื่อทดสอบ SLA
  const [slaTestModal, setSlaTestModal] = useState({ isOpen: false, id: null, hcId: null, originalCreatedAt: null })
  const [slaTestDate, setSlaTestDate] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  const [cvUploading, setCvUploading] = useState(new Set()) // Set ของ reqId ที่กำลัง upload

  // ─── Debounce search 300ms ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // ─── Sync filterAssigned เมื่อ focusTA เปลี่ยน (จาก TAWorkloadPanel) ───
  useEffect(() => {
    setFilterAssigned(focusTA ?? '')
    setPage(1)
  }, [focusTA])

  // ─── Realtime listener: ดึง hc_requests จาก Firestore แบบ realtime ───
  // ใช้ Page Visibility API → หยุด listener เมื่อ tab ไม่ active เพื่อลด Firestore reads
  useEffect(() => {
    const q = query(collection(db, 'hc_requests'), orderBy('createdAt', 'desc'), limit(500))
    let unsubscribe = null

    const handleSnapshot = (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
      setRequests(data)
      setLoading(false)
      // ส่ง data ดิบออกไป — onStatsChange จะ setRequests ใน parent
      // avgDaysToFill คำนวณใน useMemo แยกต่างหากเพื่อไม่ block snapshot callback
      onStatsChange?.(null, data)
    }

    const subscribe = () => {
      if (!unsubscribe) {
        unsubscribe = onSnapshot(q, handleSnapshot)
      }
    }

    const unsubscribeFn = () => {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    }

    // เริ่ม listener ทันที
    subscribe()

    // หยุด listener เมื่อ tab ซ่อนอยู่ → เปิดใหม่เมื่อกลับมา
    const handleVisibility = () => {
      if (document.hidden) {
        unsubscribeFn()
      } else {
        subscribe()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      unsubscribeFn()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [onStatsChange])

  // ─── โหลดรายชื่อ TA/Admin สำหรับ dropdown reassign ───
  useEffect(() => {
    if (role === 'admin' || role === 'ta') {
      const q = query(collection(db, 'users'), where('role', 'in', ['ta', 'admin']), limit(100))
      getDocs(q).then(snap => {
        setAllTAs(snap.docs.map(d => ({ email: d.id, name: d.data().name || d.id })))
      }).catch(e => console.error('Error fetching TAs:', e))
    }
  }, [role])

  // ─── Action Handlers ─────────────────────────────────────────
  async function handleCancel(id) {
    setUpdating(id)
    const req = requests.find((r) => r.id === id)
    try {
      await updateDoc(doc(db, 'hc_requests', id), { status: 'Cancelled', statusHistory: arrayUnion(buildHistoryEntry('Cancelled', user)) })
      sendStatusUpdate(id, 'Cancelled', null, null, null, null, req?.hcId)
      logAudit({ requestId: id, action: 'Cancel', by: user.email, byName: user.displayName, fromStatus: req?.status, toStatus: 'Cancelled', position: req?.position, department: req?.department })
    } catch (err) {
      console.error('[handleCancel]', err)
    } finally {
      setUpdating(null)
    }
  }

  async function handleClaim(id) {
    setUpdating(id)
    const req = requests.find((r) => r.id === id)
    try {
      await updateDoc(doc(db, 'hc_requests', id), { status: 'Recruiting', assignedTo: user.email, assignedToName: shortName(user.displayName), assignedAt: serverTimestamp(), statusHistory: arrayUnion(buildHistoryEntry('Recruiting', user)) })
      sendStatusUpdate(id, 'Recruiting', shortName(user.displayName), new Date().toISOString(), null, null, req?.hcId)
      logAudit({ requestId: id, action: 'Assign', by: user.email, byName: user.displayName, fromStatus: req?.status, toStatus: 'Recruiting', position: req?.position, department: req?.department })
    } catch (err) {
      console.error('[handleClaim]', err)
    } finally {
      setUpdating(null)
    }
  }

  // Auto-assign TA ถ้ายังไม่มีคนรับเคสและเปลี่ยนจาก Open → working status
  // extraData: ข้อมูลเพิ่มเติม เช่น { startDate, candidateName } ตอนเปลี่ยนเป็น Onboarding
  async function handleStatusChange(id, newStatus, extraData = {}) {
    const req = requests.find((r) => r.id === id)
    try {
      // กรอง undefined ออกจาก extraData ก่อน spread
      // Firestore SDK v9 treats undefined as deleteField() — ต้องไม่ปล่อยให้ลบ field โดยไม่ตั้งใจ
      const safeExtra = Object.fromEntries(
        Object.entries(extraData).filter(([, v]) => v !== undefined && v !== null)
      )
      const updateData = {
        status: newStatus,
        ...safeExtra,
        statusHistory: arrayUnion(buildHistoryEntry(newStatus, user)),
      }

      if (req.status === 'Open' && ['Recruiting', 'Interviewing', 'Offering', 'Closed'].includes(newStatus) && !req.assignedTo) {
        updateData.assignedTo = user.email
        updateData.assignedToName = shortName(user.displayName)
        updateData.assignedAt = serverTimestamp()
      }

      if (newStatus === 'Rejected') updateData.rejectedAt = serverTimestamp()
      if (newStatus === 'Closed') updateData.closedAt = serverTimestamp()
      if (newStatus === 'Onboarding') { updateData.rejectReason = ''; updateData.rejectedAt = null }
      if (newStatus === 'Offering' && !req.offeringDate) {
        // ใช้วันที่ระบุมา (ย้อนหลัง) หรือ fallback เป็นวันนี้
        const customDate = extraData.offeringDate ? new Date(extraData.offeringDate) : null
        updateData.offeringDate = (customDate && !isNaN(customDate))
          ? customDate.toISOString()
          : new Date().toISOString()
      }
      // กลับไปก่อน Offering → ล้าง offeringDate
      const PRE_OFFERING = ['Open', 'Recruiting', 'Interviewing']
      if (PRE_OFFERING.includes(newStatus) && req.offeringDate) updateData.offeringDate = ''
      // กลับไป Interviewing / Rejected → ล้าง candidateName + startDate
      const CLEAR_CANDIDATE = ['Open', 'Recruiting', 'Interviewing', 'Rejected']
      if (CLEAR_CANDIDATE.includes(newStatus) && (req.candidateName || req.startDate)) {
        updateData.candidateName = ''
        updateData.startDate = ''
        updateData.cvUrl = ''
      }
      // กลับไป Offering → ล้างแค่ startDate (candidateName ยังคงอยู่)
      const CLEAR_START_DATE = ['Offering']
      if (CLEAR_START_DATE.includes(newStatus) && req.startDate) {
        updateData.startDate = ''
      }

      await updateDoc(doc(db, 'hc_requests', id), updateData)
      const assignedAt = updateData.assignedAt ? new Date().toISOString() : req.assignedAt?.toDate?.().toISOString()
      const offeringDate = PRE_OFFERING.includes(newStatus) && req.offeringDate ? 'CLEAR'
        : (updateData.offeringDate || req.offeringDate || null)
      const clearInfo = CLEAR_CANDIDATE.includes(newStatus) && !!(req.candidateName || req.startDate)
      // ส่ง startDate='CLEAR' ไป GAS เมื่อกลับไป Offering เพื่อล้าง Onboard Date ใน Sheets
      const startDateParam = CLEAR_START_DATE.includes(newStatus) && req.startDate
        ? 'CLEAR'
        : (extraData.startDate || null)
      sendStatusUpdate(id, newStatus, updateData.assignedToName || req.assignedToName, assignedAt, startDateParam, extraData.candidateName || null, req?.hcId, offeringDate, clearInfo, extraData.cvUrl || null)
      logAudit({
        requestId: id,
        action: newStatus === 'Rejected' ? 'Rejected' : 'StatusChange',
        by: user.email,
        byName: user.displayName,
        fromStatus: req?.status,
        toStatus: newStatus,
        position: req?.position,
        department: req?.department,
        note: [
          extraData.startDate ? `วันเริ่มงาน: ${extraData.startDate}` : null,
          extraData.candidateName ? `Candidate: ${extraData.candidateName}` : null,
        ].filter(Boolean).join(', ') || undefined,
      })
    } catch (err) {
      console.error('[handleStatusChange]', err)
    }
  }

  // Offering / Onboarding confirm
  async function handleOfferingConfirm() {
    if (!offeringModal.id) return
    if (offeringModal.mode === 'offering') {
      // Offering: กรอกชื่อ candidate (optional) + CV URL (optional) + วันที่ (optional)
      const extra = {}
      if (offeringCandidateName.trim()) extra.candidateName  = offeringCandidateName.trim()
      if (offeringCvUrl.trim())         extra.cvUrl          = offeringCvUrl.trim()
      if (offeringCustomDate)           extra.offeringDate   = offeringCustomDate
      await handleStatusChange(offeringModal.id, 'Offering', extra)
    } else {
      // Onboarding: ต้องมี startDate
      if (!offeringStartDate) return
      const extra = { startDate: offeringStartDate }
      if (offeringCandidateName.trim()) extra.candidateName = offeringCandidateName.trim()
      await handleStatusChange(offeringModal.id, 'Onboarding', extra)
    }
    setOfferingModal({ isOpen: false, id: null, mode: 'onboarding' })
    setOfferingStartDate('')
    setOfferingCandidateName('')
    setOfferingCvUrl('')
    setOfferingCustomDate('')
  }

  // Reject confirm: บันทึก Rejected (หยุดที่ Rejected → TA กด "Recruit ใหม่" เองเมื่อพร้อม)
  async function handleRejectConfirm() {
    if (!rejectModal.id) return
    const req = requests.find((r) => r.id === rejectModal.id)
    try {
      await updateDoc(doc(db, 'hc_requests', rejectModal.id), {
        status: 'Rejected',
        rejectReason: rejectReason.trim() || 'ไม่ระบุเหตุผล',
        rejectedAt: serverTimestamp(),
        startDate: '',
        candidateName: '',   // ล้างชื่อ candidate เมื่อ Reject
        statusHistory: arrayUnion(buildHistoryEntry('Rejected', user)),
      })
      // clearInfo=true → GAS จะล้าง candidateName + startDate ใน Sheets ด้วย
      sendStatusUpdate(rejectModal.id, 'Rejected', req?.assignedToName, null, null, null, req?.hcId, null, true)
      logAudit({
        requestId: rejectModal.id,
        action: 'Rejected',
        by: user.email,
        byName: user.displayName,
        fromStatus: req?.status,
        toStatus: 'Rejected',
        position: req?.position,
        department: req?.department,
        note: `Rejected (${rejectReason.trim() || 'ไม่ระบุเหตุผล'})`,
      })
    } catch (err) {
      console.error('[handleRejectConfirm]', err)
    }
    setRejectModal({ isOpen: false, id: null })
    setRejectReason('')
  }

  // Admin: แก้ SLA ย้อนหลัง — เซ็ต slaStartDate (ไม่แตะ createdAt จริง)
  // dateOverride: ถ้าส่งมา ใช้ค่านั้นแทน slaTestDate state (หลีกเลี่ยง async setState race)
  async function handleSlaFixSave(dateOverride) {
    if (!slaTestModal.id) return
    try {
      const dateVal = dateOverride !== undefined ? dateOverride : slaTestDate
      const parsed  = dateVal ? new Date(dateVal) : null
      const isoDate = parsed && !isNaN(parsed) ? parsed.toISOString() : null
      console.log('[SLA fix] dateVal:', dateVal, '| parsed:', parsed, '| isoDate:', isoDate)
      await updateDoc(doc(db, 'hc_requests', slaTestModal.id), {
        slaStartDate: isoDate,  // null = reset กลับ auto
      })
      // sync Column A "Open Jobs" ใน Sheets ด้วย
      if (slaTestModal.hcId) {
        const effectiveDate = isoDate || slaTestModal.originalCreatedAt
        if (effectiveDate) updateOpenDateInSheets(slaTestModal.hcId, effectiveDate)
      }
      setSlaTestModal({ isOpen: false, id: null, hcId: null, originalCreatedAt: null })
      setSlaTestDate('')
    } catch (err) {
      console.error('[handleSlaFixSave]', err)
    }
  }

  // ─── CV Upload / Delete ───
  async function handleCVUpload(reqId, file) {
    if (!file) return
    setCvUploading((prev) => new Set([...prev, reqId]))
    try {
      const result = await uploadCVFile(file, reqId)
      if (result.error) { alert(result.error); return }
      await updateDoc(doc(db, 'hc_requests', reqId), {
        cvFiles: arrayUnion({ name: file.name, path: result.path, uploadedBy: user.email, uploadedAt: new Date().toISOString() }),
      })
    } catch (err) {
      console.error('[handleCVUpload]', err)
      alert('อัพโหลดไม่สำเร็จ: ' + err.message)
    } finally {
      setCvUploading((prev) => { const s = new Set(prev); s.delete(reqId); return s })
    }
  }

  async function handleDeleteCV(reqId, cvEntry) {
    await deleteCVFile(cvEntry.path)
    await updateDoc(doc(db, 'hc_requests', reqId), { cvFiles: arrayRemove(cvEntry) })
  }

  // Rejected → Recruiting ใหม่
  async function handleReopen(id) {
    const req = requests.find((r) => r.id === id)
    try {
      await updateDoc(doc(db, 'hc_requests', id), {
        status: 'Recruiting',
        startDate: '',
        candidateName: '',   // ล้างชื่อ candidate เมื่อ Reopen
        offeringDate: '',    // ล้างวัน offering เมื่อ Reopen
        rejectedAt: null,
        statusHistory: arrayUnion(buildHistoryEntry('Recruiting', user)),
      })
      // clearInfo=true → GAS จะล้าง candidateName + startDate ใน Sheets ด้วย
      sendStatusUpdate(id, 'Recruiting', req.assignedToName, null, null, null, req?.hcId, 'CLEAR', true)
      logAudit({
        requestId: id,
        action: 'Reopen',
        by: user.email,
        byName: user.displayName,
        fromStatus: 'Rejected',
        toStatus: 'Recruiting',
        position: req?.position,
        department: req?.department,
        note: 'Rejected → Recruiting ใหม่',
      })
    } catch (err) {
      console.error('[handleReopen]', err)
    }
  }

  async function handleReassign(id, newTAEmail, newTAName) {
    setUpdating(id)
    const req = requests.find((r) => r.id === id)
    const now = new Date().toISOString()
    try {
      await updateDoc(doc(db, 'hc_requests', id), {
        assignedTo: newTAEmail,
        assignedToName: newTAName,
        assignedAt: serverTimestamp(),
      })
      sendStatusUpdate(id, req?.status, newTAName, now, null, null, req?.hcId)
      logAudit({
        requestId: id,
        action: 'Assign',
        by: user.email,
        byName: user.displayName,
        fromStatus: req?.status,
        toStatus: req?.status,
        position: req?.position,
        department: req?.department,
        note: `Reassigned from ${req.assignedToName} to ${newTAName}`
      })
    } catch (err) {
      console.error('[handleReassign]', err)
    } finally {
      setReassigningId(null)
      setUpdating(null)
    }
  }

  async function handleDelete(id) {
    setUpdating(id)
    try {
      const req = requests.find((r) => r.id === id)

      // 1. ลบไฟล์ JD ใน Supabase Storage (ถ้ามี)
      if (req?.jdFilePath) {
        await deleteJDFile(req.jdFilePath)
      }

      // 2. ลบไฟล์ CV ทั้งหมดใน Supabase cv-files bucket (ป้องกัน orphaned files)
      if (req?.cvFiles?.length > 0) {
        await Promise.all(req.cvFiles.map((cv) => deleteCVFile(cv.path).catch(() => {})))
      }

      // 3. ลบ Document ใน Firestore
      await deleteDoc(doc(db, 'hc_requests', id))

      // 4. แจ้ง GAS ให้ลบ row ใน Google Sheets (ถ้ามี hcId)
      if (req?.hcId) sendDeleteToSheets(req.hcId)

      logAudit({
        requestId: id,
        action: 'Delete',
        by: user.email,
        byName: user.displayName,
        position: req?.position,
        department: req?.department,
        note: 'Permanently deleted from database & storage by Admin'
      })
    } catch (e) {
      console.error('Delete error:', e)
    }
    setUpdating(null)
  }

  function openConfirm(action, payload) {
    setConfirmState({ isOpen: true, action, payload })
  }

  function closeConfirm() {
    if (confirmState.action === 'reassign') setReassigningId(null)
    setConfirmState({ isOpen: false, action: null, payload: null })
  }

  async function handleConfirm() {
    const { action, payload } = confirmState
    try {
      if (action === 'cancel') await handleCancel(payload.id)
      if (action === 'close') await handleStatusChange(payload.id, 'Closed')
      if (action === 'reassign') await handleReassign(payload.id, payload.email, payload.name)
      if (action === 'delete') await handleDelete(payload.id)
    } catch (err) {
      console.error('[handleConfirm] error:', err)
    } finally {
      closeConfirm()
    }
  }

  function getConfirmContent() {
    const { action, payload } = confirmState

    if (action === 'cancel') {
      return {
        title: 'ยืนยันการยกเลิกคำขอ',
        message: 'ต้องการยกเลิกคำขอนี้ใช่หรือไม่? หลังยกเลิกแล้วเคสจะไม่อยู่ในกระบวนการต่อ',
        confirmText: 'ยืนยันการยกเลิก',
        variant: 'warning',
      }
    }

    if (action === 'close') {
      return {
        title: 'ปิดเคสนี้',
        message: 'ต้องการเปลี่ยนสถานะเป็น Closed ใช่หรือไม่? หลังจากนี้การแก้ไขบางส่วนอาจไม่สามารถทำได้',
        confirmText: 'ปิดเคส',
        variant: 'info',
      }
    }

    if (action === 'reassign') {
      return {
        title: 'ย้ายผู้ดูแลเคส',
        message: payload ? `ต้องการย้ายเคสนี้ไปให้ ${payload.name} ดูแลแทนใช่หรือไม่?` : '',
        confirmText: 'ยืนยันการย้าย',
        variant: 'warning',
      }
    }

    if (action === 'delete') {
      return {
        title: 'ลบคำขอออกจากระบบ',
        message: 'ต้องการลบรายการนี้ออกจากฐานข้อมูลและไฟล์ที่เกี่ยวข้องถาวรใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้',
        confirmText: 'ลบถาวร',
        variant: 'danger',
      }
    }

    return {
      title: 'ยืนยันการทำรายการ',
      message: '',
      confirmText: 'ยืนยัน',
      variant: 'info',
    }
  }

  const toggleSort = useCallback((field) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }, [sortField])

  const departments   = useMemo(() => [...new Set(requests.map((r) => r.department).filter(Boolean))].sort(), [requests])
  const assignees     = useMemo(() => [...new Set(requests.map((r) => r.assignedToName).filter(Boolean))].sort(), [requests])
  const businessUnits = useMemo(() => [...new Set(requests.map((r) => r.businessUnit).filter(Boolean))].sort(), [requests])
  const ranks         = useMemo(() => [...new Set(requests.map((r) => r.jg).filter(Boolean))].sort(), [requests])
  const years         = useMemo(() => {
    const yrs = [...new Set(requests.map((r) => r.createdAt?.toDate?.()?.getFullYear()).filter(Boolean))]
    return yrs.sort((a, b) => b - a).map(String) // เรียงจากใหม่→เก่า
  }, [requests])


  // ─── คำนวณจำนวนรายการในแต่ละ Tab (นับตาม visibility rule เดียวกับ displayed) ───
  const tabCounts = useMemo(() => {
    let base = [...requests]

    // Visibility logic
    if (role === 'manager') {
      // สำหรับ Manager: เห็นเฉพาะของตัวเอง + แผนกตัวเอง (หรือแผนกที่ override มาเทส)
      base = base.filter(r => r.requesterEmail === user.email || r.department === department)
    } else if (role === 'ta' && department) {
      // สำหรับ TA ถ้ามีการ override แผนก ให้กรองตามแผนก
      base = base.filter(r => r.department === department)
    }

    // Sub-filters (Tabs / Toggle)
    if (filterMine) base = base.filter(r => r.requesterEmail === user.email)
    if (filterMyCases) {
      base = role === 'admin'
        ? base.filter(r => Boolean(r.assignedTo) || Boolean(r.assignedToName))
        : base.filter(r => getAssignedEmail(r, allTAs) === user.email?.toLowerCase() || (r.assignedToName && (r.assignedToName === user.displayName || r.assignedToName === shortName(user.displayName))))
    }
    if (filterYear) base = base.filter(r => r.createdAt?.toDate?.()?.getFullYear() === Number(filterYear))

    const counts = { ทั้งหมด: base.length }
    ALL_STATUSES.forEach(s => { counts[s] = base.filter(r => r.status === s).length })
    return counts
  }, [requests, filterYear, filterMine, filterMyCases, user.email, user.displayName, role, department, allTAs])

  // ─── กรองและเรียงข้อมูลสำหรับแสดงในตาราง ───
  // Visibility: manager เห็นเฉพาะของตัวเอง + แผนก, ta/admin เห็นทั้งหมด
  const displayed = useMemo(() => {
    let list = [...requests]

    // Visibility logic (must match tabCounts)
    if (role === 'manager') {
      list = list.filter(r => r.requesterEmail === user.email || r.department === department)
    } else if (role === 'ta' && department) {
      list = list.filter(r => r.department === department)
    }

    if (filterMine) list = list.filter((r) => r.requesterEmail === user.email)
    if (filterMyCases) {
      list = role === 'admin'
        ? list.filter((r) => Boolean(r.assignedTo) || Boolean(r.assignedToName))
        : list.filter((r) => getAssignedEmail(r, allTAs) === user.email?.toLowerCase() || (r.assignedToName && (r.assignedToName === user.displayName || r.assignedToName === shortName(user.displayName))))
    }
    if (activeTab !== 'ทั้งหมด') list = list.filter((r) => r.status === activeTab)
    if (filterYear)     list = list.filter((r) => r.createdAt?.toDate?.()?.getFullYear() === Number(filterYear))
    if (filterEmpType)  list = list.filter((r) => r.employmentType === filterEmpType)
    if (filterJobType)  list = list.filter((r) => r.requestType === filterJobType)
    if (filterRank)     list = list.filter((r) => r.jg === filterRank)
    if (filterDept)     list = list.filter((r) => r.department === filterDept)
    if (filterBU)       list = list.filter((r) => r.businessUnit === filterBU)
    if (filterAssigned) list = list.filter((r) => r.assignedToName === filterAssigned)
    if (filterDateFrom) list = list.filter((r) => r.createdAt?.toDate?.() >= new Date(filterDateFrom))
    if (filterDateTo) { const to = new Date(filterDateTo); to.setHours(23, 59, 59); list = list.filter((r) => r.createdAt?.toDate?.() <= to) }
    if (focusMonth) {
      list = list.filter(r => {
        const d = r.createdAt?.toDate?.()
        if (!d) return false
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        return key === focusMonth
      })
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      list = list.filter((r) =>
        r.position?.toLowerCase().includes(q) ||
        r.department?.toLowerCase().includes(q) ||
        r.businessUnit?.toLowerCase().includes(q) ||
        r.requesterName?.toLowerCase().includes(q) ||
        r.assignedToName?.toLowerCase().includes(q) ||
        r.candidateName?.toLowerCase().includes(q) ||
        r.hcId?.toLowerCase().includes(q) ||
        r.id?.toLowerCase().includes(q) ||
        r.jg?.toLowerCase().includes(q) ||
        r.requestType?.toLowerCase().includes(q) ||
        r.employmentType?.toLowerCase().includes(q) ||
        (STATUS_CONFIG[r.status]?.label ?? r.status)?.toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      let aVal, bVal
      if (sortField === 'createdAt') {
        aVal = a.createdAt?.toDate?.()?.getTime() ?? 0
        bVal = b.createdAt?.toDate?.()?.getTime() ?? 0
      } else if (sortField === 'hcId') {
        const parseSeq = (id) => { const m = (id || '').match(/(\d+)-(\d+)$/); return m ? parseInt(m[1]) * 100000 + parseInt(m[2]) : 0 }
        aVal = parseSeq(a.hcId)
        bVal = parseSeq(b.hcId)
      } else {
        aVal = a[sortField] ?? ''
        bVal = b[sortField] ?? ''
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [requests, filterMine, filterMyCases, activeTab, filterYear, filterEmpType, filterJobType, filterRank, filterDept, filterBU, filterAssigned, filterDateFrom, filterDateTo, debouncedSearch, focusMonth, sortField, sortDir, user.email, user.displayName, role, department, allTAs])

  const hasChipFilters     = filterYear || filterEmpType || filterJobType || filterRank || filterDept || filterBU || filterAssigned
  const hasAdvancedFilters = hasChipFilters || filterDateFrom || filterDateTo

  function clearChips()    { setFilterYear(''); setFilterEmpType(''); setFilterJobType(''); setFilterRank(''); setFilterDept(''); setFilterBU(''); setFilterAssigned('') }
  function clearAdvanced() { clearChips(); setFilterDateFrom(''); setFilterDateTo('') }

  useEffect(() => { setPage(1) }, [activeTab, filterYear, filterEmpType, filterJobType, filterRank, filterDept, filterBU, filterAssigned, filterDateFrom, filterDateTo, debouncedSearch, focusMonth, filterMine, filterMyCases])

  // ปิด chip dropdown เมื่อคลิกนอก
  useEffect(() => {
    if (!openChip) return
    const close = () => setOpenChip(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openChip])

  const totalPages = Math.ceil(displayed.length / PAGE_SIZE)
  const paged = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin text-[#008065]" />
      <span>กำลังโหลดข้อมูล...</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">

      {/* Search + Filter toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
          <input
            id="rt-search" name="rt-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาตำแหน่ง, แผนก, TA, ผู้สมัคร, HCID, สถานะ..."
            className="w-full pl-8 pr-10 py-1.5 text-sm border border-gray-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#00ce7c]/30 transition-all font-medium"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X size={13} strokeWidth={3} />
            </button>
          )}
        </div>

        {showFilters && (
          <button
            onClick={() => setShowFilterBar(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm border transition-all font-medium ${showFilterBar || hasAdvancedFilters
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-white dark:bg-slate-900 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
          >
            <SlidersHorizontal size={13} />
            Filters
            {hasAdvancedFilters && (
              <span className="ml-1 bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                {[filterYear, filterDept, filterAssigned, filterDateFrom, filterDateTo].filter(Boolean).length}
              </span>
            )}
          </button>
        )}
        {hasAdvancedFilters && (
          <button onClick={clearAdvanced} className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500 hover:text-emerald-600 transition-colors font-medium">
            <X size={11} strokeWidth={3} /> ล้างค่าทิ้ง
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400 dark:text-slate-600 font-medium">{displayed.length} รายการ</span>
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 dark:border-slate-800 pb-0">
        {STATUS_TABS.map((tab) => {
          const active = activeTab === tab
          const count = tabCounts[tab] ?? 0
          const tabLabel = STATUS_CONFIG[tab]?.label ?? tab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold whitespace-nowrap transition-all border-b-2 -mb-px ${active
                  ? 'border-[#008065] text-[#008065]'
                  : 'border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'
                }`}
            >
              {tabLabel}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full leading-none transition-colors ${active
                    ? 'bg-[#008065] text-white'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
                  }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Chip Filters */}
      {showFilters && (() => {
        function ChipSelect({ id, label, value, onChange, options }) {
          return (
            <div className="relative" onMouseDown={e => e.stopPropagation()}>
              <button
                onClick={() => setOpenChip(openChip === id ? null : id)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap select-none
                  ${value
                    ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:text-emerald-600'}`}
              >
                <span>{value || label}</span>
                {value
                  ? <X size={10} className="cursor-pointer" onClick={e => { e.stopPropagation(); onChange(''); setOpenChip(null) }} />
                  : <ChevronDown size={10} />}
              </button>
              {openChip === id && (
                <div className="absolute top-full mt-1.5 z-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg min-w-40 py-1 max-h-56 overflow-y-auto">
                  {options.map(opt => (
                    <button key={opt} onMouseDown={() => { onChange(opt); setOpenChip(null) }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                        ${value === opt
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-500/10'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700'}`}>
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        }
        return (
          <div className="flex flex-wrap gap-2 items-center">
            <ChipSelect id="year"     label="ปี"             value={filterYear}     onChange={setFilterYear}     options={years} />
            <div className="w-px h-4 bg-gray-200 dark:bg-slate-700" />
            <ChipSelect id="empType"  label="Emp. Type"      value={filterEmpType}  onChange={setFilterEmpType}  options={['Monthly','Daily','Contract','Intern']} />
            <ChipSelect id="jobType"  label="Job Type"       value={filterJobType}  onChange={setFilterJobType}  options={['New HC','Replace']} />
            <ChipSelect id="rank"     label="Rank"           value={filterRank}     onChange={setFilterRank}     options={ranks} />
            <ChipSelect id="dept"     label="Department"     value={filterDept}     onChange={setFilterDept}     options={departments} />
            <ChipSelect id="bu"       label="Business Unit"  value={filterBU}       onChange={setFilterBU}       options={businessUnits} />
            <ChipSelect id="ta"       label="PIC / TA"       value={filterAssigned} onChange={setFilterAssigned} options={assignees} />
            <div className="w-px h-4 bg-gray-200 dark:bg-slate-700 mx-1" />
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} title="วันที่ตั้งแต่"
              className="text-[11px] border border-gray-200 dark:border-slate-700 rounded-full px-3 py-1.5 bg-white dark:bg-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/40" />
            <span className="text-gray-400 text-xs">–</span>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} title="ถึงวันที่"
              className="text-[11px] border border-gray-200 dark:border-slate-700 rounded-full px-3 py-1.5 bg-white dark:bg-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/40" />
            {hasAdvancedFilters && (
              <button onClick={clearAdvanced} className="text-[11px] text-gray-400 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1 transition-colors">
                <X size={11} /> ล้างทั้งหมด
              </button>
            )}
          </div>
        )
      })()}

      {/* Table */}
      {displayed.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-gray-200 bg-white">
          <p className="text-gray-400 font-medium">ไม่พบรายการ</p>
          {(hasAdvancedFilters || search || activeTab !== 'ทั้งหมด') && (
            <button onClick={() => { clearAdvanced(); setSearch(''); setActiveTab('ทั้งหมด') }} className="text-sm mt-2 hover:underline text-[#008065]">
              ล้าง filter ทั้งหมด
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-colors">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80 dark:bg-slate-800/50 backdrop-blur-sm">
                {[
                  { label: 'ID', field: 'hcId' },
                  { label: 'ประเภท', field: 'requestType' },
                  { label: 'ตำแหน่ง / JG', field: 'position' },
                  { label: 'แผนก', field: 'department' },
                  { label: 'ผู้ยื่น', field: 'requesterName' },
                  { label: 'TA', field: 'assignedToName' },
                  { label: 'สถานะ', field: 'status' },
                  { label: 'วันที่ยื่น', field: 'createdAt' },
                  { label: 'SLA', field: null },
                  { label: 'Actions', field: null },
                ].map(({ label, field }) => (
                  <th
                    key={label}
                    className={`px-4 py-3 text-left text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest ${field ? 'cursor-pointer select-none hover:text-[#008065] dark:hover:text-emerald-400' : ''} transition-colors`}
                    onClick={field ? () => toggleSort(field) : undefined}
                  >
                    <span className="flex items-center gap-1.5">
                      {label}
                      {field && <SortIcon field={field} sortField={sortField} sortDir={sortDir} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
              {paged.map((req) => {
                // ─── Permission flags สำหรับแต่ละแถว ───
                const isOwner = req.requesterEmail === user.email
                const isTA = role === 'ta' || role === 'admin'
                const isAdmin = role === 'admin'
                const isExpanded = expandedId === req.id
                const canViewFile = req.jdFilePath && (isTA || isOwner)
                const canCancel = isAdmin || (isTA && req.status !== 'Closed' && req.status !== 'Cancelled') || (isOwner && req.status === 'Open')
                const canClaim = isTA && req.status === 'Open'
                const canUpdateStatus = isAdmin || (filterMyCases && isTA && req.status !== 'Cancelled' && req.status !== 'Closed')
                const canReassign = isTA && (isAdmin || filterMyCases) && req.status !== 'Cancelled' && req.status !== 'Closed' && allTAs.length > 0
                const isBusy = updating === req.id

                async function handleOpenFile(e) {
                  e.stopPropagation()
                  const url = await getJDSignedUrl(req.jdFilePath)
                  if (url) window.open(url, '_blank')
                }

                return (
                  <Fragment key={req.id}>
                    <tr
                      className={`transition-all cursor-pointer group ${isExpanded ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 'hover:bg-gray-50/80 dark:hover:bg-slate-800/80'}`}
                      onClick={() => setExpandedId(isExpanded ? null : req.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronRight size={13} strokeWidth={3} className={`text-gray-300 dark:text-slate-700 transition-transform shrink-0 ${isExpanded ? 'rotate-90 text-emerald-500' : 'rotate-0 group-hover:text-gray-400'}`} />
                          <span className="font-mono text-[10px] font-bold text-gray-400 dark:text-slate-600 tracking-tighter uppercase">{req.hcId || req.id.slice(0, 7)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-tight ${req.requestType === 'New HC'
                            ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400'
                            : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                          }`}>
                          {req.requestType === 'New HC' ? 'New HC' : 'Replace'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-gray-800 dark:text-gray-200 leading-tight">{req.position}</p>
                        {req.jg && <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 mt-0.5 uppercase tracking-wide">{getJGLabel(req.jg)}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400 font-medium">{req.department}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-slate-500 text-[11px] font-medium">{req.requesterName}</td>
                      <td className="px-4 py-3">
                        {req.assignedToName
                          ? <span className="text-xs font-bold text-emerald-600 dark:text-emerald-500">{req.assignedToName}</span>
                          : <span className="text-slate-300 dark:text-slate-800">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={req.status} /></td>
                      <td className="px-4 py-3 text-gray-400 dark:text-slate-600 text-[11px] font-medium font-mono whitespace-nowrap">
                        {req.createdAt?.toDate?.().toLocaleDateString('th-TH') ?? '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <SLABadge req={req} />
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 flex-wrap">
                          {canViewFile && (
                            <button onClick={handleOpenFile} title={req.jdFileName || 'ไฟล์ JD'}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold border rounded-lg transition-all bg-emerald-50 dark:bg-emerald-950/30 text-[#008065] dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 uppercase tracking-tight"
                            >
                              <FileText size={11} strokeWidth={3} /> JD
                            </button>
                          )}
                          {canClaim && (
                            <button onClick={(e) => { e.stopPropagation(); handleClaim(req.id) }} disabled={isBusy}
                              className="flex items-center gap-1.5 px-3 py-1 bg-[#008065] text-white text-[10px] font-bold rounded-lg disabled:opacity-50 transition-all hover:bg-emerald-700 shadow-md shadow-emerald-500/20 uppercase tracking-tight"
                            >
                              {isBusy ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} strokeWidth={3} />}
                              รับเรื่อง
                            </button>
                          )}
                          {canUpdateStatus && (
                            <select
                              value={req.status}
                              onClick={e => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation()
                                const val = e.target.value
                                if (val === 'Closed') { openConfirm('close', { id: req.id }); return }
                                if (val === 'Offering')   { setOfferingModal({ isOpen: true, id: req.id, mode: 'offering' }); setOfferingCandidateName(req.candidateName || ''); return }
                                if (val === 'Onboarding') { setOfferingModal({ isOpen: true, id: req.id, mode: 'onboarding' }); setOfferingCandidateName(req.candidateName || ''); return }
                                handleStatusChange(req.id, val)
                              }}
                              className="text-[10px] font-bold border border-emerald-500/30 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-[#008065] dark:text-emerald-400 focus:outline-none cursor-pointer uppercase tracking-tight"
                            >
                              {getAvailableStatuses(req.status, isAdmin).map((s) => (
                                <option key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</option>
                              ))}
                            </select>
                          )}
                          {/* Offering / Onboarding → Reject พร้อมเหตุผล */}
                          {isTA && ['Offering', 'Onboarding'].includes(req.status) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setRejectModal({ isOpen: true, id: req.id }) }}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-red-600 dark:text-red-400 text-[10px] font-bold border border-red-300 dark:border-red-900/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-all uppercase tracking-tight"
                            >
                              <XCircle size={11} strokeWidth={3} /> Reject
                            </button>
                          )}
                          {/* Rejected → Reopen: เปิด recruit ใหม่ */}
                          {isTA && req.status === 'Rejected' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReopen(req.id) }}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-yellow-700 dark:text-yellow-400 text-[10px] font-bold border border-yellow-300 dark:border-yellow-900/30 rounded-lg hover:bg-yellow-50 dark:hover:bg-yellow-950/20 transition-all uppercase tracking-tight"
                            >
                              <UserCheck size={11} strokeWidth={3} /> Recruit ใหม่
                            </button>
                          )}
                          {canReassign && (
                            reassigningId === req.id ? (
                              <select
                                value=""
                                onClick={e => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation()
                                  const selected = allTAs.find(t => t.email === e.target.value)
                                  if (selected) openConfirm('reassign', { id: req.id, email: selected.email, name: selected.name })
                                  else setReassigningId(null)
                                }}
                                onBlur={() => setTimeout(() => setReassigningId(null), 200)}
                                autoFocus
                                className="text-[10px] font-bold border border-emerald-500/30 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-[#008065] dark:text-emerald-400 focus:outline-none cursor-pointer"
                              >
                                <option value="">ย้ายไปที่...</option>
                                {allTAs.map(t => (
                                  <option key={t.email} value={t.email}>{t.name}</option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setReassigningId(req.id) }}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold border rounded-lg transition-all bg-white dark:bg-slate-900 text-[#008065] dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 uppercase tracking-tight"
                              >
                                <Pencil size={11} strokeWidth={3} />
                                ย้ายคนดูแลเคส
                              </button>
                            )
                          )}
                          {canCancel && (
                            <button onClick={(e) => { e.stopPropagation(); openConfirm('cancel', { id: req.id }) }} disabled={isBusy}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-red-500 dark:text-red-400 text-[10px] font-bold border border-red-200 dark:border-red-900/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-all uppercase tracking-tight"
                            >
                              {isBusy ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} strokeWidth={3} />}
                              ยกเลิก
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                // รองรับทั้ง Firestore Timestamp (.toDate()) และ ISO string
                                const toJS = (v) => {
                                  if (!v) return null
                                  const d = v?.toDate?.() ?? new Date(v)
                                  return isNaN(d) ? null : d
                                }
                                const slaD     = toJS(req.slaStartDate)
                                const createdD = toJS(req.createdAt)
                                const existing = slaD
                                  ? slaD.toISOString().slice(0,10)
                                  : createdD ? createdD.toISOString().slice(0,10) : ''
                                setSlaTestDate(existing)
                                setSlaTestModal({
                                  isOpen: true,
                                  id: req.id,
                                  hcId: req.hcId || null,
                                  originalCreatedAt: createdD ? createdD.toISOString() : null,
                                })
                              }}
                              disabled={isBusy}
                              className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded-lg disabled:opacity-50 transition-all uppercase tracking-tight shadow-sm
                                ${req.slaStartDate
                                  ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/50'
                                  : 'text-purple-700 bg-purple-100 dark:bg-purple-900/40 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800/50'
                                }`}
                            >
                              ⏱ SLA{req.slaStartDate ? ' ✓' : ''}
                            </button>
                          )}
                          {isAdmin && (
                            <button onClick={(e) => { e.stopPropagation(); openConfirm('delete', { id: req.id }) }} disabled={isBusy}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-white bg-red-600 dark:bg-red-700 text-[10px] font-bold rounded-lg hover:bg-red-700 dark:hover:bg-red-800 disabled:opacity-50 transition-all uppercase tracking-tight shadow-sm"
                            >
                              {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} strokeWidth={3} />}
                              ลบ
                            </button>
                          )}
                        </div>

                      </td>
                    </tr>

                    {/* Expanded Detail Row */}
                    {isExpanded && (
                      <tr key={`${req.id}-detail`} className="bg-emerald-50/50 dark:bg-emerald-900/10">
                        <td colSpan={9} className="px-6 pb-6 pt-0">
                          <div className="border border-emerald-500/20 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 bg-white dark:bg-slate-900 shadow-xl shadow-emerald-900/5 transition-colors">

                            {/* จำนวน HC + วันที่ */}
                            <div className="flex flex-col gap-5">
                              <div>
                                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                  <Users size={12} strokeWidth={3} /> จำนวน HC
                                </p>
                                <p className="text-xl font-black text-[#008065] dark:text-emerald-500 tabular-nums">{req.headcount ?? 1} <span className="text-sm font-bold text-gray-400">คน</span></p>
                              </div>
                              {/* Candidate name — editable inline สำหรับ TA/Admin */}
                              {(isTA || isAdmin) && (
                                <div>
                                  <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                    <UserCheck size={12} strokeWidth={3} /> Candidate
                                  </p>
                                  {candidateEditId === req.id ? (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        autoFocus
                                        value={candidateEditVal}
                                        onChange={e => setCandidateEditVal(e.target.value)}
                                        onKeyDown={async e => {
                                          if (e.key === 'Enter') {
                                            await updateDoc(doc(db, 'hc_requests', req.id), { candidateName: candidateEditVal.trim() })
                                            sendStatusUpdate(req.id, req.status, req.assignedToName, null, req.startDate, candidateEditVal.trim(), req.hcId)
                                            setCandidateEditId(null)
                                          } else if (e.key === 'Escape') {
                                            setCandidateEditId(null)
                                          }
                                        }}
                                        placeholder="ชื่อ Candidate..."
                                        className="flex-1 text-sm border border-indigo-200 dark:border-indigo-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400 min-w-0"
                                      />
                                      <button
                                        onClick={async () => {
                                          await updateDoc(doc(db, 'hc_requests', req.id), { candidateName: candidateEditVal.trim() })
                                          sendStatusUpdate(req.id, req.status, req.assignedToName, null, req.startDate, candidateEditVal.trim(), req.hcId)
                                          setCandidateEditId(null)
                                        }}
                                        className="text-[10px] font-black px-2 py-1 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors shrink-0"
                                      >
                                        ✓
                                      </button>
                                      <button onClick={() => setCandidateEditId(null)} className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0">✕</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setCandidateEditId(req.id); setCandidateEditVal(req.candidateName || '') }}
                                      className="flex items-center gap-1.5 group text-left"
                                    >
                                      {req.candidateName
                                        ? <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">{req.candidateName}</span>
                                        : <span className="text-xs text-gray-300 dark:text-slate-700 italic">— กดเพื่อกรอกชื่อ</span>
                                      }
                                      <Pencil size={10} strokeWidth={2.5} className="text-gray-300 dark:text-slate-700 group-hover:text-indigo-400 transition-colors shrink-0" />
                                    </button>
                                  )}
                                </div>
                              )}
                              {!isTA && !isAdmin && req.candidateName && (
                                <div>
                                  <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                    <UserCheck size={12} strokeWidth={3} /> Candidate
                                  </p>
                                  <p className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">{req.candidateName}</p>
                                </div>
                              )}
                              {req.startDate && (
                                <div>
                                  <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                    <Calendar size={12} strokeWidth={3} /> วันเริ่มงาน
                                  </p>
                                  <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{(() => { const d = new Date(req.startDate); return isNaN(d) ? req.startDate : d.getDate() + '-' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + '-' + d.getFullYear() })()}</p>
                                </div>
                              )}
                              {req.rejectReason && (
                                <div>
                                  <p className="text-[10px] font-black text-red-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                    <XCircle size={12} strokeWidth={3} /> เหตุผลการ Reject
                                  </p>
                                  <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2">
                                    <p className="text-sm text-red-700 dark:text-red-400 font-medium leading-relaxed">{req.rejectReason}</p>
                                  </div>
                                </div>
                              )}
                              {req.requestType === 'Replacement' && (
                                <div>
                                  <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                    <Calendar size={12} strokeWidth={3} /> วันที่ลาออก (LWD)
                                  </p>
                                  <p className="text-sm font-extrabold text-gray-700 dark:text-gray-200">{req.targetStartDate || '—'}</p>
                                </div>
                              )}
                              {req.requestType === 'Replacement' && req.replacementFor && (
                                <div>
                                  <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-2">ทดแทนพนักงานเดิม</p>
                                  <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-500 drop-shadow-sm">{req.replacementFor}</p>
                                </div>
                              )}
                            </div>

                            {/* เหตุผล */}
                            <div>
                              <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                <AlignLeft size={12} strokeWidth={3} /> เหตุผลในการขอ
                              </p>
                              <div className="bg-gray-50 dark:bg-slate-800/50 p-3 rounded-xl border border-gray-100 dark:border-slate-800">
                                <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap italic font-medium">"{req.reason || '—'}"</p>
                              </div>
                            </div>

                            {/* Requirements */}
                            <div>
                              <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                <ClipboardList size={12} strokeWidth={3} /> Requirements
                              </p>
                              <div className="bg-gray-50 dark:bg-slate-800/50 p-3 rounded-xl border border-gray-100 dark:border-slate-800">
                                <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-medium">{req.requirements || '—'}</p>
                              </div>
                              {/* วันทำงาน + กะ — แสดงเฉพาะ TA/Admin */}
                              {isTA && (req.workDaysPerWeek || req.shift) && (
                                <div className="mt-4 flex gap-4">
                                  {req.workDaysPerWeek && (
                                    <div className="flex-1 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl px-3 py-2 border border-indigo-100 dark:border-indigo-500/20">
                                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">วัน/สัปดาห์</p>
                                      <p className="text-sm font-black text-indigo-700 dark:text-indigo-300">{req.workDaysPerWeek} วัน</p>
                                    </div>
                                  )}
                                  {req.shift && (
                                    <div className="flex-1 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl px-3 py-2 border border-indigo-100 dark:border-indigo-500/20">
                                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">กะ</p>
                                      <p className="text-sm font-black text-indigo-700 dark:text-indigo-300">{req.shift}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Meta */}
                            <div className="flex flex-col gap-5">
                              <div>
                                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-2">ข้อมูลผู้ยื่น</p>
                                <p className="text-sm font-bold text-gray-800 dark:text-gray-200">{req.requesterName}</p>
                                <p className="text-[11px] font-bold text-gray-400 dark:text-slate-600 transition-colors hover:text-[#008065]">{req.requesterEmail}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-2">Timestamp</p>
                                <p className="text-sm font-bold text-gray-500 dark:text-slate-400 font-mono italic">
                                  {req.createdAt?.toDate?.().toLocaleString('th-TH') ?? '—'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* ── CV Files — TA อัพโหลด/ลบได้, Manager ดูอย่างเดียว ── */}
                          {(isTA || role === 'manager' || isOwner) && (
                            <div className="mt-4 border border-gray-100 dark:border-slate-800 rounded-2xl p-4 bg-white dark:bg-slate-900">
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                                  <File size={12} strokeWidth={3} /> CV / Resume
                                </p>
                                {isTA && (
                                  <label className={`flex items-center gap-1.5 cursor-pointer text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 transition-all ${cvUploading.has(req.id) ? 'opacity-50 pointer-events-none' : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'}`}>
                                    {cvUploading.has(req.id)
                                      ? <><Loader2 size={12} strokeWidth={3} className="animate-spin" /> กำลังอัพโหลด...</>
                                      : <><Upload size={12} strokeWidth={3} /> อัพโหลด CV</>
                                    }
                                    <input
                                      type="file"
                                      className="hidden"
                                      accept=".pdf,.doc,.docx"
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => { e.stopPropagation(); handleCVUpload(req.id, e.target.files[0]); e.target.value = '' }}
                                    />
                                  </label>
                                )}
                              </div>
                              {(!req.cvFiles || req.cvFiles.length === 0) ? (
                                <p className="text-xs text-gray-400 dark:text-slate-600 italic">ยังไม่มีไฟล์ CV</p>
                              ) : (
                                <div className="flex flex-col gap-1.5">
                                  {req.cvFiles.map((cv, idx) => (
                                    <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-800 group">
                                      <button
                                        onClick={async (e) => { e.stopPropagation(); const url = await getCVSignedUrl(cv.path); if (url) window.open(url, '_blank') }}
                                        className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors truncate"
                                        title={cv.name}
                                      >
                                        <FileText size={13} strokeWidth={2.5} className="shrink-0 text-emerald-500" />
                                        <span className="truncate max-w-[200px]">{cv.name}</span>
                                      </button>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] text-gray-400 dark:text-slate-600 hidden group-hover:inline">{cv.uploadedBy?.split('@')[0]}</span>
                                        {isTA && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteCV(req.id, cv) }}
                                            className="text-gray-300 dark:text-slate-700 hover:text-red-500 transition-colors"
                                            title="ลบไฟล์"
                                          >
                                            <X size={13} strokeWidth={3} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* ── Stage Duration (simplified: Open → Offering → Close/Reject) ── */}
                          {req.statusHistory?.length > 0 && (() => {
                            const KEY_STAGES = ['Open', 'Offering', 'Onboarding', 'Rejected', 'Closed', 'Cancelled']
                            const STAGE_CFG = {
                              Open:       { label: 'Open',       dot: 'bg-gray-400',    badge: 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400',             text: 'text-gray-500 dark:text-slate-400' },
                              Offering:   { label: 'Offering',   dot: 'bg-indigo-500',  badge: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',     text: 'text-indigo-600 dark:text-indigo-400' },
                              Onboarding: { label: 'W.Onboarding', dot: 'bg-teal-500', badge: 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',             text: 'text-teal-600 dark:text-teal-400' },
                              Rejected:   { label: 'Rejected',   dot: 'bg-red-500',     badge: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',                 text: 'text-red-500 dark:text-red-400' },
                              Closed:     { label: 'Closed',     dot: 'bg-emerald-500', badge: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
                              Cancelled:  { label: 'Cancelled',  dot: 'bg-slate-400',   badge: 'bg-slate-100 dark:bg-slate-800 text-slate-500',                               text: 'text-slate-400' },
                            }

                            // เรียง history ตามเวลา
                            const sorted = [...req.statusHistory].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))

                            // สร้าง full timeline เริ่มจาก Open (createdAt)
                            const hasOpen = sorted[0]?.status === 'Open'
                            const full = hasOpen ? sorted : [
                              { status: 'Open', changedAt: req.createdAt?.toDate?.().toISOString() },
                              ...sorted,
                            ]

                            // กรองเฉพาะ key stages (ตัด Recruiting/Interviewing ออก)
                            // เก็บไว้ทุก Rejected เพื่อแสดงประวัติ reject ซ้ำ
                            const keyEntries = full.filter(e => KEY_STAGES.includes(e.status))

                            // คำนวณ days ระหว่าง key stages
                            // ช่วง Open → Offering = นับวันรวมตั้งแต่ open (ผ่าน Recruiting/Interview ด้วย)
                            const segments = keyEntries.map((entry, i) => {
                              const start = new Date(entry.changedAt)
                              const nextKey = keyEntries[i + 1]
                              const end = nextKey ? new Date(nextKey.changedAt) : new Date()
                              const days = Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)))
                              const dateStr = start.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
                              return { ...entry, days, isCurrent: !nextKey, dateStr }
                            })

                            const totalDays = getDaysOpen(req)
                            const isDone = ['Closed', 'Cancelled'].includes(req.status)

                            return (
                              <div className="mt-4 rounded-2xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest">⏱ Stage Duration</p>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-gray-400 dark:text-slate-600">รวม</span>
                                    <span className="text-sm font-black text-gray-700 dark:text-gray-200 tabular-nums">{totalDays}</span>
                                    <span className="text-[10px] text-gray-400 dark:text-slate-500">วัน</span>
                                  </div>
                                </div>
                                <div className="flex flex-col">
                                  {segments.map((seg, i) => {
                                    const c = STAGE_CFG[seg.status] || STAGE_CFG.Open
                                    const isLast = i === segments.length - 1
                                    return (
                                      <div key={i} className="flex items-stretch gap-3">
                                        <div className="flex flex-col items-center w-4 flex-shrink-0 pt-1.5">
                                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.dot} ${seg.isCurrent && !isDone ? 'animate-pulse' : ''}`}/>
                                          {!isLast && <span className="flex-1 w-px bg-gray-200 dark:bg-slate-700 my-1"/>}
                                        </div>
                                        <div className={`flex items-center justify-between flex-1 ${isLast ? 'pb-0' : 'pb-3'}`}>
                                          <div className="flex items-center gap-2">
                                            <span className={`text-[11px] font-black uppercase tracking-wide ${c.text}`}>{c.label}</span>
                                            <span className="text-[10px] text-gray-400 dark:text-slate-600">{seg.dateStr}</span>
                                            {seg.isCurrent && !isDone && (
                                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">กำลังดำเนินการ</span>
                                            )}
                                          </div>
                                          <span className={`text-[11px] font-black tabular-nums px-2 py-0.5 rounded-lg ${c.badge}`}>
                                            {seg.isCurrent && !isDone ? `${seg.days}+ วัน` : `${seg.days} วัน`}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })()}

                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
              <span className="text-xs text-gray-400 dark:text-slate-500 font-medium">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, displayed.length)} จาก {displayed.length} รายการ
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  ← ก่อนหน้า
                </button>
                <span className="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  ถัดไป →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={closeConfirm}
        onConfirm={handleConfirm}
        {...getConfirmContent()}
      />

      {/* ── Offering Modal: กรอกวันเริ่มงาน ── */}
      {/* Reject Modal — กรอกเหตุผลการ Reject */}
      {rejectModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-black text-gray-800 dark:text-gray-100 mb-1">Reject ผู้สมัคร</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">กรุณาระบุเหตุผลการ Reject (ถ้ามี)</p>
            <label className="block text-[10px] font-black text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-2">เหตุผล</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="เช่น ผู้สมัครขอถอนตัว,ป่วย,ไม่สะดวกมาเริ่มงานแล้ว (แอ๊บ) (ถ้าไม่ใส่จะขึ้นว่า No Reason)"
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 text-sm font-medium resize-none"
              autoFocus
            />
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setRejectModal({ isOpen: false, id: null }); setRejectReason('') }}
                className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleRejectConfirm}
                className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors shadow-md shadow-red-500/20"
              >
                ยืนยัน Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin: แก้ SLA ย้อนหลัง Modal ── */}
      {slaTestModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-black text-gray-800 dark:text-gray-100 mb-1">⏱ แก้ SLA ย้อนหลัง</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
              กำหนดวันเปิดเคส (SLA Start) สำหรับ record นี้<br/>
              <span className="text-amber-600 dark:text-amber-400">createdAt จริงไม่ถูกแก้</span> — ใช้ field แยก <code className="text-[10px] bg-gray-100 dark:bg-slate-800 px-1 rounded">slaStartDate</code>
            </p>
            <label className="block text-[10px] font-black text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-2">วันเปิดเคส (SLA Start)</label>
            <input
              id="sla-fix-date" name="sla-fix-date"
              type="date"
              value={slaTestDate}
              onChange={(e) => setSlaTestDate(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-sm font-medium"
              autoFocus
            />
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setSlaTestModal({ isOpen: false, id: null }); setSlaTestDate('') }}
                className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => handleSlaFixSave('')}  // '' = reset → slaStartDate = null
                className="px-3 py-2.5 text-xs font-bold rounded-xl border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="ล้าง slaStartDate กลับไปใช้ createdAt auto"
              >
                รีเซ็ต
              </button>
              <button
                onClick={() => handleSlaFixSave()}
                disabled={!slaTestDate}
                className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-md shadow-amber-500/20 disabled:opacity-50"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {offeringModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-black text-gray-800 dark:text-gray-100 mb-1">
              {offeringModal.mode === 'offering' ? '📋 Offering' : '🟦 Waiting Onboarding'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
              {offeringModal.mode === 'offering' ? 'กรอกชื่อผู้สมัครที่ได้รับ offer' : 'กรุณากรอกข้อมูลผู้สมัครที่รับ offer'}
            </p>

            <label className="block text-[10px] font-black text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-2">
              ชื่อ Candidate {offeringModal.mode === 'onboarding' ? '*' : '(optional)'}
            </label>
            <input
              id="offering-candidate" name="offering-candidate"
              type="text"
              value={offeringCandidateName}
              onChange={(e) => setOfferingCandidateName(e.target.value)}
              placeholder="ชื่อ-นามสกุล ผู้สมัคร"
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm font-medium mb-4"
              autoFocus
            />

            {offeringModal.mode === 'offering' && (
              <>
                <label className="block text-[10px] font-black text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-2">
                  ลิ้ง CV (optional)
                </label>
                <input
                  id="offering-cv-url" name="offering-cv-url"
                  type="url"
                  value={offeringCvUrl}
                  onChange={(e) => setOfferingCvUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm font-medium mb-4"
                />
                <label className="block text-[10px] font-black text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-2">
                  วัน Offering <span className="text-gray-400 font-normal normal-case">(optional — ปล่อยว่าง = วันนี้)</span>
                </label>
                <input
                  id="offering-custom-date" name="offering-custom-date"
                  type="date"
                  value={offeringCustomDate}
                  onChange={(e) => setOfferingCustomDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm font-medium mb-4"
                />
              </>
            )}

            {offeringModal.mode === 'onboarding' && (
              <>
                <label className="block text-[10px] font-black text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-2">วันเริ่มงาน *</label>
                <input
                  id="offering-start-date" name="offering-start-date"
                  type="date"
                  value={offeringStartDate}
                  onChange={(e) => setOfferingStartDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm font-medium"
                />
              </>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setOfferingModal({ isOpen: false, id: null, mode: 'onboarding' }); setOfferingStartDate(''); setOfferingCandidateName(''); setOfferingCvUrl(''); setOfferingCustomDate('') }}
                className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleOfferingConfirm}
                disabled={offeringModal.mode === 'onboarding' && (!offeringStartDate || !offeringCandidateName.trim())}
                className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-md ${offeringModal.mode === 'offering' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-500/20'}`}
              >
                {offeringModal.mode === 'offering' ? 'ยืนยัน Offering' : 'ยืนยัน Onboarding'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
