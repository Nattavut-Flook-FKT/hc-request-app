/**
 * hcId.js — สร้าง HCID (REQ-YYYY-NNN) แบบ atomic ผ่าน Firestore counter
 * ─────────────────────────────────────────────────────────────────────────────
 * ใช้ counter doc `counters/hcId_{YYYY}` + transaction เพื่อกัน race condition
 * เมื่อมีการสร้าง request พร้อมกันหลาย session
 *
 * ใช้โดย:
 *   - HCRequestForm (submit ฟอร์มใหม่)
 *   - RequestTable → handleRecruitNew (เปิด recruit ใหม่จากเคส No Show)
 */
import { collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, limit, runTransaction } from 'firebase/firestore'
import { db } from '../services/firebase'

export async function generateHCID() {
  const currentYear = new Date().getFullYear()
  const counterRef  = doc(db, 'counters', `hcId_${currentYear}`)

  // ── Seed counter ถ้ายังไม่มี doc (ครั้งแรก) ────────────────────────────
  const counterSnap = await getDoc(counterRef)
  if (!counterSnap.exists()) {
    const prefix = `REQ-${currentYear}-`
    const q = query(
      collection(db, 'hc_requests'),
      where('hcId', '>=', prefix),
      where('hcId', '<',  prefix + ''),
      orderBy('hcId', 'desc'),
      limit(1)
    )
    const snap = await getDocs(q)
    const currentMax = snap.empty ? 0 : (parseInt(snap.docs[0].data().hcId.split('-')[2]) || 0)
    // merge:true ป้องกัน overwrite ถ้า concurrent init เกิดขึ้น
    await setDoc(counterRef, { value: currentMax }, { merge: true })
  }

  // ── Atomic increment ผ่าน transaction → ป้องกัน duplicate ─────────────
  const newSeq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const next = (snap.data()?.value ?? 0) + 1
    tx.set(counterRef, { value: next })
    return next
  })

  return `REQ-${currentYear}-${newSeq}`
}
