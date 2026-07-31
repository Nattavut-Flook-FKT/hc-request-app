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
import { collection, onSnapshot, orderBy, query, doc, updateDoc, addDoc, getDocs, where, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, limit, Timestamp } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { generateHCID } from '@/features/hc-request/hcId'
import { sendStatusUpdate, sendToWebhook, sendDeleteToSheets, updateOpenDateInSheets, updateStartDateInSheets, reportClientError } from '@/libs/webhook'
import { getJGLabel } from '@/config/jobGrades'
import { slaLimit } from '@/features/dashboard/sla'
import { isEnglishName, generateFreshketEmail } from '@/utils/email'
import { logAudit } from '@/features/audit-log/auditLog'
import { Loader2, UserCheck, XCircle, ChevronUp, ChevronDown, ChevronsUpDown, SlidersHorizontal, X, FileText, Search, ChevronRight, Users, Calendar, AlignLeft, ClipboardList, Pencil, Trash2, Upload, File } from 'lucide-react'
import { getJDSignedUrl, deleteJDFile, uploadCVFile, getCVSignedUrl, deleteCVFile } from '@/libs/supabase'
import ConfirmModal from '@/components/ui/ConfirmModal'

// ─── สี Badge ของแต่ละสถานะ — DS Light-variant recipe (functional color-coding, DS-#010) ───
const STATUS_CONFIG = {
  Open:             { label: 'Open',              bg: 'bg-yellow-50',      text: 'text-yellow-900',      border: 'border-yellow-100' },
  Recruiting:       { label: 'Recruiting',        bg: 'bg-blue-50',        text: 'text-blue-900',        border: 'border-blue-100' },
  Interviewing:     { label: 'Interviewing',      bg: 'bg-orange-50',      text: 'text-orange-900',      border: 'border-orange-100' },
  Offering:         { label: 'Offering',          bg: 'bg-purple-50',     text: 'text-purple-900',      border: 'border-purple-100' },
  Onboarding:       { label: 'W.Onboarding',      bg: 'bg-teal-50',        text: 'text-teal-900',        border: 'border-teal-100' },
  Rejected:         { label: 'Rejected',          bg: 'bg-red-50',         text: 'text-red-700',         border: 'border-red-100' },
  NoShow:           { label: 'No Show',           bg: 'bg-pink-50',        text: 'text-pink-900',        border: 'border-pink-100' },
  Closed:           { label: 'Closed',            bg: 'bg-green-fresh-50', text: 'text-green-fresh-900', border: 'border-green-fresh-100' },
  Cancelled:        { label: 'Cancelled',         bg: 'bg-neutral-50',     text: 'text-neutral-500',     border: 'border-neutral-100' },
  OnHold:           { label: 'On Hold',           bg: 'bg-banana-50',      text: 'text-banana-900',      border: 'border-banana-100' },
  Confidential:     { label: 'Confidential',      bg: 'bg-neutral-900',    text: 'text-neutral-50',      border: 'border-neutral-900' },
  InternalTransfer: { label: 'Internal Transfer', bg: 'bg-blue-600',       text: 'text-neutral-50',      border: 'border-blue-600' },
  PendingApproval:  { label: 'รออนุมัติ',          bg: 'bg-purple-50',      text: 'text-purple-900',      border: 'border-purple-100' },
  RejectedByCEO:    { label: 'ไม่อนุมัติ',          bg: 'bg-red-50',         text: 'text-red-700',         border: 'border-red-100' },
}

// ─── Tab list และสถานะที่ TA สามารถเปลี่ยนได้ (ยกเว้น Open) ───
const STATUS_TABS = ['ทั้งหมด', 'Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding', 'Rejected', 'NoShow', 'Closed', 'Cancelled', 'OnHold', 'Confidential', 'InternalTransfer']
// PendingApproval/RejectedByCEO (CEO approval gate, beta): TA เปลี่ยนสถานะนี้เองไม่ได้ — โผล่แค่ฝั่ง admin
// เพื่อ oversight (ต่อท้าย STATUS_TABS แบบมีเงื่อนไข role ตอน render — ดูจุดใช้งาน)
const CEO_APPROVAL_STATUS_TABS = ['PendingApproval', 'RejectedByCEO']
const TA_STATUSES = ['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding', 'Closed', 'OnHold', 'Confidential', 'InternalTransfer']
const ALL_STATUSES = ['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding', 'Rejected', 'NoShow', 'Closed', 'Cancelled', 'OnHold', 'Confidential', 'InternalTransfer', ...CEO_APPROVAL_STATUS_TABS]

// สถานะที่ถือว่า "จบแล้ว" — รวมกันเป็น tab เดียวชื่อ "ประวัติ" เฉพาะตอน filterMine (หน้า "คำขอของฉัน")
// pattern เดียวกับ ManagerRequestsView.jsx HISTORY_STATUSES
const HISTORY_TAB_STATUSES = ['Closed', 'Cancelled', 'Rejected', 'NoShow']

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
  const cfg = STATUS_CONFIG[status] ?? { label: status, bg: 'bg-neutral-50', text: 'text-neutral-500', border: 'border-neutral-100' }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
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

// แสดงป้าย SLA: dot สีตามสถานะ — pause / เกิน limit / เกินครึ่ง limit / ปกติ
// limit ต่อ request มาจาก slaLimit(): Tech หรือ JG9+ = 45 วัน, ต่ำกว่า = 30 วัน
function SLABadge({ req }) {
  const days = getDaysOpen(req)
  if (days === null) return null
  const done   = ['Closed', 'Cancelled', 'NoShow'].includes(req.status)
  const paused = ['Offering', 'Onboarding'].includes(req.status)
  if (done) return <span className="text-[11px] font-bold text-neutral-400 tabular-nums">{days}d</span>
  if (paused) return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-neutral-100 bg-neutral-50 px-1.5 py-0.5 text-[11px] font-bold text-neutral-500">
      <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" /> {days}d
    </span>
  )
  const limit = slaLimit(req)
  const style = days > limit
    ? 'text-red-700 bg-red-50 border-red-100'
    : days > limit / 2
      ? 'text-yellow-900 bg-yellow-50 border-yellow-100'
      : 'text-green-fresh-900 bg-green-fresh-50 border-green-fresh-100'
  const dotColor = days > limit ? 'bg-red-500' : days > limit / 2 ? 'bg-yellow-500' : 'bg-green-fresh-500'
  return (
    <span title={`SLA ${limit} วัน`} className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} /> {days}d
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
  if (sortField !== field) return <ChevronsUpDown size={12} strokeWidth={1} absoluteStrokeWidth className="text-neutral-300" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} strokeWidth={1} absoluteStrokeWidth className="text-dark-green-700" />
    : <ChevronDown size={12} strokeWidth={1} absoluteStrokeWidth className="text-dark-green-700" />
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
  const [itEmailVal, setItEmailVal] = useState('') // อีเมลแจ้ง IT — ถ้าว่าง ใช้ค่า auto-generate จากชื่อ
  // Reject modal: กรอกเหตุผลก่อน Reject
  const [rejectModal, setRejectModal] = useState({ isOpen: false, id: null })
  const [rejectReason, setRejectReason] = useState('')
  // Admin: แก้ createdAt เพื่อทดสอบ SLA
  const [slaTestModal, setSlaTestModal] = useState({ isOpen: false, id: null, hcId: null, originalCreatedAt: null })
  const [slaTestDate, setSlaTestDate] = useState('')
  // TA/Admin: แก้วันเริ่มงาน (พนักงานขอเลื่อนวันเริ่มงาน) — ไม่กระทบสถานะ, sync Sheets + Slack + audit
  const [startDateModal, setStartDateModal] = useState({ isOpen: false, id: null, hcId: null, oldDate: '' })
  const [newStartDateVal, setNewStartDateVal] = useState('')
  const [startDateReason, setStartDateReason] = useState('')
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
      sendStatusUpdate(id, 'Cancelled', null, null, null, null, req?.hcId, null, false, null, null, req?.requesterEmail)
      logAudit({ requestId: id, action: 'Cancel', by: user.email, byName: user.displayName, fromStatus: req?.status, toStatus: 'Cancelled', position: req?.position, department: req?.department })
    } catch (err) {
      console.error('[handleCancel]', err)
      reportClientError('handleCancel', err, { hcId: req?.hcId })
    } finally {
      setUpdating(null)
    }
  }

  async function handleClaim(id) {
    setUpdating(id)
    const req = requests.find((r) => r.id === id)
    try {
      await updateDoc(doc(db, 'hc_requests', id), { status: 'Recruiting', assignedTo: user.email, assignedToName: shortName(user.displayName), assignedAt: serverTimestamp(), statusHistory: arrayUnion(buildHistoryEntry('Recruiting', user)) })
      sendStatusUpdate(id, 'Recruiting', shortName(user.displayName), new Date().toISOString(), null, null, req?.hcId, null, false, null, null, req?.requesterEmail)
      logAudit({ requestId: id, action: 'Assign', by: user.email, byName: user.displayName, fromStatus: req?.status, toStatus: 'Recruiting', position: req?.position, department: req?.department })
    } catch (err) {
      console.error('[handleClaim]', err)
      reportClientError('handleClaim', err, { hcId: req?.hcId })
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
      // ส่ง offeringDate ไป GAS เฉพาะเมื่อ set ใหม่ (Offering) หรือ clear (กลับก่อน Offering)
      // Onboarding/Closed/Rejected ไม่ส่ง → ป้องกัน GAS overwrite offering date ด้วยค่าเก่า
      const offeringDate = PRE_OFFERING.includes(newStatus) && req.offeringDate
        ? 'CLEAR'
        : newStatus === 'Offering'
          ? (updateData.offeringDate || null)
          : null
      const clearInfo = CLEAR_CANDIDATE.includes(newStatus) && !!(req.candidateName || req.startDate)
      // ส่ง startDate='CLEAR' ไป GAS เมื่อกลับไป Offering เพื่อล้าง Onboard Date ใน Sheets
      const startDateParam = CLEAR_START_DATE.includes(newStatus) && req.startDate
        ? 'CLEAR'
        : (extraData.startDate || null)
      sendStatusUpdate(id, newStatus, updateData.assignedToName || req.assignedToName, assignedAt, startDateParam, extraData.candidateName || null, req?.hcId, offeringDate, clearInfo, extraData.cvUrl || req.cvUrl || null, extraData.itEmail || null, req?.requesterEmail)
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
          extraData.itEmail ? `Email: ${extraData.itEmail}` : null,
        ].filter(Boolean).join(', ') || undefined,
      })
    } catch (err) {
      console.error('[handleStatusChange]', err)
      reportClientError('handleStatusChange → ' + newStatus, err, { hcId: req?.hcId })
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
      // Onboarding: ต้องมี startDate + ชื่อภาษาอังกฤษ (ใช้ generate อีเมลแจ้ง IT)
      if (!offeringStartDate) return
      const extra = { startDate: offeringStartDate }
      if (offeringCandidateName.trim()) extra.candidateName = offeringCandidateName.trim()
      const finalItEmail = (itEmailVal || generateFreshketEmail(offeringCandidateName)).trim()
      if (finalItEmail) extra.itEmail = finalItEmail
      await handleStatusChange(offeringModal.id, 'Onboarding', extra)
    }
    setOfferingModal({ isOpen: false, id: null, mode: 'onboarding' })
    setOfferingStartDate('')
    setOfferingCandidateName('')
    setOfferingCvUrl('')
    setOfferingCustomDate('')
    setItEmailVal('')
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
      sendStatusUpdate(rejectModal.id, 'Rejected', req?.assignedToName, null, null, null, req?.hcId, null, true, null, null, req?.requesterEmail)
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
      reportClientError('handleRejectConfirm', err, { hcId: req?.hcId })
    }
    setRejectModal({ isOpen: false, id: null })
    setRejectReason('')
  }

  // No Show: ผู้สมัครไม่มาเริ่มงานตอนอยู่ W.Onboarding
  // ต่างจาก Reject ตรงที่ "เก็บข้อมูลไว้" — ไม่ล้าง candidateName / startDate / offeringDate
  async function handleNoShow(id) {
    const req = requests.find((r) => r.id === id)
    try {
      await updateDoc(doc(db, 'hc_requests', id), {
        status: 'NoShow',
        noShowAt: serverTimestamp(),
        statusHistory: arrayUnion(buildHistoryEntry('NoShow', user)),
      })
      // ไม่ส่ง clearInfo → Sheets คงชื่อ candidate + วันเริ่มงานไว้เหมือนกัน
      sendStatusUpdate(id, 'NoShow', req?.assignedToName, null, null, null, req?.hcId, null, false, null, null, req?.requesterEmail)
      logAudit({
        requestId: id,
        action: 'NoShow',
        by: user.email,
        byName: user.displayName,
        fromStatus: req?.status,
        toStatus: 'NoShow',
        position: req?.position,
        department: req?.department,
        note: `ผู้สมัครไม่มาเริ่มงาน (candidate: ${req?.candidateName || '—'}, วันเริ่มงาน: ${req?.startDate || '—'})`,
      })
    } catch (err) {
      console.error('[handleNoShow]', err)
      reportClientError('handleNoShow', err, { hcId: req?.hcId })
    }
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
      reportClientError('handleSlaFixSave', err, { hcId: slaTestModal.hcId })
    }
  }

  // แก้วันเริ่มงานหลัง Onboarding/Closed (พนักงานขอเลื่อนวันเริ่มงาน) — ไม่กระทบสถานะ
  async function handleStartDateConfirm() {
    if (!startDateModal.id || !newStartDateVal || !startDateReason.trim()) return
    const req = requests.find((r) => r.id === startDateModal.id)
    try {
      await updateDoc(doc(db, 'hc_requests', startDateModal.id), { startDate: newStartDateVal })
      // ไม่ await GAS/Sheets — แค่ updateDoc (Firestore) พอที่ modal จะรอ ป้องกัน popup ค้าง
      // ระหว่าง GAS cold start (toast แจ้งผลสำเร็จ/ล้มเหลวเองอยู่แล้วใน updateStartDateInSheets)
      if (startDateModal.hcId) {
        updateStartDateInSheets(startDateModal.hcId, newStartDateVal, startDateReason.trim())
      }
      logAudit({
        requestId: startDateModal.id,
        action: 'StartDateChange',
        by: user.email,
        byName: user.displayName,
        fromStatus: req?.status,
        toStatus: req?.status,
        position: req?.position,
        department: req?.department,
        note: `วันเริ่มงาน: ${startDateModal.oldDate || '—'} → ${newStartDateVal} (${startDateReason.trim()})`,
      })
    } catch (err) {
      console.error('[handleStartDateConfirm]', err)
      reportClientError('handleStartDateConfirm', err, { hcId: startDateModal.hcId })
    }
    setStartDateModal({ isOpen: false, id: null, hcId: null, oldDate: '' })
    setNewStartDateVal('')
    setStartDateReason('')
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
      reportClientError('handleCVUpload', err)
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
      sendStatusUpdate(id, 'Recruiting', req.assignedToName, null, null, null, req?.hcId, 'CLEAR', true, null, null, req?.requesterEmail)
      logAudit({
        requestId: id,
        action: 'Reopen',
        by: user.email,
        byName: user.displayName,
        fromStatus: req?.status,
        toStatus: 'Recruiting',
        position: req?.position,
        department: req?.department,
        note: `${req?.status} → Recruiting ใหม่`,
      })
    } catch (err) {
      console.error('[handleReopen]', err)
      reportClientError('handleReopen', err, { hcId: req?.hcId })
    }
  }

  // No Show → Recruit ใหม่: สร้าง "REQ ID ใหม่" ทั้งดุ้น (ไม่แตะเคส No Show เดิม)
  // เคสเดิมคงสถานะ NoShow + ข้อมูลผู้สมัครไว้เป็นประวัติ; REQ ใหม่เริ่มที่ Open
  // เหมือนคำขอใหม่จริงๆ (ไม่ preassign TA — ต้อง claim เอง) และมี reopenedFrom โยงกลับต้นทาง
  async function handleRecruitNew(id) {
    const req = requests.find((r) => r.id === id)
    if (!req) return
    setUpdating(id)
    try {
      const newHcId = await generateHCID()
      // copy เฉพาะ field นิยามงาน — reset field วงจรชีวิต/ผู้สมัครทั้งหมด
      const payload = {
        requestType:     req.requestType || 'Replacement',
        employmentType:  req.employmentType || 'Monthly',
        division:        req.division || '',
        department:      req.department || '',
        section:         req.section || '',
        businessUnit:    req.businessUnit || '',
        position:        req.position || '',
        orgTrack:        req.orgTrack || '',
        jg:              req.jg || '',
        headcount:       Number(req.headcount) || 1,
        requirements:    req.requirements || '',
        reason:          req.reason || '',
        targetStartDate: req.targetStartDate || '',
        replacementFor:  req.replacementFor || '',
        workDaysPerWeek: req.workDaysPerWeek || '',
        shift:           req.shift || '',
        requesterName:   req.requesterName || '',
        requesterEmail:  req.requesterEmail || '',
        jdFileUrl:       req.jdFileUrl || '',          // คง JD เดิม (ตำแหน่งเดียวกัน)
        jdFilePath:      req.jdFilePath || '',
        jdFileName:      req.jdFileName || '',
        status:          'Open',
        hcId:            newHcId,
        reopenedFrom:    req.hcId || '',               // ลิงก์ย้อนรอย
        createdAt:       serverTimestamp(),            // SLA เริ่มนับใหม่ (เหมือนคำขอใหม่)
      }
      const docRef = await addDoc(collection(db, 'hc_requests'), payload)

      // สร้างแถวใหม่ใน Sheets (create-row path เหมือนฟอร์ม, strip TA-only fields)
      const { workDaysPerWeek: _w, shift: _s, ...webhookPayload } = payload
      sendToWebhook({ ...webhookPayload, id: docRef.id, hcId: newHcId, createdAt: new Date().toISOString() })

      // audit สองทาง: doc ใหม่ + doc เดิม
      logAudit({
        requestId: docRef.id,
        action: 'RecruitNew',
        by: user.email,
        byName: user.displayName,
        toStatus: 'Open',
        position: req?.position,
        department: req?.department,
        note: `เปิด recruit ใหม่ (${newHcId}) จาก ${req.hcId} — No Show`,
      })
      logAudit({
        requestId: id,
        action: 'ReopenedInto',
        by: user.email,
        byName: user.displayName,
        fromStatus: req?.status,
        position: req?.position,
        department: req?.department,
        note: `No Show → เปิด REQ ใหม่ ${newHcId}`,
      })
    } catch (err) {
      console.error('[handleRecruitNew]', err)
      reportClientError('handleRecruitNew', err, { hcId: req?.hcId })
    } finally {
      setUpdating(null)
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
      sendStatusUpdate(id, req?.status, newTAName, now, null, null, req?.hcId, null, false, null, null, req?.requesterEmail)
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
      reportClientError('handleReassign', err, { hcId: req?.hcId })
    } finally {
      setReassigningId(null)
      setUpdating(null)
    }
  }

  async function handleDelete(id) {
    setUpdating(id)
    const req = requests.find((r) => r.id === id)
    try {
      // 1. ลบ Document ใน Firestore ก่อน (source of truth) — แถวหายจาก UI ทันที
      //    และ modal ปิดได้เลย ไม่ต้องรอ Storage/GAS ที่ช้ากว่ามาก
      await deleteDoc(doc(db, 'hc_requests', id))
    } catch (e) {
      console.error('Delete error:', e)
      reportClientError('handleDelete', e, { hcId: req?.hcId })
      setUpdating(null)
      return
    }
    setUpdating(null)

    // 2-4. งานตามหลัง ทำเบื้องหลังไม่บล็อก modal:
    // ลบไฟล์ JD/CV ใน Supabase Storage (พลาด = orphaned file ไม่กระทบระบบ แค่ log ไว้)
    if (req?.jdFilePath) deleteJDFile(req.jdFilePath).catch((e) => console.error('[handleDelete] JD file:', e))
    req?.cvFiles?.forEach((cv) => deleteCVFile(cv.path).catch((e) => console.error('[handleDelete] CV file:', e)))
    // แจ้ง GAS ลบแถวใน Sheets — โชว์ toast สำเร็จ/ล้มเหลวเองข้างใน จึงไม่ต้อง await
    if (req?.hcId) sendDeleteToSheets(req.hcId).catch(() => {})
    logAudit({
      requestId: id,
      action: 'Delete',
      by: user.email,
      byName: user.displayName,
      position: req?.position,
      department: req?.department,
      note: 'Permanently deleted from database & storage by Admin'
    })
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
      if (action === 'noshow') await handleNoShow(payload.id)
      if (action === 'recruitnew') await handleRecruitNew(payload.id)
      if (action === 'delete') await handleDelete(payload.id)
    } catch (err) {
      console.error('[handleConfirm] error:', err)
      reportClientError('handleConfirm:' + action, err)
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

    if (action === 'noshow') {
      return {
        title: 'บันทึกผู้สมัครไม่มาเริ่มงาน (No Show)',
        message: 'ต้องการบันทึกว่าผู้สมัครไม่มาเริ่มงานใช่หรือไม่? ข้อมูลชื่อผู้สมัครและวันเริ่มงานจะถูกเก็บไว้ — กด "Recruit ใหม่" ได้ภายหลังเมื่อพร้อมหาคนต่อ',
        confirmText: 'บันทึก No Show',
        variant: 'warning',
      }
    }

    if (action === 'recruitnew') {
      return {
        title: 'เปิด Recruit ใหม่ (REQ ID ใหม่)',
        message: 'ต้องการเปิดหาคนรอบใหม่เป็น REQ ID ใหม่ใช่หรือไม่? เคส No Show เดิมจะถูกเก็บไว้เป็นประวัติ (ไม่ถูกแก้ไข) และเคสใหม่จะเริ่มที่สถานะ Open เหมือนคำขอใหม่ (รอ claim)',
        confirmText: 'เปิด Recruit ใหม่',
        variant: 'info',
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
    // TA ไม่เห็นเคสที่ยังรอ/ถูก CEO ปฏิเสธ (beta) เลย — ไม่ actionable สำหรับ TA, admin เห็นได้เพื่อ oversight
    if (role === 'ta') base = base.filter(r => !CEO_APPROVAL_STATUS_TABS.includes(r.status))

    // Sub-filters (Tabs / Toggle)
    if (filterMine) base = base.filter(r => r.requesterEmail === user.email)
    if (filterMyCases) {
      base = role === 'admin'
        ? base.filter(r => Boolean(r.assignedTo) || Boolean(r.assignedToName))
        : base.filter(r => getAssignedEmail(r, allTAs) === user.email?.toLowerCase() || (r.assignedToName && (r.assignedToName === user.displayName || r.assignedToName === shortName(user.displayName))))
    }
    if (filterYear) base = base.filter(r => r.createdAt?.toDate?.()?.getFullYear() === Number(filterYear))

    const counts = { ทั้งหมด: base.length, ประวัติ: base.filter(r => HISTORY_TAB_STATUSES.includes(r.status)).length }
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
    if (role === 'ta') list = list.filter(r => !CEO_APPROVAL_STATUS_TABS.includes(r.status))

    if (filterMine) list = list.filter((r) => r.requesterEmail === user.email)
    if (filterMyCases) {
      list = role === 'admin'
        ? list.filter((r) => Boolean(r.assignedTo) || Boolean(r.assignedToName))
        : list.filter((r) => getAssignedEmail(r, allTAs) === user.email?.toLowerCase() || (r.assignedToName && (r.assignedToName === user.displayName || r.assignedToName === shortName(user.displayName))))
    }
    if (activeTab === 'ประวัติ') list = list.filter((r) => HISTORY_TAB_STATUSES.includes(r.status))
    else if (activeTab !== 'ทั้งหมด') list = list.filter((r) => r.status === activeTab)
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
    <div className="flex items-center justify-center gap-2 py-20 text-neutral-400">
      <Loader2 size={20} strokeWidth={1} absoluteStrokeWidth className="animate-spin text-dark-green-600" />
      <span>กำลังโหลดข้อมูล...</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">

      {/* Search + Filter toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={14} strokeWidth={1} absoluteStrokeWidth className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            id="rt-search" name="rt-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาตำแหน่ง, แผนก, TA, ผู้สมัคร, HCID, สถานะ..."
            className="w-full rounded-lg border border-neutral-100 bg-white py-2 pl-8 pr-10 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
              <X size={13} strokeWidth={1} absoluteStrokeWidth />
            </button>
          )}
        </div>

        {showFilters && (
          <button
            onClick={() => setShowFilterBar(v => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${showFilterBar || hasAdvancedFilters
                ? 'border-dark-green-100 bg-dark-green-50 text-dark-green-900'
                : 'border-neutral-100 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
          >
            <SlidersHorizontal size={13} strokeWidth={1} absoluteStrokeWidth />
            Filters
            {hasAdvancedFilters && (
              <span className="ml-1 rounded-full bg-dark-green-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-neutral-50">
                {[filterYear, filterDept, filterAssigned, filterDateFrom, filterDateTo].filter(Boolean).length}
              </span>
            )}
          </button>
        )}
        {hasAdvancedFilters && (
          <button onClick={clearAdvanced} className="flex items-center gap-1 text-xs font-bold text-neutral-400 transition-colors hover:text-dark-green-700">
            <X size={11} strokeWidth={1} absoluteStrokeWidth /> ล้างค่าทิ้ง
          </button>
        )}
        <span className="ml-auto text-xs font-bold text-neutral-400">{displayed.length} รายการ</span>
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-100 pb-0">
        {/* "ประวัติ" — tab รวม Closed/Cancelled/Rejected ไว้ที่เดียว แสดงเฉพาะหน้า "คำขอของฉัน" (filterMine)
            PendingApproval/RejectedByCEO — โผล่แค่ฝั่ง admin (oversight คำขอ CEO approval, beta) */}
        {(() => {
          const tabsForRole = role === 'admin' ? [...STATUS_TABS, ...CEO_APPROVAL_STATUS_TABS] : STATUS_TABS
          return filterMine ? [tabsForRole[0], 'ประวัติ', ...tabsForRole.slice(1)] : tabsForRole
        })().map((tab) => {
          const active = activeTab === tab
          const count = tabCounts[tab] ?? 0
          const tabLabel = STATUS_CONFIG[tab]?.label ?? tab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold transition-colors ${active
                  ? 'border-dark-green-600 text-dark-green-900'
                  : 'border-transparent text-neutral-400 hover:text-neutral-600'
                }`}
            >
              {tabLabel}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none transition-colors ${active
                    ? 'bg-dark-green-600 text-neutral-50'
                    : 'bg-neutral-100 text-neutral-500'
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
                className={`flex select-none items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors
                  ${value
                    ? 'border-dark-green-100 bg-dark-green-50 text-dark-green-900'
                    : 'border-neutral-100 bg-white text-neutral-500 hover:border-dark-green-100 hover:text-dark-green-700'}`}
              >
                <span>{value || label}</span>
                {value
                  ? <X size={10} strokeWidth={1} absoluteStrokeWidth className="cursor-pointer" onClick={e => { e.stopPropagation(); onChange(''); setOpenChip(null) }} />
                  : <ChevronDown size={10} strokeWidth={1} absoluteStrokeWidth />}
              </button>
              {openChip === id && (
                <div className="absolute top-full z-40 mt-1.5 max-h-56 min-w-40 overflow-y-auto rounded-xl border border-neutral-100 bg-white py-1 shadow-lg">
                  {options.map(opt => (
                    <button key={opt} onMouseDown={() => { onChange(opt); setOpenChip(null) }}
                      className={`w-full px-3 py-1.5 text-left text-xs font-bold transition-colors
                        ${value === opt
                          ? 'bg-dark-green-50 text-dark-green-900'
                          : 'text-neutral-700 hover:bg-neutral-50'}`}>
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        }
        return (
          <div className="flex flex-wrap items-center gap-2">
            <ChipSelect id="year"     label="ปี"             value={filterYear}     onChange={setFilterYear}     options={years} />
            <div className="h-4 w-px bg-neutral-100" />
            <ChipSelect id="empType"  label="Emp. Type"      value={filterEmpType}  onChange={setFilterEmpType}  options={['Monthly','Daily','Contract','Intern']} />
            <ChipSelect id="jobType"  label="Job Type"       value={filterJobType}  onChange={setFilterJobType}  options={['New HC','Replace']} />
            <ChipSelect id="rank"     label="Rank"           value={filterRank}     onChange={setFilterRank}     options={ranks} />
            <ChipSelect id="dept"     label="Department"     value={filterDept}     onChange={setFilterDept}     options={departments} />
            <ChipSelect id="bu"       label="Business Unit"  value={filterBU}       onChange={setFilterBU}       options={businessUnits} />
            <ChipSelect id="ta"       label="PIC / TA"       value={filterAssigned} onChange={setFilterAssigned} options={assignees} />
            <div className="mx-1 h-4 w-px bg-neutral-100" />
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} title="วันที่ตั้งแต่"
              className="rounded-full border border-neutral-100 bg-white px-3 py-1.5 text-[11px] text-neutral-700 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none" />
            <span className="text-xs text-neutral-400">–</span>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} title="ถึงวันที่"
              className="rounded-full border border-neutral-100 bg-white px-3 py-1.5 text-[11px] text-neutral-700 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none" />
            {hasAdvancedFilters && (
              <button onClick={clearAdvanced} className="flex items-center gap-1 text-[11px] font-bold text-neutral-400 transition-colors hover:text-red-600">
                <X size={11} strokeWidth={1} absoluteStrokeWidth /> ล้างทั้งหมด
              </button>
            )}
          </div>
        )
      })()}

      {/* Table */}
      {displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-100 bg-white py-16 text-center">
          <p className="font-bold text-neutral-400">ไม่พบรายการ</p>
          {(hasAdvancedFilters || search || activeTab !== 'ทั้งหมด') && (
            <button onClick={() => { clearAdvanced(); setSearch(''); setActiveTab('ทั้งหมด') }} className="mt-2 text-sm font-bold text-dark-green-700 hover:underline">
              ล้าง filter ทั้งหมด
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
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
                    className={`px-4 py-3 text-left text-[11px] font-bold text-neutral-500 ${field ? 'cursor-pointer select-none hover:text-dark-green-700' : ''} transition-colors`}
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
            <tbody className="divide-y divide-neutral-100">
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
                      className={`group cursor-pointer transition-colors ${isExpanded ? 'bg-dark-green-50' : 'hover:bg-neutral-50'}`}
                      onClick={() => setExpandedId(isExpanded ? null : req.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronRight size={13} strokeWidth={1} absoluteStrokeWidth className={`shrink-0 text-neutral-300 transition-transform ${isExpanded ? 'rotate-90 text-dark-green-600' : 'rotate-0 group-hover:text-neutral-400'}`} />
                          <span className="font-mono text-[11px] font-bold text-neutral-400">{req.hcId || req.id.slice(0, 7)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-lg px-2 py-0.5 text-[11px] font-bold ${req.requestType === 'New HC'
                            ? 'bg-purple-50 text-purple-900'
                            : 'bg-orange-50 text-orange-900'
                          }`}>
                          {req.requestType === 'New HC' ? 'New HC' : 'Replace'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold leading-tight text-neutral-900">{req.position}</p>
                        {req.jg && <p className="mt-0.5 text-[11px] font-bold text-neutral-400">{getJGLabel(req.jg)}</p>}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{req.department}</td>
                      <td className="px-4 py-3 text-[11px] text-neutral-500">{req.requesterName}</td>
                      <td className="px-4 py-3">
                        {req.assignedToName
                          ? <span className="text-xs font-bold text-dark-green-700">{req.assignedToName}</span>
                          : <span className="text-neutral-200">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={req.status} /></td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-neutral-400">
                        {req.createdAt?.toDate?.().toLocaleDateString('th-TH') ?? '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <SLABadge req={req} />
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 flex-wrap">
                          {canViewFile && (
                            <button onClick={handleOpenFile} title={req.jdFileName || 'ไฟล์ JD'}
                              className="flex items-center gap-1.5 rounded-lg border border-dark-green-100 bg-dark-green-50 px-2.5 py-1 text-[11px] font-bold text-dark-green-800 transition-colors hover:bg-dark-green-100"
                            >
                              <FileText size={11} strokeWidth={1} absoluteStrokeWidth /> JD
                            </button>
                          )}
                          {canClaim && (
                            <button onClick={(e) => { e.stopPropagation(); handleClaim(req.id) }} disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-lg bg-dark-green-600 px-3 py-1 text-[11px] font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} strokeWidth={1} absoluteStrokeWidth />}
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
                              className="cursor-pointer rounded-lg border border-dark-green-100 bg-white px-2 py-1 text-[11px] font-bold text-dark-green-800 focus:outline-none"
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
                              className="flex items-center gap-1.5 rounded-lg border border-red-100 px-2.5 py-1 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-50"
                            >
                              <XCircle size={11} strokeWidth={1} absoluteStrokeWidth /> Reject
                            </button>
                          )}
                          {/* W.Onboarding → No Show: ผู้สมัครไม่มาเริ่มงาน (เก็บชื่อ candidate + วันเริ่มงานไว้) */}
                          {isTA && req.status === 'Onboarding' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openConfirm('noshow', { id: req.id }) }}
                              className="flex items-center gap-1.5 rounded-lg border border-pink-100 px-2.5 py-1 text-[11px] font-bold text-pink-900 transition-colors hover:bg-pink-50"
                            >
                              <XCircle size={11} strokeWidth={1} absoluteStrokeWidth /> No Show
                            </button>
                          )}
                          {/* Rejected → Reopen: reopen ที่ REQ เดิม (ล้างข้อมูล) */}
                          {isTA && req.status === 'Rejected' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReopen(req.id) }}
                              className="flex items-center gap-1.5 rounded-lg border border-yellow-100 px-2.5 py-1 text-[11px] font-bold text-yellow-900 transition-colors hover:bg-yellow-50"
                            >
                              <UserCheck size={11} strokeWidth={1} absoluteStrokeWidth /> Recruit ใหม่
                            </button>
                          )}
                          {/* NoShow → Recruit ใหม่: สร้าง REQ ID ใหม่ (เก็บเคสเดิมไว้) */}
                          {isTA && req.status === 'NoShow' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openConfirm('recruitnew', { id: req.id }) }}
                              className="flex items-center gap-1.5 rounded-lg border border-yellow-100 px-2.5 py-1 text-[11px] font-bold text-yellow-900 transition-colors hover:bg-yellow-50"
                            >
                              <UserCheck size={11} strokeWidth={1} absoluteStrokeWidth /> Recruit ใหม่
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
                                className="cursor-pointer rounded-lg border border-dark-green-100 bg-white px-2 py-1 text-[11px] font-bold text-dark-green-800 focus:outline-none"
                              >
                                <option value="">ย้ายไปที่...</option>
                                {allTAs.map(t => (
                                  <option key={t.email} value={t.email}>{t.name}</option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setReassigningId(req.id) }}
                                className="flex items-center gap-1.5 rounded-lg border border-dark-green-100 bg-white px-2.5 py-1 text-[11px] font-bold text-dark-green-800 transition-colors hover:bg-dark-green-50"
                              >
                                <Pencil size={11} strokeWidth={1} absoluteStrokeWidth />
                                ย้ายคนดูแลเคส
                              </button>
                            )
                          )}
                          {canCancel && (
                            <button onClick={(e) => { e.stopPropagation(); openConfirm('cancel', { id: req.id }) }} disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-lg border border-red-100 px-2.5 py-1 text-[11px] font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} strokeWidth={1} absoluteStrokeWidth />}
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
                              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-50
                                ${req.slaStartDate
                                  ? 'bg-banana-100 text-banana-900 hover:bg-banana-200'
                                  : 'bg-purple-100 text-purple-900 hover:bg-purple-200'
                                }`}
                            >
                              SLA{req.slaStartDate ? ' ✓' : ''}
                            </button>
                          )}
                          {isAdmin && (
                            <button onClick={(e) => { e.stopPropagation(); openConfirm('delete', { id: req.id }) }} disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-neutral-50 transition-colors hover:bg-red-700 disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} strokeWidth={1} absoluteStrokeWidth />}
                              ลบ
                            </button>
                          )}
                        </div>

                      </td>
                    </tr>

                    {/* Expanded Detail Row */}
                    {isExpanded && (
                      <tr key={`${req.id}-detail`} className="bg-dark-green-50">
                        <td colSpan={9} className="px-6 pb-6 pt-0">
                          <div className="grid grid-cols-1 gap-8 rounded-2xl border border-neutral-100 bg-white p-6 md:grid-cols-2 lg:grid-cols-4">

                            {/* จำนวน HC + วันที่ */}
                            <div className="flex flex-col gap-5">
                              <div>
                                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                  <Users size={12} strokeWidth={1} absoluteStrokeWidth /> จำนวน HC
                                </p>
                                <p className="text-xl font-bold text-dark-green-700 tabular-nums">{req.headcount ?? 1} <span className="text-sm font-bold text-neutral-400">คน</span></p>
                              </div>
                              {/* Candidate name — editable inline สำหรับ TA/Admin */}
                              {(isTA || isAdmin) && (
                                <div>
                                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                    <UserCheck size={12} strokeWidth={1} absoluteStrokeWidth /> Candidate
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
                                            sendStatusUpdate(req.id, req.status, req.assignedToName, null, req.startDate, candidateEditVal.trim(), req.hcId, null, false, req.cvUrl || null, null, req.requesterEmail)
                                            setCandidateEditId(null)
                                          } else if (e.key === 'Escape') {
                                            setCandidateEditId(null)
                                          }
                                        }}
                                        placeholder="ชื่อ Candidate..."
                                        className="min-w-0 flex-1 rounded-lg border border-purple-100 bg-white px-2 py-1 text-sm text-purple-900 focus:outline-none focus:ring-1 focus:ring-purple-300"
                                      />
                                      <button
                                        onClick={async () => {
                                          await updateDoc(doc(db, 'hc_requests', req.id), { candidateName: candidateEditVal.trim() })
                                          sendStatusUpdate(req.id, req.status, req.assignedToName, null, req.startDate, candidateEditVal.trim(), req.hcId, null, false, req.cvUrl || null, null, req.requesterEmail)
                                          setCandidateEditId(null)
                                        }}
                                        className="shrink-0 rounded-lg bg-purple-600 px-2 py-1 text-[11px] font-bold text-neutral-50 transition-colors hover:bg-purple-700"
                                      >
                                        ✓
                                      </button>
                                      <button onClick={() => setCandidateEditId(null)} className="shrink-0 text-[11px] text-neutral-400 hover:text-neutral-600">✕</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setCandidateEditId(req.id); setCandidateEditVal(req.candidateName || '') }}
                                      className="group flex items-center gap-1.5 text-left"
                                    >
                                      {req.candidateName
                                        ? <span className="text-sm font-bold text-purple-700">{req.candidateName}</span>
                                        : <span className="text-xs italic text-neutral-300">— กดเพื่อกรอกชื่อ</span>
                                      }
                                      <Pencil size={10} strokeWidth={1} absoluteStrokeWidth className="shrink-0 text-neutral-300 transition-colors group-hover:text-purple-500" />
                                    </button>
                                  )}
                                </div>
                              )}
                              {!isTA && !isAdmin && req.candidateName && (
                                <div>
                                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                    <UserCheck size={12} strokeWidth={1} absoluteStrokeWidth /> Candidate
                                  </p>
                                  <p className="text-sm font-bold text-purple-700">{req.candidateName}</p>
                                </div>
                              )}
                              {req.startDate && (
                                <div>
                                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                    <Calendar size={12} strokeWidth={1} absoluteStrokeWidth /> วันเริ่มงาน
                                  </p>
                                  {(isTA || isAdmin) ? (
                                    <button
                                      onClick={() => {
                                        setNewStartDateVal(req.startDate)
                                        setStartDateReason('')
                                        setStartDateModal({ isOpen: true, id: req.id, hcId: req.hcId || null, oldDate: req.startDate })
                                      }}
                                      className="group flex items-center gap-1.5 text-left"
                                    >
                                      <span className="text-sm font-bold text-teal-700">{(() => { const d = new Date(req.startDate); return isNaN(d) ? req.startDate : d.getDate() + '-' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + '-' + d.getFullYear() })()}</span>
                                      <Pencil size={10} strokeWidth={1} absoluteStrokeWidth className="shrink-0 text-neutral-300 transition-colors group-hover:text-teal-500" />
                                    </button>
                                  ) : (
                                    <p className="text-sm font-bold text-teal-700">{(() => { const d = new Date(req.startDate); return isNaN(d) ? req.startDate : d.getDate() + '-' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + '-' + d.getFullYear() })()}</p>
                                  )}
                                </div>
                              )}
                              {req.rejectReason && (
                                <div>
                                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-red-400">
                                    <XCircle size={12} strokeWidth={1} absoluteStrokeWidth /> เหตุผลการ Reject
                                  </p>
                                  <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                                    <p className="text-sm leading-relaxed text-red-700">{req.rejectReason}</p>
                                  </div>
                                </div>
                              )}
                              {req.requestType === 'Replacement' && (
                                <div>
                                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                    <Calendar size={12} strokeWidth={1} absoluteStrokeWidth /> วันที่ลาออก (LWD)
                                  </p>
                                  <p className="text-sm font-bold text-neutral-700">{req.targetStartDate || '—'}</p>
                                </div>
                              )}
                              {req.requestType === 'Replacement' && req.replacementFor && (
                                <div>
                                  <p className="mb-2 text-[11px] font-bold text-neutral-400">ทดแทนพนักงานเดิม</p>
                                  <p className="text-sm font-bold text-dark-green-700">{req.replacementFor}</p>
                                </div>
                              )}
                            </div>

                            {/* เหตุผล */}
                            <div>
                              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                <AlignLeft size={12} strokeWidth={1} absoluteStrokeWidth /> เหตุผลในการขอ
                              </p>
                              <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3">
                                <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-neutral-700">"{req.reason || '—'}"</p>
                              </div>
                            </div>

                            {/* Requirements */}
                            <div>
                              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                <ClipboardList size={12} strokeWidth={1} absoluteStrokeWidth /> Requirements
                              </p>
                              <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3">
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{req.requirements || '—'}</p>
                              </div>
                              {/* วันทำงาน + กะ — แสดงเฉพาะ TA/Admin */}
                              {isTA && (req.workDaysPerWeek || req.shift) && (
                                <div className="mt-4 flex gap-4">
                                  {req.workDaysPerWeek && (
                                    <div className="flex-1 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2">
                                      <p className="mb-1 text-[11px] font-bold text-purple-400">วัน/สัปดาห์</p>
                                      <p className="text-sm font-bold text-purple-900">{req.workDaysPerWeek} วัน</p>
                                    </div>
                                  )}
                                  {req.shift && (
                                    <div className="flex-1 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2">
                                      <p className="mb-1 text-[11px] font-bold text-purple-400">กะ</p>
                                      <p className="text-sm font-bold text-purple-900">{req.shift}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Meta */}
                            <div className="flex flex-col gap-5">
                              <div>
                                <p className="mb-2 text-[11px] font-bold text-neutral-400">ข้อมูลผู้ยื่น</p>
                                <p className="text-sm font-bold text-neutral-900">{req.requesterName}</p>
                                <p className="text-[11px] font-bold text-neutral-400 transition-colors hover:text-dark-green-700">{req.requesterEmail}</p>
                              </div>
                              <div>
                                <p className="mb-2 text-[11px] font-bold text-neutral-400">Timestamp</p>
                                <p className="font-mono text-sm font-bold text-neutral-500">
                                  {req.createdAt?.toDate?.().toLocaleString('th-TH') ?? '—'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* ── CV Files — TA อัพโหลด/ลบได้, Manager ดูอย่างเดียว ── */}
                          {(isTA || role === 'manager' || isOwner) && (
                            <div className="mt-4 rounded-2xl border border-neutral-100 bg-white p-4">
                              <div className="mb-3 flex items-center justify-between">
                                <p className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                                  <File size={12} strokeWidth={1} absoluteStrokeWidth /> CV / Resume
                                </p>
                                {isTA && (
                                  <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${cvUploading.has(req.id) ? 'pointer-events-none opacity-50' : 'border-dark-green-100 text-dark-green-700 hover:bg-dark-green-50'}`}>
                                    {cvUploading.has(req.id)
                                      ? <><Loader2 size={12} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> กำลังอัพโหลด...</>
                                      : <><Upload size={12} strokeWidth={1} absoluteStrokeWidth /> อัพโหลด CV</>
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
                                <p className="text-xs italic text-neutral-400">ยังไม่มีไฟล์ CV</p>
                              ) : (
                                <div className="flex flex-col gap-1.5">
                                  {req.cvFiles.map((cv, idx) => (
                                    <div key={idx} className="group flex items-center justify-between gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
                                      <button
                                        onClick={async (e) => { e.stopPropagation(); const url = await getCVSignedUrl(cv.path); if (url) window.open(url, '_blank') }}
                                        className="flex items-center gap-2 truncate text-xs font-bold text-neutral-700 transition-colors hover:text-dark-green-700"
                                        title={cv.name}
                                      >
                                        <FileText size={13} strokeWidth={1} absoluteStrokeWidth className="shrink-0 text-dark-green-600" />
                                        <span className="max-w-[200px] truncate">{cv.name}</span>
                                      </button>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <span className="hidden text-[11px] text-neutral-400 group-hover:inline">{cv.uploadedBy?.split('@')[0]}</span>
                                        {isTA && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteCV(req.id, cv) }}
                                            className="text-neutral-300 transition-colors hover:text-red-600"
                                            title="ลบไฟล์"
                                          >
                                            <X size={13} strokeWidth={1} absoluteStrokeWidth />
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
                              Open:       { label: 'Open',         dot: 'bg-neutral-400',    badge: 'bg-neutral-100 text-neutral-600',         text: 'text-neutral-500' },
                              Offering:   { label: 'Offering',     dot: 'bg-purple-500',     badge: 'bg-purple-50 text-purple-900',            text: 'text-purple-700' },
                              Onboarding: { label: 'W.Onboarding', dot: 'bg-teal-500',       badge: 'bg-teal-50 text-teal-900',                text: 'text-teal-700' },
                              Rejected:   { label: 'Rejected',     dot: 'bg-red-500',        badge: 'bg-red-50 text-red-700',                  text: 'text-red-600' },
                              Closed:     { label: 'Closed',       dot: 'bg-green-fresh-500', badge: 'bg-green-fresh-50 text-green-fresh-900', text: 'text-green-fresh-700' },
                              Cancelled:  { label: 'Cancelled',    dot: 'bg-neutral-300',    badge: 'bg-neutral-100 text-neutral-500',         text: 'text-neutral-400' },
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
                              <div className="mt-4 rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                  <p className="text-[11px] font-bold text-neutral-400">Stage Duration</p>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-neutral-400">รวม</span>
                                    <span className="text-sm font-bold text-neutral-700 tabular-nums">{totalDays}</span>
                                    <span className="text-[11px] text-neutral-400">วัน</span>
                                  </div>
                                </div>
                                <div className="flex flex-col">
                                  {segments.map((seg, i) => {
                                    const c = STAGE_CFG[seg.status] || STAGE_CFG.Open
                                    const isLast = i === segments.length - 1
                                    return (
                                      <div key={i} className="flex items-stretch gap-3">
                                        <div className="flex w-4 flex-shrink-0 flex-col items-center pt-1.5">
                                          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${c.dot} ${seg.isCurrent && !isDone ? 'animate-pulse' : ''}`}/>
                                          {!isLast && <span className="my-1 w-px flex-1 bg-neutral-100"/>}
                                        </div>
                                        <div className={`flex flex-1 items-center justify-between ${isLast ? 'pb-0' : 'pb-3'}`}>
                                          <div className="flex items-center gap-2">
                                            <span className={`text-[11px] font-bold ${c.text}`}>{c.label}</span>
                                            <span className="text-[11px] text-neutral-400">{seg.dateStr}</span>
                                            {seg.isCurrent && !isDone && (
                                              <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">กำลังดำเนินการ</span>
                                            )}
                                          </div>
                                          <span className={`rounded-lg px-2 py-0.5 text-[11px] font-bold tabular-nums ${c.badge}`}>
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
            <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50 px-4 py-3">
              <span className="text-xs font-bold text-neutral-400">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, displayed.length)} จาก {displayed.length} รายการ
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-neutral-100 px-3 py-1.5 text-xs font-bold text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← ก่อนหน้า
                </button>
                <span className="px-3 py-1.5 text-xs font-bold text-neutral-500">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-neutral-100 px-3 py-1.5 text-xs font-bold text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45">
          <div className="mx-4 w-full max-w-sm rounded-[24px] border border-neutral-100 bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold text-neutral-900">Reject ผู้สมัคร</h3>
            <p className="mb-5 text-sm text-neutral-500">กรุณาระบุเหตุผลการ Reject (ถ้ามี)</p>
            <label className="mb-2 block text-[11px] font-bold text-neutral-500">เหตุผล</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="เช่น ผู้สมัครขอถอนตัว,ป่วย,ไม่สะดวกมาเริ่มงานแล้ว (แอ๊บ) (ถ้าไม่ใส่จะขึ้นว่า No Reason)"
              rows={3}
              className="w-full resize-none rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              autoFocus
            />
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setRejectModal({ isOpen: false, id: null }); setRejectReason('') }}
                className="flex-1 rounded-lg border border-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleRejectConfirm}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-red-700"
              >
                ยืนยัน Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin: แก้ SLA ย้อนหลัง Modal ── */}
      {slaTestModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45">
          <div className="mx-4 w-full max-w-sm rounded-[24px] border border-neutral-100 bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-base font-bold text-neutral-900">แก้ SLA ย้อนหลัง</h3>
            <p className="mb-4 text-xs text-neutral-500">
              กำหนดวันเปิดเคส (SLA Start) สำหรับ record นี้<br/>
              <span className="text-banana-700">createdAt จริงไม่ถูกแก้</span> — ใช้ field แยก <code className="rounded bg-neutral-50 px-1 text-[11px]">slaStartDate</code>
            </p>
            <label className="mb-2 block text-[11px] font-bold text-neutral-500">วันเปิดเคส (SLA Start)</label>
            <input
              id="sla-fix-date" name="sla-fix-date"
              type="date"
              value={slaTestDate}
              onChange={(e) => setSlaTestDate(e.target.value)}
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              autoFocus
            />
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => { setSlaTestModal({ isOpen: false, id: null }); setSlaTestDate('') }}
                className="flex-1 rounded-lg border border-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => handleSlaFixSave('')}  // '' = reset → slaStartDate = null
                className="rounded-lg border border-red-100 px-3 py-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50"
                title="ล้าง slaStartDate กลับไปใช้ createdAt auto"
              >
                รีเซ็ต
              </button>
              <button
                onClick={() => handleSlaFixSave()}
                disabled={!slaTestDate}
                className="flex-1 rounded-lg bg-banana-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-banana-700 disabled:opacity-50"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── แก้วันเริ่มงาน (พนักงานขอเลื่อนวันเริ่มงาน) — sync Firestore + Sheets + Slack ── */}
      {startDateModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45">
          <div className="mx-4 w-full max-w-sm rounded-[24px] border border-neutral-100 bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold text-neutral-900">แก้ไขวันเริ่มงาน</h3>
            <p className="mb-5 text-sm text-neutral-500">ใช้เมื่อพนักงานขอเลื่อนวันเริ่มงาน — จะ sync เข้า Sheets และแจ้งเตือนใน Slack ทันที</p>
            <label className="mb-2 block text-[11px] font-bold text-neutral-500">วันเริ่มงานใหม่</label>
            <input
              id="start-date-fix" name="start-date-fix"
              type="date"
              value={newStartDateVal}
              onChange={(e) => setNewStartDateVal(e.target.value)}
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              autoFocus
            />
            <label className="mb-2 mt-4 block text-[11px] font-bold text-neutral-500">เหตุผลที่เปลี่ยน *</label>
            <textarea
              value={startDateReason}
              onChange={(e) => setStartDateReason(e.target.value)}
              placeholder="เช่น พนักงานขอเลื่อนวันเริ่มงาน, ติดธุระส่วนตัว"
              rows={3}
              className="w-full resize-none rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            />
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => { setStartDateModal({ isOpen: false, id: null, hcId: null, oldDate: '' }); setNewStartDateVal(''); setStartDateReason('') }}
                className="flex-1 rounded-lg border border-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleStartDateConfirm}
                disabled={!newStartDateVal || !startDateReason.trim()}
                className="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {offeringModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45">
          <div className="mx-4 w-full max-w-sm rounded-[24px] border border-neutral-100 bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold text-neutral-900">
              {offeringModal.mode === 'offering' ? 'Offering' : 'Waiting Onboarding'}
            </h3>
            <p className="mb-5 text-sm text-neutral-500">
              {offeringModal.mode === 'offering' ? 'กรอกชื่อผู้สมัครที่ได้รับ offer' : 'กรุณากรอกข้อมูลผู้สมัครที่รับ offer'}
            </p>

            <label className="mb-2 block text-[11px] font-bold text-neutral-500">
              ชื่อ Candidate {offeringModal.mode === 'onboarding' ? '*' : '(optional)'}
            </label>
            <input
              id="offering-candidate" name="offering-candidate"
              type="text"
              value={offeringCandidateName}
              onChange={(e) => setOfferingCandidateName(e.target.value)}
              placeholder="ชื่อ-นามสกุล ผู้สมัคร"
              className={`w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none ${
                offeringModal.mode === 'onboarding' && offeringCandidateName.trim() && !isEnglishName(offeringCandidateName)
                  ? 'mb-1 border-red-300' : 'mb-4 border-neutral-100'
              }`}
              autoFocus
            />
            {offeringModal.mode === 'onboarding' && offeringCandidateName.trim() && !isEnglishName(offeringCandidateName) && (
              <p className="mb-4 text-xs text-red-600">กรุณากรอกชื่อเป็นภาษาอังกฤษ (ใช้สร้างอีเมลบริษัทแจ้ง IT)</p>
            )}

            {offeringModal.mode === 'offering' && (
              <>
                <label className="mb-2 block text-[11px] font-bold text-neutral-500">
                  ลิ้ง CV (optional)
                </label>
                <input
                  id="offering-cv-url" name="offering-cv-url"
                  type="url"
                  value={offeringCvUrl}
                  onChange={(e) => setOfferingCvUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="mb-4 w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
                <label className="mb-2 block text-[11px] font-bold text-neutral-500">
                  วัน Offering <span className="font-normal text-neutral-400">(optional — ปล่อยว่าง = วันนี้)</span>
                </label>
                <input
                  id="offering-custom-date" name="offering-custom-date"
                  type="date"
                  value={offeringCustomDate}
                  onChange={(e) => setOfferingCustomDate(e.target.value)}
                  className="mb-4 w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
              </>
            )}

            {offeringModal.mode === 'onboarding' && (
              <>
                <label className="mb-2 block text-[11px] font-bold text-neutral-500">วันเริ่มงาน *</label>
                <input
                  id="offering-start-date" name="offering-start-date"
                  type="date"
                  value={offeringStartDate}
                  onChange={(e) => setOfferingStartDate(e.target.value)}
                  className="mb-4 w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />

                <label className="mb-2 block text-[11px] font-bold text-neutral-500">
                  อีเมลบริษัท (แจ้ง IT) <span className="font-normal text-neutral-400">— auto-generate, แก้ไขได้</span>
                </label>
                <input
                  id="offering-it-email" name="offering-it-email"
                  type="text"
                  value={itEmailVal || generateFreshketEmail(offeringCandidateName)}
                  onChange={(e) => setItEmailVal(e.target.value)}
                  placeholder="somchai.j@freshket.co"
                  className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
              </>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setOfferingModal({ isOpen: false, id: null, mode: 'onboarding' }); setOfferingStartDate(''); setOfferingCandidateName(''); setOfferingCvUrl(''); setOfferingCustomDate(''); setItEmailVal('') }}
                className="flex-1 rounded-lg border border-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleOfferingConfirm}
                disabled={offeringModal.mode === 'onboarding' && (
                  !offeringStartDate ||
                  !offeringCandidateName.trim() ||
                  !isEnglishName(offeringCandidateName) ||
                  !(itEmailVal || generateFreshketEmail(offeringCandidateName))
                )}
                className="flex-1 rounded-lg bg-dark-green-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:cursor-not-allowed disabled:opacity-40"
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
