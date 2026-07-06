/**
 * ReportPanel
 * ─────────────────────────────────────────────────────────
 * Report section สำหรับ Dashboard:
 *   - Filter by date range, department, status, TA
 *   - Summary: by status, by department, by TA
 *   - Export filtered data เป็น CSV (UTF-8 BOM สำหรับ Google Sheets / Excel)
 */
import { useState, useMemo } from 'react'
import { Download, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react'
import { PRESETS, getDateRange, computeSLADays, getOfferingDate, escapeCSV, fmtDate } from '../../utils/reportUtils'

// ─── SLA days wrapper ─────────────────────────────────────
function slaDays(r) {
  const days = computeSLADays(r)
  return days === '' ? '' : days
}

function downloadPivotCSV(rows, filename) {
  const ACTIVE = new Set(['Open', 'Recruiting', 'Interviewing', 'Offering'])
  const isReplace = r => r.requestType === 'Replacement' || r.requestType === 'Replace'

  const lines = []
  const row = (...cells) => lines.push(cells.map(escapeCSV).join(','))
  const blank = (n = 1) => { for (let i = 0; i < n; i++) lines.push('') }

  // ── Section 1: Task by PIC ──────────────────────────────
  row('Task by PIC')
  row('PIC', 'HCID', 'Position', 'Status', 'New HC', 'Replace', 'Grand Total')

  // group by PIC
  const picMap = {}
  rows.forEach(r => {
    const pic = r.assignedToName || '— ยังไม่ assign —'
    if (!picMap[pic]) picMap[pic] = []
    picMap[pic].push(r)
  })

  let gNewHC = 0, gReplace = 0
  Object.entries(picMap)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([pic, reqs]) => {
      let pNewHC = 0, pReplace = 0
      reqs.forEach((r, i) => {
        const isNew = !isReplace(r)
        isNew ? pNewHC++ : pReplace++
        row(i === 0 ? pic : '', r.hcId || r.id, r.position, r.status, isNew ? 1 : '', isReplace(r) ? 1 : '', 1)
      })
      gNewHC += pNewHC; gReplace += pReplace
      row(`${pic} Total`, '', '', '', pNewHC || '', pReplace || '', pNewHC + pReplace)
      blank()
    })
  row('Grand Total', '', '', '', gNewHC || '', gReplace || '', rows.length)

  blank(2)

  // ── Section 2: Active Search by PIC ────────────────────
  row('Active Search by PIC')
  row('PIC', 'Active Search Count')
  const activeByPIC = {}
  rows.filter(r => ACTIVE.has(r.status)).forEach(r => {
    const pic = r.assignedToName || '— ยังไม่ assign —'
    activeByPIC[pic] = (activeByPIC[pic] || 0) + 1
  })
  Object.entries(activeByPIC).sort((a, b) => b[1] - a[1]).forEach(([pic, cnt]) => row(pic, cnt))
  row('Grand Total', Object.values(activeByPIC).reduce((s, v) => s + v, 0))

  blank(2)

  // ── Section 3: Active Search by Department ─────────────
  row('Active Search by Department')
  row('Department', 'HCID', 'Position', 'Active Search')
  const deptMap = {}
  rows.filter(r => ACTIVE.has(r.status)).forEach(r => {
    const dept = r.department || '— ไม่ระบุ —'
    if (!deptMap[dept]) deptMap[dept] = []
    deptMap[dept].push(r)
  })
  Object.entries(deptMap).sort((a, b) => b[1].length - a[1].length).forEach(([dept, reqs]) => {
    reqs.forEach((r, i) => row(i === 0 ? dept : '', r.hcId || r.id, r.position, 1))
    row(`${dept} Total`, '', '', reqs.length)
    blank()
  })
  row('Grand Total', '', '', Object.values(deptMap).reduce((s, v) => s + v.length, 0))

  blank(2)

  // ── Section 4: Overview by Department (all statuses) ───
  row('Overview by Department')
  row('Department', 'HCID', 'Position', 'Status', 'Count')
  const allDeptMap = {}
  rows.forEach(r => {
    const dept = r.department || '— ไม่ระบุ —'
    if (!allDeptMap[dept]) allDeptMap[dept] = []
    allDeptMap[dept].push(r)
  })
  Object.entries(allDeptMap).sort((a, b) => b[1].length - a[1].length).forEach(([dept, reqs]) => {
    reqs.forEach((r, i) => row(i === 0 ? dept : '', r.hcId || r.id, r.position, r.status, 1))
    row(`${dept} Total`, '', '', '', reqs.length)
    blank()
  })

  const csv = '\uFEFF' + lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadCSV(rows, filename) {
  const COLS = [
    { h: 'Open Jobs',              fn: r => fmtDate(r.createdAt?.toDate?.()) },
    { h: 'Emp. Type',              fn: r => r.employmentType || 'Monthly' },
    { h: 'Job Type',               fn: r => r.requestType === 'New HC' ? 'New HC' : r.requestType === 'Replacement' ? 'Replace' : (r.requestType || '') },
    { h: 'HCID',                   fn: r => r.hcId || r.id },
    { h: 'Position',               fn: r => r.position },
    { h: 'Rank',                   fn: r => r.jg },
    { h: 'Department',             fn: r => r.department },
    { h: 'Business Unit',          fn: r => r.businessUnit || r.division || '' },
    { h: 'PIC',                    fn: r => r.assignedToName || '' },
    { h: 'Status',                 fn: r => r.status },
    { h: 'Offered Candidate',      fn: r => r.candidateName || '' },
    { h: 'Offering Date',          fn: r => fmtDate(getOfferingDate(r)) },
    { h: 'Offer Month',            fn: r => { const d = getOfferingDate(r); return d ? String(d.getMonth() + 1).padStart(2,'0') : '' } },
    { h: 'Offer Year',             fn: r => { const d = getOfferingDate(r); return d ? d.getFullYear() : '' } },
    { h: 'SLA Offer (Days)',       fn: r => slaDays(r) },
    { h: 'Onboard Date',           fn: r => r.startDate || '' },
    { h: 'Contract End Date',      fn: r => r.contractEndDate || '' },
    { h: 'Requester',              fn: r => r.requesterName || '' },
    { h: 'Requester Email',        fn: r => r.requesterEmail || '' },
    { h: 'HC Count',               fn: r => r.headcount || '' },
    { h: 'Replacement For',        fn: r => r.replacementFor || '' },
    { h: 'Reason',                 fn: r => r.reason || '' },
  ]
  const header = COLS.map(c => c.h).join(',')
  const lines  = rows.map(r => COLS.map(c => escapeCSV(c.fn(r))).join(','))
  const csv    = '\uFEFF' + [header, ...lines].join('\n')  // UTF-8 BOM
  const blob   = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Colour chips — DS token families ─────────────────────
const STATUS_DOT = {
  Open:        'bg-yellow-400',
  Recruiting:  'bg-blue-500',
  Interviewing:'bg-orange-400',
  Offering:    'bg-purple-500',
  Onboarding:  'bg-teal-400',
  Rejected:    'bg-red-400',
  Closed:      'bg-green-fresh-500',
  Cancelled:   'bg-neutral-300',
}

// ─── Mini progress bar ────────────────────────────────────
function Bar({ value, max, color = 'bg-green-fresh-600' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-5 text-right text-xs font-bold text-neutral-700 tabular-nums">{value}</span>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────
export default function ReportPanel({ requests }) {
  const [preset, setPreset]       = useState('this_month')
  const [filterDept, setFilterDept] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterTA, setFilterTA]   = useState('')
  const [open, setOpen]           = useState(true)

  // ── Filtered dataset ──
  const filtered = useMemo(() => {
    const range = getDateRange(preset)
    return requests.filter(r => {
      const date = r.createdAt?.toDate?.()
      if (range && date) {
        if (date < range.from || date > range.to) return false
      }
      if (filterDept   && r.department   !== filterDept)   return false
      if (filterStatus && r.status       !== filterStatus) return false
      if (filterTA     && r.assignedToName !== filterTA)   return false
      return true
    })
  }, [requests, preset, filterDept, filterStatus, filterTA])

  // ── Dropdown options ──
  const depts    = useMemo(() => [...new Set(requests.map(r => r.department).filter(Boolean))].sort(), [requests])
  const taNames  = useMemo(() => [...new Set(requests.map(r => r.assignedToName).filter(Boolean))].sort(), [requests])
  const statuses = ['Open','Recruiting','Interviewing','Offering','Onboarding','Rejected','Closed','Cancelled']

  // ── Summaries ──
  const byStatus = useMemo(() => {
    const m = {}
    filtered.forEach(r => { m[r.status] = (m[r.status] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const byDept = useMemo(() => {
    const m = {}
    filtered.forEach(r => { if (r.department) m[r.department] = (m[r.department] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [filtered])

  const byTA = useMemo(() => {
    const m = {}
    filtered.forEach(r => {
      const name = r.assignedToName || '— ยังไม่ assign —'
      m[name] = (m[name] || 0) + 1
    })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [filtered])

  const maxDept = byDept[0]?.[1] ?? 1
  const maxTA   = byTA[0]?.[1]   ?? 1

  const filename = `hc-report_${preset}_${new Date().toISOString().slice(0,10)}.csv`

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
        <button
          onClick={() => setOpen(o => !o)}
          className="group flex items-center gap-2.5 text-left"
        >
          <BarChart3 size={16} strokeWidth={1} absoluteStrokeWidth className="shrink-0 text-dark-green-600" />
          <div>
            <p className="text-sm font-bold text-neutral-900">Report & Export</p>
            <p className="text-[11px] font-bold text-neutral-400">
              {filtered.length} รายการ {preset !== 'all' ? `· ${PRESETS.find(p => p.value === preset)?.label}` : '· ทั้งหมด'}
            </p>
          </div>
          {open
            ? <ChevronUp size={14} strokeWidth={1} absoluteStrokeWidth className="ml-1 text-neutral-300" />
            : <ChevronDown size={14} strokeWidth={1} absoluteStrokeWidth className="ml-1 text-neutral-300" />
          }
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadPivotCSV(filtered, `hc-pivot_${preset}_${new Date().toISOString().slice(0,10)}.csv`)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 rounded-lg border border-neutral-100 px-4 py-2 text-xs font-bold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-40"
          >
            <Download size={13} strokeWidth={1} absoluteStrokeWidth />
            Pivot
          </button>
          <button
            onClick={() => downloadCSV(filtered, filename)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 rounded-lg bg-dark-green-600 px-4 py-2 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:pointer-events-none disabled:opacity-40"
          >
            <Download size={13} strokeWidth={1} absoluteStrokeWidth />
            Export CSV
            {filtered.length > 0 && (
              <span className="rounded-md bg-neutral-50/20 px-1.5 py-0.5 text-[11px] font-bold">{filtered.length}</span>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-6 p-6">
          {/* ── Filters ── */}
          <div className="flex flex-wrap gap-3">
            {/* Date preset tabs */}
            <div className="flex items-center gap-1 rounded-lg border border-neutral-100 bg-neutral-50 p-1">
              {PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPreset(p.value)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    preset === p.value
                      ? 'border border-neutral-100 bg-white text-dark-green-700'
                      : 'text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Department */}
            <select
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
              className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-[11px] font-bold text-neutral-600 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            >
              <option value="">ทุกแผนก</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Status */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-[11px] font-bold text-neutral-600 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            >
              <option value="">ทุกสถานะ</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* TA */}
            <select
              value={filterTA}
              onChange={e => setFilterTA(e.target.value)}
              className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-[11px] font-bold text-neutral-600 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            >
              <option value="">ทุก TA</option>
              {taNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Clear filters */}
            {(filterDept || filterStatus || filterTA || preset !== 'this_month') && (
              <button
                onClick={() => { setFilterDept(''); setFilterStatus(''); setFilterTA(''); setPreset('this_month') }}
                className="rounded-lg border border-red-100 px-3 py-2 text-[11px] font-bold text-red-500 transition-colors hover:bg-red-50"
              >
                ✕ ล้าง
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm italic text-neutral-400">ไม่มีข้อมูลในช่วงเวลาที่เลือก</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* ── By Status ── */}
              <div>
                <p className="mb-3 text-[11px] font-bold text-neutral-400">สถานะ</p>
                <div className="flex flex-col gap-2">
                  {byStatus.map(([status, count]) => (
                    <div key={status} className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] ?? 'bg-neutral-400'}`} />
                      <span className="flex-1 truncate text-xs font-bold text-neutral-600">{status}</span>
                      <Bar value={count} max={filtered.length} />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── By Department ── */}
              <div>
                <p className="mb-3 text-[11px] font-bold text-neutral-400">แผนก (Top 8)</p>
                <div className="flex flex-col gap-2">
                  {byDept.map(([dept, count]) => (
                    <div key={dept} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs font-bold text-neutral-600" title={dept}>{dept}</span>
                      <Bar value={count} max={maxDept} color="bg-purple-500" />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── By TA ── */}
              <div>
                <p className="mb-3 text-[11px] font-bold text-neutral-400">TA (Top 8)</p>
                <div className="flex flex-col gap-2">
                  {byTA.map(([ta, count]) => (
                    <div key={ta} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs font-bold text-neutral-600" title={ta}>{ta}</span>
                      <Bar value={count} max={maxTA} color="bg-dark-green-600" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
