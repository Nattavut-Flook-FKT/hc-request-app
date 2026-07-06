/**
 * ReportUI.jsx — Shared presentational bits สำหรับ report ต่างๆ
 * ─────────────────────────────────────────────────────────────────────────────
 * KpiCard · SectionCard · ExportButtons · Bar · DataTable
 * FKT Design System v1.0 — token-only · no shadow at rest (DS-#023) · weight 400/700 ·
 * sentence case · strokeWidth 1
 */
import { Download, FileSpreadsheet } from 'lucide-react'

/** การ์ด KPI ตัวเลขเดี่ยว */
export function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="rounded-[18px] border border-neutral-100 bg-white px-5 py-4">
      <p className="text-[13px] font-bold text-neutral-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-dark-green-700' : 'text-neutral-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </div>
  )
}

/** การ์ดครอบ section พร้อมหัวข้อ + ปุ่ม action (เช่น export) ฝั่งขวา */
export function SectionCard({ title, sub, action, children }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-neutral-100 px-6 pb-4 pt-5">
        <div>
          <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/** ปุ่ม Export Excel + CSV คู่ */
export function ExportButtons({ onExcel, onCSV, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onExcel} disabled={disabled}
        className="flex items-center gap-1.5 rounded-lg bg-dark-green-600 px-3 py-2 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:bg-neutral-50 disabled:text-neutral-300">
        <FileSpreadsheet size={14} strokeWidth={1} absoluteStrokeWidth /> Excel
      </button>
      <button onClick={onCSV} disabled={disabled}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-100 px-3 py-2 text-xs font-bold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:text-neutral-300">
        <Download size={14} strokeWidth={1} absoluteStrokeWidth /> CSV
      </button>
    </div>
  )
}

/** progress bar เล็ก (เหมือน ReportPanel.Bar) */
export function Bar({ value, max, color = 'bg-green-fresh-600' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-bold tabular-nums text-neutral-700">{value}</span>
    </div>
  )
}

/**
 * ตารางข้อมูลทั่วไป
 * @param columns [{ key, label, align?, render?, accent? }]
 * @param rows    array ของ object (อ้างด้วย column.key หรือ column.render(row))
 */
export function DataTable({ columns, rows, emptyText = 'ไม่มีข้อมูล' }) {
  if (!rows.length) {
    return <p className="px-6 py-10 text-center text-sm text-neutral-400">{emptyText}</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-neutral-100">
            {columns.map(c => (
              <th key={c.key}
                className={`whitespace-nowrap px-4 py-3 text-[11px] font-bold text-neutral-500 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row._key ?? i} className="border-b border-neutral-100 transition-colors last:border-0 hover:bg-neutral-50">
              {columns.map(c => (
                <td key={c.key}
                  className={`whitespace-nowrap px-4 py-2.5 text-xs ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center tabular-nums' : 'text-left'} ${c.accent ? 'font-bold text-dark-green-700' : 'font-bold text-neutral-700'}`}>
                  {c.render ? c.render(row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
