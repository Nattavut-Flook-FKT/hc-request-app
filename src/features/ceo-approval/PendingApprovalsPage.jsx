/**
 * PendingApprovalsPage.jsx — หน้า CEO/Admin ในแอพ (/pending-approvals) — login role ceo/admin
 * ─────────────────────────────────────────────────────────────────────────────
 * ทางหลักที่ CEO อนุมัติคือลิงก์ในอีเมล (ApproveNewHcPage ไม่ต้อง login) — หน้านี้เป็น
 *   (1) fallback ถ้าอีเมลหาย/ลิงก์ใช้ไม่ได้  (2) ที่เดียวที่เห็นประวัติว่าใบที่อนุมัติไปแล้วอยู่สถานะไหน
 * firestore.rules: doc ที่ status PendingApproval แก้ได้เฉพาะ isCeo() (ceo/admin) หรือ token จากอีเมล
 *
 * 2 tab:
 *   รออนุมัติ  → การ์ดพร้อมปุ่มตัดสิน
 *   ตัดสินแล้ว → ตาราง New HC ที่เคยอนุมัติ/ไม่อนุมัติ + สถานะปัจจุบันของใบนั้น (อ่านอย่างเดียว)
 *
 * อนุมัติ   → Open + approvedBy/approvedAt + statusHistory → sendToWebhook (ลง Sheets + Slack แจ้ง TA ครั้งแรก)
 * ไม่อนุมัติ → RejectedByCEO + rejectedBy/rejectReason/rejectedAt + statusHistory (Manager เห็นเหตุผลใน /my-requests)
 * ทั้งคู่เขียนผ่าน runTransaction เช็คว่ายัง PendingApproval อยู่ — กันกดซ้ำ/CEO กดจากอีเมลพร้อมกันแล้ว Sheets ได้ row ซ้ำ
 */
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, query, where, runTransaction, arrayUnion, serverTimestamp } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { sendToWebhook, reportClientError } from '@/libs/webhook'
import { logAudit } from '@/features/audit-log/auditLog'
import { STATUS_CONFIG } from '@/config/statusConfig'
import { shortName, buildHistoryEntry } from '@/utils/statusHistory'
import { toast } from '@/components/ui/Toast'
import Layout from '@/components/app-shell/Layout'
import RequestSummary from './RequestSummary'
import { toMs, fmtDate } from '@/utils/dates'
import { CheckCircle, XCircle } from 'lucide-react'

const ALREADY_DECIDED = 'ALREADY_DECIDED'
const TABS = ['รออนุมัติ', 'ตัดสินแล้ว']

/** ใบที่ CEO เคยตัดสินแล้ว — approvedAt มีเฉพาะที่ผ่าน CEO (TA Rejected ไม่ตั้ง field นี้) */
const isDecided = (r) => Boolean(r.approvedAt) || r.status === 'RejectedByCEO'

export default function PendingApprovalsPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(TABS[0])
  const [busyId, setBusyId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    // query เดียว (New HC ทั้งหมด) แล้วแยก pending/decided ฝั่ง client — ไม่ต้องมี composite index
    const q = query(collection(db, 'hc_requests'), where('requestType', '==', 'New HC'))
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, (err) => {
      console.error('[PendingApprovalsPage] snapshot error:', err)
      setLoading(false)
    })
    return unsub
  }, [])

  // เก่าสุดขึ้นก่อน — CEO เคลียร์ตามคิว
  const pending = rows.filter((r) => r.status === 'PendingApproval').sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
  // ตัดสินล่าสุดขึ้นก่อน
  const decided = rows.filter(isDecided).sort((a, b) => toMs(b.approvedAt ?? b.rejectedAt) - toMs(a.approvedAt ?? a.rejectedAt))
  const counts = { [TABS[0]]: pending.length, [TABS[1]]: decided.length }

  /** เขียน patch ลง doc เฉพาะเมื่อยังเป็น PendingApproval — ไม่งั้น throw ALREADY_DECIDED */
  async function decide(id, patch) {
    const ref = doc(db, 'hc_requests', id)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (snap.data()?.status !== 'PendingApproval') throw new Error(ALREADY_DECIDED)
      tx.update(ref, patch)
    })
  }

  function handleError(where, err, hcId) {
    if (err.message === ALREADY_DECIDED) { toast('ใบนี้ถูกตัดสินไปแล้ว', { type: 'warning', sub: 'อาจมีคนกดจากอีเมลก่อนหน้า — รายการจะหายไปเอง' }); return }
    console.error(`[PendingApprovalsPage] ${where} error:`, err)
    reportClientError(where, err, { hcId })
    toast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง', { type: 'error' })
  }

  async function handleApprove(req) {
    setBusyId(req.id)
    try {
      await decide(req.id, {
        status: 'Open',
        approvedAt: serverTimestamp(),
        approvedBy: user.email,
        approvedByName: shortName(user.displayName),
        statusHistory: arrayUnion(buildHistoryEntry('Open', user)),
      })
      // อนุมัติแล้วถึงลง Sheets + แจ้ง TA เป็นครั้งแรก — openDate ใน Sheets = วันอนุมัติ (วันที่ TA ได้งานจริง)
      const { workDaysPerWeek: _w, shift: _s, approvalTokenHash: _h, ...webhookPayload } = req
      await sendToWebhook({ ...webhookPayload, status: 'Open', id: req.id, createdAt: new Date().toISOString() })
      logAudit({
        requestId: req.id, action: 'CeoApprove', by: user.email, byName: user.displayName,
        fromStatus: 'PendingApproval', toStatus: 'Open', position: req.position, department: req.department,
      })
      toast(`อนุมัติ "${req.position}" แล้ว`, { type: 'success', sub: 'ส่งต่อให้ทีม TA เรียบร้อย' })
    } catch (err) {
      handleError('ceoApprove', err, req.hcId)
    }
    setBusyId(null)
  }

  async function handleReject(req) {
    const reason = rejectReason.trim()
    if (!reason) return
    setBusyId(req.id)
    try {
      await decide(req.id, {
        status: 'RejectedByCEO',
        rejectReason: reason,
        rejectedAt: serverTimestamp(),
        rejectedBy: user.email,
        rejectedByName: shortName(user.displayName),
        statusHistory: arrayUnion(buildHistoryEntry('RejectedByCEO', user)),
      })
      logAudit({
        requestId: req.id, action: 'CeoReject', by: user.email, byName: user.displayName,
        fromStatus: 'PendingApproval', toStatus: 'RejectedByCEO', position: req.position, department: req.department,
        note: reason,
      })
      toast(`ไม่อนุมัติ "${req.position}"`, { type: 'success', sub: 'ผู้ยื่นจะเห็นเหตุผลในหน้าคำขอของฉัน' })
      setRejectingId(null)
      setRejectReason('')
    } catch (err) {
      handleError('ceoReject', err, req.hcId)
    }
    setBusyId(null)
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Pending Approvals</h1>
          <p className="mt-0.5 text-sm text-neutral-500">คำขอ New Headcount ที่รออนุมัติ — {pending.length} รายการ</p>
        </div>

        {/* Tabs — pattern เดียวกับ RequestTable */}
        <div className="flex gap-1 border-b border-neutral-100">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold transition-colors ${tab === t
                ? 'border-dark-green-600 text-dark-green-900'
                : 'border-transparent text-neutral-400 hover:text-neutral-600'
              }`}
            >
              {t}
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${tab === t ? 'bg-dark-green-50 text-dark-green-900' : 'bg-neutral-50 text-neutral-400'}`}>{counts[t]}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="h-32 animate-pulse rounded-2xl border border-neutral-100 bg-white" />
        ) : tab === TABS[1] ? (
          <DecidedTable rows={decided} />
        ) : pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-100 bg-white py-16 text-center">
            <p className="font-bold text-neutral-400">ไม่มีคำขอรออนุมัติ</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {pending.map((req) => {
              const busy = busyId === req.id
              return (
                <div key={req.id} className="rounded-2xl border border-neutral-100 bg-white p-6">
                  <RequestSummary req={req} />

                  {/* ปุ่มตัดสิน — ไม่อนุมัติต้องกรอกเหตุผลก่อน */}
                  {rejectingId === req.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="เหตุผลที่ไม่อนุมัติ (ผู้ยื่นจะเห็นข้อความนี้)"
                        rows={2}
                        autoFocus
                        className="w-full resize-none rounded-lg border border-neutral-100 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason('') }}
                          disabled={busy}
                          className="h-10 flex-1 rounded-lg border border-neutral-100 px-4 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
                        >
                          ยกเลิก
                        </button>
                        <button
                          onClick={() => handleReject(req)}
                          disabled={busy || !rejectReason.trim()}
                          className="h-10 flex-1 rounded-lg bg-red-600 px-4 text-sm font-bold text-neutral-50 transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          {busy ? 'กำลังบันทึก...' : 'ยืนยันไม่อนุมัติ'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setRejectingId(req.id); setRejectReason('') }}
                        disabled={busy}
                        className="flex h-10 items-center gap-1.5 rounded-lg border border-red-100 px-4 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        <XCircle size={16} strokeWidth={1} absoluteStrokeWidth /> ไม่อนุมัติ
                      </button>
                      <button
                        onClick={() => handleApprove(req)}
                        disabled={busy}
                        className="flex h-10 items-center gap-1.5 rounded-lg bg-dark-green-600 px-4 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-50"
                      >
                        <CheckCircle size={16} strokeWidth={1} absoluteStrokeWidth /> {busy ? 'กำลังบันทึก...' : 'อนุมัติ'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}

/** ตาราง New HC ที่ตัดสินไปแล้ว — อ่านอย่างเดียว · สถานะปัจจุบันใช้สี/label เดียวกับตาราง TA */
function DecidedTable({ rows }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-100 bg-white py-16 text-center">
        <p className="font-bold text-neutral-400">ยังไม่มีคำขอที่ตัดสิน</p>
      </div>
    )
  }
  const TH = 'px-4 py-2.5 text-left text-[11px] font-bold text-neutral-400'
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-100 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 bg-neutral-50">
            <th className={TH}>ID</th>
            <th className={TH}>ตำแหน่ง / แผนก</th>
            <th className={TH}>ผู้ยื่น</th>
            <th className={TH}>ผลการตัดสิน</th>
            <th className={TH}>สถานะตอนนี้</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => {
            const rejected = r.status === 'RejectedByCEO'
            const cfg = STATUS_CONFIG[r.status]
            const byName = rejected ? r.rejectedByName : r.approvedByName
            return (
              <tr key={r.id}>
                <td className="px-4 py-3 whitespace-nowrap text-[11px] font-bold text-neutral-500">{r.hcId || '—'}</td>
                <td className="px-4 py-3">
                  <p className="font-bold text-neutral-900">{r.position} <span className="font-normal text-neutral-400">× {r.headcount ?? 1}</span></p>
                  <p className="text-xs text-neutral-500">{r.department}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{r.requesterName || '—'}</td>
                <td className="px-4 py-3">
                  <p className={`flex items-center gap-1.5 font-bold ${rejected ? 'text-red-700' : 'text-dark-green-700'}`}>
                    {rejected
                      ? <><XCircle size={14} strokeWidth={1} absoluteStrokeWidth /> ไม่อนุมัติ</>
                      : <><CheckCircle size={14} strokeWidth={1} absoluteStrokeWidth /> อนุมัติ</>}
                  </p>
                  <p className="text-xs text-neutral-500">{fmtDate(rejected ? r.rejectedAt : r.approvedAt)}{byName && ` · ${byName}`}</p>
                  {rejected && r.rejectReason && <p className="mt-1 max-w-xs text-xs italic text-neutral-500">"{r.rejectReason}"</p>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${cfg ? `${cfg.bg} ${cfg.text} ${cfg.border}` : 'border-neutral-100 bg-neutral-50 text-neutral-500'}`}>
                    {cfg?.label ?? r.status}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
