/**
 * statusConfig.js — label + สี badge ของแต่ละสถานะ hc_requests (DS Light-variant: bg-50 · text-900 · border-100)
 * ย้ายมาจาก RequestTable เพื่อให้หน้าอื่น (PendingApprovalsPage) ใช้ชุดเดียวกัน — TA กับ CEO เห็นสี/ชื่อสถานะตรงกัน
 * ponytail: ยังมี STATUS map ซ้ำใน ManagerRequestsView / reportUtils / GAS — ค่อยรวมทีหลังถ้ามีเหตุให้แตะ
 */
// ─── สี Badge ของแต่ละสถานะ — DS Light-variant recipe (functional color-coding, DS-#010) ───
export const STATUS_CONFIG = {
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
