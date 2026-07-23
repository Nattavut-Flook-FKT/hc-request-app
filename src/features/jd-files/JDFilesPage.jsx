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
import { db } from '@/libs/firebase'
import { FolderOpen, FileText, ExternalLink, Clock, Trash2, Pencil, Plus, X, ChevronDown } from 'lucide-react'
import { listJDFiles, getJDSignedUrl, deleteJDFile, uploadJDLibraryFile } from '@/libs/supabase'
import { fetchSheetsData, getPositionsByDepartment } from '@/libs/sheetsData'
import { DIVISIONS, getDepartments, getDivisionByDepartment } from '@/config/orgStructure'
import Layout from '@/components/app-shell/Layout'
import ConfirmModal from '@/components/ui/ConfirmModal'

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
          className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 pr-9 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setOpen((v) => !v); inputRef.current?.focus() }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
        >
          <ChevronDown size={14} strokeWidth={1} absoluteStrokeWidth />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-neutral-100 bg-white text-sm shadow-xl">
          {filtered.map((pos) => (
            <li
              key={pos}
              onMouseDown={() => handleSelect(pos)}
              className={`cursor-pointer px-4 py-2 transition-colors hover:bg-dark-green-50 hover:text-dark-green-700 ${pos === value ? 'font-bold text-dark-green-700' : 'text-neutral-700'}`}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4">
      <div className="w-full max-w-md rounded-[24px] border border-neutral-100 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-5">
          <h2 className="text-base font-bold text-neutral-900">เพิ่ม JD เข้า Library</h2>
          <button type="button" onClick={handleClose} className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600">
            <X size={16} strokeWidth={1} absoluteStrokeWidth />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
          <div>
            <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">Division *</label>
            <select
              value={division}
              onChange={(e) => { setDivision(e.target.value); setDepartment(''); setPosition('') }}
              required
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            >
              <option value="">เลือก Division</option>
              {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">แผนก *</label>
            <select
              value={department}
              onChange={(e) => { setDepartment(e.target.value); setPosition('') }}
              required
              disabled={!division}
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none disabled:opacity-50"
            >
              <option value="">เลือกแผนก</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">ตำแหน่งงาน *</label>
            <PositionCombobox
              value={position}
              onChange={setPosition}
              positions={positionOptions}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">ไฟล์ JD (PDF) *</label>
            {file ? (
              <div className="flex items-center gap-3 rounded-2xl border border-dark-green-100 bg-dark-green-50 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-dark-green-100 text-dark-green-700">
                  <FileText size={18} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-dark-green-800">{file.name}</p>
                  <p className="text-[11px] font-bold text-dark-green-600">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button type="button" onClick={() => setFile(null)} className="p-1.5 text-dark-green-400 transition-colors hover:text-red-600">
                  <X size={16} strokeWidth={1} absoluteStrokeWidth />
                </button>
              </div>
            ) : (
              <label className="group flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-neutral-100 px-6 py-6 transition-colors hover:border-dark-green-600 hover:bg-dark-green-50">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-50 text-neutral-400 transition-colors group-hover:bg-dark-green-600 group-hover:text-neutral-50">
                  <FileText size={18} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <p className="text-sm font-bold text-neutral-500">คลิกเพื่อเลือกไฟล์ PDF</p>
                <p className="text-[11px] font-bold text-neutral-400">PDF เท่านั้น, ไม่เกิน 10MB</p>
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
            <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-lg border border-neutral-100 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-dark-green-600 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-60"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4">
      <div className="w-full max-w-md rounded-[24px] border border-neutral-100 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-5">
          <h2 className="text-base font-bold text-neutral-900">แก้ไข JD Library</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600">
            <X size={16} strokeWidth={1} absoluteStrokeWidth />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
          <div>
            <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">Division *</label>
            <select
              value={division}
              onChange={(e) => { setDivision(e.target.value); setDepartment(''); setPosition('') }}
              required
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
            >
              <option value="">เลือก Division</option>
              {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">แผนก *</label>
            <select
              value={department}
              onChange={(e) => { setDepartment(e.target.value); setPosition('') }}
              required
              disabled={!division}
              className="w-full rounded-lg border border-neutral-100 bg-white px-4 py-2.5 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none disabled:opacity-50"
            >
              <option value="">เลือกแผนก</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">ตำแหน่งงาน *</label>
            <PositionCombobox
              value={position}
              onChange={setPosition}
              positions={positionOptions}
              required
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-100 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-dark-green-600 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-60"
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
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">JD Files</h1>
            <p className="mt-0.5 text-[11px] font-bold text-neutral-400">คลังข้อมูล Job Description ที่อัปโหลดเข้าระบบ</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 rounded-lg bg-dark-green-600 px-4 py-2.5 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700"
            >
              <Plus size={16} strokeWidth={1} absoluteStrokeWidth />
              เพิ่ม JD
            </button>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="inline-flex w-fit items-center gap-0.5 rounded-full border border-neutral-100 p-0.5">
          {[
            { id: 'library', label: 'JD Library' },
            { id: 'requests', label: 'JD จาก HC Request' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-5 py-2 text-sm font-normal transition-colors ${
                activeTab === tab.id
                  ? 'bg-green-fresh-50 text-green-fresh-900'
                  : 'text-neutral-900 hover:bg-neutral-50'
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
              <div className="py-20 text-center text-neutral-400">กำลังดึงข้อมูล...</div>
            ) : libraryItems.length === 0 ? (
              <div className="flex flex-col items-center gap-6 rounded-[2.5rem] border border-neutral-100 bg-white p-24 text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-dark-green-50 text-dark-green-700">
                  <FolderOpen size={48} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <div>
                  <p className="text-lg font-bold text-neutral-900">ยังไม่มี JD ใน Library</p>
                  <p className="mt-2 text-xs font-bold text-neutral-400">กด "เพิ่ม JD" เพื่อเริ่มต้นสร้างคลัง JD</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {libraryItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => item.filePath && handleOpen(item.filePath)}
                    className="group relative cursor-pointer overflow-hidden rounded-3xl border border-neutral-100 bg-white p-5 transition-colors hover:border-dark-green-100"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-dark-green-50 text-dark-green-700">
                        <FileText size={24} strokeWidth={1} absoluteStrokeWidth />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 truncate text-[11px] font-bold text-dark-green-700">
                          {item.position || '—'}
                        </p>
                        <p className="mb-1 truncate text-sm font-bold text-neutral-900">
                          {item.fileName || 'ไฟล์ JD'}
                        </p>
                        {item.department && (
                          <p className="mb-1 truncate text-[11px] font-bold text-neutral-400">
                            {item.department}
                          </p>
                        )}
                        {item.createdAt && (
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                            <Clock size={12} strokeWidth={1} absoluteStrokeWidth className="shrink-0" />
                            {item.createdAt?.toDate?.().toLocaleDateString('th-TH') || '—'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Admin action buttons on hover */}
                    {isAdmin && (
                      <div className="absolute right-4 top-4 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditItem(item)
                          }}
                          className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-dark-green-50 hover:text-dark-green-700"
                          title="แก้ไข"
                        >
                          <Pencil size={14} strokeWidth={1} absoluteStrokeWidth />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteLibraryState({ isOpen: true, item })
                          }}
                          disabled={deletingLibraryId === item.id}
                          className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="ลบ"
                        >
                          <Trash2 size={14} strokeWidth={1} absoluteStrokeWidth />
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
              <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm font-bold text-red-700">
                {deleteError}
              </div>
            )}

            {loading ? (
              <div className="py-20 text-center text-neutral-400">กำลังดึงข้อมูลไฟล์...</div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center gap-6 rounded-[2.5rem] border border-neutral-100 bg-white p-24 text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-dark-green-50 text-dark-green-700">
                  <FolderOpen size={48} strokeWidth={1} absoluteStrokeWidth />
                </div>
                <div>
                  <p className="text-lg font-bold text-neutral-900">คลังไฟล์ JD ยังว่างอยู่</p>
                  <p className="mt-2 text-xs font-bold text-neutral-400">ยังไม่มีการอัปโหลดไฟล์ JD เข้าระบบในขณะนี้</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                      className="group relative cursor-pointer overflow-hidden rounded-3xl border border-neutral-100 bg-white p-5 transition-colors hover:border-dark-green-100"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-dark-green-50 text-dark-green-700">
                          <FileText size={24} strokeWidth={1} absoluteStrokeWidth />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="mb-1 truncate text-[11px] font-bold text-dark-green-700">
                            {req ? `${req.position} (${req.department})` : file.folder.slice(0, 8).toUpperCase()}
                          </p>
                          <p className="mb-2 truncate text-sm font-bold text-neutral-900">
                            {displayName}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                              <Clock size={12} strokeWidth={1} absoluteStrokeWidth className="shrink-0" />
                              {new Date(file.created_at).toLocaleDateString('th-TH')}
                            </div>
                            <div className="text-[11px] font-bold text-neutral-300">
                              {formatSize(file.metadata?.size)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="absolute right-4 top-4 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <ExternalLink size={16} strokeWidth={1} absoluteStrokeWidth className="text-neutral-300" />
                        {role === 'admin' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmState({ isOpen: true, file })
                            }}
                            disabled={deletingPath === file.path}
                            className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            title="ลบไฟล์ JD"
                          >
                            <Trash2 size={14} strokeWidth={1} absoluteStrokeWidth />
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
