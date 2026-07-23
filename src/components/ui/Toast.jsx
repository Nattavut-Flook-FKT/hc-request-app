/**
 * Toast.jsx — Toast / Snackbar ตาม FKT DS 2026 (16-toast.md · DS-#072, #073)
 * ─────────────────────────────────────────────────────────────────────────────
 * ใช้แจ้งผลหลัง action โดยไม่ขัดจังหวะผู้ใช้ — โดยเฉพาะผล sync ไป Google Sheets
 *
 * การใช้งาน:
 *   1. mount <Toaster /> ครั้งเดียวใน App.jsx
 *   2. เรียก toast('ข้อความ', { type: 'success' | 'warning' | 'error', sub: 'รายละเอียด' })
 *      จากที่ไหนก็ได้ (ไม่ต้องอยู่ใน React tree)
 *
 * Spec ที่ implement:
 *   - Variant B (Tinted 50) — default ของ portal context
 *   - Warning ใช้ yellow bg + neutral-900 เสมอ (DS-#073)
 *   - Emoji เป็น icon หลัก · ไม่มี colored border/accent (spec §4)
 *   - z-toast 600 · top-right (desktop) · bottom-center (mobile)
 *   - Success auto-dismiss 4s · Warning/Error ต้องกดปิดเอง (spec §5)
 *   - แสดงสูงสุด 3 อัน — เกินนั้นต่อคิว (spec §1)
 * [PROPOSED — not in spec yet]: กลไก trigger แบบ module-level event bus
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// ── Module-level event bus — ให้ non-React code (เช่น service layer) ยิง toast ได้ ──
let _push = null
let _id = 0

/**
 * แสดง toast — เรียกจากที่ไหนก็ได้
 * @param {string} message ข้อความหลัก (Body2 14px)
 * @param {object} [opts]
 * @param {'success'|'warning'|'error'|'normal'} [opts.type='normal']
 * @param {string} [opts.sub] ข้อความรอง (Caption 12px)
 */
export function toast(message, { type = 'normal', sub = '' } = {}) {
  if (_push) _push({ id: ++_id, message, type, sub })
  else console.warn('[toast] Toaster not mounted:', message)
}

// spec §2-3: Variant B (Tinted 50) ต่อ type + emoji ต่อ type (emoji คือ icon หลักของ toast)
const STYLE = {
  success: { emoji: '✅', box: 'bg-green-fresh-50 border-green-fresh-100 text-green-fresh-900', autoDismiss: true },
  warning: { emoji: '⚠️', box: 'bg-yellow-50 border-yellow-100 text-neutral-900',               autoDismiss: false },
  error:   { emoji: '❌', box: 'bg-red-50 border-red-100 text-red-900',                          autoDismiss: false },
  normal:  { emoji: '💬', box: 'bg-white border-neutral-100 text-neutral-900',                   autoDismiss: true },
}

const MAX_VISIBLE = 3 // spec §1: แสดงพร้อมกันสูงสุด 3

export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => {
    _push = (item) => setItems(prev => [item, ...prev]) // ใหม่สุดอยู่บน (spec §1)
    return () => { _push = null }
  }, [])

  // auto-dismiss 4s เฉพาะ type ที่ spec อนุญาต (success / normal)
  useEffect(() => {
    const timers = items
      .filter(it => STYLE[it.type].autoDismiss)
      .map(it => setTimeout(() => dismiss(it.id), 4000))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map(it => it.id).join(',')])

  function dismiss(id) {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  if (!items.length) return null

  return (
    <div className="fixed z-[600] flex flex-col gap-2 max-md:bottom-4 max-md:left-1/2 max-md:w-[calc(100%-32px)] max-md:-translate-x-1/2 md:right-4 md:top-4">
      {items.slice(0, MAX_VISIBLE).map(it => {
        const s = STYLE[it.type]
        return (
          <div
            key={it.id}
            className={`flex items-start gap-2 rounded-[18px] border-[0.5px] py-4 pl-3 pr-4 shadow-lg animate-in fade-in duration-200 max-md:slide-in-from-bottom-4 md:slide-in-from-right-4 md:min-w-[320px] md:max-w-[480px] ${s.box}`}
          >
            <span className="mt-px text-base leading-none">{s.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-normal leading-[1.4]">{it.message}</p>
              {it.sub && <p className="mt-1 text-xs font-normal text-neutral-600">{it.sub}</p>}
            </div>
            <button
              onClick={() => dismiss(it.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600"
            >
              <X size={16} strokeWidth={1} absoluteStrokeWidth />
            </button>
          </div>
        )
      })}
    </div>
  )
}
