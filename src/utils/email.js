/**
 * email.js — generate อีเมลบริษัทจากชื่อ candidate (ภาษาอังกฤษเท่านั้น)
 * ใช้ร่วมกันระหว่าง RequestTable.jsx (onboarding modal) และ ItOnboardingPage.jsx
 * (backfill อีเมลให้เคสเก่า)
 */
const ENGLISH_NAME_RE = /^[A-Za-z\s.'-]+$/
export function isEnglishName(s) { return !!s && ENGLISH_NAME_RE.test(s.trim()) }

// "Somchai Jaidee" → "somchai.j@freshket.co" — ต้องมีอย่างน้อย 2 คำ (first + last)
// ชื่อกลาง (ถ้ามี) ไม่มีผล ใช้แค่คำแรกกับคำสุดท้าย
export function generateFreshketEmail(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return ''
  const first = parts[0].toLowerCase().replace(/[^a-z]/g, '')
  const lastInitial = (parts[parts.length - 1][0] || '').toLowerCase().replace(/[^a-z]/g, '')
  return first && lastInitial ? `${first}.${lastInitial}@freshket.co` : ''
}
