/**
 * JDFilesPage.jsx — JD Files management page
 * ─────────────────────────────────────────────────────────────────────────────
 * Tab 1: JD Library — คลัง JD ที่ admin อัปโหลดตรง (Firestore: jd_library)
 * Tab 2: JD จาก HC Request — ไฟล์ JD ที่อัปโหลดผ่านฟอร์ม HC Request (Supabase Storage)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState, useRef } from 'react'
import {
  collection, getDocs, query, where, limit, doc, updateDoc, deleteDoc,
  addDoc, deleteField, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { FolderOpen, FileText, ExternalLink, Clock, Trash2, Pencil, Plus, X, ChevronDown } from 'lucide-react'
import { listJDFiles, getJDSignedUrl, deleteJDFile, uploadJDLibraryFile } from '../services/supabase'
import { fetchSheetsData, getPositionsByDepartment } from '../services/sheetsData'
import { DIVISIONS, getDepartments, getDivisionByDepartment } from '../data/orgStructure'
import Layout from '../components/Shared/Layout'
import ConfirmModal from '../components/Shared/ConfirmModal'

// ─── PositionCombobox ─────────────────────────────────────────────────────────
function PositionCombobox({ value, onChange, positions, required }) {
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)

  const filtered = positions.filter((p) =>
    p.toLowerCase().includes(searchText.toLowerCase())
  ).slice(0, 40)

  useEffect(() => {
    function handleClick(e) {
      if (!wrapperRef.current?.contains(e.target)) {
        setOpen(false)
        setIsFocused(false)
        setSearchText('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSelect(pos) {
    onChange(pos)
    setSearchText('')
    setOpen(false)
    setIsFocused(false)
  }

  function handleInputChange(e) {
    setSearchText(e.target.value)
    onChange(e.target.value)
    setOpen(true)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          required={required}
          value={isFocused ? searchText : value}
          placeholder={value || 'เช่น Software Engineer'}
          onFocus={() => {
            setIsFocused(true)
            setSearchText(value)
            setOpen(true)
          }}
          onChange={handleInputChange}
          onBlur={() => {
            if (!open) { setIsFocused(false); setSearchText('') }
          }}
          className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-medium"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setOpen((v) => !v); inputRef.current?.focus() }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl text-sm">
          {filtered.map((pos) => (
            <li
              key={pos}
              onMouseDown={() => handleSelect(pos)}
              className={`px-4 py-2 cursor-pointer font-medium hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors ${pos === value ? 'text-emerald-600 font-bold' : 'text-gray-700 dark:text-gray-200'}`}
            >
              {pos}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── AddLibraryModal ──────────────────────────────────────────────────────────
function AddLibraryModal({ isOpen, onClose, onSaved, user, positionsByDept }) {
  const [division, setDivision] = useState('')
  const [department, setDepartment] = useState('')
  const [position, setPosition] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const deptOptions = getDepartments(division)
  const positionOptions = getPositionsByDepartment(positionsByDept, department)

  function reset() {
    setDivision('')
    setDepartment('')
    setPosition('')
    setFile(null)
    setError('')
    setSaving(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) { setError('กรุณาแนบไฟล์ PDF'); return }
    setSaving(true)
    setError('')
    try {
      const normalized = position.trim().toLowerCase()

      // ตรวจว่ามี JD ของตำแหน่งนี้อยู่แล้วหรือไม่
      const existing = await getDocs(
        query(collection(db, 'jd_library'), where('normalizedPosition', '==', normalized), limit(1))
      )

      if (!existing.empty) {
        // ── UPDATE: ลบไฟล์เก่าแล้วอัพโหลดใหม่ทับ ──
        const existingDoc = existing.docs[0]
        const existingData = existingDoc.data()

        // ลบไฟล์เก่าจาก Supabase (ถ้ามี)
        if (existingData.filePath) {
          await deleteJDFile(existingData.filePath).catch(() => {})
        }

        // อัพโหลดไฟล์ใหม่โดยใช้ docId เดิม
        const { path, error: uploadErr } = await uploadJDLibraryFile(file, existingDoc.id)
        if (uploadErr) throw new Error(uploadErr)

        // อัพเดต Firestore doc
        await updateDoc(doc(db, 'jd_library', existingDoc.id), {
          position: position.trim(),
          department: department.trim(),
          division: division.trim(),
          normalizedPosition: normalized,
          fileName: file.name,
          filePath: path,
          updatedAt: serverTimestamp(),
        })

        onSaved({
          id: existingDoc.id,
          position: position.trim(),
          department: department.trim(),
          division: division.trim(),
          normalizedPosition: normalized,
          fileName: file.name,
          filePath: path,
          uploadedBy: existingData.uploadedBy,
          createdAt: existingData.createdAt,
        })
      } else {
        // ── CREATE: สร้าง doc ใหม่ ──
        const docRef = await addDoc(collection(db, 'jd_library'), {
          position: position.trim(),
          department: department.trim(),
          division: division.trim(),
          normalizedPosition: normalized,
          uploadedBy: user.email,
          createdAt: serverTimestamp(),
        })

        const { path, error: uploadErr } = await uploadJDLibraryFile(file, docRef.id)
        if (uploadErr) throw new Error(uploadErr)

        await updateDoc(doc(db, 'jd_library', docRef.id), {
          fileName: file.name,
          filePath: path,
          updatedAt: serverTimestamp(),
        })

        onSaved({
          id: docRef.id,
          position: position.trim(),
          department: department.trim(),
          division: division.trim(),
          normalizedPosition: normalized,
          fileName: file.name,
          filePath: path,
          uploadedBy: user.email,
        })
      }

      handleClose()
    } catch (err) {
      console.error('[AddLibraryModal]', err)
      setError(err.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-base font-black text-gray-800 dark:text-gray-100 tracking-tight">เพิ่ม JD เข้า Library</h2>
          <button type="button" onClick={handleClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest mb-1.5">Division *</label>
            <select
              value={division}
              onChange={(e) => { setDivision(e.target.value); setDepartment(''); setPosition('') }}
              required
              className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
            >
              <option value="">เลือก Division</option>
              {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest mb-1.5">แผนก *</label>
            <select
              value={department}
              onChange={(e) => { setDepartment(e.target.value); setPosition('') }}
              required
              disabled={!division}
              className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold disabled:opacity-50"
            >
              <option value="">เลือกแผนก</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest mb-1.5">ตำแหน่งงาน *</label>
            <PositionCombobox
              value={position}
              onChange={setPosition}
              positions={positionOptions}
              required
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest mb-1.5">ไฟล์ JD (PDF) *</label>
            {file ? (
              <div className="flex items-center gap-3 border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 rounded-2xl px-4 py-3 animate-in zoom-in-95">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 shrink-0">
                  <FileText size={18} strokeWidth={3} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 truncate">{file.name}</p>
                  <p className="text-[10px] font-black text-emerald-600/60 uppercase">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button type="button" onClick={() => setFile(null)} className="p-1.5 text-emerald-400 hover:text-red-500 transition-colors">
                  <X size={16} strokeWidth={3} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl px-6 py-6 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/5 transition-all group">
                <div className="w-10 h-10 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center text-gray-400 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                  <FileText size={18} strokeWidth={2.5} />
                </div>
                <p className="text-sm font-bold text-gray-500 dark:text-slate-400">คลิกเพื่อเลือกไฟล์ PDF</p>
                <p className="text-[10px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest">PDF เท่านั้น, ไม่เกิน 10MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          {error && (
            <p className="text-sm font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-slate-800 text-sm font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black hover:bg-emerald-700 transition-colors disabled:opacity-60 shadow-lg shadow-emerald-500/20"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── EditLibraryModal ─────────────────────────────────────────────────────────
function EditLibraryModal({ isOpen, item, onClose, onSaved, positionsByDept }) {
  const [division, setDivision] = useState('')
  const [department, setDepartment] = useState('')
  const [position, setPosition] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const deptOptions = getDepartments(division)
  const positionOptions = getPositionsByDepartment(positionsByDept, department)

  useEffect(() => {
    if (item) {
      const dept = item.department || ''
      const div = item.division || getDivisionByDepartment(dept) || ''
      setDivision(div)
      setDepartment(dept)
      setPosition(item.position || '')
      setError('')
    }
  }, [item])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateDoc(doc(db, 'jd_library', item.id), {
        position: position.trim(),
        department: department.trim(),
        division: division.trim(),
        normalizedPosition: position.trim().toLowerCase(),
        updatedAt: serverTimestamp(),
      })
      onSaved({ ...item, position: position.trim(), department: department.trim(), division: division.trim(), normalizedPosition: position.trim().toLowerCase() })
      onClose()
    } catch (err) {
      console.error('[EditLibraryModal]', err)
      setError(err.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !item) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-base font-black text-gray-800 dark:text-gray-100 tracking-tight">แก้ไข JD Library</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest mb-1.5">Division *</label>
            <select
              value={division}
              onChange={(e) => { setDivision(e.target.value); setDepartment(''); setPosition('') }}
              required
              className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold"
            >
              <option value="">เลือก Division</option>
              {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest mb-1.5">แผนก *</label>
            <select
              value={department}
              onChange={(e) => { setDepartment(e.target.value); setPosition('') }}
              required
              disabled={!division}
              className="w-full border border-gray-300 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white dark:bg-slate-900 dark:text-gray-100 transition-all font-bold disabled:opacity-50"
            >
              <option value="">เลือกแผนก</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 dark:text-slate-500 tracking-widest mb-1.5">ตำแหน่งงาน *</label>
            <PositionCombobox
              value={position}
              onChange={setPosition}
              positions={positionOptions}
              required
            />
          </div>

          {error && (
            <p className="text-sm font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-slate-800 text-sm font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black hover:bg-emerald-700 transition-colors disabled:opacity-60 shadow-lg shadow-emerald-500/20"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function JDFilesPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [activeTab, setActiveTab] = useState('library') // 'library' | 'requests'

  // ── Tab 1: JD Library state ──
  const [libraryItems, setLibraryItems] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [deleteLibraryState, setDeleteLibraryState] = useState({ isOpen: false, item: null })
  const [deletingLibraryId, setDeletingLibraryId] = useState('')

  // ── Tab 2: JD from HC Request state ──
  const [files, setFiles] = useState([])
  const [requestMap, setRequestMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [deletingPath, setDeletingPath] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [confirmState, setConfirmState] = useState({ isOpen: false, file: null })

  // ── positionsByDept map for cascading combobox ──
  const [positionsByDept, setPositionsByDept] = useState({})

  // ── Load positions from Sheets ──
  useEffect(() => {
    fetchSheetsData()
      .then(({ positions: pos }) => {
        if (pos && typeof pos === 'object') setPositionsByDept(pos)
      })
      .catch(() => {})
  }, [])

  // ── Load JD Library (Tab 1) ──
  useEffect(() => {
    let cancelled = false
    async function loadLibrary() {
      try {
        const snap = await getDocs(query(collection(db, 'jd_library')))
        if (cancelled) return
        setLibraryItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      } catch (e) {
        console.error('[JDFilesPage] Error fetching jd_library:', e)
      } finally {
        if (!cancelled) setLibraryLoading(false)
      }
    }
    loadLibrary()
    return () => { cancelled = true }
  }, [])

  // ── Load JD from HC Requests (Tab 2) ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await listJDFiles()
      if (cancelled) return
      try {
        // ดึงเฉพาะ requests ที่มี jdFilePath — ไม่ดึงทั้ง collection
        const qReq = query(
          collection(db, 'hc_requests'),
          where('jdFilePath', '!=', ''),
          limit(500),
        )
        const snap = await getDocs(qReq)
        if (cancelled) return
        const map = {}
        snap.forEach(d => {
          const data = d.data()
          map[d.id] = data
          if (data.jdFilePath) {
            const folder = data.jdFilePath.split('/')[0]
            map[folder] = data
          }
        })
        setRequestMap(map)
      } catch (e) {
        console.error('[JDFilesPage] Error fetching request map:', e)
      }
      if (!cancelled) {
        setFiles(data)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Open file via signed URL ──
  async function handleOpen(path) {
    const url = await getJDSignedUrl(path)
    if (url) window.open(url, '_blank')
  }

  // ── Delete from HC Request files (Tab 2) ──
  async function handleDeleteFile(file) {
    if (!file?.path) return
    setDeletingPath(file.path)
    try {
      await deleteJDFile(file.path)
      if (file.folder && !file.folder.startsWith('tmp_')) {
        try {
          await updateDoc(doc(db, 'hc_requests', file.folder), {
            jdFilePath: deleteField(),
            jdFileUrl: deleteField(),
            jdFileName: deleteField(),
          })
        } catch (e) {
          console.error('[JDFilesPage] Could not clear Firestore ref:', e)
        }
      }
      setFiles((prev) => prev.filter((f) => f.path !== file.path))
    } catch (e) {
      console.error('[JDFilesPage] Delete error:', e)
      setDeleteError('ลบไฟล์ไม่สำเร็จ กรุณาลองใหม่')
      setTimeout(() => setDeleteError(''), 4000)
    } finally {
      setDeletingPath('')
    }
  }

  // ── Delete from JD Library (Tab 1) ──
  async function handleDeleteLibraryItem(item) {
    if (!item) return
    setDeletingLibraryId(item.id)
    try {
      if (item.filePath) await deleteJDFile(item.filePath)
      await deleteDoc(doc(db, 'jd_library', item.id))
      setLibraryItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch (e) {
      console.error('[JDFilesPage] Delete library item error:', e)
    } finally {
      setDeletingLibraryId('')
    }
  }

  function formatSize(bytes) {
    if (!bytes) return '—'
    const mb = bytes / (1024 * 1024)
    return mb < 0.1 ? `${(bytes / 1024).toFixed(1)} KB` : `${mb.toFixed(2)} MB`
  }

  const isAdmin = role === 'admin'

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">

        {/* ── Page Header ── */}
        <div className="animate-in fade-in slide-in-from-left-4 duration-500 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight">JD Files</h1>
            <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 mt-0.5 uppercase tracking-widest">คลังข้อมูล Job Description ที่อัปโหลดเข้าระบบ</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-600 text-white text-sm font-black hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20"
            >
              <Plus size={16} strokeWidth={3} />
              เพิ่ม JD
            </button>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-gray-100 dark:bg-slate-800/60 p-1 rounded-2xl w-fit">
          {[
            { id: 'library', label: 'JD Library' },
            { id: 'requests', label: 'JD จาก HC Request' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 rounded-xl text-sm font-black transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-900 text-gray-800 dark:text-gray-100 shadow-sm'
                  : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab 1: JD Library ── */}
        {activeTab === 'library' && (
          <>
            {libraryLoading ? (
              <div className="text-center py-20 text-gray-400 animate-pulse">กำลังดึงข้อมูล...</div>
            ) : libraryItems.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-gray-100 dark:border-slate-800 p-24 flex flex-col items-center gap-6 text-center shadow-xl shadow-emerald-900/5 transition-all group">
                <div className="w-24 h-24 rounded-[2rem] bg-emerald-50 dark:bg-emerald-500/5 flex items-center justify-center text-emerald-600 dark:text-emerald-500 transition-transform group-hover:scale-110 duration-500">
                  <FolderOpen size={48} strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight">ยังไม่มี JD ใน Library</p>
                  <p className="text-xs font-bold text-gray-400 dark:text-slate-500 mt-2 uppercase tracking-widest">กด "เพิ่ม JD" เพื่อเริ่มต้นสร้างคลัง JD</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {libraryItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => item.filePath && handleOpen(item.filePath)}
                    className="group relative bg-white dark:bg-slate-900 p-5 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-emerald-900/5 transition-all cursor-pointer overflow-hidden"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0 group-hover:scale-110 transition-transform">
                        <FileText size={24} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest mb-1 truncate">
                          {item.position || '—'}
                        </p>
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate mb-1">
                          {item.fileName || 'ไฟล์ JD'}
                        </p>
                        {item.department && (
                          <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 truncate mb-1">
                            {item.department}
                          </p>
                        )}
                        {item.createdAt && (
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            <Clock size={12} className="shrink-0" />
                            {item.createdAt?.toDate?.().toLocaleDateString('th-TH') || '—'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Admin action buttons on hover */}
                    {isAdmin && (
                      <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditItem(item)
                          }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                          title="แก้ไข"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteLibraryState({ isOpen: true, item })
                          }}
                          disabled={deletingLibraryId === item.id}
                          className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                          title="ลบ"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Tab 2: JD จาก HC Request ── */}
        {activeTab === 'requests' && (
          <>
            {deleteError && (
              <div className="flex items-center gap-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl px-5 py-3 text-sm font-bold animate-in fade-in slide-in-from-top-2">
                {deleteError}
              </div>
            )}

            {loading ? (
              <div className="text-center py-20 text-gray-400 animate-pulse">กำลังดึงข้อมูลไฟล์...</div>
            ) : files.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-gray-100 dark:border-slate-800 p-24 flex flex-col items-center gap-6 text-center shadow-xl shadow-emerald-900/5 transition-all group">
                <div className="w-24 h-24 rounded-[2rem] bg-emerald-50 dark:bg-emerald-500/5 flex items-center justify-center text-emerald-600 dark:text-emerald-500 transition-transform group-hover:scale-110 duration-500">
                  <FolderOpen size={48} strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight">คลังไฟล์ JD ยังว่างอยู่</p>
                  <p className="text-xs font-bold text-gray-400 dark:text-slate-500 mt-2 uppercase tracking-widest">ยังไม่มีการอัปโหลดไฟล์ JD เข้าระบบในขณะนี้</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {files.filter((file) => {
                  // กรองไฟล์ที่เป็น JD Library ออก (path ตรงกับ filePath ใน libraryItems)
                  const libraryPaths = new Set(libraryItems.map((i) => i.filePath).filter(Boolean))
                  return !libraryPaths.has(file.path)
                }).map((file) => {
                  const req = requestMap[file.folder]
                  // ใช้ jdFileName จาก Firestore (ชื่อไฟล์จริงก่อน sanitize) ถ้ามี
                  const displayName = req?.jdFileName || (file.name.includes('_')
                    ? file.name.split('_').slice(1).join('_')
                    : file.name)
                  return (
                    <div
                      key={file.path}
                      onClick={() => handleOpen(file.path)}
                      className="group relative bg-white dark:bg-slate-900 p-5 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-emerald-900/5 transition-all cursor-pointer overflow-hidden"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0 group-hover:scale-110 transition-transform">
                          <FileText size={24} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest mb-1 truncate">
                            {req ? `${req.position} (${req.department})` : file.folder.slice(0, 8).toUpperCase()}
                          </p>
                          <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate mb-2">
                            {displayName}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                              <Clock size={12} className="shrink-0" />
                              {new Date(file.created_at).toLocaleDateString('th-TH')}
                            </div>
                            <div className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">
                              {formatSize(file.metadata?.size)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ExternalLink size={16} className="text-gray-300" />
                        {role === 'admin' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmState({ isOpen: true, file })
                            }}
                            disabled={deletingPath === file.path}
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                            title="ลบไฟล์ JD"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      <AddLibraryModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={(newItem) => setLibraryItems((prev) => [newItem, ...prev])}
        user={user}
        positionsByDept={positionsByDept}
      />

      <EditLibraryModal
        isOpen={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={(updated) => {
          setLibraryItems((prev) => prev.map((i) => i.id === updated.id ? updated : i))
          setEditItem(null)
        }}
        positionsByDept={positionsByDept}
      />

      <ConfirmModal
        isOpen={deleteLibraryState.isOpen}
        onClose={() => setDeleteLibraryState({ isOpen: false, item: null })}
        onConfirm={async () => {
          await handleDeleteLibraryItem(deleteLibraryState.item)
          setDeleteLibraryState({ isOpen: false, item: null })
        }}
        title="ลบ JD ออกจาก Library"
        message={deleteLibraryState.item ? `ต้องการลบ JD "${deleteLibraryState.item.position}" ใช่หรือไม่?` : ''}
        confirmText="ลบ"
        variant="danger"
      />

      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState({ isOpen: false, file: null })}
        onConfirm={async () => {
          await handleDeleteFile(confirmState.file)
          setConfirmState({ isOpen: false, file: null })
        }}
        title="ลบไฟล์ JD ออกจากระบบ"
        message={confirmState.file ? `ต้องการลบไฟล์ ${confirmState.file.name} ใช่หรือไม่?` : ''}
        confirmText="ลบไฟล์"
        variant="danger"
      />
    </Layout>
  )
}
