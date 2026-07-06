/**
 * SLAReport.jsx — รายงาน SLA (เวลาตั้งแต่เปิดงานจนถึง Offering)
 * ─────────────────────────────────────────────────────────────────────────────
 * นับเฉพาะเคสที่ "เข้าสู่สถานะ Offering แล้ว" (มี offering date) = SLA ที่ปิดจบ
 *   SLA (วัน) = offeringDate − createdAt
 * แสดง: KPI รวม · การกระจาย (distribution buckets) · แยกแผนก · แยก TA · แยกเดือน
 * Export Excel หลาย sheet
 *
 * Props: requests {Array} (ผ่าน global filter จาก ReportsPage แล้ว)
 */
import { useMemo } from 'react'
import { toDate, getOfferingDate, fmtDate, MONTH_TH } from '../../utils/reportUtils'
import { exportWorkbook, exportCSV, dateStamp } from '../../utils/exportExcel'
import { KpiCard, SectionCard, ExportButtons, DataTable, Bar } from './ReportUI'

/** SLA วัน จาก createdAt → offering (null ถ้ายังไม่ถึง Offering) */
function slaToOffer(r) {
  const created = toDate(r.createdAt)
  const off = getOfferingDate(r)
  if (!created || !off) return null
  return Math.max(0, Math.round((off - created) / 86400000))
}

const BUCKETS = [
  { label: '≤ 15 วัน',   test: d => d <= 15 },
  { label: '16–30 วัน',  test: d => d > 15 && d <= 30 },
  { label: '31–45 วัน',  test: d => d > 30 && d <= 45 },
  { label: '46–60 วัน',  test: d => d > 45 && d <= 60 },
  { label: '60+ วัน',    test: d => d > 60 },
]

function avg(arr) { return arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0 }
function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export default function SLAReport({ requests }) {
  const data = useMemo(() => {
    // เคสที่มี SLA (ถึง Offering แล้ว)
    const withSLA = requests
      .map(r => ({ r, sla: slaToOffer(r) }))
      .filter(x => x.sla != null)

    const allSLA = withSLA.map(x => x.sla)

    // distribution
    const dist = BUCKETS.map(b => ({ label: b.label, count: withSLA.filter(x => b.test(x.sla)).length }))

    // by department
    const deptMap = {}
    withSLA.forEach(({ r, sla }) => {
      const k = r.department || 'ไม่ระบุ'
      ;(deptMap[k] ??= []).push(sla)
    })
    const byDept = Object.entries(deptMap)
      .map(([k, arr]) => ({ key: k, count: arr.length, avg: avg(arr), min: Math.min(...arr), max: Math.max(...arr) }))
      .sort((a, b) => b.count - a.count)

    // by TA
    const taMap = {}
    withSLA.forEach(({ r, sla }) => {
      const k = r.assignedToName || '— ยังไม่ assign —'
      ;(taMap[k] ??= []).push(sla)
    })
    const byTA = Object.entries(taMap)
      .map(([k, arr]) => ({ key: k, count: arr.length, avg: avg(arr) }))
      .sort((a, b) => b.count - a.count)

    // by month (ของ offering date)
    const moMap = {}
    withSLA.forEach(({ r, sla }) => {
      const d = getOfferingDate(r)
      const k = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'ไม่ระบุ'
      ;(moMap[k] ??= []).push(sla)
    })
    const byMonth = Object.entries(moMap)
      .map(([k, arr]) => ({ key: k, count: arr.length, avg: avg(arr) }))
      .sort((a, b) => a.key.localeCompare(b.key))

    return {
      total: withSLA.length,
      avg: avg(allSLA),
      median: median(allSLA),
      min: allSLA.length ? Math.min(...allSLA) : 0,
      max: allSLA.length ? Math.max(...allSLA) : 0,
      dist, byDept, byTA, byMonth,
    }
  }, [requests])

  const maxBucket = Math.max(1, ...data.dist.map(d => d.count))

  function monthLabel(k) {
    if (k === 'ไม่ระบุ') return k
    const [y, m] = k.split('-')
    return `${MONTH_TH[Number(m) - 1]} ${y}`
  }

  function buildSheets() {
    return [
      { name: 'Summary', aoa: [
        ['SLA Offer Report', `(${data.total} เคสที่ถึง Offering)`],
        [],
        ['SLA เฉลี่ย (วัน)', data.avg],
        ['SLA มัธยฐาน (วัน)', data.median],
        ['SLA ต่ำสุด (วัน)', data.min],
        ['SLA สูงสุด (วัน)', data.max],
        [],
        ['การกระจาย', 'จำนวน'],
        ...data.dist.map(d => [d.label, d.count]),
      ]},
      { name: 'By Department', aoa: [
        ['แผนก', 'จำนวนเคส', 'SLA เฉลี่ย', 'ต่ำสุด', 'สูงสุด'],
        ...data.byDept.map(d => [d.key, d.count, d.avg, d.min, d.max]),
      ]},
      { name: 'By TA', aoa: [
        ['TA / PIC', 'จำนวนเคส', 'SLA เฉลี่ย'],
        ...data.byTA.map(d => [d.key, d.count, d.avg]),
      ]},
      { name: 'By Month', aoa: [
        ['เดือน (Offering)', 'จำนวนเคส', 'SLA เฉลี่ย'],
        ...data.byMonth.map(d => [monthLabel(d.key), d.count, d.avg]),
      ]},
      { name: 'Raw', aoa: [
        ['HCID', 'Position', 'Department', 'TA', 'Open Date', 'Offering Date', 'SLA (วัน)'],
        ...requests.map(r => ({ r, sla: slaToOffer(r) })).filter(x => x.sla != null).map(({ r, sla }) =>
          [r.hcId || r.id, r.position, r.department, r.assignedToName || '', fmtDate(r.createdAt), fmtDate(getOfferingDate(r)), sla]),
      ]},
    ]
  }

  return (
    <div className="flex flex-col gap-6">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="เคสที่ถึง Offering" value={data.total} accent />
        <KpiCard label="SLA เฉลี่ย" value={`${data.avg}`} sub="วัน" />
        <KpiCard label="มัธยฐาน" value={`${data.median}`} sub="วัน" />
        <KpiCard label="เร็วสุด" value={`${data.min}`} sub="วัน" />
        <KpiCard label="ช้าสุด" value={`${data.max}`} sub="วัน" />
      </div>

      {/* Distribution */}
      <SectionCard title="การกระจายของ SLA"
        action={<ExportButtons disabled={data.total === 0}
          onExcel={() => exportWorkbook(`sla-report_${dateStamp()}`, buildSheets())}
          onCSV={() => exportCSV(`sla-distribution_${dateStamp()}`, [['ช่วง SLA', 'จำนวน'], ...data.dist.map(d => [d.label, d.count])])} />}>
        <div className="p-6 flex flex-col gap-3">
          {data.dist.map(d => (
            <div key={d.label} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs font-bold text-neutral-600">{d.label}</span>
              <Bar value={d.count} max={maxBucket} />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* By Department + By TA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="SLA แยกตามแผนก">
          <DataTable
            columns={[
              { key: 'key', label: 'แผนก' },
              { key: 'count', label: 'เคส', align: 'right' },
              { key: 'avg', label: 'เฉลี่ย', align: 'right', accent: true },
              { key: 'min', label: 'ต่ำสุด', align: 'right' },
              { key: 'max', label: 'สูงสุด', align: 'right' },
            ]}
            rows={data.byDept.map(d => ({ ...d, _key: d.key }))}
          />
        </SectionCard>
        <SectionCard title="SLA แยกตาม TA">
          <DataTable
            columns={[
              { key: 'key', label: 'TA / PIC' },
              { key: 'count', label: 'เคส', align: 'right' },
              { key: 'avg', label: 'SLA เฉลี่ย', align: 'right', accent: true },
            ]}
            rows={data.byTA.map(d => ({ ...d, _key: d.key }))}
          />
        </SectionCard>
      </div>

      {/* By Month */}
      <SectionCard title="SLA แยกตามเดือน (ตามวันที่ Offering)">
        <DataTable
          columns={[
            { key: 'key', label: 'เดือน', render: r => monthLabel(r.key) },
            { key: 'count', label: 'จำนวนเคส', align: 'right' },
            { key: 'avg', label: 'SLA เฉลี่ย (วัน)', align: 'right', accent: true },
          ]}
          rows={data.byMonth.map(d => ({ ...d, _key: d.key }))}
        />
      </SectionCard>
    </div>
  )
}
