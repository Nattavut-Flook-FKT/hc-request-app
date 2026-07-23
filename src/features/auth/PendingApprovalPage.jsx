/**
 * PendingApprovalPage.jsx — Waiting-for-admin-approval screen
 * ─────────────────────────────────────────────────────────────────────────────
 * แสดงเมื่อ user login สำเร็จแต่ยังไม่มี role ที่ Admin กำหนด (role === 'pending')
 * กันไม่ให้เข้าแอปจนกว่า Admin จะเข้าไปกำหนด role ที่ Users (/users)
 *
 * Props:
 *   user {object} Firebase Auth user object (ใช้แสดง avatar/ชื่อ/email)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { signOut } from 'firebase/auth'
import { auth } from '@/libs/firebase'
import { Clock3, LogOut } from 'lucide-react'

export default function PendingApprovalPage({ user }) {
  async function handleSignOut() {
    try { await signOut(auth) } catch (e) { console.error(e) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="flex w-full max-w-[480px] flex-col items-center gap-8 rounded-3xl border border-neutral-100 bg-white p-5 shadow-xl sm:p-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">รออนุมัติสิทธิ์การใช้งาน</h1>
          <p className="mt-1 text-[11px] font-bold text-neutral-400">ระบบยื่นคำขออัตรากำลัง</p>
        </div>

        <div className="flex h-20 w-20 items-center justify-center rounded-[2rem] bg-yellow-50">
          <Clock3 size={36} strokeWidth={1} absoluteStrokeWidth className="text-yellow-900" />
        </div>

        <div className="flex w-full flex-col items-center gap-1 rounded-2xl border border-neutral-100 bg-neutral-50 px-5 py-4 text-center">
          {user.photoURL && (
            <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="mb-2 h-10 w-10 rounded-full" />
          )}
          <p className="font-bold text-neutral-900">{user.displayName}</p>
          <p className="text-xs text-neutral-500">{user.email}</p>
        </div>

        <p className="text-center text-sm text-neutral-500 leading-relaxed">
          บัญชีของคุณยังไม่มีสิทธิ์การใช้งานในระบบ HC Request กรุณาแจ้งทีม People Experience
          เพื่อขอให้ Admin กำหนดสิทธิ์ให้ — เมื่ออนุมัติแล้ว ให้เข้าสู่ระบบใหม่อีกครั้ง
        </p>

        <button
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-neutral-100 bg-white px-6 py-4 font-bold text-neutral-700 transition-colors hover:bg-neutral-50 active:scale-95"
        >
          <LogOut size={16} strokeWidth={1} absoluteStrokeWidth />
          <span>ออกจากระบบ</span>
        </button>
      </div>
    </div>
  )
}
