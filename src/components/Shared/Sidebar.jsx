/**
 * Sidebar.jsx — Left Navigation Sidebar
 * ─────────────────────────────────────────────────────────────────────────────
 * แถบ navigation ซ้ายมือ — FKT Design System v1.0 (18-navigation §13)
 *
 * ลักษณะ:
 *   - Full (240px): icon + label · Mini (56px): icon + label แนวตั้ง
 *   - Active item = dark-green-50 bg + 2px left accent + dark-green-900 text
 *     (weight 400 ทุก state · DS-#118 — ไม่ใช้ weight เป็นตัวบอก state)
 *   - สถานะ collapsed เก็บใน localStorage ('sidebarCollapsed')
 *   - Sticky top-0 h-screen ทำให้ sidebar อยู่กับที่ขณะ scroll
 *   - Token-only · no dark mode · Lucide strokeWidth 1 (Portal · DS-#083)
 *
 * Navigation groups ตาม role:
 *   manager  → 1 กลุ่ม · ta → 2 กลุ่ม · admin → 3 กลุ่ม
 *
 * Props:
 *   user / role — Firebase Auth user + บทบาท
 *   isDarkMode / toggleDarkMode — รับไว้เพื่อ compatibility กับ Layout (ไม่ใช้แล้ว · DS ห้าม dark mode)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { useNavigate, useLocation } from 'react-router-dom'
import { auth } from '../../services/firebase'
import {
  LogOut, LayoutDashboard, FilePlus, List,
  Briefcase, FolderOpen, ClipboardList, ScrollText,
  Users, Tag, DatabaseZap, Upload,
  ChevronLeft, HelpCircle, PieChart,
} from 'lucide-react'
import UserGuide from './UserGuide'

// ── Nav item definitions แต่ละ role ──────────────────────────────
// แต่ละ group มี label (section header) + items

const MANAGER_GROUPS = [
  { label: null, items: [
    { path: '/request',     label: 'ยื่นคำขอ',   icon: FilePlus },
    { path: '/my-requests', label: 'คำขอของฉัน', icon: ClipboardList },
  ]},
]

const TA_GROUPS = [
  { label: 'Overview', items: [
    { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
    { path: '/reports',      label: 'Reports',      icon: PieChart },
    { path: '/all-requests', label: 'All Requests', icon: List },
    { path: '/my-cases',     label: 'My Cases',     icon: Briefcase },
  ]},
  { label: 'Files', items: [
    { path: '/jd-files',  label: 'JD Files',  icon: FolderOpen },
    { path: '/audit-log', label: 'Audit Log', icon: ScrollText },
  ]},
]

const ADMIN_GROUPS = [
  { label: 'Overview', items: [
    { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
    { path: '/reports',      label: 'Reports',      icon: PieChart },
    { path: '/all-requests', label: 'All Requests', icon: List },
    { path: '/my-cases',     label: 'My Cases',     icon: Briefcase },
  ]},
  { label: 'Recruit', items: [
    { path: '/request',   label: 'ยื่นคำขอ',  icon: FilePlus },
    { path: '/jd-files',  label: 'JD Files',  icon: FolderOpen },
    { path: '/audit-log', label: 'Audit Log', icon: ScrollText },
  ]},
  { label: 'Admin', items: [
    { path: '/custom-positions', label: 'Positions',    icon: Tag },
    { path: '/users',            label: 'Users',        icon: Users },
    { path: '/admin-tools',      label: 'Admin Tools',  icon: DatabaseZap },
    { path: '/import',           label: 'Import Data',  icon: Upload },
  ]},
]

// Label แสดงใต้ชื่อ user ใน sidebar
const ROLE_LABEL = {
  admin:   'Administrator',
  ta:      'TA · People Exp.',
  manager: 'Manager',
}

// ขนาด sidebar (px) — DS 18-navigation §13.1
const FULL_W = 240
const MINI_W = 56

// border-right / divider color — neutral-100 @ 60% (DS §13.1)
const HAIRLINE = 'rgba(230,233,235,0.6)'

// ════════════════════════════════════════════════════════════════
export default function Sidebar({ user, role }) {
  // อ่านสถานะ collapsed จาก localStorage เพื่อ persist ระหว่าง refresh
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  )
  const [showGuide, setShowGuide] = useState(false)
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
      className="h-screen sticky top-0 z-30 flex shrink-0 flex-col overflow-hidden bg-white transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? MINI_W : FULL_W, borderRight: `1px solid ${HAIRLINE}` }}
    >
      {/* ── Logo zone (h-56px · DS §13.2) ─────────────────────── */}
      <div
        className={`flex h-14 shrink-0 items-center ${collapsed ? 'justify-center' : 'justify-between px-3'}`}
        style={{ borderBottom: `1px solid ${HAIRLINE}` }}
      >
        {collapsed ? (
          // Mini: logo mark (clip wordmark) — กดเพื่อขยาย
          <button onClick={toggle} title="ขยาย sidebar" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-neutral-50">
            <span className="block h-7 w-7 overflow-hidden">
              <img src="/freshket-original.svg" alt="Freshket" className="h-7 max-w-none object-left" style={{ objectPosition: 'left' }} />
            </span>
          </button>
        ) : (
          <>
            <img src="/freshket-original.svg" alt="Freshket" className="h-[22px] object-contain" />
            <button
              onClick={toggle}
              title="ย่อ sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
            >
              <ChevronLeft size={16} strokeWidth={1} absoluteStrokeWidth />
            </button>
          </>
        )}
      </div>

      {/* ── Nav groups ────────────────────────────────────────── */}
      <nav className="flex flex-1 flex-col overflow-y-auto py-2">
        {groups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-5' : ''}>
            {/* Section header — Full เท่านั้น (Caption · neutral-400 · sentence case) */}
            {group.label && !collapsed && (
              <p className="px-4 pb-1.5 text-[11px] font-bold text-neutral-400">{group.label}</p>
            )}

            {group.items.map((item) => {
              const active = pathname === item.path
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  title={collapsed ? item.label : undefined}
                  className={
                    collapsed
                      ? `relative flex h-[52px] w-full flex-col items-center justify-center gap-[3px] text-[10px] font-normal transition-colors ${
                          active ? 'bg-dark-green-50 text-dark-green-900' : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900'
                        }`
                      : `relative flex h-9 w-full items-center gap-3 px-4 text-sm font-normal transition-colors ${
                          active ? 'bg-dark-green-50 text-dark-green-900' : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900'
                        }`
                  }
                >
                  {/* Active = 2px left accent flush · เต็มความสูง (DS §13.3) */}
                  {active && (
                    <span className="absolute left-0 top-0 h-full w-0.5 bg-dark-green-600" />
                  )}
                  <item.icon
                    size={collapsed ? 20 : 18}
                    strokeWidth={1}
                    absoluteStrokeWidth
                    className={`shrink-0 ${active ? 'text-dark-green-600' : 'text-neutral-400'}`}
                  />
                  <span className={collapsed ? 'line-clamp-2 px-1 text-center leading-tight' : 'truncate'}>
                    {item.label}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── Bottom: help + profile ────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${HAIRLINE}` }}>

        {/* Help (UserGuide) — neutral ghost icon */}
        <div className={`flex px-2 py-2 ${collapsed ? 'justify-center' : 'justify-start'}`}>
          <button
            onClick={() => setShowGuide(true)}
            title="คู่มือการใช้งาน"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
          >
            <HelpCircle size={16} strokeWidth={1} absoluteStrokeWidth />
          </button>
        </div>

        {/* Profile zone (DS §13.8) — Avatar + name + role + sign out */}
        <div className={`flex items-center gap-2.5 px-3 pb-3 ${collapsed ? 'justify-center' : ''}`}>
          {user.photoURL
            ? <img
                src={user.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                className="h-8 w-8 shrink-0 rounded-full"
                style={{ border: '1px solid rgba(0,128,101,0.2)' }}
              />
            : <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dark-green-50 text-xs font-bold text-dark-green-900"
                style={{ border: '1px solid rgba(0,128,101,0.2)' }}
              >
                {user.displayName?.[0]}
              </div>
          }

          {/* ชื่อ + role — Full เท่านั้น */}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-neutral-900">
                {user.displayName?.split(' ')[0]}
              </p>
              <p className="truncate text-[10px] text-neutral-500">
                {ROLE_LABEL[role]}
              </p>
            </div>
          )}

          {/* Sign out — Full เท่านั้น */}
          {!collapsed && (
            <button
              onClick={handleSignOut}
              title="ออกจากระบบ"
              className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={14} strokeWidth={1} absoluteStrokeWidth />
            </button>
          )}

          {/* Mini: sign out ผ่าน title (sr-only เพื่อ accessibility) */}
          {collapsed && (
            <button onClick={handleSignOut} title="ออกจากระบบ" className="sr-only" />
          )}
        </div>
      </div>

      {/* ── User Guide modal ──────────────────────────────────── */}
      {showGuide && <UserGuide onClose={() => setShowGuide(false)} />}
    </aside>
  )
}
