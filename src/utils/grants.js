/**
 * grants.js — Helpers สำหรับอ่านสิทธิ์ Manager จาก settings/deptManagers + divisionManagers
 * ─────────────────────────────────────────────────────────────────────────────
 * โครงสร้างใหม่: { "แผนก": ["a@freshket.co", "b@freshket.co"] } — 1 แผนกมีได้หลาย Manager
 * โครงสร้างเก่า: { "แผนก": "a@freshket.co" } — ยังอ่านได้ (normalize เป็น array 1 คน)
 * จึงไม่ต้อง migrate ข้อมูลเดิม — จะกลายเป็น array เองครั้งแรกที่ Admin แก้ grant แผนกนั้น
 */

/** normalize ค่า grant (string เดี่ยวแบบเก่า | array แบบใหม่) → array อีเมล lowercase เสมอ */
export function grantEmails(value) {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
}

/**
 * คืน key ทั้งหมด (แผนก/division) ที่อีเมลนี้ถูก grant
 * @param {Object} mapping  settings/deptManagers หรือ divisionManagers
 * @param {string} email    อีเมลของ user
 */
export function grantedKeys(mapping, email) {
  if (!mapping || !email) return []
  const me = email.trim().toLowerCase()
  return Object.entries(mapping)
    .filter(([, v]) => grantEmails(v).includes(me))
    .map(([key]) => key)
}
