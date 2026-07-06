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
 * `bar` is a DS token Tailwind utility class used for the stacked bar
 * segments and legend swatches. The insertion order determines the visual
 * stacking order in the bar chart.
 */
const STATUS_COLOR = {
  Open:         { bar: 'bg-yellow-400' },
  Recruiting:   { bar: 'bg-blue-400' },
  Interviewing: { bar: 'bg-purple-400' },
  Offering:     { bar: 'bg-orange-400' },
  Onboarding:   { bar: 'bg-teal-400' },
  Closed:       { bar: 'bg-dark-green-600' },
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
    <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white">

      {/* ── Header + KPI strip ─────────────────────────────────── */}
      <div className="border-b border-neutral-100 px-6 pb-4 pt-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-neutral-900">Monthly Pipeline</h3>
            <p className="mt-0.5 text-[11px] font-bold text-neutral-400">
              {months.length} เดือนล่าสุด
            </p>
          </div>
          {/* View toggle */}
          <div className="flex shrink-0 items-center gap-1 rounded-lg bg-neutral-100 p-0.5">
            {[{ v:'status', l:'สถานะ' }, { v:'flow', l:'เปิด vs ปิด' }].map(t => (
              <button key={t.v} onClick={() => setView(t.v)}
                className={`rounded-md px-3 py-1 text-[11px] font-bold transition-colors ${
                  view === t.v
                    ? 'bg-white text-neutral-900'
                    : 'text-neutral-400 hover:text-neutral-600'
                }`}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'เปิดใหม่',   value: kpi.opened,                          color: 'text-blue-700'    },
            { label: 'ปิดแล้ว',    value: kpi.closed,                          color: 'text-dark-green-700' },
            { label: 'Fill Rate',  value: kpi.fillRate + '%',                  color: kpi.fillRate >= 50 ? 'text-dark-green-700' : 'text-orange-600' },
            { label: 'SLA เฉลี่ย', value: kpi.avgSLA != null ? kpi.avgSLA + 'd' : '—', color: kpi.avgSLA > 30 ? 'text-red-600' : 'text-neutral-700' },
          ].map(k => (
            <div key={k.label} className="rounded-xl bg-neutral-50 px-3 py-2.5">
              <p className={`text-lg font-bold leading-none tabular-nums ${k.color}`}>{k.value}</p>
              <p className="mt-1 text-[10px] font-bold text-neutral-400">{k.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chart ──────────────────────────────────────────────── */}
      <div className="px-6 pb-4 pt-5">
        <div className="flex h-28 items-end gap-2">
          {months.map((key) => {
            const d    = data[key]
            const [yr, mo] = key.split('-')
            const isSelected = selectedMonth === key
            const tot  = view === 'flow' ? Math.max(d.opened, d.closed) : d.total
            const max  = view === 'flow' ? maxFlow : maxTotal
            const pct  = (tot / max) * 100
            const diff = delta(key, 'total')

            return (
              <div key={key} className="group flex flex-1 cursor-pointer flex-col items-center gap-1"
                onClick={() => handleMonthClick(key)}>

                {/* Delta badge */}
                <div className="flex h-4 items-center justify-center">
                  {diff !== null && diff !== 0 && (
                    <span className={`flex items-center gap-0.5 text-[10px] font-bold ${diff > 0 ? 'text-red-500' : 'text-dark-green-700'}`}>
                      {diff > 0 ? <TrendingUp size={9} strokeWidth={1} absoluteStrokeWidth /> : <TrendingDown size={9} strokeWidth={1} absoluteStrokeWidth />}
                      {Math.abs(diff)}
                    </span>
                  )}
                  {diff === 0 && <Minus size={8} strokeWidth={1} absoluteStrokeWidth className="text-neutral-200" />}
                </div>

                {/* Total count */}
                <span className="text-[11px] font-bold text-neutral-600 tabular-nums">{d.total}</span>

                {/* Bar */}
                <div
                  className={`w-full overflow-hidden rounded-lg transition-all duration-200 ${
                    isSelected
                      ? 'ring-2 ring-dark-green-600 ring-offset-1 ring-offset-white'
                      : 'group-hover:opacity-80'
                  }`}
                  style={{ height: `${Math.max(pct, 10)}%`, minHeight: '8px' }}
                >
                  {view === 'status' ? (
                    <div className="flex h-full w-full flex-col-reverse">
                      {Object.entries(STATUS_COLOR).map(([status, cfg]) =>
                        d[status] > 0 ? (
                          <div key={status} title={`${status}: ${d[status]}`}
                            className={`w-full ${cfg.bar}`} style={{ flex: d[status] }} />
                        ) : null
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full w-full flex-col">
                      {/* Opened (blue top) */}
                      <div className="w-full bg-blue-200" style={{ flex: d.opened - d.closed || 0 }} />
                      {/* Closed (green bottom) */}
                      <div className="w-full bg-dark-green-600" style={{ flex: d.closed }} />
                    </div>
                  )}
                </div>

                {/* Month label */}
                <div className="mt-1 flex flex-col items-center leading-none">
                  <span className={`text-[11px] font-bold transition-colors ${isSelected ? 'text-dark-green-700' : 'text-neutral-500'}`}>
                    {MONTH_TH[Number(mo) - 1]}
                  </span>
                  <span className="text-[10px] font-bold text-neutral-300">{yr}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────── */}
      <div className="border-t border-neutral-100 px-6 pb-4 pt-1">
        {view === 'status' ? (
          <div className="flex flex-wrap gap-4">
            {Object.entries(STATUS_COLOR).map(([status, cfg]) => (
              <div key={status} className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded ${cfg.bar}`} />
                <span className="text-[10px] font-bold text-neutral-400">{status}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded bg-blue-200" />
              <span className="text-[10px] font-bold text-neutral-400">เปิดใหม่ (ยังไม่ปิด)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded bg-dark-green-600" />
              <span className="text-[10px] font-bold text-neutral-400">ปิดแล้ว</span>
            </div>
          </div>
        )}
        {selectedMonth && (
          <button onClick={() => { setSelected(null); onMonthClick?.(null) }}
            className="mt-2 text-[11px] font-bold text-dark-green-700 hover:underline">
            ✕ ล้าง filter เดือน
          </button>
        )}
      </div>
    </div>
  )
}
