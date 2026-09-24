/** dates.js — แปลงวันที่จาก Firestore Timestamp / ISO string / Date ให้เป็นค่าใช้งานร่วมกัน */

/** epoch ms หรือ 0 ถ้าแปลงไม่ได้ — ใช้ sort */
export function toMs(ts) {
  const d = ts?.toDate?.() ?? (ts ? new Date(ts) : null)
  return d && !isNaN(d) ? d.getTime() : 0
}

/** "24 ก.ย. 2569" หรือ '—' */
export function fmtDate(ts) {
  const ms = toMs(ts)
  return ms ? new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
