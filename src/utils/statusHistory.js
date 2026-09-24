/**
 * statusHistory.js — helper กลางสำหรับ entry ใน hc_requests.statusHistory[]
 * ใช้ร่วมกันทั้ง RequestTable (TA เปลี่ยนสถานะ), PendingApprovalsPage (CEO อนุมัติ/ไม่อนุมัติ), AdminTools
 */

/** ตัดนามสกุลออก เหลือแค่ "ชื่อ (nickname)" — เช่น "Jitlada (Mo) Mooltha" → "Jitlada (Mo)" */
export function shortName(fullName) {
  if (!fullName) return fullName
  const match = fullName.match(/^.+?\)/)
  return match ? match[0].trim() : fullName
}

/** entry สำหรับ arrayUnion() ลง statusHistory — reportUtils.computeSLADays อ่าน status + changedAt จากตรงนี้ */
export function buildHistoryEntry(status, user) {
  return { status, changedAt: new Date().toISOString(), changedBy: user.email, changedByName: shortName(user.displayName) }
}
