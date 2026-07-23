/**
 * ApproveNewHcPage.jsx — หน้า CEO approve/reject คำขอ New HC (beta)
 * ─────────────────────────────────────────────────────────────────────────────
 * Public route — ไม่ต้อง login (เข้าจากลิงก์ Slack ตรงๆ) — ดู carve-out ใน App.jsx
 *
 * Security: ปุ่ม "อนุมัติ"/"ไม่อนุมัติ" ต้องกดเองเสมอ — ห้าม auto-approve ตอนโหลดหน้า (GET)
 * เพราะ Slack/mail security scanner บางระบบ auto-เปิดลิงก์เพื่อเช็คมัลแวร์ ถ้า approve เกิดตอน
 * โหลดหน้าจะโดน scanner กด-อนุมัติ-ให้เองโดยไม่มีใครตั้งใจ
 *
 * One-time โดยธรรมชาติ: updateDoc ต้องส่ง approvalToken กลับไปตรงกับที่เก็บในเอกสาร +
 * เอกสารต้องยังเป็นสถานะ PendingApproval เท่านั้น (ดู firestore.rules) — พอ approve/reject
 * สำเร็จครั้งแรก สถานะเปลี่ยนไปแล้ว ลิงก์เดิมกดซ้ำจะ fail ทันทีโดยไม่ต้องมี flag "ใช้แล้ว" แยก
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { sendToWebhook } from '@/libs/webhook'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

export default function ApproveNewHcPage() {
  const { id, token } = useParams()
  const [loading, setLoading] = useState(true)
  const [reqData, setReqData] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [decision, setDecision] = useState(null) // null | 'approved' | 'rejected'
  const [showRejectBox, setShowRejectBox] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'hc_requests', id))
        if (cancelled) return
        if (!snap.exists() || snap.data().status !== 'PendingApproval' || snap.data().approvalToken !== token) {
          setNotFound(true)
        } else {
          setReqData(snap.data())
        }
      } catch (err) {
        console.error('[ApproveNewHcPage] load error:', err)
        setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, token])

  async function handleApprove() {
    setSubmitting(true)
    setErrorMsg('')
    try {
      await updateDoc(doc(db, 'hc_requests', id), {
        status: 'Open',
        approvalToken: token, // ส่งกลับไปให้ rule เช็คตรงกับค่าที่เก็บไว้ (ยืนยันว่ามาจากลิงก์จริง)
        approvedAt: serverTimestamp(),
      })
      // อนุมัติสำเร็จ → เพิ่งแจ้ง TA/sync Sheets ตอนนี้เป็นครั้งแรก (เดิมถูกข้ามไว้ตอน submit)
      const { workDaysPerWeek: _w, shift: _s, approvalToken: _t, ...webhookPayload } = reqData
      await sendToWebhook({
        ...webhookPayload,
        status: 'Open',
        id,
        createdAt: reqData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      })
      setDecision('approved')
    } catch (err) {
      console.error('[ApproveNewHcPage] approve error:', err)
      setErrorMsg('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return
    setSubmitting(true)
    setErrorMsg('')
    try {
      await updateDoc(doc(db, 'hc_requests', id), {
        status: 'RejectedByCEO',
        approvalToken: token,
        rejectReason: rejectReason.trim(),
        rejectedAt: serverTimestamp(),
      })
      setDecision('rejected')
    } catch (err) {
      console.error('[ApproveNewHcPage] reject error:', err)
      setErrorMsg('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md rounded-3xl border border-neutral-100 bg-white p-8">
        <img src="/freshket-original.svg" alt="Freshket" className="mb-6 h-6" />

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400">
            <Loader2 size={18} className="animate-spin" /> กำลังโหลด...
          </div>
        )}

        {!loading && notFound && (
          <>
            <h1 className="mb-2 text-lg font-bold text-neutral-900">ลิงก์นี้ใช้ไม่ได้แล้ว</h1>
            <p className="text-sm text-neutral-500">
              คำขอนี้อาจถูกอนุมัติ/ปฏิเสธไปแล้วก่อนหน้านี้ หรือลิงก์ไม่ถูกต้อง
            </p>
          </>
        )}

        {!loading && !notFound && decision === 'approved' && (
          <>
            <div className="mb-2 flex items-center gap-2 text-dark-green-700">
              <CheckCircle size={20} strokeWidth={1} absoluteStrokeWidth />
              <h1 className="text-lg font-bold">อนุมัติแล้ว</h1>
            </div>
            <p className="text-sm text-neutral-500">คำขอ "{reqData?.position}" เข้าสู่กระบวนการปกติแล้ว — ทีม TA จะดำเนินการต่อ</p>
          </>
        )}

        {!loading && !notFound && decision === 'rejected' && (
          <>
            <div className="mb-2 flex items-center gap-2 text-red-600">
              <XCircle size={20} strokeWidth={1} absoluteStrokeWidth />
              <h1 className="text-lg font-bold">ปฏิเสธคำขอแล้ว</h1>
            </div>
            <p className="text-sm text-neutral-500">คำขอ "{reqData?.position}" ถูกบันทึกว่าไม่อนุมัติ</p>
          </>
        )}

        {!loading && !notFound && !decision && (
          <>
            <h1 className="mb-4 text-lg font-bold text-neutral-900">คำขอ New HC รออนุมัติ</h1>
            <div className="mb-6 flex flex-col gap-2.5 rounded-2xl border border-neutral-100 bg-neutral-50 p-4 text-sm">
              <Row label="ตำแหน่ง" value={reqData.position} />
              <Row label="แผนก" value={reqData.department} />
              <Row label="จำนวน" value={`${reqData.headcount ?? 1} คน`} />
              <Row label="ผู้ยื่น" value={reqData.requesterName} />
              {reqData.reason && <Row label="เหตุผล" value={reqData.reason} />}
            </div>

            {errorMsg && <p className="mb-4 text-sm font-bold text-red-600">{errorMsg}</p>}

            {!showRejectBox ? (
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRejectBox(true)}
                  disabled={submitting}
                  className="flex-1 rounded-lg border border-red-100 px-4 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  ไม่อนุมัติ
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-dark-green-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-50"
                >
                  {submitting ? 'กำลังบันทึก...' : 'อนุมัติ'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-bold text-neutral-500">เหตุผลที่ไม่อนุมัติ *</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowRejectBox(false); setRejectReason('') }}
                    disabled={submitting}
                    className="flex-1 rounded-lg border border-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={submitting || !rejectReason.trim()}
                    className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {submitting ? 'กำลังบันทึก...' : 'ยืนยันไม่อนุมัติ'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 font-bold text-neutral-400">{label}</span>
      <span className="text-neutral-800">{value}</span>
    </div>
  )
}
