/**
 * @file MonthlyPipeline.jsx
 * @description Dashboard widget that renders a stacked bar chart summarising HC
 * (Headcount) requests grouped by calendar month for the trailing 6 months.
 *
 * Two chart views are available via a toggle:
 *  - "status"  — bars are stacked and colour-coded by request status
 *                (Open → Recruiting → Interviewing → Offering → Onboarding → Closed).
 *  - "flow"    — each bar is split into two segments: opened (blue, net-open
 *                portion) vs closed (green), giving a fill-rate picture at a glance.
 *
 * Above the chart a KPI strip surfaces four period-aggregate metrics:
 *  - เปิดใหม่   — total requests opened in the visible window
 *  - ปิดแล้ว    — total requests closed in the visible window
 *  - Fill Rate  — closed ÷ opened as a percentage
 *  - SLA เฉลี่ย — average calendar days from creation to close (Closed only)
 *
 * Each bar column shows a delta badge (▲/▼) comparing its total to the prior
 * month so trend direction is immediately visible.  Clicking a bar invokes the
 * `onMonthClick` callback so a parent table can filter to that month; clicking
 * the same bar again (or the "ล้าง filter" button) clears the selection.
 *
 * @module MonthlyPipeline
 *
 * @param {Object}   props
 * @param {Array}    props.requests
 *   Flat array of Firestore-shaped request documents.  Each document is
 *   expected to have at minimum:
 *     - {firebase.Timestamp} createdAt  — creation timestamp (Firestore Timestamp)
 *     - {string}             status     — one of the keys in STATUS_COLOR, or
 *                                         "Cancelled" (which is excluded from charts)
 *     - {firebase.Timestamp} [closedAt] — close timestamp used for SLA calculation;
 *                                         falls back to createdAt when absent
 * @param {Function} [props.onMonthClick]
 *   Optional callback fired whenever the active month selection changes.
 *   Receives the selected month key string ("YYYY-MM") or `null` when the
 *   selection is cleared.  Use this to filter a sibling data table.
 *
 * @notes
 *   computeSLADays is intentionally simplified:
 *     - Only "Closed" status requests produce an SLA value; all others return null.
 *     - Uses createdAt → closedAt (falls back to createdAt when closedAt is absent).
 *     - Result is floored to whole days; negative values are clamped to 0.
 *     - Firestore Timestamps must expose a .toDate() method (standard SDK behaviour).
 */
import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

/**
 * Mapping of every possible request status to its chart colours.
 * `bar` is a Tailwind utility class used for the stacked bar segments and
 * legend swatches; `hex` is the equivalent raw colour value used anywhere
 * a CSS hex string is needed directly (e.g. canvas or SVG contexts).
 * The insertion order determines the visual stacking order in the bar chart.
 */
const STATUS_COLOR = {
  Open:         { bar: 'bg-yellow-400',  hex: '#facc15' },
  Recruiting:   { bar: 'bg-blue-400',    hex: '#60a5fa' },
  Interviewing: { bar: 'bg-purple-400',  hex: '#c084fc' },
  Offering:     { bar: 'bg-orange-400',  hex: '#fb923c' },
  Onboarding:   { bar: 'bg-teal-400',    hex: '#2dd4bf' },
  Closed:       { bar: 'bg-[#008065]',   hex: '#008065' },
}

/** Thai abbreviated month names indexed 0–11 (January = index 0). */
const MONTH_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

/**
 * Calculates the SLA duration in calendar days for a single request.
 * Only "Closed" requests yield a value; all other statuses return null so
 * they are excluded from the average SLA calculation.
 *
 * @param {Object} req - A request document (see props.requests shape above).
 * @returns {number|null} Whole-day count (≥ 0), or null if not applicable.
 */
// คำนวณ SLA days (simplified)
function computeSLADays(req) {
  const createdAt = req.createdAt?.toDate?.()
  if (!createdAt || req.status !== 'Closed') return null
  const closedAt = req.closedAt?.toDate?.() ?? req.createdAt?.toDate?.()
  if (!closedAt) return null
  return Math.max(0, Math.floor((closedAt - createdAt) / 86400000))
}

export default function MonthlyPipeline({ requests, onMonthClick }) {
  const [view, setView]           = useState('status')   // 'status' | 'flow'
  const [selectedMonth, setSelected] = useState(null)

  /**
   * Aggregates all non-Cancelled requests into a month-keyed lookup object.
   *
   * Shape of each byMonth[key] entry ("YYYY-MM" → aggregate):
   * {
   *   total:    number,   // count of all requests created this month
   *   opened:   number,   // same as total (every created request counts as opened)
   *   closed:   number,   // subset whose status === 'Closed'
   *   slaSum:   number,   // sum of SLA days for all Closed requests with valid SLA
   *   slaCount: number,   // number of Closed requests that contributed to slaSum
   *   Open:        number,   // \
   *   Recruiting:  number,   //  |
   *   Interviewing:number,   //  | per-status counts, one key per STATUS_COLOR entry
   *   Offering:    number,   //  |
   *   Onboarding:  number,   //  |
   *   Closed:      number,   // /
   * }
   */
  const data = useMemo(() => {
    const byMonth = {}
    const statuses = Object.keys(STATUS_COLOR)

    requests
      .filter(r => r.status !== 'Cancelled')
      .forEach(r => {
        const date = r.createdAt?.toDate?.()
        if (!date) return
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        if (!byMonth[key]) {
          byMonth[key] = { total: 0, closed: 0, opened: 0, slaSum: 0, slaCount: 0 }
          statuses.forEach(s => { byMonth[key][s] = 0 })
        }
        byMonth[key][r.status] = (byMonth[key][r.status] || 0) + 1
        byMonth[key].total  += 1
        byMonth[key].opened += 1
        if (r.status === 'Closed') {
          byMonth[key].closed += 1
          const sla = computeSLADays(r)
          if (sla !== null) { byMonth[key].slaSum += sla; byMonth[key].slaCount++ }
        }
      })

    return byMonth
  }, [requests])

  const months = useMemo(() => Object.keys(data).sort().slice(-6), [data])

  /**
   * Derives period-aggregate KPI values by summing across the visible months.
   * fillRate is rounded to the nearest whole percent; avgSLA is rounded to
   * the nearest whole day and is null when no Closed requests exist.
   */
  // KPI period totals
  const kpi = useMemo(() => {
    let opened = 0, closed = 0, slaSum = 0, slaCount = 0
    months.forEach(m => {
      opened   += data[m].opened
      closed   += data[m].closed
      slaSum   += data[m].slaSum
      slaCount += data[m].slaCount
    })
    return {
      opened,
      closed,
      fillRate: opened > 0 ? Math.round((closed / opened) * 100) : 0,
      avgSLA:   slaCount > 0 ? Math.round(slaSum / slaCount) : null,
    }
  }, [months, data])

  const maxTotal = Math.max(...months.map(m => data[m].total), 1)
  const maxFlow  = Math.max(...months.map(m => Math.max(data[m].opened, data[m].closed)), 1)

  /**
   * Returns the signed difference between the current month's value and the
   * previous month's value for the given field (e.g. "total").
   * Returns null for the first month in the window (no prior month to compare).
   *
   * @param {string} key   - Month key ("YYYY-MM") to evaluate.
   * @param {string} field - Numeric field name to diff inside byMonth[key].
   * @returns {number|null}
   */
  function delta(key, field) {
    const i = months.indexOf(key)
    if (i <= 0) return null
    const curr = data[months[i]][field]
    const prev = data[months[i - 1]][field]
    return curr - prev
  }

  /**
   * Toggles the selected month.  If the clicked month is already selected,
   * the selection is cleared (null); otherwise the new key is stored.
   * The parent is notified in both cases via the onMonthClick prop.
   *
   * @param {string} key - Month key ("YYYY-MM") that was clicked.
   */
  function handleMonthClick(key) {
    const next = selectedMonth === key ? null : key
    setSelected(next)
    onMonthClick?.(next)
  }

  if (months.length === 0) return null

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm transition-colors overflow-hidden">

      {/* ── Header + KPI strip ─────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-50 dark:border-slate-800">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-black text-gray-800 dark:text-gray-100 italic tracking-tight">Monthly Pipeline</h3>
            <p className="text-[10px] text-gray-400 dark:text-slate-600 font-bold uppercase tracking-widest mt-0.5">
              {months.length} เดือนล่าสุด
            </p>
          </div>
          {/* View toggle */}
          <div className="flex items-center gap-1 p-0.5 bg-gray-100 dark:bg-slate-800 rounded-lg shrink-0">
            {[{ v:'status', l:'สถานะ' }, { v:'flow', l:'เปิด vs ปิด' }].map(t => (
              <button key={t.v} onClick={() => setView(t.v)}
                className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                  view === t.v
                    ? 'bg-white dark:bg-slate-900 text-gray-800 dark:text-gray-200 shadow-sm'
                    : 'text-gray-400 dark:text-slate-600 hover:text-gray-600'
                }`}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'เปิดใหม่',   value: kpi.opened,                          color: 'text-blue-600 dark:text-blue-400'    },
            { label: 'ปิดแล้ว',    value: kpi.closed,                          color: 'text-[#008065] dark:text-emerald-400' },
            { label: 'Fill Rate',  value: kpi.fillRate + '%',                  color: kpi.fillRate >= 50 ? 'text-[#008065] dark:text-emerald-400' : 'text-orange-500' },
            { label: 'SLA เฉลี่ย', value: kpi.avgSLA != null ? kpi.avgSLA + 'd' : '—', color: kpi.avgSLA > 30 ? 'text-red-500' : 'text-gray-700 dark:text-gray-300' },
          ].map(k => (
            <div key={k.label} className="bg-gray-50 dark:bg-slate-800/50 rounded-xl px-3 py-2.5">
              <p className={`text-lg font-black tabular-nums leading-none ${k.color}`}>{k.value}</p>
              <p className="text-[9px] font-bold text-gray-400 dark:text-slate-600 uppercase tracking-widest mt-1">{k.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chart ──────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-end gap-2 h-28">
          {months.map((key) => {
            const d    = data[key]
            const [yr, mo] = key.split('-')
            const isSelected = selectedMonth === key
            const tot  = view === 'flow' ? Math.max(d.opened, d.closed) : d.total
            const max  = view === 'flow' ? maxFlow : maxTotal
            const pct  = (tot / max) * 100
            const diff = delta(key, 'total')

            return (
              <div key={key} className="flex flex-col items-center gap-1 flex-1 group cursor-pointer"
                onClick={() => handleMonthClick(key)}>

                {/* Delta badge */}
                <div className="h-4 flex items-center justify-center">
                  {diff !== null && diff !== 0 && (
                    <span className={`text-[9px] font-black flex items-center gap-0.5 ${diff > 0 ? 'text-red-400' : 'text-[#008065] dark:text-emerald-400'}`}>
                      {diff > 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                      {Math.abs(diff)}
                    </span>
                  )}
                  {diff === 0 && <Minus size={8} className="text-gray-200 dark:text-slate-700" />}
                </div>

                {/* Total count */}
                <span className="text-[10px] font-black text-gray-600 dark:text-slate-400 tabular-nums">{d.total}</span>

                {/* Bar */}
                <div
                  className={`w-full rounded-lg overflow-hidden transition-all duration-200 ${
                    isSelected
                      ? 'ring-2 ring-[#008065] ring-offset-1 ring-offset-white dark:ring-offset-slate-900'
                      : 'group-hover:opacity-80'
                  }`}
                  style={{ height: `${Math.max(pct, 10)}%`, minHeight: '8px' }}
                >
                  {view === 'status' ? (
                    <div className="w-full h-full flex flex-col-reverse">
                      {Object.entries(STATUS_COLOR).map(([status, cfg]) =>
                        d[status] > 0 ? (
                          <div key={status} title={`${status}: ${d[status]}`}
                            className={`w-full ${cfg.bar}`} style={{ flex: d[status] }} />
                        ) : null
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col">
                      {/* Opened (blue top) */}
                      <div className="bg-blue-200 dark:bg-blue-900/40 w-full" style={{ flex: d.opened - d.closed || 0 }} />
                      {/* Closed (green bottom) */}
                      <div className="bg-[#008065] w-full" style={{ flex: d.closed }} />
                    </div>
                  )}
                </div>

                {/* Month label */}
                <div className="flex flex-col items-center leading-none mt-1">
                  <span className={`text-[10px] font-bold transition-colors ${isSelected ? 'text-[#008065] dark:text-emerald-400' : 'text-gray-500 dark:text-slate-500'}`}>
                    {MONTH_TH[Number(mo) - 1]}
                  </span>
                  <span className="text-[9px] font-bold text-gray-300 dark:text-slate-700">{yr}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────── */}
      <div className="px-6 pb-4 pt-1 border-t border-gray-50 dark:border-slate-800">
        {view === 'status' ? (
          <div className="flex flex-wrap gap-4">
            {Object.entries(STATUS_COLOR).map(([status, cfg]) => (
              <div key={status} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded ${cfg.bar}`} />
                <span className="text-[9px] font-bold text-gray-400 dark:text-slate-600 uppercase tracking-tight">{status}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded bg-blue-200 dark:bg-blue-900/40" />
              <span className="text-[9px] font-bold text-gray-400 dark:text-slate-600 uppercase tracking-tight">เปิดใหม่ (ยังไม่ปิด)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded bg-[#008065]" />
              <span className="text-[9px] font-bold text-gray-400 dark:text-slate-600 uppercase tracking-tight">ปิดแล้ว</span>
            </div>
          </div>
        )}
        {selectedMonth && (
          <button onClick={() => { setSelected(null); onMonthClick?.(null) }}
            className="mt-2 text-[10px] text-[#008065] dark:text-emerald-400 font-bold hover:underline">
            ✕ ล้าง filter เดือน
          </button>
        )}
      </div>
    </div>
  )
}
