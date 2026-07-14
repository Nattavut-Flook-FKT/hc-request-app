/**
 * TAPerformanceReport.jsx — ผลงานของ TA แต่ละคน
 * ─────────────────────────────────────────────────────────────────────────────
 * ต่อ TA: เคสทั้งหมด · กำลังทำ (active) · ปิดจบ (Onboard) · ปฏิเสธ · SLA เฉลี่ย · % conversion
 * Export Excel
 *
 * Props: requests {Array} (ผ่าน global filter จาก ReportsPage แล้ว)
 */
import { useMemo } from 'react'
import { toDate, getOfferingDate } from '../../utils/reportUtils'
import { exportWorkbook, exportCSV, dateStamp } from '../../utils/exportExcel'
import { SectionCard, ExportButtons, DataTable, Bar } from './ReportUI'

const ACTIVE = new Set(['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding'])

function slaToOffer(r) {
  const created = toDate(r.createdAt)
  const off = getOfferingDate(r)
  if (!created || !off) return null
  return Math.max(0, Math.round((off - created) / 86400000))
}

export default function TAPerformanceReport({ requests }) {
  const rows = useMemo(() => {
    const map = {}
    requests.forEach(r => {
      const k = r.assignedToName || '— ยังไม่ assign —'
      const m = (map[k] ??= { key: k, total: 0, active: 0, closed: 0, rejected: 0, slaSum: 0, slaN: 0 })
      m.total++
      if (ACTIVE.has(r.status)) m.active++
      if (r.status === 'Closed') m.closed++
      if (r.status === 'Rejected') m.rejected++
      const sla = slaToOffer(r)
      if (sla != null) { m.slaSum += sla; m.slaN++ }
    })
    return Object.values(map)
      .map(m => ({
        ...m,
        avgSLA: m.slaN ? Math.round(m.slaSum / m.slaN) : null,
        conversion: m.total ? Math.round((m.closed / m.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [requests])

  const maxTotal = Math.max(1, ...rows.map(r => r.total))

  function buildAOA() {
    return [
      ['ผู้ดูแล (TA)', 'เคสทั้งหมด', 'กำลังหาคน', 'ได้คนเริ่มงาน', 'ผู้สมัครสละสิทธิ์', 'เวลาเฉลี่ย (วัน)', 'อัตราปิดงาน %'],
      ...rows.map(r => [r.key, r.total, r.active, r.closed, r.rejected, r.avgSLA ?? '', r.conversion]),
    ]
  }

  return (
    <SectionCard
      title="ผลงานทีมสรรหา (TA)"
      sub={`${rows.length} คน · อัตราปิดงาน = เคสที่ได้คนเริ่มงาน ÷ เคสทั้งหมดที่รับผิดชอบ`}
      action={<ExportButtons disabled={rows.length === 0}
        onExcel={() => exportWorkbook(`ta-performance_${dateStamp()}`, [{ name: 'TA Performance', aoa: buildAOA() }])}
        onCSV={() => exportCSV(`ta-performance_${dateStamp()}`, buildAOA())} />}>
      <DataTable
        columns={[
          { key: 'key', label: 'ผู้ดูแล (TA)' },
          { key: 'total', label: 'เคสทั้งหมด', align: 'right', render: r => (
            <div className="w-28 ml-auto"><Bar value={r.total} max={maxTotal} /></div>
          ) },
          { key: 'active', label: 'กำลังหาคน', align: 'right' },
          { key: 'closed', label: 'ได้คนเริ่มงาน', align: 'right', accent: true },
          { key: 'rejected', label: 'ผู้สมัครสละสิทธิ์', align: 'right' },
          { key: 'avgSLA', label: 'เวลาเฉลี่ย (วัน)', align: 'right', render: r => r.avgSLA ?? '—' },
          { key: 'conversion', label: 'อัตราปิดงาน', align: 'right', render: r => `${r.conversion}%` },
        ]}
        rows={rows.map(r => ({ ...r, _key: r.key }))}
      />
    </SectionCard>
  )
}
