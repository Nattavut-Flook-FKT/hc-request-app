/**
 * OnboardingReport.jsx — คนที่กำลัง/เตรียม onboard
 * ─────────────────────────────────────────────────────────────────────────────
 * เคสที่อยู่สถานะ Offering / Onboarding / Closed หรือมีวันเริ่มงาน (startDate)
 * คอลัมน์: HCID · Position · Dept · Candidate · TA · Offering Date · Onboard Date · Contract End · Status
 * toggle จัดกลุ่ม: ตามเดือนของวันเริ่มงาน | ตามแผนก
 * Export Excel
 *
 * Props: requests {Array} (ผ่าน global filter จาก ReportsPage แล้ว)
 */
import { useMemo, useState } from 'react'
import { toDate, getOfferingDate, fmtDate, MONTH_TH, statusTH } from '../../utils/reportUtils'
import { exportWorkbook, exportCSV, dateStamp } from '../../utils/exportExcel'
import { SectionCard, ExportButtons, DataTable } from './ReportUI'

const ONBOARD_STATUS = new Set(['Offering', 'Onboarding', 'Closed'])

function monthLabelOf(startDate) {
  const d = toDate(startDate)
  if (!d) return 'ไม่ระบุวันเริ่มงาน'
  return `${MONTH_TH[d.getMonth()]} ${d.getFullYear()}`
}

export default function OnboardingReport({ requests }) {
  const [groupBy, setGroupBy] = useState('month') // 'month' | 'department'

  const list = useMemo(() => {
    return requests
      .filter(r => ONBOARD_STATUS.has(r.status) || (r.startDate && String(r.startDate).trim()))
      .map(r => ({
        _key: r.id,
        hcId: r.hcId || r.id,
        position: r.position || '—',
        department: r.department || '—',
        candidate: r.candidateName || '—',
        ta: r.assignedToName || '—',
        offeringDate: fmtDate(getOfferingDate(r)),
        startDate: r.startDate || '',
        contractEnd: r.contractEndDate || '',
        status: r.status,
        _startSort: toDate(r.startDate)?.getTime() ?? 0,
      }))
      .sort((a, b) => b._startSort - a._startSort)
  }, [requests])

  // จัดกลุ่ม
  const groups = useMemo(() => {
    const m = {}
    list.forEach(row => {
      const k = groupBy === 'month' ? monthLabelOf(row.startDate) : row.department
      ;(m[k] ??= []).push(row)
    })
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length)
  }, [list, groupBy])

  const columns = [
    { key: 'hcId', label: 'เลขที่คำขอ' },
    { key: 'position', label: 'ตำแหน่ง' },
    { key: 'department', label: 'แผนก' },
    { key: 'candidate', label: 'ผู้สมัคร', accent: true },
    { key: 'ta', label: 'ผู้ดูแล (TA)' },
    { key: 'offeringDate', label: 'วันยื่นข้อเสนอ' },
    { key: 'startDate', label: 'วันเริ่มงาน' },
    { key: 'contractEnd', label: 'วันสิ้นสุดสัญญา' },
    { key: 'status', label: 'สถานะ', align: 'center', render: r => statusTH(r.status) },
  ]

  function buildAOA() {
    const header = columns.map(c => c.label)
    return [header, ...list.map(r => columns.map(c => c.key === 'status' ? statusTH(r.status) : (r[c.key] ?? '')))]
  }

  return (
    <SectionCard
      title="คนที่ได้แล้ว — เตรียมเริ่มงาน / เริ่มงานแล้ว"
      sub={`${list.length} เคส · จัดกลุ่มตาม${groupBy === 'month' ? 'เดือนที่เริ่มงาน' : 'แผนก'}`}
      action={
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-full border border-neutral-100 p-0.5">
            {[{ v: 'month', l: 'เดือน' }, { v: 'department', l: 'แผนก' }].map(t => (
              <button key={t.v} onClick={() => setGroupBy(t.v)}
                className={`rounded-full px-3 py-1 text-xs font-normal transition-colors ${groupBy === t.v ? 'bg-green-fresh-50 text-green-fresh-900' : 'text-neutral-900 hover:bg-neutral-50'}`}>
                {t.l}
              </button>
            ))}
          </div>
          <ExportButtons disabled={list.length === 0}
            onExcel={() => exportWorkbook(`onboarding-report_${dateStamp()}`, [{ name: 'Onboarding', aoa: buildAOA() }])}
            onCSV={() => exportCSV(`onboarding-report_${dateStamp()}`, buildAOA())} />
        </div>
      }>
      {list.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-neutral-400">ไม่มีเคส onboarding ตามตัวกรอง</p>
      ) : (
        <div className="flex flex-col">
          {groups.map(([groupName, groupRows]) => (
            <div key={groupName}>
              <div className="flex items-center justify-between border-y border-neutral-100 bg-neutral-50 px-6 py-2">
                <span className="text-[11px] font-bold text-neutral-600">{groupName}</span>
                <span className="text-[11px] font-bold tabular-nums text-dark-green-700">{groupRows.length}</span>
              </div>
              <DataTable columns={columns} rows={groupRows} />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
