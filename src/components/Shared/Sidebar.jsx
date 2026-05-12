/**
 * Sidebar.jsx — Left Navigation Sidebar
 * ─────────────────────────────────────────────────────────────────────────────
 * แถบ navigation ซ้ายมือ แบบ Linear / Notion
 *
 * ลักษณะ:
 *   - Expanded (220px): แสดง icon + label
 *   - Collapsed (56px): แสดงเฉพาะ icon พร้อม tooltip title
 *   - สถานะ collapsed เก็บใน localStorage ('sidebarCollapsed')
 *   - Sticky top-0 h-screen ทำให้ sidebar อยู่กับที่ขณะ scroll
 *
 * Navigation groups ตาม role:
 *   manager  → 1 กลุ่ม (ยื่นคำขอ, คำขอของฉัน)
 *   ta       → 2 กลุ่ม (Main | Files)
 *   admin    → 3 กลุ่ม (Main | Recruit tools | Admin tools)
 *
 * Props:
 *   user           {object}  Firebase Auth user object
 *   role           {string}  'admin' | 'ta' | 'manager'
 *   isDarkMode     {boolean} สถานะ dark mode
 *   toggleDarkMode {fn}      toggle dark/light mode
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { useNavigate, useLocation } from 'react-router-dom'
import { auth } from '../../services/firebase'
import {
  LogOut, LayoutDashboard, FilePlus, List,
  Briefcase, FolderOpen, ClipboardList, ScrollText,
  Moon, Sun, Users, Tag, DatabaseZap, Upload,
  ChevronLeft, ChevronRight,
} from 'lucide-react'

// ── Nav item definitions แต่ละ role ──────────────────────────────
// แต่ละ group คือ array ของ nav items — null ระหว่าง group = เส้นคั่น

const MANAGER_GROUPS = [
  [
    { path: '/request',     label: 'ยื่นคำขอ',   icon: FilePlus },
    { path: '/my-requests', label: 'คำขอของฉัน', icon: ClipboardList },
  ],
]

const TA_GROUPS = [
  [
    { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
    { path: '/all-requests', label: 'All Requests', icon: List },
    { path: '/my-cases',     label: 'My Cases',     icon: Briefcase },
  ],
  [
    { path: '/jd-files',  label: 'JD Files',  icon: FolderOpen },
    { path: '/audit-log', label: 'Audit Log', icon: ScrollText },
  ],
]

const ADMIN_GROUPS = [
  // กลุ่ม 1: หน้าหลัก
  [
    { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
    { path: '/all-requests', label: 'All Requests', icon: List },
    { path: '/my-cases',     label: 'My Cases',     icon: Briefcase },
  ],
  // กลุ่ม 2: เครื่องมือ Recruit
  [
    { path: '/request',   label: 'ยื่นคำขอ',  icon: FilePlus },
    { path: '/jd-files',  label: 'JD Files',  icon: FolderOpen },
    { path: '/audit-log', label: 'Audit Log', icon: ScrollText },
  ],
  // กลุ่ม 3: Admin tools (เข้าถึงได้เฉพาะ admin)
  [
    { path: '/custom-positions', label: 'Positions',    icon: Tag },
    { path: '/users',            label: 'Users',        icon: Users },
    { path: '/admin-tools',      label: 'Admin Tools',  icon: DatabaseZap },
    { path: '/import',           label: 'Import Data',  icon: Upload },
  ],
]

// Label แสดงใต้ชื่อ user ใน sidebar
const ROLE_LABEL = {
  admin:   'Administrator',
  ta:      'TA · People Exp.',
  manager: 'Manager',
}

// ขนาด sidebar (px)
const EXPANDED_W  = 220
const COLLAPSED_W = 56

// ════════════════════════════════════════════════════════════════
export default function Sidebar({ user, role, isDarkMode, toggleDarkMode }) {
  // อ่านสถานะ collapsed จาก localStorage เพื่อ persist ระหว่าง refresh
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  )
  const navigate     = useNavigate()
  const { pathname } = useLocation()

  /** Toggle collapsed ← → expanded และบันทึกลง localStorage */
  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebarCollapsed', String(next))
  }

  async function handleSignOut() {
    try { await signOut(auth) } catch (e) { console.error(e) }
  }

  // เลือก nav groups ตาม role
  const groups =
    role === 'admin' ? ADMIN_GROUPS :
    role === 'ta'    ? TA_GROUPS    :
    MANAGER_GROUPS

  return (
    <aside
      className="h-screen sticky top-0 flex flex-col bg-white dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800 shrink-0 overflow-hidden transition-[width] duration-200 ease-out z-30"
      style={{ width: collapsed ? COLLAPSED_W : EXPANDED_W }}
    >
      {/* ── Brand / Logo ─────────────────────────────────────── */}
      <div className={`flex items-center gap-2.5 h-14 border-b border-gray-100 dark:border-slate-800 shrink-0 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
          style={{ background: 'linear-gradient(135deg, #008065 0%, #00ce7c 100%)' }}
        >
          <span className="text-white text-xs font-black tracking-tight">HC</span>
        </div>
        {/* แสดงชื่อแอปเฉพาะตอน expanded */}
        {!collapsed && (
          <div className="leading-tight overflow-hidden">
            <p className="text-sm font-black text-gray-800 dark:text-gray-100 whitespace-nowrap">HC Request</p>
            <p className="text-[10px] text-gray-400 dark:text-slate-500 font-medium whitespace-nowrap">People Experience</p>
          </div>
        )}
      </div>

      {/* ── Nav groups ────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {groups.map((group, gi) => (
          <div key={gi}>
            {/* เส้นคั่นระหว่าง group */}
            {gi > 0 && (
              <div className={`my-2 border-t border-gray-100 dark:border-slate-800 ${collapsed ? 'mx-2' : 'mx-1'}`} />
            )}

            {group.map((item) => {
              const active = pathname === item.path
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  // เมื่อ collapsed ให้ใช้ native tooltip แทน label
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-2.5 rounded-lg transition-all text-sm font-medium ${
                    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
                  } ${
                    active
                      ? 'bg-[#008065] text-white shadow-sm shadow-[#008065]/20'
                      : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  <item.icon size={15} className="shrink-0" />
                  {/*숨겨진 label เมื่อ collapsed */}
                  {!collapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── Bottom section: dark mode + collapse toggle + user profile ── */}
      <div className="shrink-0 border-t border-gray-100 dark:border-slate-800">

        {/* Dark mode toggle + collapse button */}
        <div className={`flex items-center py-2 px-2 gap-1 ${collapsed ? 'flex-col' : ''}`}>
          <button
            onClick={toggleDarkMode}
            title={isDarkMode ? 'เปลี่ยนเป็น Light mode' : 'เปลี่ยนเป็น Dark mode'}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            {isDarkMode
              ? <Sun size={15} className="text-yellow-400" />
              : <Moon size={15} />
            }
          </button>

          {/* spacer เฉพาะตอน expanded */}
          {!collapsed && <div className="flex-1" />}

          {/* ปุ่มย่อ/ขยาย sidebar */}
          <button
            onClick={toggle}
            title={collapsed ? 'ขยาย sidebar' : 'ย่อ sidebar'}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {/* User profile: รูปโปรไฟล์ + ชื่อ + role + ปุ่ม sign out */}
        <div className={`flex items-center gap-2.5 px-2 py-3 ${collapsed ? 'justify-center' : ''}`}>
          {user.photoURL
            ? <img
                src={user.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full ring-2 ring-[#008065]/30 shrink-0"
              />
            : <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-black bg-[#008065] shrink-0">
                {user.displayName?.[0]}
              </div>
          }

          {/* ชื่อ + role — แสดงเฉพาะตอน expanded */}
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">
                {user.displayName?.split(' ')[0]}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-slate-500 truncate">
                {ROLE_LABEL[role]}
              </p>
            </div>
          )}

          {/* ปุ่ม Sign out — แสดงเฉพาะตอน expanded */}
          {!collapsed && (
            <button
              onClick={handleSignOut}
              title="ออกจากระบบ"
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0"
            >
              <LogOut size={14} />
            </button>
          )}

          {/* sr-only placeholder เพื่อให้ sign out ยังใช้ได้ตอน collapsed (ผ่าน title) */}
          {collapsed && (
            <button onClick={handleSignOut} title="ออกจากระบบ" className="sr-only" />
          )}
        </div>
      </div>
    </aside>
  )
}
