/**
 * App.jsx — Root Application Component
 * ─────────────────────────────────────────────────────────────────────────────
 * คอมโพเนนต์หลักของแอปพลิเคชัน ทำหน้าที่เป็น entry point สำหรับทุก route
 * จัดการ authentication, role resolution, dark mode, และ maintenance mode
 * ทั้งหมดในที่เดียวก่อนที่จะ render หน้าจริงใด ๆ
 *
 * Architecture:
 *   - Firebase Auth  → ตรวจสอบว่า user login อยู่หรือไม่ (onAuthStateChanged)
 *   - Firestore      → ดึง role จาก collection `users/{email}` และ
 *                      สถานะ maintenance จาก `settings/maintenance`
 *   - Google Sheets  → fallback สำหรับ role resolution (managers list)
 *   - Slack Webhook  → แจ้งเตือนทีมเมื่อมีการเปิด/ปิด maintenance mode
 *   - localStorage   → จดจำ dark/light mode preference ของ user
 *
 * Auth & Role Resolution Flow:
 *   1. onAuthStateChanged fires → ได้ firebaseUser
 *   2. ดึง Firestore users doc และ Google Sheets managers list พร้อมกัน (Promise.all)
 *   3. ถ้า Firestore doc มีอยู่  → ใช้ role จาก doc โดยตรง
 *   4. ถ้า Firestore doc ไม่มี   → เช็คว่า email อยู่ใน Sheets managers list หรือไม่
 *        - อยู่ใน Sheets → role = 'manager'
 *        - ไม่อยู่ใน Sheets → role = 'ta' (default)
 *   5. ถ้า fetch ล้มเหลวทุกอย่าง → fallback เป็น role = 'ta'
 *
 * Roles & Accessible Routes:
 *   manager → /my-requests, /request (submit form), /jd-files (TA/Admin only แต่ redirect ออก)
 *   ta      → /dashboard, /all-requests, /my-cases, /audit-log, /jd-files, /my-requests
 *   admin   → ทุก route รวมถึง /users, /custom-positions, /admin-tools, /import
 *
 * Dark Mode:
 *   - อ่านค่าเริ่มต้นจาก localStorage key 'theme'
 *   - toggle แล้ว persist กลับ localStorage
 *   - useEffect sync กับ document.documentElement.classList ('dark' class)
 *     เพื่อให้ Tailwind dark mode (class strategy) ทำงานได้ทั่วทั้งแอป
 *
 * Maintenance Mode:
 *   - อ่านสถานะครั้งเดียวตอน mount จาก Firestore `settings/maintenance`
 *   - admin สามารถ toggle ได้ผ่านปุ่ม fixed bottom-left
 *   - เมื่อ toggle: เขียน Firestore → ส่ง Slack alert → อัปเดต local state
 *   - non-admin ที่เข้าแอปขณะ maintenance = true จะเห็น <MaintenancePage>
 *
 * Special Components:
 *   - RoleSwitcher  → dev-only, แสดงเฉพาะเมื่อ email ตรงกับ VITE_DEV_EMAIL
 *   - RoleGuard     → wrapper ป้องกัน route ไม่ให้ role ที่ไม่ได้รับอนุญาตเข้าถึง
 *   - MaintenancePage → หน้า placeholder สำหรับ non-admin ระหว่างระบบปิด
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './services/firebase'
import { fetchSheetsData, getDepartmentByEmail } from './services/sheetsData'
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { PowerOff, Power } from 'lucide-react'
import { sendMaintenanceAlert } from './services/webhook'

import Login from './components/Auth/Login'

// นำเข้า Shared Components
import { RoleSwitcher, RoleGuard, MaintenancePage } from './components/Shared/AppHelpers'

// นำเข้า Pages
import DashboardPage from './pages/DashboardPage'
import FormPage from './pages/FormPage'
import MyRequestsPage from './pages/MyRequestsPage'
import AllRequestsPage from './pages/AllRequestsPage'
import MyCasesPage from './pages/MyCasesPage'
import UserManagementPage from './pages/UserManagementPage'
import JDFilesPage from './pages/JDFilesPage'
import AuditLogPage from './pages/AuditLogPage'
import CustomPositionsPage from './pages/CustomPositionsPage'
import AdminToolsPage from './pages/AdminToolsPage'

// Lazy load — โหลด ImportPage แยกต่างหากเพื่อลด initial bundle size
// เพราะ ImportPage ใช้งานเฉพาะ admin และไม่จำเป็นสำหรับ user ทั่วไป
const ImportPage = lazy(() => import('./components/Admin/ImportPage'))

// DEV_EMAIL — email ที่กำหนดใน .env (VITE_DEV_EMAIL)
// ใช้เพื่อตรวจสอบว่าควรแสดง RoleSwitcher (dev tool) หรือไม่
const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL

// ─── Root App ────────────────────────────────────────────────────────────────
// Auth flow: Firebase onAuthStateChanged → ดึง role จาก Firestore users collection
// Dark mode: เก็บใน localStorage → ใส่ class 'dark' ที่ <html> element
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // user — Firebase user object หลังจาก login สำเร็จ, null = ยังไม่ได้ login
  const [user, setUser] = useState(null)

  // authLoading — true ระหว่างที่รอ onAuthStateChanged ตอบกลับครั้งแรก
  // ป้องกัน flash ของหน้า Login ก่อนที่ Firebase จะ restore session
  const [authLoading, setAuthLoading] = useState(true)

  // role — สิทธิ์ของ user: 'manager' | 'ta' | 'admin'
  // ใช้ควบคุมการเข้าถึง route และการแสดงผล UI
  const [role, setRole] = useState(null)

  // department — แผนกของ manager ดึงมาจาก Google Sheets
  // ส่งต่อไปยัง page components เพื่อ pre-fill ข้อมูลในฟอร์ม
  const [department, setDepartment] = useState('')

  // isDarkMode — สถานะ dark mode ปัจจุบัน
  // อ่านค่าเริ่มต้นจาก localStorage แบบ lazy init เพื่อหลีกเลี่ยง flash
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark'
  })

  // maintenanceMode — true = ระบบปิดปรับปรุง, non-admin จะเห็น MaintenancePage
  const [maintenanceMode, setMaintenanceMode] = useState(false)

  // maintenanceMessage — ข้อความที่แสดงบน MaintenancePage ระหว่างระบบปิด
  const [maintenanceMessage, setMaintenanceMessage] = useState('')

  // togglingMaintenance — true ระหว่างที่กำลังเขียน Firestore + ส่ง Slack alert
  // ใช้ disable ปุ่มเพื่อป้องกัน double-click
  const [togglingMaintenance, setTogglingMaintenance] = useState(false)

  // ─── Effect: Sync dark mode → document.documentElement.classList ───────────
  // ทุกครั้งที่ isDarkMode เปลี่ยน ให้ toggle class 'dark' บน <html>
  // Tailwind ใช้ class strategy: ต้องมี class 'dark' ที่ root element
  // เพื่อให้ dark: variants ทำงานทั่วทั้งแอป
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDarkMode])

  // toggleDarkMode — สลับ dark/light mode และ persist ลง localStorage
  // key 'theme' เก็บค่าเป็น string 'dark' หรือ 'light'
  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      const newVal = !prev
      localStorage.setItem('theme', newVal ? 'dark' : 'light')
      return newVal
    })
  }

  // ─── Effect: Subscribe maintenance mode (realtime) ──────────────────────────
  // ใช้ onSnapshot แทน getDoc เพื่อให้ maintenance state อัปเดต realtime
  // เมื่อ admin เปิด/ปิด maintenance mode ทุก session ที่ login อยู่จะได้รับทันที
  // Subscribe เฉพาะเมื่อ user login แล้ว (rules กำหนดให้ต้อง auth)
  // Cleanup (unsubscribe) เมื่อ user logout หรือ component unmount
  useEffect(() => {
    if (!user) return   // รอจนกว่า user จะ authenticate ก่อน
    const unsub = onSnapshot(
      doc(db, 'settings', 'maintenance'),
      (snap) => {
        if (snap.exists()) {
          setMaintenanceMode(snap.data().active ?? false)
          setMaintenanceMessage(snap.data().message ?? '')
        }
      },
      (err) => console.error('[App] maintenance snapshot error:', err)
    )
    return () => unsub()   // unsubscribe เมื่อ user logout หรือ unmount
  }, [user])

  // ─── toggleMaintenance — Admin: เปิด/ปิด maintenance mode ──────────────────
  // ขั้นตอน:
  //   1. Guard ด้วย togglingMaintenance เพื่อป้องกัน concurrent calls
  //   2. คำนวณ next state (toggle จาก current)
  //   3. เขียน Firestore `settings/maintenance` พร้อม metadata (updatedAt, updatedBy)
  //   4. ส่ง Slack alert ผ่าน sendMaintenanceAlert(next)
  //   5. อัปเดต local state เพื่อ reflect การเปลี่ยนแปลงทันทีโดยไม่ต้อง re-fetch
  async function toggleMaintenance() {
    if (togglingMaintenance) return   // ป้องกัน double-click / concurrent toggle
    setTogglingMaintenance(true)
    const next = !maintenanceMode     // สถานะใหม่ที่จะตั้ง
    try {
      // เขียน Firestore document พร้อมข้อความ default ถ้ากำลังเปิด maintenance
      await setDoc(doc(db, 'settings', 'maintenance'), {
        active: next,
        message: next ? 'กำลังดำเนินการปรับปรุงระบบ กรุณารอสักครู่' : '',
        updatedAt: serverTimestamp(),   // timestamp จาก Firestore server (ไม่ใช่ client)
        updatedBy: user?.email,         // บันทึกว่า admin คนไหนเป็นคนกด
      })
      // แจ้งเตือน Slack ว่าระบบเปิดหรือปิด
      // await sendMaintenanceAlert(next)
      // อัปเดต local state ให้ตรงกับ Firestore
      setMaintenanceMode(next)
      setMaintenanceMessage(next ? 'กำลังดำเนินการปรับปรุงระบบ กรุณารอสักครู่' : '')
    } catch (e) {
      console.error('[toggleMaintenance] error:', e)
    }
    setTogglingMaintenance(false)
  }

  // ─── Effect: Auth State Listener + Role Resolution ──────────────────────────
  // Subscribe ต่อ Firebase Auth ตลอดอายุของ component
  // ทุกครั้งที่ auth state เปลี่ยน (login / logout / token refresh) callback นี้จะถูกเรียก
  //
  // เมื่อ user login:
  //   - normalize email เป็น lowercase + trim เพื่อความสม่ำเสมอใน Firestore key
  //   - ดึง Firestore users doc และ Google Sheets managers list พร้อมกัน (Promise.all)
  //     เพื่อลด latency จากการทำ sequential requests
  //   - getDepartmentByEmail() คืน department name ถ้า email อยู่ใน managers list
  //   - Role determination:
  //       Firestore doc exists  → ใช้ role จาก doc (มีการ set ไว้โดย admin แล้ว)
  //       Firestore doc missing + อยู่ใน Sheets → 'manager'
  //       Firestore doc missing + ไม่อยู่ใน Sheets → 'ta' (default สำหรับ TA/PE)
  //
  // เมื่อ user logout: reset user, role, department กลับเป็น null/''
  // cleanup: unsubscribe listener เมื่อ component unmount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser)
        // normalize email ให้เป็น lowercase เพื่อใช้เป็น Firestore document key
        const userEmail = firebaseUser.email?.trim().toLowerCase()
        try {
          // ดึงข้อมูลสองแหล่งพร้อมกัน: Firestore users doc + Google Sheets managers list
          const userRef = doc(db, 'users', userEmail)
          const [userDoc, { managers }] = await Promise.all([
            getDoc(userRef),
            fetchSheetsData(),
          ])

          // หา department ของ user จาก Sheets managers list
          // คืน string ชื่อแผนก หรือ null ถ้าไม่พบ
          const sheetDept = getDepartmentByEmail(managers, userEmail)
          setDepartment(sheetDept || '')

          if (userDoc.exists()) {
            // กรณีที่ 1: Firestore มี users doc → ใช้ role ที่ admin กำหนดไว้
            setRole(userDoc.data().role)
          } else {
            // กรณีที่ 2: ไม่มี Firestore doc → ใช้ Sheets เป็น fallback
            // มีชื่ออยู่ใน Sheets managers → 'manager', ไม่มี → 'ta'
            setRole(sheetDept ? 'manager' : 'ta')
          }
        } catch (error) {
          console.error('[App] Error fetching role:', error)
          // Fallback สุดท้าย: ถ้า fetch ล้มเหลวทุกอย่าง ให้เป็น 'ta'
          // เพื่อป้องกันไม่ให้แอปค้างโดยไม่มี role
          setRole('ta')
        }
      } else {
        // User logout → reset state ทั้งหมดที่เกี่ยวกับ user
        setUser(null)
        setRole(null)
        setDepartment('')
      }
      // ไม่ว่าผลจะเป็นอย่างไร ให้ปิด loading state
      setAuthLoading(false)
    })
    // cleanup: unsubscribe เมื่อ App unmount เพื่อป้องกัน memory leak
    return () => unsubscribe()
  }, [])

  // ─── Loading State ──────────────────────────────────────────────────────────
  // แสดง spinner ระหว่างรอ Firebase restore session ครั้งแรก
  // ป้องกัน flash ของ Login page ก่อนที่ auth state จะพร้อม
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f7f6] dark:bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#008065]" />
      </div>
    )
  }

  // ─── Unauthenticated ────────────────────────────────────────────────────────
  // ถ้าไม่มี user (ยังไม่ได้ login หรือ logout แล้ว) ให้แสดงหน้า Login
  if (!user) return <Login />

  // ─── Maintenance Gate (non-admin) ──────────────────────────────────────────
  // แสดงหน้า maintenance ให้ non-admin เมื่อระบบปิดปรับปรุง
  // admin ยังเข้าแอปได้ตามปกติเพื่อ monitor และ toggle maintenance กลับ
  if (maintenanceMode && role !== 'admin') {
    return <MaintenancePage message={maintenanceMessage} />
  }

  // defaultRoute — route เริ่มต้นตาม role
  // manager ไม่มี /dashboard → redirect ไป /my-requests
  // ta/admin มี /dashboard → ไปที่นั่น
  const defaultRoute = role === 'manager' ? '/my-requests' : '/dashboard'

  // pageProps — props ชุดที่ส่งต่อให้ทุก page component
  // รวม user info, role, dark mode state/toggle ไว้ด้วยกันเพื่อความสะดวก
  const pageProps = { user, role, department, isDarkMode, toggleDarkMode }

  return (
    <>
      {/* ─── Route Definitions ─────────────────────────────────────────────── */}
      <Routes>

        {/* /request — ฟอร์มสร้าง HC request
            อนุญาต: manager, admin
            redirect: role อื่น → /dashboard */}
        <Route
          path="/request"
          element={
            <RoleGuard role={role} allowed={['manager', 'admin']} redirectTo="/dashboard">
              <FormPage {...pageProps} maintenanceMode={maintenanceMode} />
            </RoleGuard>
          }
        />

        {/* /my-requests — รายการ request ของตัวเอง
            เข้าถึงได้ทุก role (ไม่มี RoleGuard) */}
        <Route path="/my-requests" element={<MyRequestsPage {...pageProps} />} />

        {/* /jd-files — ไฟล์ Job Description
            อนุญาต: ta, admin
            redirect: manager → defaultRoute (/my-requests) */}
        <Route
          path="/jd-files"
          element={
            <RoleGuard role={role} allowed={['ta', 'admin']} redirectTo={defaultRoute}>
              <JDFilesPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* ── TA/PE & Admin Only Routes ──────────────────────────────────── */}

        {/* /dashboard — overview สรุปสถานะ request ทั้งหมด
            อนุญาต: ta, admin
            redirect: manager → /my-requests */}
        <Route
          path="/dashboard"
          element={
            <RoleGuard role={role} allowed={['ta', 'admin']} redirectTo="/my-requests">
              <DashboardPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* /all-requests — ดู request ทั้งหมดในระบบ
            อนุญาต: ta, admin
            redirect: manager → /my-requests */}
        <Route
          path="/all-requests"
          element={
            <RoleGuard role={role} allowed={['ta', 'admin']} redirectTo="/my-requests">
              <AllRequestsPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* /my-cases — request ที่ TA รับผิดชอบอยู่
            อนุญาต: ta, admin
            redirect: manager → /my-requests */}
        <Route
          path="/my-cases"
          element={
            <RoleGuard role={role} allowed={['ta', 'admin']} redirectTo="/my-requests">
              <MyCasesPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* /audit-log — ประวัติการเปลี่ยนแปลงทั้งหมดในระบบ
            อนุญาต: ta, admin
            redirect: manager → /my-requests */}
        <Route
          path="/audit-log"
          element={
            <RoleGuard role={role} allowed={['ta', 'admin']} redirectTo="/my-requests">
              <AuditLogPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* ── Admin Only Routes ──────────────────────────────────────────── */}

        {/* /users — จัดการ user accounts และ roles
            อนุญาต: admin เท่านั้น
            redirect: ไม่ใช่ admin → /dashboard */}
        <Route
          path="/users"
          element={
            <RoleGuard role={role} allowed={['admin']} redirectTo="/dashboard">
              <UserManagementPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* /custom-positions — จัดการ custom job positions นอกเหนือจาก standard list
            อนุญาต: admin เท่านั้น
            redirect: ไม่ใช่ admin → /dashboard */}
        <Route
          path="/custom-positions"
          element={
            <RoleGuard role={role} allowed={['admin']} redirectTo="/dashboard">
              <CustomPositionsPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* /admin-tools — เครื่องมือ admin เช่น bulk operations, system config
            อนุญาต: admin เท่านั้น
            redirect: ไม่ใช่ admin → /dashboard */}
        <Route
          path="/admin-tools"
          element={
            <RoleGuard role={role} allowed={['admin']} redirectTo="/dashboard">
              <AdminToolsPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* /import — นำเข้าข้อมูล bulk ผ่าน ImportPage (lazy loaded)
            อนุญาต: admin เท่านั้น
            redirect: ไม่ใช่ admin → /dashboard */}
        <Route
          path="/import"
          element={
            <RoleGuard role={role} allowed={['admin']} redirectTo="/dashboard">
              <ImportPage {...pageProps} />
            </RoleGuard>
          }
        />

        {/* Catch-all: redirect path ที่ไม่รู้จัก → defaultRoute ตาม role */}
        <Route path="*" element={<Navigate to={defaultRoute} replace />} />
      </Routes>

      {/* ─── RoleSwitcher (Dev Only) ──────────────────────────────────────────
          แสดงเฉพาะเมื่อ email ของ user ที่ login อยู่ตรงกับ VITE_DEV_EMAIL
          ใช้ simulate role/department ต่าง ๆ ระหว่าง development โดยไม่ต้องสลับ account
          ไม่แสดงใน production เพราะ DEV_EMAIL จะไม่ตรงกับ user จริง */}
      {user?.email === DEV_EMAIL && (
        <RoleSwitcher
          currentRole={role}
          onSwitch={setRole}
          currentDept={department}
          onDeptSwitch={setDepartment}
        />
      )}

      {/* ─── Maintenance Toggle Button (Admin Only) ───────────────────────────
          ปุ่ม fixed position ที่มุมล่างซ้าย แสดงเฉพาะ admin
          สีเขียว = ระบบปิดอยู่ (กดเพื่อเปิด) | สีส้ม = ระบบเปิดอยู่ (กดเพื่อปิด)
          disabled ระหว่าง togglingMaintenance เพื่อป้องกัน race condition */}
      {role === 'admin' && (
        <div className="fixed bottom-6 left-6 z-[100]">
          <button
            onClick={toggleMaintenance}
            disabled={togglingMaintenance}
            title={maintenanceMode ? 'เปิดระบบ' : 'ปิดระบบเพื่อปรับปรุง'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold shadow-xl transition-all disabled:opacity-50 ${
              maintenanceMode
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/30'  // ระบบปิดอยู่ → ปุ่มสีเขียว "เปิดระบบ"
                : 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/30'      // ระบบเปิดอยู่ → ปุ่มสีส้ม "ปิดระบบ"
            }`}
          >
            {/* ไอคอน: Power = เปิดระบบ, PowerOff = ปิดระบบ */}
            {maintenanceMode ? <Power size={15} /> : <PowerOff size={15} />}
            {/* ข้อความ: แสดง loading text ระหว่าง toggle, หรือ action text ปกติ */}
            {togglingMaintenance ? 'กำลังดำเนินการ...' : maintenanceMode ? 'เปิดระบบ' : 'ปิดระบบ'}
          </button>
          {/* badge เตือน admin ว่าระบบปิดอยู่ในขณะนี้ */}
          {maintenanceMode && (
            <p className="text-[10px] text-orange-500 font-bold mt-1.5 text-center">ระบบปิดอยู่</p>
          )}
        </div>
      )}
    </>
  )
}
