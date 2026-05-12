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

// ─── Date presets ──────────────────────────────────────────
const PRESETS = [
  { label: 'เดือนนี้',      value: 'this_month'  },
  { label: 'เดือนที่แล้ว', value: 'last_month'  },
  { label: 'ไตรมาสนี้',    value: 'this_quarter'},
  { label: 'ปีนี้',         value: 'this_year'   },
  { label: 'ทั้งหมด',       value: 'all'         },
]

function getDateRange(preset) {
  const now = new Date()
  if (preset === 'this_month')  return { from: new Date(now.getFullYear(), now.getMonth(), 1),     to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) }
  if (preset === 'last_month')  return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(),     0, 23, 59, 59) }
  if (preset === 'this_quarter') {
    const q = Math.floor(now.getMonth() / 3)
    return { from: new Date(now.getFullYear(), q * 3, 1), to: new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59) }
  }
  if (preset === 'this_year') return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) }
  return null // all time
}

// ─── SLA days (simplified — same logic as RequestTable) ───
function computeSLADays(req) {
  const createdAt = req.createdAt?.toDate?.()
  if (!createdAt) return ''
  const DONE = new Set(['Closed', 'Cancelled'])
  const history = [...(req.statusHistory ?? [])]
    .map(e => ({ status: e.status, t: new Date(e.changedAt) }))
    .filter(e => !isNaN(e.t))
    .sort((a, b) => a.t - b.t)

  let acc = 0, start = createdAt, lastOnboarding = false
  for (const { status, t } of history) {
    if (status === 'Offering')    { if (start) { acc += t - start; start = null }; lastOnboarding = false }
    else if (status === 'Onboarding') { if (start) { acc += t - start; start = null }; lastOnboarding = true  }
    else if (status === 'Recruiting' || status === 'Interviewing') {
      if (lastOnboarding) { acc = 0; start = t; lastOnboarding = false }
      else if (!start) start = t
    } else if (DONE.has(status)) { if (start) { acc += t - start; start = null }; lastOnboarding = false }
  }
  if (start) acc += new Date() - start
  return Math.floor(acc / 86400000)
}

// ─── CSV Helpers ──────────────────────────────────────────
function escapeCSV(val) {
  if (val == null || val === '') return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`
  return str
}

function fmtDate(d) {
  if (!d) return ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = d.getDate()
  return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`
}

function getOfferingDate(r) {
  const h = [...(r.statusHistory ?? [])].find(e => e.status === 'Offering')
  if (!h) return null
  const d = new Date(h.changedAt)
  return isNaN(d) ? null : d
}

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

// ─── Colour chips ──────────────────────────────────────────
const STATUS_DOT = {
  Open:        'bg-yellow-400',
  Recruiting:  'bg-emerald-500',
  Interviewing:'bg-orange-400',
  Offering:    'bg-indigo-500',
  Onboarding:  'bg-teal-400',
  Rejected:    'bg-red-400',
  Closed:      'bg-slate-400',
  Cancelled:   'bg-gray-300',
}

// ─── Mini progress bar ────────────────────────────────────
function Bar({ value, max, color = 'bg-[#00ce7c]' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-black text-gray-700 dark:text-slate-300 tabular-nums w-5 text-right">{value}</span>
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
    <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm transition-colors">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2.5 text-left group"
        >
          <BarChart3 size={16} strokeWidth={2.5} className="text-[#008065] dark:text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-black text-gray-800 dark:text-gray-100 tracking-tight">Report & Export</p>
            <p className="text-[10px] font-bold text-gray-400 dark:text-slate-600 uppercase tracking-widest">
              {filtered.length} รายการ {preset !== 'all' ? `· ${PRESETS.find(p => p.value === preset)?.label}` : '· ทั้งหมด'}
            </p>
          </div>
          {open
            ? <ChevronUp size={14} strokeWidth={3} className="text-gray-300 dark:text-slate-700 ml-1" />
            : <ChevronDown size={14} strokeWidth={3} className="text-gray-300 dark:text-slate-700 ml-1" />
          }
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadPivotCSV(filtered, `hc-pivot_${preset}_${new Date().toISOString().slice(0,10)}.csv`)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none text-gray-600 dark:text-slate-400 text-xs font-black uppercase tracking-wider transition-colors"
          >
            <Download size={13} strokeWidth={3} />
            Pivot
          </button>
          <button
            onClick={() => downloadCSV(filtered, filename)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#008065] hover:bg-[#006b54] disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-black uppercase tracking-wider transition-colors shadow-sm shadow-[#008065]/20"
          >
            <Download size={13} strokeWidth={3} />
            Export CSV
            {filtered.length > 0 && (
              <span className="bg-white/20 rounded-md px-1.5 py-0.5 text-[10px] font-black">{filtered.length}</span>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-6 flex flex-col gap-6">
          {/* ── Filters ── */}
          <div className="flex flex-wrap gap-3">
            {/* Date preset tabs */}
            <div className="flex items-center gap-1 p-1 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-100 dark:border-slate-800">
              {PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPreset(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${
                    preset === p.value
                      ? 'bg-white dark:bg-slate-900 text-[#008065] dark:text-emerald-400 shadow-sm border border-gray-100 dark:border-slate-700'
                      : 'text-gray-400 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-400'
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
              className="text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 focus:outline-none focus:border-[#008065] transition-colors"
            >
              <option value="">ทุกแผนก</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Status */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 focus:outline-none focus:border-[#008065] transition-colors"
            >
              <option value="">ทุกสถานะ</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* TA */}
            <select
              value={filterTA}
              onChange={e => setFilterTA(e.target.value)}
              className="text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 focus:outline-none focus:border-[#008065] transition-colors"
            >
              <option value="">ทุก TA</option>
              {taNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Clear filters */}
            {(filterDept || filterStatus || filterTA || preset !== 'this_month') && (
              <button
                onClick={() => { setFilterDept(''); setFilterStatus(''); setFilterTA(''); setPreset('this_month') }}
                className="text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-red-100 dark:border-red-900/30 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
              >
                ✕ ล้าง
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-600 italic text-center py-8">ไม่มีข้อมูลในช่วงเวลาที่เลือก</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* ── By Status ── */}
              <div>
                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-3">สถานะ</p>
                <div className="flex flex-col gap-2">
                  {byStatus.map(([status, count]) => (
                    <div key={status} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status] ?? 'bg-gray-400'}`} />
                      <span className="text-xs font-bold text-gray-600 dark:text-slate-400 flex-1 truncate">{status}</span>
                      <Bar value={count} max={filtered.length} />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── By Department ── */}
              <div>
                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-3">แผนก (Top 8)</p>
                <div className="flex flex-col gap-2">
                  {byDept.map(([dept, count]) => (
                    <div key={dept} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-600 dark:text-slate-400 flex-1 truncate" title={dept}>{dept}</span>
                      <Bar value={count} max={maxDept} color="bg-indigo-400 dark:bg-indigo-500" />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── By TA ── */}
              <div>
                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-3">TA (Top 8)</p>
                <div className="flex flex-col gap-2">
                  {byTA.map(([ta, count]) => (
                    <div key={ta} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-600 dark:text-slate-400 flex-1 truncate" title={ta}>{ta}</span>
                      <Bar value={count} max={maxTA} color="bg-[#008065]" />
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
