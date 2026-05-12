/**
 * firebase.js — Firebase Initialisation & Core Service Exports (การตั้งค่าและส่งออก Firebase)
 * ─────────────────────────────────────────────────────────────────────────────
 * ไฟล์นี้ทำหน้าที่เริ่มต้น Firebase App เพียงครั้งเดียว (singleton pattern)
 * และส่งออก instance ของ Auth, GoogleAuthProvider และ Firestore
 * เพื่อให้ส่วนอื่นๆ ของแอปนำไปใช้งานได้โดยตรง
 *
 * ค่า config ทั้งหมดอ่านจาก environment variables (VITE_FIREBASE_*)
 * เพื่อความปลอดภัยและสะดวกต่อการ deploy หลาย environment
 *
 * Functions exported:
 *   - auth          : Firebase Auth instance — ใช้สำหรับ login/logout
 *   - googleProvider: GoogleAuthProvider — ใช้ร่วมกับ signInWithPopup
 *   - db            : Firestore instance — ใช้สำหรับอ่าน/เขียน database
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

/**
 * Firebase project configuration object.
 * ค่าทั้งหมดอ่านจาก Vite environment variables ที่นำหน้าด้วย VITE_FIREBASE_
 * All values are injected at build time from Vite environment variables prefixed with VITE_FIREBASE_
 * ไม่ควร hardcode ค่าเหล่านี้โดยตรงในโค้ด / Never hardcode these values directly in source code.
 */
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,            // API key สำหรับ authenticate กับ Firebase / API key for Firebase authentication
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,        // โดเมนสำหรับ OAuth redirect / OAuth redirect domain
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,         // รหัสโปรเจกต์ Firebase / Firebase project identifier
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,     // ชื่อ Cloud Storage bucket / Cloud Storage bucket name
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, // Sender ID สำหรับ FCM / FCM sender ID
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,             // App ID ของ Firebase project / Firebase app identifier
}

/**
 * สร้าง Firebase App instance เพียงครั้งเดียว (singleton)
 * Initialize the Firebase app once. Calling initializeApp multiple times
 * with the same config would throw, so this module-level call ensures
 * only a single instance is created for the entire application.
 */
const app = initializeApp(firebaseConfig)

/**
 * Firebase Authentication instance.
 * ส่งออกเพื่อให้ใช้ร่วมกับ signInWithPopup, signOut, onAuthStateChanged ฯลฯ
 * Export for use with signInWithPopup, signOut, onAuthStateChanged, etc.
 * @type {import('firebase/auth').Auth}
 */
export const auth = getAuth(app)

/**
 * Google OAuth provider instance.
 * ส่งออกเพื่อให้ใช้ร่วมกับ auth สำหรับ Google Sign-In popup flow
 * Export for use alongside auth to trigger the Google Sign-In popup flow.
 * @type {import('firebase/auth').GoogleAuthProvider}
 */
export const googleProvider = new GoogleAuthProvider()

/**
 * Firestore database instance.
 * ส่งออกเพื่อให้ใช้งาน Firestore CRUD operations ทั่วทั้งแอป
 * Export for Firestore CRUD operations throughout the application.
 * @type {import('firebase/firestore').Firestore}
 */
export const db = getFirestore(app)
