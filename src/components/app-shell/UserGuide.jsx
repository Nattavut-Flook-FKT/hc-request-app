/**
 * UserGuide.jsx — Interactive Onboarding Slides (คู่มือการใช้งาน)
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal slide-deck แสดงวิธีใช้งานระบบ HC Request สำหรับ Manager
 * เปิดได้จากปุ่ม "?" ใน Sidebar
 *
 * Props:
 *   onClose  {fn}  callback ปิด modal
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Slide content ────────────────────────────────────────────────────────────
const SLIDES = [
  // ── Slide 1: Overview ──────────────────────────────────────────────────────
  {
    step: '01',
    tag: 'ภาพรวม',
    title: 'HC Request คืออะไร?',
    body: 'ระบบสำหรับยื่นคำขออัตรากำลังพนักงานให้ทีม People Experience รับทราบและดำเนินการสรรหา ทุกคำขอถูกติดตามสถานะแบบ Real-time',
    visual: (
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl bg-dark-green-600">
          <span className="text-white font-bold text-xl">HC</span>
        </div>
        <div className="flex gap-3 mt-1">
          {['Manager','→ People Exp.','→ พนักงานใหม่'].map((t, i) => (
            <div key={i} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border ${
              i === 0 ? 'bg-blue-50 border-blue-100 text-blue-900'
              : i === 1 ? 'bg-dark-green-50 border-dark-green-100 text-dark-green-900'
              : 'bg-purple-50 border-purple-100 text-purple-900'
            }`}>{t}</div>
          ))}
        </div>
        <div className="text-[10px] text-neutral-400 text-center mt-1">
          ยื่นคำขอ → TA รับเรื่อง → สรรหา → ปิดงาน
        </div>
      </div>
    ),
  },

  // ── Slide 2: Form walkthrough ──────────────────────────────────────────────
  {
    step: '02',
    tag: 'ยื่นคำขอ',
    title: 'วิธีกรอกฟอร์มยื่นคำขอ',
    body: 'เข้าเมนู "ยื่นคำขอ" แล้วกรอกข้อมูลตามลำดับ 4 ขั้นตอน ระบบจะ Auto-fill แผนกของคุณอัตโนมัติ',
    visual: (
      <div className="w-full flex flex-col gap-2 text-[11px]">
        {[
          { n: '1', label: 'เลือกประเภทคำขอ', sub: 'Replacement หรือ New HC', color: 'bg-blue-600' },
          { n: '2', label: 'เลือก Division → Department → ตำแหน่ง', sub: 'ระบบ Cascade อัตโนมัติ', color: 'bg-purple-600' },
          { n: '3', label: 'กรอก Job Grade + เหตุผล', sub: 'ระบุเหตุผลให้ชัดเจน', color: 'bg-orange-600' },
          { n: '4', label: 'แนบ JD (optional) แล้วกด ยื่นคำขอ', sub: 'รับแจ้งเตือนทาง Slack ทันที', color: 'bg-dark-green-600' },
        ].map(s => (
          <div key={s.n} className="flex items-start gap-2.5 bg-neutral-50 rounded-xl px-3 py-2">
            <span className={`w-5 h-5 rounded-full ${s.color} text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>{s.n}</span>
            <div>
              <p className="font-bold text-neutral-800">{s.label}</p>
              <p className="text-neutral-400 text-[10px]">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },

  // ── Slide 3: Request types ─────────────────────────────────────────────────
  {
    step: '03',
    tag: 'ประเภทคำขอ',
    title: 'Replacement vs New HC',
    body: 'เลือกประเภทให้ถูกต้อง ข้อมูลที่ต้องกรอกจะต่างกัน',
    visual: (
      <div className="grid grid-cols-2 gap-3 w-full text-[11px]">
        {/* Replacement */}
        <div className="flex flex-col gap-2 p-3 bg-orange-50 border border-orange-100 rounded-2xl">
          <div className="flex items-center gap-1.5">
            <span className="text-lg">🔄</span>
            <span className="font-bold text-orange-900">Replacement</span>
          </div>
          <p className="text-neutral-600 text-[10px]">ทดแทนพนักงานที่ลาออก</p>
          <div className="flex flex-col gap-1 mt-1">
            {['ระบุชื่อพนักงานเดิม','วันสุดท้ายที่ทำงาน (LWD)'].map(t => (
              <div key={t} className="flex items-center gap-1 text-[10px] text-neutral-500">
                <span className="text-orange-600">•</span> {t}
              </div>
            ))}
          </div>
        </div>
        {/* New HC */}
        <div className="flex flex-col gap-2 p-3 bg-dark-green-50 border border-dark-green-100 rounded-2xl">
          <div className="flex items-center gap-1.5">
            <span className="text-lg">✨</span>
            <span className="font-bold text-dark-green-900">New HC</span>
          </div>
          <p className="text-neutral-600 text-[10px]">เพิ่มอัตรากำลังใหม่</p>
          <div className="flex flex-col gap-1 mt-1">
            {['ระบุจำนวน HC ที่ต้องการ','วันที่ต้องการเริ่มงาน'].map(t => (
              <div key={t} className="flex items-center gap-1 text-[10px] text-neutral-500">
                <span className="text-dark-green-600">•</span> {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  },

  // ── Slide 4: Preset ────────────────────────────────────────────────────────
  {
    step: '04',
    tag: 'Preset',
    title: 'Preset — บันทึกสูตรที่ใช้บ่อย',
    body: 'ถ้าต้องยื่นตำแหน่งเดิมซ้ำๆ ให้บันทึกเป็น Preset ครั้งถัดไปกด Load ได้เลย ประหยัดเวลามาก',
    visual: (
      <div className="w-full flex flex-col gap-3 text-[11px]">
        {/* How to save */}
        <div className="flex items-start gap-2.5 bg-neutral-50 rounded-xl px-3 py-2.5">
          <span className="w-6 h-6 rounded-full bg-dark-green-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
          <div>
            <p className="font-bold text-neutral-800">กรอกฟอร์มให้ครบ</p>
            <p className="text-neutral-400 text-[10px]">Division, Department, ตำแหน่ง, JG, ประเภทจ้าง</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 bg-neutral-50 rounded-xl px-3 py-2.5">
          <span className="w-6 h-6 rounded-full bg-dark-green-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
          <div>
            <p className="font-bold text-neutral-800">กดปุ่ม <span className="px-1.5 py-0.5 bg-dark-green-50 text-dark-green-900 rounded-lg font-bold">Preset</span> มุมขวาบนของฟอร์ม</p>
            <p className="text-neutral-400 text-[10px]">ตั้งชื่อ เช่น "Daily-DC" หรือ "Sales-Monthly"</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 bg-dark-green-50 border border-dark-green-100 rounded-xl px-3 py-2.5">
          <span className="w-6 h-6 rounded-full bg-dark-green-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
          <div>
            <p className="font-bold text-neutral-800">ครั้งถัดไป — กดชื่อ Preset</p>
            <p className="text-neutral-400 text-[10px]">ฟอร์มจะ fill ทุก field อัตโนมัติ เหลือแค่กรอก เหตุผล</p>
          </div>
        </div>
      </div>
    ),
  },

  // ── Slide 5: Track status ──────────────────────────────────────────────────
  {
    step: '05',
    tag: 'ติดตามสถานะ',
    title: 'ดูสถานะคำขอของฉัน',
    body: 'เข้าเมนู "คำขอของฉัน" เพื่อดูรายการคำขอทั้งหมดและสถานะปัจจุบันของแต่ละรายการ',
    visual: (
      <div className="w-full flex flex-col gap-2 text-[11px]">
        {/* Mock request list */}
        {[
          { hcId: 'REQ-2026-045', pos: 'Sales Executive', status: 'Recruiting', color: 'bg-blue-50 text-blue-900' },
          { hcId: 'REQ-2026-038', pos: 'Logistics Officer', status: 'Offering', color: 'bg-purple-50 text-purple-900' },
          { hcId: 'REQ-2026-031', pos: 'Merchandiser', status: 'Closed', color: 'bg-green-fresh-50 text-green-fresh-900' },
        ].map(r => (
          <div key={r.hcId} className="flex items-center justify-between bg-neutral-50 rounded-xl px-3 py-2">
            <div>
              <p className="font-bold text-neutral-700">{r.pos}</p>
              <p className="text-neutral-400 text-[10px]">{r.hcId}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.color}`}>{r.status}</span>
          </div>
        ))}
        <p className="text-center text-[10px] text-neutral-400 mt-1">
          เห็นสถานะ Real-time ทุกครั้งที่ TA อัปเดต
        </p>
      </div>
    ),
  },

  // ── Slide 6: Status flow ───────────────────────────────────────────────────
  {
    step: '06',
    tag: 'ขั้นตอน TA',
    title: 'สถานะการดำเนินงาน',
    body: 'หลังจากยื่นคำขอ TA จะดำเนินการตามขั้นตอนนี้ คุณสามารถติดตามได้ตลอดเวลา',
    visual: (
      <div className="w-full">
        {/* Status flow */}
        <div className="flex flex-col gap-1.5">
          {[
            { s: 'Open',         label: 'Open',          desc: 'คำขอเข้าระบบ รอ TA รับเรื่อง',         dot: 'bg-yellow-600' },
            { s: 'Recruiting',   label: 'Recruiting',    desc: 'TA กำลังสรรหาและคัดกรองผู้สมัคร',      dot: 'bg-blue-600' },
            { s: 'Interviewing', label: 'Interviewing',  desc: 'อยู่ระหว่างนัดสัมภาษณ์',               dot: 'bg-orange-600' },
            { s: 'Offering',     label: 'Offering',      desc: 'เสนอเงินเดือน รอผู้สมัครตอบรับ',       dot: 'bg-purple-600' },
            { s: 'Onboarding',   label: 'W.Onboarding',  desc: 'ผู้สมัครตอบรับแล้ว รอวันเริ่มงาน',     dot: 'bg-teal-600' },
            { s: 'Closed',       label: 'Closed ✓',      desc: 'พนักงานเริ่มงานแล้ว — ปิดคำขอ',        dot: 'bg-green-fresh-600' },
          ].map((item, i) => (
            <div key={item.s} className="flex items-start gap-2.5">
              {/* Timeline line */}
              <div className="flex flex-col items-center shrink-0 mt-1">
                <span className={`w-2.5 h-2.5 rounded-full ${item.dot}`} />
                {i < 5 && <span className="w-px h-3 bg-neutral-200 mt-0.5" />}
              </div>
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="font-bold text-neutral-700 w-24 shrink-0">{item.label}</span>
                <span className="text-neutral-400">{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
]

// ─── Component ────────────────────────────────────────────────────────────────
export default function UserGuide({ onClose }) {
  const [slide, setSlide] = useState(0)
  const total = SLIDES.length

  const prev = useCallback(() => setSlide(s => Math.max(0, s - 1)), [])
  const next = useCallback(() => setSlide(s => Math.min(total - 1, s + 1)), [total])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next()
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prev()
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  const current = SLIDES[slide]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div className="relative bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden border border-neutral-100 flex flex-col"
        style={{ maxHeight: '90vh' }}>

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-0 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-dark-green-600">
              <span className="text-white text-[10px] font-bold">HC</span>
            </div>
            <span className="text-xs font-bold text-neutral-400">คู่มือการใช้งาน</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-xl text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-all">
            <X size={14} strokeWidth={1} absoluteStrokeWidth />
          </button>
        </div>

        {/* ── Slide content ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Step tag */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-bold text-dark-green-700">{current.step}</span>
            <span className="w-px h-3 bg-neutral-200" />
            <span className="text-[10px] font-bold text-neutral-400">{current.tag}</span>
          </div>

          {/* Title + body */}
          <h2 className="text-xl font-bold text-neutral-900 mb-2 leading-tight">{current.title}</h2>
          <p className="text-sm text-neutral-500 leading-relaxed mb-6">{current.body}</p>

          {/* Visual area */}
          <div className="w-full">
            {current.visual}
          </div>
        </div>

        {/* ── Footer: dots + nav buttons ────────────────────────── */}
        <div className="shrink-0 border-t border-neutral-100 px-6 py-4 flex items-center justify-between bg-neutral-50/50">

          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)}
                className={`rounded-full transition-all duration-200 ${
                  i === slide
                    ? 'w-5 h-2 bg-dark-green-600'
                    : 'w-2 h-2 bg-neutral-200 hover:bg-neutral-300'
                }`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            <button onClick={prev} disabled={slide === 0}
              className="w-8 h-8 flex items-center justify-center rounded-xl border border-neutral-100 text-neutral-400 disabled:opacity-30 hover:bg-neutral-100 hover:text-neutral-600 transition-all">
              <ChevronLeft size={14} strokeWidth={1} absoluteStrokeWidth />
            </button>

            {slide < total - 1 ? (
              <button onClick={next}
                className="flex items-center gap-1.5 px-4 py-2 bg-dark-green-600 text-white text-[11px] font-bold rounded-xl hover:bg-dark-green-700 transition-all">
                ถัดไป <ChevronRight size={12} strokeWidth={1} absoluteStrokeWidth />
              </button>
            ) : (
              <button onClick={onClose}
                className="flex items-center gap-1.5 px-4 py-2 bg-dark-green-600 text-white text-[11px] font-bold rounded-xl hover:bg-dark-green-700 transition-all">
                เริ่มใช้งาน ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
