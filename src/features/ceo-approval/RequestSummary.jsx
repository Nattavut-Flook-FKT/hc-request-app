/**
 * RequestSummary.jsx — สรุปคำขอ New HC สำหรับผู้อนุมัติ (อ่านอย่างเดียว)
 * ใช้ร่วมกันทั้งหน้า /approve/:id/:token (public จากอีเมล) และ /pending-approvals (ในแอพ)
 * โชว์เท่าที่ CEO ต้องใช้ตัดสิน: ตำแหน่ง · สายงาน · จำนวน · JG · ประเภทจ้าง · วันเริ่ม · เหตุผล · คุณสมบัติ · ไฟล์ JD
 */
import { FileText } from 'lucide-react'
import { getJDSignedUrl } from '@/libs/supabase'
import { fmtDate } from '@/utils/dates'

async function openJD(path) {
  const url = await getJDSignedUrl(path)
  if (url) window.open(url, '_blank')
}

export default function RequestSummary({ req }) {
  return (
    <>
      {/* หัว: ตำแหน่ง + HCID + สายงาน / ผู้ยื่น + วันยื่น */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-neutral-900">{req.position}</h2>
            {req.hcId && <span className="rounded border border-neutral-100 bg-neutral-50 px-2 py-0.5 text-[11px] font-bold text-neutral-500">{req.hcId}</span>}
          </div>
          <p className="mt-0.5 text-sm text-neutral-500">{[req.division, req.department, req.section].filter(Boolean).join(' · ')}</p>
        </div>
        <p className="text-xs text-neutral-400">
          ยื่นโดย <span className="font-bold text-neutral-600">{req.requesterName}</span> · {fmtDate(req.createdAt)}
        </p>
      </div>

      {/* ข้อมูลประกอบการตัดสินใจ */}
      <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label="จำนวน HC" value={`${req.headcount ?? 1} คน`} strong />
        <Fact label="Job grade" value={req.jg} />
        <Fact label="ประเภทการจ้าง" value={[req.employmentType, req.payrollType].filter(Boolean).join(' · ')} />
        <Fact label="ต้องการเริ่มงาน" value={req.targetStartDate} />
      </dl>

      <div className="mb-4 rounded-xl border border-neutral-100 bg-neutral-50 p-3">
        <p className="mb-1 text-[11px] font-bold text-neutral-400">เหตุผลในการขอ</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{req.reason || '—'}</p>
      </div>
      {req.requirements && (
        <div className="mb-4 rounded-xl border border-neutral-100 bg-neutral-50 p-3">
          <p className="mb-1 text-[11px] font-bold text-neutral-400">คุณสมบัติที่ต้องการ</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{req.requirements}</p>
        </div>
      )}
      {req.jdFilePath && (
        <button
          onClick={() => openJD(req.jdFilePath)}
          className="mb-4 flex items-center gap-1.5 rounded-lg border border-neutral-100 bg-white px-3 py-1.5 text-[11px] font-bold text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          <FileText size={12} strokeWidth={1} absoluteStrokeWidth /> {req.jdFileName || 'JD file'}
        </button>
      )}
    </>
  )
}

function Fact({ label, value, strong }) {
  return (
    <div>
      <dt className="mb-1 text-[11px] font-bold text-neutral-400">{label}</dt>
      <dd className={strong ? 'text-lg font-bold text-dark-green-700 tabular-nums' : 'text-sm font-bold text-neutral-700'}>{value || '—'}</dd>
    </div>
  )
}
