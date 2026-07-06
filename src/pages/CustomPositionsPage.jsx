/**
 * CustomPositionsPage.jsx — Custom Positions Manager
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าจัดการตำแหน่งงาน (positions) ที่สร้างขึ้นเพิ่มเติมโดยผู้ใช้งาน
 * ข้อมูลถูกเก็บใน Firestore collection `custom_positions`
 * รองรับการเพิ่ม, ค้นหา, กรองตามแผนก และลบตำแหน่ง
 *
 * UI: FKT Design System v1.0 (token-only · no dark mode · weight 400/700 ·
 *     sentence case · Lucide strokeWidth 1) — pilot page for DS rollout
 *
 * Props / Features:
 *   - user / role / isDarkMode / toggleDarkMode — ส่งต่อให้ Layout
 *   - ฟอร์มเพิ่ม position รองรับ division, department, section, orgTrack (HQ/OPERATION), ชื่อตำแหน่ง
 *   - normalizedPosition (lowercase) ถูกบันทึกควบคู่กันเพื่อรองรับการค้นหาแบบ case-insensitive
 *   - การลบใช้ ConfirmModal ยืนยันก่อนทุกครั้ง
 *
 * Notes:
 *   - ข้อมูลโหลดครั้งเดียวตอน mount (getDocs) ไม่ใช่ realtime listener
 *   - หลังเพิ่ม position สำเร็จ จะ prepend เข้า local state ทันทีโดยไม่ต้อง refetch
 *   - pageError จะหายเองหลัง 4 วินาที
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react'
import { query, collection, orderBy, getDocs, deleteDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../services/firebase'
import { Plus, Search, Tag, Trash2, Loader2 } from 'lucide-react'
import Layout from '../components/Shared/Layout'
import ConfirmModal from '../components/Shared/ConfirmModal'
import { DIVISIONS } from '../data/orgStructure'

// ── DS class recipes (07-input · 09-dropdown · 05-button) ──
const FIELD = 'h-10 w-full rounded-lg border border-neutral-100 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none'
const LABEL = 'mb-1 block text-[13px] font-bold text-neutral-900'

export default function CustomPositionsPage({ user, role, isDarkMode, toggleDarkMode }) {
  // รายการ positions ทั้งหมดที่โหลดจาก Firestore
  const [positions, setPositions] = useState([])

  // สถานะการโหลดข้อมูลครั้งแรก
  const [loading, setLoading] = useState(true)

  // ข้อความค้นหา — กรองทั้งชื่อตำแหน่งและชื่อแผนก
  const [search, setSearch] = useState('')

  // ตัวกรองแผนก — ค่าว่าง = แสดงทุกแผนก
  const [deptFilter, setDeptFilter] = useState('')

  // id ของ position ที่กำลังถูกลบ (แสดง spinner บนปุ่มของแถวนั้น)
  const [deletingId, setDeletingId] = useState('')

  // สถานะ confirm modal: isOpen และ id ของ position ที่จะลบ
  const [confirmState, setConfirmState] = useState({ isOpen: false, id: '' })

  // ข้อความ error ที่แสดงบนหน้า (จะหายอัตโนมัติใน 4 วินาที)
  const [pageError, setPageError] = useState('')

  // ข้อมูลในฟอร์มสำหรับเพิ่ม position ใหม่
  const [addForm, setAddForm] = useState({ division: '', department: '', section: '', orgTrack: 'HQ', position: '' })

  // สถานะว่ากำลัง submit ฟอร์มเพิ่ม position อยู่ (ป้องกัน double submit)
  const [isAdding, setIsAdding] = useState(false)

  /**
   * useEffect — โหลดรายการ positions จาก Firestore เมื่อ component mount
   * เรียงตาม createdAt descending เพื่อให้ positions ใหม่ขึ้นก่อน
   */
  useEffect(() => {
    const q = query(collection(db, 'custom_positions'), orderBy('createdAt', 'desc'))
    getDocs(q).then((snap) => {
      setPositions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  /**
   * handleDelete — ลบ position ออกจาก Firestore และอัพเดต local state
   * ตั้ง deletingId เพื่อแสดง spinner บนปุ่มขณะรอ async operation
   */
  async function handleDelete(id) {
    setDeletingId(id)
    try {
      await deleteDoc(doc(db, 'custom_positions', id))
      // อัพเดต local state โดย filter ออก แทนการ refetch ทั้งหมด
      setPositions(prev => prev.filter(p => p.id !== id))
    } catch (e) {
      setPageError('ลบ position ไม่สำเร็จ: ' + e.message)
      setTimeout(() => setPageError(''), 4000)
    } finally {
      setDeletingId('')
    }
  }

  /**
   * handleAdd — เพิ่ม position ใหม่เข้า Firestore
   * บันทึก normalizedPosition (lowercase) ควบคู่เพื่อรองรับการค้นหาในอนาคต
   * หลัง add สำเร็จ จะ prepend เข้า local state ทันทีพร้อม reset form
   */
  async function handleAdd(e) {
    e.preventDefault()
    // ตรวจสอบ required fields ก่อน submit
    if (!addForm.department.trim() || !addForm.position.trim()) return
    setIsAdding(true)
    try {
      const docRef = await addDoc(collection(db, 'custom_positions'), {
        division:   addForm.division,
        department: addForm.department.trim(),
        section:    addForm.section.trim(),
        orgTrack:   addForm.orgTrack,
        position:   addForm.position.trim(),
        normalizedPosition: addForm.position.trim().toLowerCase(),
        createdBy: user.email,
        createdAt: serverTimestamp(),
      })
      setPositions(prev => [{
        id: docRef.id,
        division:   addForm.division,
        department: addForm.department.trim(),
        section:    addForm.section.trim(),
        orgTrack:   addForm.orgTrack,
        position:   addForm.position.trim(),
        normalizedPosition: addForm.position.trim().toLowerCase(),
        createdBy: user.email,
        createdAt: new Date(),
      }, ...prev])
      setAddForm({ division: '', department: '', section: '', orgTrack: 'HQ', position: '' })
    } catch (e) {
      setPageError('เพิ่ม position ไม่สำเร็จ: ' + e.message)
      setTimeout(() => setPageError(''), 4000)
    }
    setIsAdding(false)
  }

  // สร้างรายการ department ที่ไม่ซ้ำกันจาก positions ปัจจุบัน (สำหรับ dropdown กรอง)
  const depts = [...new Set(positions.map(p => p.department))].sort()

  // กรอง positions ตาม deptFilter และ search text (ตรวจสอบทั้ง position name และ department)
  const filtered = positions.filter(p =>
    (!deptFilter || p.department === deptFilter) &&
    (!search || p.position.toLowerCase().includes(search.toLowerCase()) || p.department.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        {/* ── Section header (13-section-header §2) ── */}
        <div className="flex items-center gap-2">
          <Tag size={20} strokeWidth={1} absoluteStrokeWidth className="text-neutral-600" />
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Custom positions</h1>
            <p className="mt-0.5 text-sm text-neutral-500">ตำแหน่งที่สร้างเพิ่มเติมโดยผู้ใช้งาน</p>
          </div>
        </div>

        {/* ── Error alert (semantic · red-50 + red-700 · DS-#096) ── */}
        {pageError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 animate-in fade-in slide-in-from-top-2">
            {pageError}
          </div>
        )}

        {/* ── Add form (panel · r-lg · token-only) ── */}
        <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Plus size={16} strokeWidth={1} absoluteStrokeWidth className="text-neutral-500" />
            <h2 className="text-base font-bold text-neutral-900">เพิ่ม position ใหม่</h2>
          </div>

          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Division */}
              <div>
                <label className={LABEL}>Division</label>
                <select
                  value={addForm.division} onChange={e => setAddForm(f => ({ ...f, division: e.target.value }))}
                  className={`${FIELD} cursor-pointer`}
                >
                  <option value="">เลือก division</option>
                  {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* แผนก (required) */}
              <div>
                <label className={LABEL}>แผนก <span className="text-red-600">*</span></label>
                <input
                  id="pos-department" name="pos-department"
                  type="text" placeholder="ชื่อแผนก" required
                  value={addForm.department} onChange={e => setAddForm(f => ({ ...f, department: e.target.value }))}
                  className={FIELD}
                />
              </div>

              {/* Section */}
              <div>
                <label className={LABEL}>Section</label>
                <input
                  id="pos-section" name="pos-section"
                  type="text" placeholder="ชื่อ section"
                  value={addForm.section} onChange={e => setAddForm(f => ({ ...f, section: e.target.value }))}
                  className={FIELD}
                />
              </div>

              {/* Location (orgTrack) */}
              <div>
                <label className={LABEL}>Location</label>
                <select
                  value={addForm.orgTrack} onChange={e => setAddForm(f => ({ ...f, orgTrack: e.target.value }))}
                  className={`${FIELD} cursor-pointer`}
                >
                  <option value="HQ">HQ</option>
                  <option value="OPERATION">Operation</option>
                </select>
              </div>

              {/* ชื่อตำแหน่ง (required) */}
              <div>
                <label className={LABEL}>ชื่อตำแหน่ง <span className="text-red-600">*</span></label>
                <input
                  id="pos-position" name="pos-position"
                  type="text" placeholder="ชื่อตำแหน่ง" required
                  value={addForm.position} onChange={e => setAddForm(f => ({ ...f, position: e.target.value }))}
                  className={FIELD}
                />
              </div>
            </div>

            {/* Form → submit (s6 gap) · Primary button M · no shadow */}
            <div className="flex justify-end">
              <button
                type="submit" disabled={isAdding}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-dark-green-600 px-5 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-dark-green-100 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-300"
              >
                {isAdding && <Loader2 size={16} strokeWidth={1} absoluteStrokeWidth className="animate-spin" />}
                เพิ่ม
              </button>
            </div>
          </form>
        </div>

        {/* ── Filter bar — search + dept dropdown ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} strokeWidth={1} absoluteStrokeWidth className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              id="pos-search" name="pos-search"
              type="text" placeholder="ชื่อตำแหน่ง, ชื่อแผนก"
              value={search} onChange={e => setSearch(e.target.value)}
              className={`${FIELD} pl-9`}
            />
          </div>
          {/* depts มาจาก unique departments ของ positions ที่โหลดมา */}
          <select
            value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className={`${FIELD} w-auto cursor-pointer`}
          >
            <option value="">ทุกแผนก</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* ── Results: loading → empty → table ── */}
        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-500">กำลังดึงข้อมูล...</div>
        ) : filtered.length === 0 ? (
          // Empty state — Section variant (13-section-header §4)
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-neutral-100 bg-white py-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-50 text-neutral-400">
              <Tag size={40} strokeWidth={1} absoluteStrokeWidth />
            </div>
            <p className="text-base font-bold text-neutral-900">ไม่พบตำแหน่งที่ตรงกัน</p>
            <p className="text-sm text-neutral-500">ลองปรับคำค้นหา หรือเพิ่ม position ใหม่ด้านบน</p>
          </div>
        ) : (
          // Table — Variant B Outline (17-table)
          <div className="overflow-hidden rounded-[14px] border border-neutral-100 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="px-4 py-3 text-[11px] font-bold text-neutral-500">ตำแหน่ง</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-neutral-500">Division</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-neutral-500">แผนก</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-neutral-500">Section</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-neutral-500">Location</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-neutral-500">สร้างโดย</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-neutral-500">วันที่</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-neutral-500">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(pos => (
                    <tr key={pos.id} className="border-b border-neutral-100 transition-colors last:border-0 hover:bg-neutral-50">
                      <td className="px-4 py-3.5 text-sm font-bold text-neutral-900">{pos.position}</td>
                      <td className="px-4 py-3.5 text-sm text-neutral-700">{pos.division || '—'}</td>
                      <td className="px-4 py-3.5 text-sm text-neutral-700">{pos.department}</td>
                      <td className="px-4 py-3.5 text-sm text-neutral-700">{pos.section || '—'}</td>
                      <td className="px-4 py-3.5">
                        {/* Location badge — light chip · dark-green family · no border */}
                        <span className="inline-flex items-center rounded-full bg-dark-green-50 px-2 py-0.5 text-xs font-bold text-dark-green-900">
                          {pos.orgTrack === 'OPERATION' ? 'Operation' : (pos.orgTrack || '—')}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-neutral-500">{pos.createdBy}</td>
                      {/* createdAt เป็น Firestore Timestamp — ต้องเรียก .toDate() ก่อน format */}
                      <td className="px-4 py-3.5 text-sm text-neutral-500">{pos.createdAt?.toDate?.().toLocaleDateString('th-TH') || '—'}</td>
                      <td className="px-4 py-3.5 text-right">
                        {/* ปุ่มลบ — ghost icon · neutral rest → red hover · spinner ขณะลบ */}
                        <button
                          onClick={() => setConfirmState({ isOpen: true, id: pos.id })}
                          disabled={deletingId === pos.id}
                          aria-label="ลบตำแหน่ง"
                          title="ลบตำแหน่ง"
                          className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          {deletingId === pos.id
                            ? <Loader2 size={16} strokeWidth={1} absoluteStrokeWidth className="animate-spin" />
                            : <Trash2 size={16} strokeWidth={1} absoluteStrokeWidth />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Footer แสดงจำนวน positions ที่ผ่าน filter */}
            <div className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500">
              {filtered.length} รายการ
            </div>
          </div>
        )}

        {/* Confirm modal — ยืนยันก่อนลบ position (shared component · ยังไม่ restyle ใน pilot นี้) */}
        <ConfirmModal
          isOpen={confirmState.isOpen}
          onClose={() => setConfirmState({ isOpen: false, id: '' })}
          onConfirm={async () => {
            await handleDelete(confirmState.id)
            setConfirmState({ isOpen: false, id: '' })
          }}
          title="ลบ Custom Position"
          message="ต้องการลบตำแหน่งนี้ออกจากระบบใช่หรือไม่?"
          confirmText="ลบ"
          variant="danger"
        />
      </div>
    </Layout>
  )
}
