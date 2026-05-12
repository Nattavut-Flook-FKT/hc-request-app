/**
 * NavBar.jsx — Top Navigation Bar (Legacy Component)
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  NOTE: Component นี้ถูกแทนที่ด้วย Sidebar.jsx แล้ว
 *     Layout.jsx ปัจจุบันใช้ Sidebar แทน NavBar นี้
 *     เก็บไว้ในโค้ดเผื่อต้องการ rollback หรือใช้เป็น reference
 *
 * NavBar แบบ Sticky top bar สำหรับระบบ HC Request
 * แสดงลิงก์ navigation ตาม role ของผู้ใช้
 *
 * Navigation Sets:
 *   MANAGER_NAV — ยื่นคำขอ + คำขอของฉัน (2 รายการ)
 *   TA_NAV      — Dashboard, All Requests, My Cases, JD Files, Audit Log (5 รายการ)
 *   ADMIN_NAV   — ทุกอย่างของ TA + Positions, จัดการผู้ใช้, Admin Tools, Import (9 รายการ)
 *
 * Features:
 *   - Active link highlighting (bg-[#008065] text-white)
 *   - Dark mode toggle (Sun/Moon icon)
 *   - User dropdown: แสดงชื่อ, role, ปุ่ม sign out
 *   - Profile picture (Google photo หรือ initials fallback)
 *
 * Props:
 *   user          {object}   Firebase user object
 *   role          {string}   'admin' | 'ta' | 'manager'
 *   isDarkMode    {boolean}  สถานะ dark mode ปัจจุบัน
 *   toggleDarkMode {function} callback toggle dark/light
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { useNavigate, useLocation } from 'react-router-dom'
import { auth } from '../../services/firebase'
import {
  LogOut, LayoutDashboard, FilePlus, List,
  Briefcase, FolderOpen, ClipboardList, ScrollText, ChevronDown,
  Moon, Sun, Users, Tag, DatabaseZap, Upload
} from 'lucide-react'

// ─── Nav items ตาม role ───────────────────────────────────────────────────────
const MANAGER_NAV = [
  { path: '/request',     label: 'ยื่นคำขอ',    icon: FilePlus },
  { path: '/my-requests', label: 'คำขอของฉัน',  icon: ClipboardList },
]
const TA_NAV = [
  { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { path: '/all-requests', label: 'All Requests', icon: List },
  { path: '/my-cases',     label: 'My Cases',     icon: Briefcase },
  { path: '/jd-files',    label: 'JD Files',     icon: FolderOpen },
  { path: '/audit-log',    label: 'Audit Log',    icon: ScrollText },
]
const ADMIN_NAV = [
  { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { path: '/all-requests', label: 'All Requests', icon: List },
  { path: '/my-cases',     label: 'My Cases',     icon: Briefcase },
  { path: '/request',      label: 'ยื่นคำขอ',    icon: FilePlus },
  { path: '/jd-files',    label: 'JD Files',     icon: FolderOpen },
  { path: '/audit-log',    label: 'Audit Log',    icon: ScrollText },
  { path: '/custom-positions', label: 'Positions',    icon: Tag },
  { path: '/users',            label: 'จัดการผู้ใช้', icon: Users },
  { path: '/admin-tools',      label: 'Admin Tools',  icon: DatabaseZap },
  { path: '/import',           label: 'Import Data',  icon: Upload },
]

const ROLE_LABEL = {
  admin:   'Administrator',
  ta:      'TA / People Experience',
  manager: 'Manager',
}

export default function NavBar({ user, role, isDarkMode, toggleDarkMode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    try { await signOut(auth) } catch (e) { console.error(e) }
  }

  const navItems = role === 'admin' ? ADMIN_NAV : role === 'ta' ? TA_NAV : MANAGER_NAV

  return (
    <nav className="bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-5 h-14 flex items-center justify-between sticky top-0 z-40 shadow-sm transition-colors">

      {/* Brand */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #008065, #00ce7c)' }}
        >
          <span className="text-white text-xs font-bold tracking-tight">HC</span>
        </div>
        <div className="leading-tight hidden sm:block">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">HC Request</p>
          <p className="text-xs text-gray-400 dark:text-slate-500 font-medium">People Experience · Freshket</p>
        </div>
      </div>

      {/* Nav */}
      <div className="flex items-center gap-0.5">
        {navItems.map((item) => {
          const active = pathname === item.path
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                active 
                  ? 'bg-[#008065] text-white shadow-md shadow-[#008065]/20' 
                  : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              <item.icon size={14} />
              <span className="hidden md:block">{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDarkMode ? <Sun size={18} className="text-yellow-400" /> : <Moon size={18} />}
        </button>

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            {user.photoURL
              ? <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full ring-2 ring-offset-1 ring-[#00ce7c]" referrerPolicy="no-referrer" />
              : <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold bg-[#008065]">{user.displayName?.[0]}</div>
            }
            <div className="hidden md:flex flex-col items-start leading-tight">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{user.displayName?.split(' ')[0]}</span>
              <span className="text-xs text-gray-400 dark:text-slate-500 font-medium">{ROLE_LABEL[role]}</span>
            </div>
            <ChevronDown size={13} className="text-gray-400 hidden md:block" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 dark:border-slate-800">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{user.displayName}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{user.email}</p>
                  <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full text-white bg-[#008065]">
                    {ROLE_LABEL[role]}
                  </span>
                </div>
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  <LogOut size={14} />
                  ออกจากระบบ
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
