/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EditCaseModal — แก้ไขข้อมูลเคส (Admin เท่านั้น)
 *
 * เปิดจากแผงรายละเอียดใน RequestTable → แก้ field ของคำขอที่กรอกไว้ตอนยื่นฟอร์ม
 * (ประเภท, org structure, ตำแหน่ง/JG, จำนวน HC, เหตุผล, requirements ฯลฯ)
 *
 * เขียนเฉพาะ field ที่เปลี่ยนจริง แล้วบันทึก audit log 1 entry ต่อการแก้ 1 ครั้ง
 * โดยเก็บ before → after ของทุก field ที่เปลี่ยนไว้ใน note
 *
 * บันทึกแล้ว sync ต่อเข้า Google Sheets ผ่าน updateFieldsInSheets (action=updateFields ฝั่ง GAS)
 * — เขียนทีละ cell ไม่ทับทั้งแถว สถานะ/PIC/Candidate ที่ TA แก้ในชีตเองจึงไม่หาย
 *
 * ponytail: Firestore สำเร็จก่อนแล้วค่อยยิง Sheets — Sheets พังไม่ rollback Firestore
 *           (toast แจ้ง admin ให้ไปแก้แถวเอง) เพราะ Firestore คือ source of truth
 * ponytail: ไม่แจ้ง Slack — การแก้ข้อมูลย้อนหลังเป็นงาน admin ไม่ใช่ event ของ pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { logAudit } from '@/features/audit-log/auditLog'
import { updateFieldsInSheets } from '@/libs/webhook'
import { DIVISIONS, getDepartments, getSections, getBusinessUnits } from '@/config/orgStructure'
import { HQ_JG_LEVELS, OPERATION_JG_LEVELS } from '@/config/jobGrades'
import { Loader2, AlertTriangle } from 'lucide-react'

// field ที่แก้ได้ — ชุดเดียวกับ INITIAL_FORM ใน HCRequestForm.jsx
// (ไม่รวม status / assignedTo / candidateName / startDate — พวกนั้นมี flow แก้ของตัวเองอยู่แล้ว)
const LABELS = {
  requestType:     'ประเภทคำขอ',
  employmentType:  'ประเภทการจ้าง',
  division:        'Division',
  department:      'แผนก',
  section:         'Section',
  businessUnit:    'Business Unit',
  orgTrack:        'Location track',
  jg:              'Job Grade',
  position:        'ตำแหน่ง',
  headcount:       'จำนวน HC',
  targetStartDate: 'วันที่ต้องการ / LWD',
  replacementFor:  'ทดแทนพนักงาน',
  workDaysPerWeek: 'วัน/สัปดาห์',
  shift:           'กะการทำงาน',
  requirements:    'Requirements',
  reason:          'เหตุผลในการขอ',
}
const FIELDS = Object.keys(LABELS)

const INPUT_CLS = 'w-full rounded-lg border border-neutral-100 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none'

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 ml-1 block text-[11px] font-bold text-neutral-500">{label}</label>
      {children}
    </div>
  )
}

export default function EditCaseModal({ req, user, onClose }) {
  // '' แทน undefined ทุก field เพื่อให้ input เป็น controlled ตลอด
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, req[k] ?? ''])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }))

  // เปลี่ยนระดับบนของ org structure → ล้างระดับล่างที่ไม่ valid แล้ว (cascade เดียวกับฟอร์มยื่นคำขอ)
  const setDivision   = (v) => setF((p) => ({ ...p, division: v, department: '', section: '', businessUnit: '' }))
  const setDepartment = (v) => setF((p) => ({ ...p, department: v, section: '', businessUnit: '' }))
  const setSection    = (v) => setF((p) => ({ ...p, section: v, businessUnit: '' }))
  const setOrgTrack   = (v) => setF((p) => ({ ...p, orgTrack: v, jg: '' })) // level list ต่างกันระหว่าง HQ/OPERATION

  const jgLevels = f.orgTrack === 'OPERATION' ? OPERATION_JG_LEVELS : HQ_JG_LEVELS
  const canSave  = f.position.trim() && f.reason.trim() && Number(f.headcount) >= 1

  async function save() {
    // เทียบเป็น string เพื่อให้ headcount 1 (number) กับ '1' (จาก input) ไม่นับเป็นการเปลี่ยน
    const changes = FIELDS
      .map((k) => ({
        k,
        from: req[k] ?? '',
        to:   k === 'headcount' ? Number(f[k]) : typeof f[k] === 'string' ? f[k].trim() : f[k],
      }))
      .filter((c) => String(c.from) !== String(c.to))

    if (changes.length === 0) return onClose()

    setSaving(true)
    setError('')
    try {
      await updateDoc(doc(db, 'hc_requests', req.id), Object.fromEntries(changes.map((c) => [c.k, c.to])))
      await logAudit({
        requestId:  req.id,
        action:     'EditCase',
        by:         user.email,
        byName:     user.displayName,
        fromStatus: req.status,
        toStatus:   req.status,   // การแก้ข้อมูลไม่เปลี่ยนสถานะ
        position:   f.position,
        department: f.department,
        note:       changes.map((c) => `${LABELS[c.k]}: "${c.from || '—'}" → "${c.to || '—'}"`).join(' | '),
      })

      // sync Sheets หลัง Firestore สำเร็จแล้ว — ไม่ throw ออกมา (toast แจ้งผลเองข้างใน)
      // ถ้าไม่มี hcId แปลว่าเคสนี้ไม่เคยขึ้น Sheets → ข้ามไปเลย
      if (req.hcId) {
        const payload = Object.fromEntries(changes.map((c) => [c.k, c.to]))
        // division + businessUnit ใช้คอลัมน์ H ร่วมกัน (ค่าที่เขียนคือ division || businessUnit)
        // ต้องส่งคู่เสมอ ไม่งั้นชีตจะได้ค่าคนละตัวกับตอน full resync
        if ('division' in payload || 'businessUnit' in payload) {
          payload.division     = f.division
          payload.businessUnit = f.businessUnit
        }
        await updateFieldsInSheets(req.hcId, payload)
      }
      onClose()
    } catch (e) {
      setError(e.message || 'บันทึกไม่สำเร็จ')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-[24px] border border-neutral-100 bg-white shadow-xl">
        <div className="px-6 pt-6">
          <h3 className="mb-1 text-lg font-bold text-neutral-900">แก้ไขข้อมูลเคส</h3>
          <p className="mb-5 text-sm text-neutral-500">
            {req.hcId || req.id} — การแก้ไขจะถูกบันทึกใน Audit Log และไม่ sync กลับ Google Sheets
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-y-auto px-6 pb-2 md:grid-cols-2">
          <Field label={LABELS.requestType}>
            <select value={f.requestType} onChange={(e) => set('requestType', e.target.value)} className={INPUT_CLS}>
              {['Replacement', 'New HC'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>

          <Field label={LABELS.employmentType}>
            <select value={f.employmentType} onChange={(e) => set('employmentType', e.target.value)} className={INPUT_CLS}>
              {['Monthly', 'Daily', 'Contract', 'Intern'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>

          <Field label={LABELS.division}>
            <select value={f.division} onChange={(e) => setDivision(e.target.value)} className={INPUT_CLS}>
              <option value="">— เลือก —</option>
              {DIVISIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>

          <Field label={LABELS.department}>
            <select value={f.department} onChange={(e) => setDepartment(e.target.value)} className={INPUT_CLS}>
              <option value="">— เลือก —</option>
              {/* ค่าเดิมอาจเป็นแผนกที่ไม่อยู่ใน division ปัจจุบัน (custom dept) → คงไว้ไม่ให้หายตอนเปิดครั้งแรก */}
              {[...new Set([...getDepartments(f.division), f.department].filter(Boolean))].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>

          <Field label={LABELS.section}>
            <select value={f.section} onChange={(e) => setSection(e.target.value)} className={INPUT_CLS}>
              <option value="">— ไม่ระบุ —</option>
              {[...new Set([...getSections(f.division, f.department), f.section].filter(Boolean))].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>

          <Field label={LABELS.businessUnit}>
            <select value={f.businessUnit} onChange={(e) => set('businessUnit', e.target.value)} className={INPUT_CLS}>
              <option value="">— ไม่ระบุ —</option>
              {[...new Set([...getBusinessUnits(f.division, f.department, f.section), f.businessUnit].filter(Boolean))].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>

          <Field label={LABELS.orgTrack}>
            <select value={f.orgTrack} onChange={(e) => setOrgTrack(e.target.value)} className={INPUT_CLS}>
              <option value="">— เลือก —</option>
              <option value="HQ">HQ</option>
              <option value="OPERATION">OPERATION</option>
            </select>
          </Field>

          <Field label={LABELS.jg}>
            <select value={f.jg} onChange={(e) => set('jg', e.target.value)} className={INPUT_CLS}>
              <option value="">— เลือก —</option>
              {jgLevels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>

          <Field label={`${LABELS.position} *`}>
            <input type="text" value={f.position} onChange={(e) => set('position', e.target.value)} className={INPUT_CLS} />
          </Field>

          <Field label={`${LABELS.headcount} *`}>
            <input type="number" min={1} value={f.headcount} onChange={(e) => set('headcount', e.target.value)} className={INPUT_CLS} />
          </Field>

          <Field label={f.requestType === 'Replacement' ? 'วันที่ลาออก (LWD)' : 'วันที่ต้องการเริ่มงาน'}>
            <input type="date" value={f.targetStartDate} onChange={(e) => set('targetStartDate', e.target.value)} className={INPUT_CLS} />
          </Field>

          {f.requestType === 'Replacement' && (
            <Field label={LABELS.replacementFor}>
              <input type="text" value={f.replacementFor} onChange={(e) => set('replacementFor', e.target.value)} className={INPUT_CLS} />
            </Field>
          )}

          <Field label={LABELS.workDaysPerWeek}>
            <select value={f.workDaysPerWeek} onChange={(e) => set('workDaysPerWeek', e.target.value)} className={INPUT_CLS}>
              <option value="">— ไม่ระบุ —</option>
              {[3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} วัน/สัปดาห์</option>)}
            </select>
          </Field>

          {/* กะ: free text เพราะฟอร์มยื่นคำขอก็ให้กรอกเองได้ผ่านตัวเลือก "อื่นๆ" */}
          <Field label={LABELS.shift}>
            <input type="text" value={f.shift} onChange={(e) => set('shift', e.target.value)} placeholder="เช่น 08:00-17:00" className={INPUT_CLS} />
          </Field>

          <div className="md:col-span-2">
            <Field label={`${LABELS.reason} *`}>
              <textarea rows={3} value={f.reason} onChange={(e) => set('reason', e.target.value)} className={`${INPUT_CLS} resize-none`} />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label={LABELS.requirements}>
              <textarea rows={3} value={f.requirements} onChange={(e) => set('requirements', e.target.value)} className={`${INPUT_CLS} resize-none`} />
            </Field>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
            <AlertTriangle size={14} strokeWidth={1} absoluteStrokeWidth className="shrink-0 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-3 px-6 pb-6 pt-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={save}
            disabled={saving || !canSave}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-dark-green-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} strokeWidth={1} absoluteStrokeWidth className="animate-spin" />}
            บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}
