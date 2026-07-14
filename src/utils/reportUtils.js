/**
 * reportUtils.js — Shared helpers สำหรับ Reports & Dashboard analytics
 * ─────────────────────────────────────────────────────────────────────────────
 * รวม util ที่เคยกระจายอยู่ใน ReportPanel + ManpowerPivot ให้เป็นที่เดียว
 * (single source of truth) เพื่อไม่ให้ SLA / date logic มีหลายเวอร์ชันที่ drift กัน
 *
 * อ่านจาก Firestore (hc_requests) เท่านั้น — ไม่เกี่ยวข้องกับ Google Sheets sync
 */

// ชื่อเดือนภาษาไทย index 0 = ม.ค.
export const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// สถานะ → ภาษาไทยอ่านง่าย (ใช้ในหน้า Reports ให้ผู้บริหารอ่านรู้เรื่อง)
export const STATUS_TH = {
  Open:             'รอรับเรื่อง',
  Recruiting:       'กำลังหาผู้สมัคร',
  Interviewing:     'กำลังสัมภาษณ์',
  Offering:         'ยื่นข้อเสนอแล้ว',
  Onboarding:       'รอเริ่มงาน',
  Closed:           'ได้คนเริ่มงานแล้ว',
  Rejected:         'ผู้สมัครสละสิทธิ์',
  Cancelled:        'ยกเลิกคำขอ',
  OnHold:           'พักไว้ชั่วคราว',
  InternalTransfer: 'โอนย้ายภายใน',
  Confidential:     'ตำแหน่งลับ',
}

/** สถานะแบบไทยล้วน เช่น 'กำลังหาผู้สมัคร' (ถ้าไม่รู้จักคืนค่าเดิม) */
export function statusTH(s) { return STATUS_TH[s] || s }

/** สถานะแบบ 'ไทย (English)' เช่น 'กำลังหาผู้สมัคร (Recruiting)' — คงคำอังกฤษไว้ให้เทียบกับหน้าอื่น/Sheets ได้ */
export function statusLabelTH(s) { return STATUS_TH[s] ? `${STATUS_TH[s]} (${s})` : s }

const MONTH_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * แปลงค่าวันที่เป็น Date object
 * รองรับทั้ง Firestore Timestamp (มี .toDate), Date object และ ISO string
 */
export function toDate(v) {
  if (!v) return null
  if (typeof v?.toDate === 'function') return v.toDate()
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/** format Date → "D-MMM-YYYY" (เช่น 5-Jan-2026) */
export function fmtDate(d) {
  const date = toDate(d)
  if (!date) return ''
  return `${date.getDate()}-${MONTH_EN[date.getMonth()]}-${date.getFullYear()}`
}

/** "YYYY-MM" key ของเดือนจากวันที่ */
export function monthKey(d) {
  const date = toDate(d)
  if (!date) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

// ─── SLA days ─────────────────────────────────────────────────────────────────
// state machine: นับเวลาตั้งแต่ Open (createdAt) จนถึง Offering/Onboarding
// reset เมื่อกลับไป Recruiting/Interviewing หลัง Onboarding (เคสถูกเปิดใหม่)
// logic เดียวกับที่เคยอยู่ใน ReportPanel.computeSLADays / RequestTable
export function computeSLADays(req) {
  const createdAt = toDate(req.createdAt)
  if (!createdAt) return ''
  const DONE = new Set(['Closed', 'Cancelled'])
  const history = [...(req.statusHistory ?? [])]
    .map(e => ({ status: e.status, t: toDate(e.changedAt) }))
    .filter(e => e.t)
    .sort((a, b) => a.t - b.t)

  let acc = 0, start = createdAt, lastOnboarding = false
  for (const { status, t } of history) {
    if (status === 'Offering')          { if (start) { acc += t - start; start = null }; lastOnboarding = false }
    else if (status === 'Onboarding')   { if (start) { acc += t - start; start = null }; lastOnboarding = true  }
    else if (status === 'Recruiting' || status === 'Interviewing') {
      if (lastOnboarding) { acc = 0; start = t; lastOnboarding = false }
      else if (!start) start = t
    } else if (DONE.has(status))        { if (start) { acc += t - start; start = null }; lastOnboarding = false }
  }
  if (start) acc += new Date() - start
  return Math.floor(acc / 86400000)
}

/** วันที่เข้าสู่สถานะ Offering ครั้งแรก (จาก statusHistory) หรือ null */
export function getOfferingDate(r) {
  const h = [...(r.statusHistory ?? [])].find(e => e.status === 'Offering')
  if (!h) return null
  return toDate(h.changedAt)
}

// ─── Date range presets ───────────────────────────────────────────────────────
export const PRESETS = [
  { label: 'เดือนนี้',      value: 'this_month'   },
  { label: 'เดือนที่แล้ว', value: 'last_month'   },
  { label: 'ไตรมาสนี้',    value: 'this_quarter' },
  { label: 'ปีนี้',         value: 'this_year'    },
  { label: 'ทั้งหมด',       value: 'all'          },
]

export function getDateRange(preset) {
  const now = new Date()
  if (preset === 'this_month')  return { from: new Date(now.getFullYear(), now.getMonth(), 1),     to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) }
  if (preset === 'last_month')  return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(),     0, 23, 59, 59) }
  if (preset === 'this_quarter') {
    const q = Math.floor(now.getMonth() / 3)
    return { from: new Date(now.getFullYear(), q * 3, 1), to: new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59) }
  }
  if (preset === 'this_year') return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) }
  return null // all time
}

// ─── CSV escape (ใช้ร่วมกับ exportExcel.exportCSV) ─────────────────────────────
export function escapeCSV(val) {
  if (val == null || val === '') return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`
  return str
}

// ─── Pivot dimensions ─────────────────────────────────────────────────────────
// ใช้ใน PivotBuilder + report ต่างๆ เพื่อดึงค่า dimension จาก request หนึ่งอัน

/** คืน true ถ้า request เป็นประเภท Replacement (ไม่ใช่ New HC) */
export function isReplacement(r) {
  return r.requestType === 'Replacement' || r.requestType === 'Replace'
}

/** label มาตรฐานของ request type */
export function requestTypeLabel(r) {
  return isReplacement(r) ? 'Replace' : 'New HC'
}

// dimension ที่เลือกได้ใน PivotBuilder (key → label ภาษาไทย)
export const ROW_DIMENSIONS = [
  { value: 'department',     label: 'แผนก' },
  { value: 'position',       label: 'ตำแหน่ง' },
  { value: 'assignedToName', label: 'TA / PIC' },
  { value: 'status',         label: 'สถานะ' },
  { value: 'requestType',    label: 'ประเภท (New/Replace)' },
  { value: 'jg',             label: 'Job Grade' },
  { value: 'employmentType', label: 'ประเภทจ้าง' },
]

export const COLUMN_DIMENSIONS = [
  { value: 'month',       label: 'เดือน' },
  { value: 'quarter',     label: 'ไตรมาส' },
  { value: 'status',      label: 'สถานะ' },
  { value: 'requestType', label: 'ประเภท (New/Replace)' },
  { value: 'none',        label: 'ไม่มี (รวมทั้งหมด)' },
]

/**
 * คืนค่าของ dimension ที่ระบุ จาก request หนึ่งอัน (เป็น string)
 * @param r request object
 * @param dim key ของ dimension (เช่น 'department', 'month')
 */
export function getDimensionValue(r, dim) {
  switch (dim) {
    case 'department':     return r.department     || 'ไม่ระบุ'
    case 'position':       return r.position       || 'ไม่ระบุ'
    case 'assignedToName': return r.assignedToName || '— ยังไม่ assign —'
    case 'status':         return r.status         || 'ไม่ระบุ'
    case 'jg':             return r.jg             || 'ไม่ระบุ'
    case 'employmentType': return r.employmentType || 'Monthly'
    case 'requestType':    return requestTypeLabel(r)
    case 'month': {
      const d = toDate(r.createdAt)
      return d ? MONTH_TH[d.getMonth()] : 'ไม่ระบุ'
    }
    case 'quarter': {
      const d = toDate(r.createdAt)
      return d ? `Q${Math.floor(d.getMonth() / 3) + 1}` : 'ไม่ระบุ'
    }
    default: return 'ไม่ระบุ'
  }
}

/** ลำดับการแสดง dimension values บางตัว (status, month, quarter, requestType) ให้เรียงอย่างมีความหมาย */
export function dimensionOrder(dim) {
  if (dim === 'status')      return ['Open','Recruiting','Interviewing','Offering','Onboarding','Closed','Rejected','Cancelled','OnHold','InternalTransfer','Confidential']
  if (dim === 'month')       return [...MONTH_TH]
  if (dim === 'quarter')     return ['Q1','Q2','Q3','Q4']
  if (dim === 'requestType') return ['New HC','Replace']
  return null // เรียงตาม total/alphabet ภายหลัง
}
