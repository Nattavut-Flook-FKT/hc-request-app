/**
 * ItOnboardingPage.jsx — รายชื่อพนักงานใหม่สำหรับ IT (เตรียมบัญชี/อุปกรณ์)
 * ─────────────────────────────────────────────────────────────────────────────
 * แสดงเคสสถานะ Onboarding (รอเริ่มงาน) + Closed (เริ่มงานแล้ว) พร้อมอีเมลบริษัท
 * ที่ generate ไว้ตอนเปลี่ยนสถานะเป็น Onboarding (field `itEmail`)
 *
 * Filter: ทั้งหมด / รอเริ่มงาน / เริ่มงานแล้ว / สัปดาห์นี้ / สัปดาห์ถัดไป / เดือนนี้ / เดือนหน้า
 * (ตัวกรองช่วงเวลา ใช้เฉพาะกับเคสที่ยังรอเริ่มงาน — สัปดาห์แบบ rolling 7 วัน, เดือนแบบปฏิทินจริง)
 * เคสเก่าที่ยังไม่มี itEmail (สร้างก่อนฟีเจอร์นี้มีอยู่) — กดปุ่ม "สร้างอีเมล" เพื่อ
 * generate ย้อนหลังจากชื่อ candidate (ต้องเป็นภาษาอังกฤษ ≥ 2 คำ) หรือกรอกเองได้
 *
 * ตั้งใจไม่ query ผ่าน StatsListener (ดึงทุก field ของ hc_requests 2000 doc) —
 * ใช้ query แคบของตัวเอง + project เฉพาะ field ที่ IT ต้องใช้ (ไม่โชว์ reason,
 * replacementFor, rejectReason, statusHistory, cvUrl, requesterEmail ฯลฯ)
 *
 * ไม่แตะ Google Sheets/GAS — อ่านจาก Firestore โดยตรงเท่านั้น
 */
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, updateDoc, where, limit } from 'firebase/firestore'
import { Pencil } from 'lucide-react'
import { db } from '../services/firebase'
import Layout from '../components/Shared/Layout'
import { KpiCard, SectionCard, ExportButtons, DataTable } from '../components/Reports/ReportUI'
import { exportWorkbook, exportCSV, dateStamp } from '../utils/exportExcel'
import { toDate, statusTH } from '../utils/reportUtils'
import { generateFreshketEmail } from '../utils/email'

const VIEWS = [
  { v: 'all',       label: 'ทั้งหมด' },
  { v: 'waiting',   label: 'รอเริ่มงาน' },
  { v: 'started',   label: 'เริ่มงานแล้ว' },
  { v: 'thisWeek',  label: 'สัปดาห์นี้' },
  { v: 'nextWeek',  label: 'สัปดาห์ถัดไป' },
  { v: 'thisMonth', label: 'เดือนนี้' },
  { v: 'nextMonth', label: 'เดือนหน้า' },
]

export default function ItOnboardingPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('all')
  // แก้/กรอกอีเมลเอง (เคสเก่าที่ generate อัตโนมัติไม่ได้ เช่น ชื่อไม่ใช่ 2 คำภาษาอังกฤษ)
  const [manualEditId, setManualEditId] = useState(null)
  const [manualEmailVal, setManualEmailVal] = useState('')
  const [savingId, setSavingId] = useState(null)

  useEffect(() => {
    // ไม่ใส่ orderBy ในตัว query — เลี่ยงการต้องสร้าง Firestore composite index ใหม่
    // (in-filter + orderBy คนละ field ต้องมี index) แล้ว sort ฝั่ง client แทน
    const q = query(collection(db, 'hc_requests'), where('status', 'in', ['Onboarding', 'Closed']), limit(500))
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => {
          const r = d.data()
          return {
            _key: d.id,
            hcId: r.hcId || d.id,
            candidateNameRaw: r.candidateName || '',
            candidate: r.candidateName || '—',
            itEmail: r.itEmail || '',
            position: r.position || '—',
            department: r.department || '—',
            startDate: r.startDate || '',
            status: r.status,
            _sortTime: toDate(r.startDate)?.getTime() ?? 0,
          }
        })
        .sort((a, b) => b._sortTime - a._sortTime) // ล่าสุดก่อน
      setRows(list)
      setLoading(false)
    }, (err) => {
      console.error('[ItOnboardingPage] snapshot error:', err)
      setLoading(false)
    })
    return unsub
  }, [])

  // ช่วงเวลาสำหรับตัวกรอง — สัปดาห์: rolling 7 วัน (นี้ = 0-7 วัน, ถัดไป = 7-14 วัน)
  // เดือน: ปฏิทินจริง (วันที่ 1 ถึงวันสุดท้ายของเดือน) เพราะเดือนยาวไม่เท่ากัน
  const ranges = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const day = 24 * 60 * 60 * 1000
    const thisWeekStart = t.getTime()
    const thisWeekEnd   = thisWeekStart + 7 * day
    const nextWeekEnd   = thisWeekEnd + 7 * day
    const y = t.getFullYear(), m = t.getMonth()
    return {
      thisWeekStart, thisWeekEnd,
      nextWeekStart: thisWeekEnd, nextWeekEnd,
      thisMonthStart: new Date(y, m, 1).getTime(),
      thisMonthEnd:   new Date(y, m + 1, 0, 23, 59, 59, 999).getTime(),
      nextMonthStart: new Date(y, m + 1, 1).getTime(),
      nextMonthEnd:   new Date(y, m + 2, 0, 23, 59, 59, 999).getTime(),
    }
  }, [])

  function inRange(r, startKey, endKey) {
    return r.status === 'Onboarding' && r._sortTime >= ranges[startKey] && r._sortTime <= ranges[endKey]
  }

  const waitingCount  = rows.filter((r) => r.status === 'Onboarding').length
  const startedCount  = rows.filter((r) => r.status === 'Closed').length
  const thisWeekCount = rows.filter((r) => inRange(r, 'thisWeekStart', 'thisWeekEnd')).length

  const displayed = rows.filter((r) => {
    if (view === 'waiting')   return r.status === 'Onboarding'
    if (view === 'started')   return r.status === 'Closed'
    if (view === 'thisWeek')  return inRange(r, 'thisWeekStart', 'thisWeekEnd')
    if (view === 'nextWeek')  return inRange(r, 'nextWeekStart', 'nextWeekEnd')
    if (view === 'thisMonth') return inRange(r, 'thisMonthStart', 'thisMonthEnd')
    if (view === 'nextMonth') return inRange(r, 'nextMonthStart', 'nextMonthEnd')
    return true
  })

  // สร้างอีเมลย้อนหลังจากชื่อ candidate — ถ้า generate ไม่ได้ (ชื่อไม่ใช่ 2 คำภาษาอังกฤษ) เปิดช่องให้กรอกเอง
  async function handleGenerate(row) {
    const generated = generateFreshketEmail(row.candidateNameRaw)
    if (!generated) {
      setManualEditId(row._key)
      setManualEmailVal('')
      return
    }
    setSavingId(row._key)
    try {
      await updateDoc(doc(db, 'hc_requests', row._key), { itEmail: generated })
    } catch (err) {
      console.error('[ItOnboardingPage] generate email failed:', err)
    }
    setSavingId(null)
  }

  async function handleManualSave(row) {
    const val = manualEmailVal.trim()
    if (!val) return
    setSavingId(row._key)
    try {
      await updateDoc(doc(db, 'hc_requests', row._key), { itEmail: val })
    } catch (err) {
      console.error('[ItOnboardingPage] manual email save failed:', err)
    }
    setSavingId(null)
    setManualEditId(null)
    setManualEmailVal('')
  }

  const COLUMNS = [
    { key: 'hcId', label: 'HCID' },
    { key: 'candidate', label: 'ผู้สมัคร', accent: true },
    {
      key: 'itEmail', label: 'อีเมลบริษัท', accent: true,
      render: (r) => {
        if (manualEditId === r._key) {
          return (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={manualEmailVal}
                onChange={(e) => setManualEmailVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleManualSave(r); if (e.key === 'Escape') setManualEditId(null) }}
                placeholder="กรอกอีเมลเอง..."
                className="min-w-0 flex-1 rounded-lg border border-teal-100 bg-white px-2 py-1 text-sm text-teal-900 focus:outline-none focus:ring-1 focus:ring-teal-300"
              />
              <button onClick={() => handleManualSave(r)} className="shrink-0 rounded-lg bg-teal-600 px-2 py-1 text-[11px] font-bold text-neutral-50 hover:bg-teal-700">✓</button>
              <button onClick={() => setManualEditId(null)} className="shrink-0 text-[11px] text-neutral-400 hover:text-neutral-600">✕</button>
            </div>
          )
        }
        if (r.itEmail) {
          return (
            <span className="group inline-flex items-center gap-1.5">
              {r.itEmail}
              <button onClick={() => { setManualEditId(r._key); setManualEmailVal(r.itEmail) }} title="แก้ไข">
                <Pencil size={10} strokeWidth={1} absoluteStrokeWidth className="shrink-0 text-neutral-300 transition-colors group-hover:text-teal-500" />
              </button>
            </span>
          )
        }
        return (
          <button
            onClick={() => handleGenerate(r)}
            disabled={savingId === r._key}
            className="rounded-lg border border-teal-100 px-2 py-1 text-[11px] font-bold text-teal-700 transition-colors hover:bg-teal-50 disabled:opacity-50"
          >
            {savingId === r._key ? 'กำลังสร้าง...' : 'สร้างอีเมล'}
          </button>
        )
      },
    },
    { key: 'position', label: 'ตำแหน่ง' },
    { key: 'department', label: 'แผนก' },
    { key: 'startDate', label: 'วันเริ่มงาน' },
    { key: 'status', label: 'สถานะ', align: 'center', render: (r) => statusTH(r.status) },
  ]

  function buildAOA() {
    const header = ['HCID', 'ผู้สมัคร', 'อีเมลบริษัท', 'ตำแหน่ง', 'แผนก', 'วันเริ่มงาน', 'สถานะ']
    return [header, ...displayed.map((r) => [r.hcId, r.candidate, r.itEmail || '—', r.position, r.department, r.startDate, statusTH(r.status)])]
  }

  if (loading) {
    return (
      <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
        <div className="flex flex-col gap-4 animate-pulse">
          <div className="h-16 rounded-2xl border border-neutral-100 bg-white" />
          <div className="h-64 rounded-2xl border border-neutral-100 bg-white" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">IT Onboarding</h1>
          <p className="mt-0.5 text-sm text-neutral-500">รายชื่อพนักงานใหม่ + อีเมลบริษัท สำหรับเตรียมบัญชี/อุปกรณ์</p>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
          <button onClick={() => setView('waiting')} className="w-full text-left">
            <KpiCard label="รอเริ่มงาน" value={waitingCount} accent={view === 'waiting'} />
          </button>
          <button onClick={() => setView('started')} className="w-full text-left">
            <KpiCard label="เริ่มงานแล้ว" value={startedCount} accent={view === 'started'} />
          </button>
          <button onClick={() => setView('thisWeek')} className="w-full text-left">
            <KpiCard label="เริ่มสัปดาห์นี้" value={thisWeekCount} accent={view === 'thisWeek'} />
          </button>
        </div>

        <div className="inline-flex w-fit flex-wrap items-center gap-0.5 rounded-full border border-neutral-100 p-0.5">
          {VIEWS.map((t) => (
            <button key={t.v} onClick={() => setView(t.v)}
              className={`rounded-full px-4 py-1.5 text-xs font-normal transition-colors ${
                view === t.v ? 'bg-green-fresh-50 text-green-fresh-900' : 'text-neutral-900 hover:bg-neutral-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <SectionCard
          title="รายชื่อ"
          sub={`${displayed.length} รายการ`}
          action={<ExportButtons disabled={displayed.length === 0}
            onExcel={() => exportWorkbook(`it-onboarding_${dateStamp()}`, [{ name: 'IT Onboarding', aoa: buildAOA() }])}
            onCSV={() => exportCSV(`it-onboarding_${dateStamp()}`, buildAOA())} />}
        >
          <DataTable columns={COLUMNS} rows={displayed} emptyText="ไม่มีเคสตามตัวกรองที่เลือก" />
        </SectionCard>
      </div>
    </Layout>
  )
}
