/**
 * PeriodSummary.jsx — สรุปรายเดือน/รายช่วง สำหรับประชุม
 * ─────────────────────────────────────────────────────────────────────────────
 * เลือกเดือน → แสดงสรุป: เปิดใหม่ · ปิด · กำลังทำ · New vs Replace ·
 * แยกแผนก · แยกสถานะ · top positions · SLA เฉลี่ยในช่วง
 * Export Excel
 *
 * Props: requests {Array} (ผ่าน global filter จาก ReportsPage แล้ว)
 */
import { useMemo, useState } from 'react'
import { toDate, getOfferingDate, isReplacement, MONTH_TH, statusLabelTH } from '../../utils/reportUtils'
import { exportWorkbook, exportCSV, dateStamp } from '../../utils/exportExcel'
import { KpiCard, SectionCard, ExportButtons, DataTable, Bar } from './ReportUI'

const ACTIVE = new Set(['Open', 'Recruiting', 'Interviewing', 'Offering', 'Onboarding'])

function monthKeyOf(d) {
  const date = toDate(d)
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : null
}
function monthLabel(k) {
  if (!k) return ''
  const [y, m] = k.split('-')
  return `${MONTH_TH[Number(m) - 1]} ${y}`
}
/** วันที่ปิดเคส (Onboard) — ใช้ statusHistory Onboarding หรือ startDate */
function closedMonthKey(r) {
  if (r.status !== 'Closed') return null
  const onb = r.statusHistory?.find(h => h.status === 'Onboarding' || h.status === 'Closed')
  return monthKeyOf(onb?.changedAt) || monthKeyOf(r.startDate)
}

export default function PeriodSummary({ requests }) {
  // เดือนที่มีข้อมูล (จาก createdAt) — ใหม่สุดก่อน
  const months = useMemo(() => {
    const set = new Set()
    requests.forEach(r => { const k = monthKeyOf(r.createdAt); if (k) set.add(k) })
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [requests])

  const [sel, setSel] = useState(null)
  const month = sel || months[0] || monthKeyOf(new Date())

  const data = useMemo(() => {
    const openedList = requests.filter(r => monthKeyOf(r.createdAt) === month)
    const closedList = requests.filter(r => closedMonthKey(r) === month)
    const inProgress = requests.filter(r => ACTIVE.has(r.status)).length

    const newCount = openedList.filter(r => !isReplacement(r)).length
    const repCount = openedList.filter(r => isReplacement(r)).length

    const byDept = {}
    openedList.forEach(r => { const k = r.department || 'ไม่ระบุ'; byDept[k] = (byDept[k] || 0) + 1 })
    const byStatus = {}
    openedList.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1 })
    const byPos = {}
    openedList.forEach(r => { const k = r.position || 'ไม่ระบุ'; byPos[k] = (byPos[k] || 0) + 1 })

    // SLA เฉลี่ยของเคสที่ "Offering ในเดือนนี้"
    const slas = requests
      .map(r => { const off = getOfferingDate(r); const created = toDate(r.createdAt); return (off && created && monthKeyOf(off) === month) ? Math.max(0, Math.round((off - created) / 86400000)) : null })
      .filter(v => v != null)
    const avgSLA = slas.length ? Math.round(slas.reduce((s, v) => s + v, 0) / slas.length) : 0

    const sortEntries = o => Object.entries(o).sort((a, b) => b[1] - a[1])

    return {
      opened: openedList.length, closed: closedList.length, inProgress,
      newCount, repCount, avgSLA,
      byDept: sortEntries(byDept),
      byStatus: sortEntries(byStatus),
      topPos: sortEntries(byPos).slice(0, 10),
    }
  }, [requests, month])

  const maxDept = Math.max(1, ...data.byDept.map(d => d[1]))
  const maxPos  = Math.max(1, ...data.topPos.map(d => d[1]))

  function buildSheets() {
    return [
      { name: 'Summary', aoa: [
        [`สรุปประจำเดือน ${monthLabel(month)}`],
        [],
        ['คำขอใหม่เดือนนี้', data.opened],
        ['ได้คนเริ่มงานเดือนนี้', data.closed],
        ['กำลังหาคนอยู่ (ทั้งระบบ)', data.inProgress],
        ['ขอเพิ่มอัตราใหม่ (New HC)', data.newCount],
        ['ขอแทนคนเดิม (Replace)', data.repCount],
        ['เวลาหาคนเฉลี่ย (วัน)', data.avgSLA],
        [],
        ['แยกตามแผนก', 'จำนวน'],
        ...data.byDept.map(([k, v]) => [k, v]),
        [],
        ['แยกตามสถานะ', 'จำนวน'],
        ...data.byStatus.map(([k, v]) => [statusLabelTH(k), v]),
        [],
        ['ตำแหน่งที่ขอมากที่สุด', 'จำนวน'],
        ...data.topPos.map(([k, v]) => [k, v]),
      ]},
    ]
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Month selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-neutral-500">เดือน</span>
          <select value={month} onChange={e => setSel(e.target.value)}
            className="h-9 rounded-lg border border-neutral-100 bg-neutral-50 px-3 text-xs font-bold text-neutral-700 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none">
            {(months.length ? months : [month]).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <ExportButtons disabled={data.opened === 0 && data.closed === 0}
          onExcel={() => exportWorkbook(`period-summary_${month}_${dateStamp()}`, buildSheets())}
          onCSV={() => exportCSV(`period-summary_${month}_${dateStamp()}`, buildSheets()[0].aoa)} />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="คำขอใหม่" value={data.opened} sub="ยื่นเข้ามาเดือนนี้" accent />
        <KpiCard label="ได้คนเริ่มงาน" value={data.closed} sub="ปิดจบเดือนนี้" />
        <KpiCard label="กำลังหาคนอยู่" value={data.inProgress} sub="ทั้งระบบ ณ ตอนนี้" />
        <KpiCard label="ขอเพิ่มอัตราใหม่" value={data.newCount} sub="New HC" />
        <KpiCard label="ขอแทนคนเดิม" value={data.repCount} sub="Replace" />
        <KpiCard label="เวลาหาคนเฉลี่ย" value={data.avgSLA} sub="วัน จนถึงยื่นข้อเสนอ" />
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="แผนกไหนขอคนมากที่สุด" sub="นับจากคำขอใหม่ของเดือนที่เลือก">
          <div className="p-6 flex flex-col gap-2.5">
            {data.byDept.length === 0
              ? <p className="py-4 text-center text-sm text-neutral-400">ไม่มีข้อมูล</p>
              : data.byDept.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="flex-1 truncate text-xs font-bold text-neutral-600" title={k}>{k}</span>
                  <div className="w-32"><Bar value={v} max={maxDept} /></div>
                </div>
              ))}
          </div>
        </SectionCard>

        <SectionCard title="ตำแหน่งที่ขอมากที่สุด" sub="10 อันดับแรกของเดือนที่เลือก">
          <div className="p-6 flex flex-col gap-2.5">
            {data.topPos.length === 0
              ? <p className="py-4 text-center text-sm text-neutral-400">ไม่มีข้อมูล</p>
              : data.topPos.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="flex-1 truncate text-xs font-bold text-neutral-600" title={k}>{k}</span>
                  <div className="w-32"><Bar value={v} max={maxPos} color="bg-purple-500" /></div>
                </div>
              ))}
          </div>
        </SectionCard>
      </div>

      {/* By status table */}
      <SectionCard title="คำขอใหม่เดือนนี้ ตอนนี้ถึงขั้นไหนแล้ว" sub="สถานะล่าสุดของแต่ละคำขอที่ยื่นเข้ามาในเดือนที่เลือก">
        <DataTable
          columns={[
            { key: 'status', label: 'สถานะ', render: r => statusLabelTH(r.status) },
            { key: 'count', label: 'จำนวน', align: 'right', accent: true },
          ]}
          rows={data.byStatus.map(([k, v]) => ({ _key: k, status: k, count: v }))}
        />
      </SectionCard>
    </div>
  )
}
