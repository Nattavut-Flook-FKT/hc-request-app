/**
 * AppHelpers.jsx — Shared utility components: RoleSwitcher, RoleGuard, MaintenancePage
 * ─────────────────────────────────────────────────────────────────────────────
 * ไฟล์นี้รวม component ที่ใช้ร่วมกันทั่วทั้งแอปไว้ 3 ตัว:
 *
 *   RoleSwitcher  — เครื่องมือสำหรับ dev ใช้สลับ role/dept โดยไม่ต้องแก้ Firebase
 *                   แสดงผลเฉพาะเมื่อมี VITE_DEV_EMAIL กำหนดใน .env เท่านั้น
 *
 *   RoleGuard     — Route guard ครอบ protected pages
 *                   redirect ผู้ใช้ไปหน้าอื่นหาก role ไม่อยู่ใน allowed list
 *
 *   MaintenancePage — หน้า full-screen สำหรับแจ้ง maintenance mode
 *                     แสดงให้ผู้ใช้ที่ไม่ใช่ admin เห็นเมื่อระบบปิดปรับปรุง
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Navigate } from 'react-router-dom'
import { Settings2, PowerOff, GripVertical } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'

// อ่านค่า VITE_DEV_EMAIL จาก .env — ถ้าไม่มีค่า RoleSwitcher จะไม่แสดง
const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL

/**
 * RoleSwitcher — Dev-only floating panel for switching role and department
 * ─────────────────────────────────────────────────────────────────────────────
 * Widget ลอยมุมขวาล่างสำหรับ developer ใช้ทดสอบ UI ในแต่ละ role
 * โดยไม่ต้องเปลี่ยนข้อมูลใน Firebase หรือ login ด้วย account อื่น
 * จะ render null ทันทีหาก VITE_DEV_EMAIL ไม่ได้กำหนดใน .env
 *
 * Props:
 *   currentRole  {string}   role ที่ active อยู่ตอนนี้ ('manager' | 'ta' | 'admin')
 *   onSwitch     {function} callback(role: string) เมื่อกดเปลี่ยน role
 *   currentDept  {string}   dept override ที่ใช้อยู่ตอนนี้
 *   onDeptSwitch {function} callback(dept: string) เมื่อพิมพ์ dept ใหม่
 */
export function RoleSwitcher({ currentRole, onSwitch, currentDept, onDeptSwitch }) {
  if (!DEV_EMAIL) return null

  // โหลด position จาก localStorage (fallback = มุมขวาล่าง)
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('devSwitcherPos')
      if (saved) return JSON.parse(saved)
    } catch (_) {}
    return { x: window.innerWidth - 240, y: window.innerHeight - 220 }
  })

  const dragging = useRef(false)
  const offset   = useRef({ x: 0, y: 0 })
  const panelRef = useRef(null)

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return
    const nx = e.clientX - offset.current.x
    const ny = e.clientY - offset.current.y
    // clamp ไม่ให้หลุดออกนอกหน้าจอ
    const maxX = window.innerWidth  - (panelRef.current?.offsetWidth  ?? 220)
    const maxY = window.innerHeight - (panelRef.current?.offsetHeight ?? 180)
    setPos({ x: Math.max(0, Math.min(nx, maxX)), y: Math.max(0, Math.min(ny, maxY)) })
  }, [])

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.userSelect = ''
    // บันทึก position ล่าสุดลง localStorage
    setPos(prev => {
      try { localStorage.setItem('devSwitcherPos', JSON.stringify(prev)) } catch (_) {}
      return prev
    })
  }, [])

  // Clamp position on mount — ถ้า localStorage เก็บ position นอกจอ (เช่น จากหน้าจออื่น) ดึงกลับเข้ามา
  useEffect(() => {
    setPos(prev => {
      const W = window.innerWidth
      const H = window.innerHeight
      const pw = panelRef.current?.offsetWidth  ?? 220
      const ph = panelRef.current?.offsetHeight ?? 200
      const cx = Math.max(0, Math.min(prev.x, W - pw))
      const cy = Math.max(0, Math.min(prev.y, H - ph))
      if (cx === prev.x && cy === prev.y) return prev
      try { localStorage.setItem('devSwitcherPos', JSON.stringify({ x: cx, y: cy })) } catch (_) {}
      return { x: cx, y: cy }
    })
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  function startDrag(e) {
    dragging.current = true
    document.body.style.userSelect = 'none'
    offset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    }
  }

  return (
    <div
      ref={panelRef}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[100]"
    >
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-2 shadow-2xl flex flex-col gap-1 ring-4 ring-emerald-500/10 w-52">

        {/* Drag handle — ลากที่นี่เพื่อย้าย panel */}
        <div
          onMouseDown={startDrag}
          className="px-3 py-1.5 border-b border-gray-50 dark:border-slate-800 mb-1 flex items-center gap-2 cursor-grab active:cursor-grabbing select-none"
        >
          <Settings2 size={14} className="text-emerald-500 shrink-0" />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex-1">Dev Switcher</span>
          <GripVertical size={12} className="text-gray-300 dark:text-slate-700 shrink-0" />
        </div>

        {/* Role Switch */}
        <div className="flex flex-col gap-1 mb-2 px-1">
          <span className="text-[9px] font-bold text-gray-400 uppercase ml-1 mb-0.5">Roles</span>
          <div className="flex gap-1">
            {['manager', 'ta', 'admin'].map((r) => (
              <button
                key={r}
                onClick={() => onSwitch(r)}
                className={`flex-1 px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all uppercase tracking-tight ${
                  currentRole === r
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30'
                    : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Dept Override */}
        <div className="flex flex-col gap-1 px-1">
          <span className="text-[9px] font-bold text-gray-400 uppercase ml-1 mb-0.5">Dept Override</span>
          <input
            type="text"
            value={currentDept}
            onChange={(e) => onDeptSwitch(e.target.value)}
            id="dev-dept-override" name="dev-dept-override"
            placeholder="Enter Dept..."
            className="w-full px-3 py-2 text-[11px] font-bold rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
      </div>
    </div>
  )
}

/**
 * RoleGuard — Route guard that blocks access based on role
 * ─────────────────────────────────────────────────────────────────────────────
 * ครอบ protected route — หาก role ของผู้ใช้ไม่อยู่ใน allowed list
 * จะ redirect ไปที่ redirectTo แทนที่จะ render children
 * render null ในระหว่างที่ role ยังโหลดไม่เสร็จ (role เป็น falsy)
 *
 * Props:
 *   role       {string}    role ของผู้ใช้ที่ login อยู่
 *   allowed    {string[]}  รายการ role ที่มีสิทธิ์เข้าหน้านี้ได้
 *   children   {ReactNode} component ที่จะ render เมื่อผ่าน guard
 *   redirectTo {string}    path ที่จะ redirect ไปหาก role ไม่ผ่าน
 */
export function RoleGuard({ role, allowed, children, redirectTo }) {
  // รอ role โหลดเสร็จก่อน เพื่อไม่ redirect ผิดพลาดระหว่าง init
  if (!role) return null
  if (allowed.includes(role)) return children
  return <Navigate to={redirectTo} replace />
}

/**
 * MaintenancePage — Full-screen maintenance mode page
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้า full-screen แสดงให้ผู้ใช้ที่ไม่ใช่ admin เห็นเมื่อระบบปิดปรับปรุง
 * แสดง icon, ข้อความหัว "ระบบปิดปรับปรุง" และ message ที่รับมาจาก props
 *
 * Props:
 *   message {string} ข้อความอธิบายเพิ่มเติม (optional)
 *                    หากไม่ส่งจะแสดง default message
 */
export function MaintenancePage({ message }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f7f6] dark:bg-slate-950 px-6">
      <div className="text-center flex flex-col items-center gap-6 max-w-md">
        <div className="w-20 h-20 rounded-3xl bg-orange-100 dark:bg-orange-500/10 flex items-center justify-center">
          <PowerOff size={36} className="text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 tracking-tight">ระบบปิดปรับปรุง</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-2 text-sm leading-relaxed">
            {message || 'กำลังดำเนินการปรับปรุงระบบ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง'}
          </p>
        </div>
        <p className="text-xs text-gray-400 dark:text-slate-600 font-mono">HC Request System — Maintenance Mode</p>
      </div>
    </div>
  )
}
