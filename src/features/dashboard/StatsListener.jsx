/**
 * StatsListener — Firestore listener น้ำหนักเบา ไม่มี DOM rendering
 * ─────────────────────────────────────────────────────────────────
 * subscribe onSnapshot บน hc_requests (limit 2000) แบบ realtime แล้วส่ง
 * data ทั้งหมดขึ้นไปให้ parent ผ่าน onData callback
 *   - หยุด listener เมื่อ browser tab ซ่อน → เปิดใหม่เมื่อกลับมา (ประหยัด reads)
 *   - ไม่ render DOM เลย (return null)
 *
 * ใช้ร่วมกันทั้ง DashboardPage และ ReportsPage
 *
 * Props:
 *   onData {fn} callback รับ array ของ requests ทุกครั้งที่ snapshot เปลี่ยน
 */
import { useEffect } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '@/libs/firebase'

export default function StatsListener({ onData }) {
  useEffect(() => {
    const q = query(collection(db, 'hc_requests'), orderBy('createdAt', 'desc'), limit(2000))
    let unsub = null

    const subscribe = () => {
      if (unsub) return
      unsub = onSnapshot(q, snap => {
        onData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      })
    }

    const unsubscribe = () => {
      unsub?.()
      unsub = null
    }

    subscribe()

    // หยุด listener เมื่อ tab ซ่อน → ประหยัด Firestore reads
    const onVisibility = () => document.hidden ? unsubscribe() : subscribe()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onData])

  return null
}
