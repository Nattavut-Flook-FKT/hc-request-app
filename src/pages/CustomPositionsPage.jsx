/**
 * CustomPositionsPage.jsx — Custom Positions Manager
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าจัดการตำแหน่งงาน (positions) ที่สร้างขึ้นเพิ่มเติมโดยผู้ใช้งาน
 * ข้อมูลถูกเก็บใน Firestore collection `custom_positions`
 * รองรับการเพิ่ม, ค้นหา, กรองตามแผนก และลบตำแหน่ง
 *
 * Props / Features:
 *   - user        — ข้อมูล user ที่ล็อกอิน (ใช้บันทึก createdBy เมื่อเพิ่ม position)
 *   - role        — บทบาทของ user (ส่งต่อไปยัง Layout)
 *   - isDarkMode  — สถานะ dark mode ปัจจุบัน
 *   - toggleDarkMode — ฟังก์ชันสลับ dark/light mode
 *   - ฟอร์มเพิ่ม position รองรับ department, orgTrack (HQ/OPERATION) และชื่อตำแหน่ง
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
import { Plus, Search, Tag, Trash2, Settings2 } from 'lucide-react'
import Layout from '../components/Shared/Layout'
import ConfirmModal from '../components/Shared/ConfirmModal'

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
  const [addForm, setAddForm] = useState({ department: '', orgTrack: 'HQ', position: '' })

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
        department: addForm.department.trim(),
        orgTrack: addForm.orgTrack,
        position: addForm.position.trim(),
        normalizedPosition: addForm.position.trim().toLowerCase(), // สำหรับ case-insensitive search
        createdBy: user.email,
        createdAt: serverTimestamp(),
      })
      // Prepend เข้า local state โดยใช้ new Date() แทน serverTimestamp ที่ยังไม่ resolve
      setPositions(prev => [{
        id: docRef.id,
        department: addForm.department.trim(),
        orgTrack: addForm.orgTrack,
        position: addForm.position.trim(),
        normalizedPosition: addForm.position.trim().toLowerCase(),
        createdBy: user.email,
        createdAt: new Date(),
      }, ...prev])
      setAddForm({ department: '', orgTrack: 'HQ', position: '' })
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
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight">Custom Positions</h1>
          <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 mt-0.5 uppercase tracking-widest">ตำแหน่งที่สร้างเพิ่มเติมโดยผู้ใช้งาน</p>
        </div>

        {/* แสดง error banner เมื่อมีข้อผิดพลาด */}
        {pageError && (
          <div className="flex items-center gap-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl px-5 py-3 text-sm font-bold animate-in fade-in slide-in-from-top-2">
            {pageError}
          </div>
        )}

        {/* Add form */}
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-6 rounded-3xl shadow-xl shadow-gray-200/40 dark:shadow-none">
          <h2 className="text-sm font-black text-[#008065] dark:text-emerald-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Plus size={16} /> เพิ่ม Position ใหม่
          </h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              id="pos-department" name="pos-department"
              type="text" placeholder="ชื่อแผนก"
              value={addForm.department} onChange={e => setAddForm(f => ({ ...f, department: e.target.value }))}
              className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            {/* orgTrack กำหนดว่าตำแหน่งนี้อยู่ในสายงาน HQ หรือ OPERATION */}
            <select
              value={addForm.orgTrack} onChange={e => setAddForm(f => ({ ...f, orgTrack: e.target.value }))}
              className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="HQ">HQ</option>
              <option value="OPERATION">OPERATION</option>
            </select>
            <input
              id="pos-position" name="pos-position"
              type="text" placeholder="ชื่อตำแหน่ง" required
              value={addForm.position} onChange={e => setAddForm(f => ({ ...f, position: e.target.value }))}
              className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <button
              type="submit" disabled={isAdding}
              className="bg-[#008065] text-white font-bold rounded-xl py-2 shadow-lg shadow-emerald-500/20 transition-all hover:bg-[#006651] disabled:opacity-50"
            >
              เพิ่ม
            </button>
          </form>
        </div>

        {/* Filters — search text และ dropdown กรองแผนก */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              id="pos-search" name="pos-search"
              type="text" placeholder="ค้นหา position หรือ แผนก..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          {/* depts มาจาก unique departments ของ positions ที่โหลดมา */}
          <select
            value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">ทุกแผนก</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* ผลลัพธ์: loading state → empty state → ตาราง positions */}
        {loading ? (
          <div className="text-center py-20 text-gray-400 animate-pulse">กำลังดึงข้อมูล...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-20 flex flex-col items-center gap-4 text-center shadow-xl shadow-gray-200/40 dark:shadow-none">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/5 flex items-center justify-center text-emerald-500"><Tag size={32} /></div>
            <p className="text-sm font-bold text-gray-500 dark:text-slate-400">ไม่พบตำแหน่งที่ตรงกัน</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl shadow-xl shadow-gray-200/40 dark:shadow-none overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#fcfdfd] dark:bg-slate-800/30 border-b border-gray-50 dark:border-slate-800/50">
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">ตำแหน่ง</th>
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">แผนก</th>
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Location</th>
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">สร้างโดย</th>
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">วันที่</th>
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                  {filtered.map(pos => (
                    <tr key={pos.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/20 transition-colors">
                      <td className="px-6 py-4 text-sm font-bold text-gray-800 dark:text-gray-100">{pos.position}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-slate-400">{pos.department}</td>
                      <td className="px-6 py-4">
                        {/* orgTrack badge — สี emerald สำหรับทั้ง HQ และ OPERATION */}
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 uppercase">{pos.orgTrack || '—'}</span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400 dark:text-slate-500">{pos.createdBy}</td>
                      {/* createdAt เป็น Firestore Timestamp — ต้องเรียก .toDate() ก่อน format */}
                      <td className="px-6 py-4 text-xs text-gray-400 dark:text-slate-500">{pos.createdAt?.toDate?.().toLocaleDateString('th-TH') || '—'}</td>
                      <td className="px-6 py-4 text-right">
                        {/* ปุ่มลบ — แสดง spinner ขณะกำลัง delete document นี้ */}
                        <button
                          onClick={() => setConfirmState({ isOpen: true, id: pos.id })}
                          disabled={deletingId === pos.id}
                          className="p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                        >
                          {deletingId === pos.id ? <Settings2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Footer แสดงจำนวน positions ที่ผ่าน filter */}
            <div className="px-6 py-3 border-t border-gray-50 dark:border-slate-800/50 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              {filtered.length} รายการ
            </div>
          </div>
        )}

        {/* Confirm modal — ยืนยันก่อนลบ position */}
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
