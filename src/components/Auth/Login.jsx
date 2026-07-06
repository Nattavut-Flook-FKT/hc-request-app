/**
 * Login.jsx — Login page using Google OAuth
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้า Login ของระบบ HC Request ใช้ Google OAuth ผ่าน Firebase Authentication
 * อนุญาตเฉพาะบัญชีที่มี domain @freshket.co เท่านั้น
 * หาก sign-in สำเร็จแต่ email ไม่ใช่ domain ที่อนุญาต จะทำการ signOut ทันที
 * แล้วแสดง error message ให้ผู้ใช้ทราบ
 *
 * Notes:
 *   - ไม่รับ props (standalone page, ไม่มี parent ส่ง props มา)
 *   - ALLOWED_DOMAIN กำหนดเป็น constant ไว้ด้านบน เปลี่ยนตรงนี้ที่เดียว
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react'
import { signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from '../../services/firebase'
import { AlertCircle } from 'lucide-react'

// domain ที่อนุญาตให้ login ได้ — เปลี่ยนที่นี่หากต้องการรองรับ domain อื่น
const ALLOWED_DOMAIN = 'freshket.co'

export default function Login() {
  const [error, setError] = useState('')

  async function handleGoogleLogin() {
    setError('')
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const email = result.user.email ?? ''

      // ตรวจสอบ domain หลัง sign-in สำเร็จ — ถ้าไม่ใช่ freshket.co ให้ sign-out ออกทันที
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await signOut(auth)
        setError(`อนุญาตเฉพาะบัญชี @${ALLOWED_DOMAIN} เท่านั้น (${email})`)
      }
    } catch (err) {
      console.error('Login error:', err)
      setError('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="flex w-full max-w-[480px] flex-col items-center gap-8 rounded-3xl border border-neutral-100 bg-white p-5 shadow-xl sm:p-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">HC Request System</h1>
          <p className="mt-1 text-[11px] font-bold text-neutral-400">ระบบยื่นคำขออัตรากำลัง</p>
        </div>

        <div className="flex h-20 w-20 rotate-3 items-center justify-center rounded-[2rem] bg-dark-green-50 transition-transform duration-500 hover:rotate-0">
          <svg className="h-10 w-10 text-dark-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>

        {/* แสดง error เมื่อ login ไม่สำเร็จ หรือ email ไม่ถูก domain */}
        {error && (
          <div className="flex w-full items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-xs font-bold text-red-700 animate-shake">
            <AlertCircle size={16} strokeWidth={1} absoluteStrokeWidth className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          className="group flex w-full items-center justify-center gap-4 rounded-2xl border border-neutral-100 bg-white px-6 py-4 font-bold text-neutral-700 transition-colors hover:bg-neutral-50 active:scale-95"
        >
          <svg className="h-5 w-5 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          <span>Sign in with Google</span>
        </button>

        <p className="text-center text-[11px] font-bold text-neutral-400">
          Freshket account only
        </p>
      </div>
    </div>
  )
}
