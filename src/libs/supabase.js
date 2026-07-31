/**
 * supabase.js — Supabase File Storage Service (บริการจัดการไฟล์ผ่าน Supabase Storage)
 * ─────────────────────────────────────────────────────────────────────────────
 * Hybrid Storage Layer — ใช้ Supabase Storage สำหรับเก็บไฟล์ JD (PDF/Word/รูปภาพ) และ CV (PDF/DOC/DOCX)
 * ส่วน Auth และ Database หลักยังคงใช้ Firebase / Firestore
 *
 * This module provides a hybrid storage layer: Supabase Storage is used
 * exclusively for file uploads (JD and CV attachments), while Firebase/Firestore
 * continues to handle authentication and the primary database.
 *
 * Bucket  : jd-files  (private, ต้องใช้ signed URL ในการเข้าถึง / requires signed URLs for access)
 *           cv-files  (private, รองรับ PDF/DOC/DOCX / supports PDF, DOC, DOCX)
 * Folder  : {firestore_doc_id}/  (ใช้ docRef.id เป็นชื่อ folder / Firestore doc ID used as folder name)
 * Auth    : anon key + signed URL แทน Firebase Auth token / anon key + signed URLs instead of Firebase Auth tokens
 *
 * Functions exported:
 *   - validateJDFile : ตรวจชนิด+ขนาดไฟล์ JD ก่อนอัพโหลด (ฟอร์มเรียกตอนเลือกไฟล์) / Validate JD file type + size
 *   - uploadJDFile   : อัพโหลดไฟล์ JD (PDF/Word/รูปภาพ) ไปยัง bucket jd-files / Upload JD file to jd-files bucket
 *   - getJDSignedUrl : สร้าง signed URL (1 ชั่วโมง) สำหรับ JD file / Generate 1-hour signed URL for a JD file
 *   - listJDFiles    : ดึงรายการไฟล์ทั้งหมดใน jd-files bucket / List all files in the jd-files bucket
 *   - deleteJDFile   : ลบไฟล์ JD ออกจาก Supabase / Delete a JD file from Supabase Storage
 *   - uploadCVFile   : อัพโหลดไฟล์ CV (PDF/DOC/DOCX) ไปยัง bucket cv-files / Upload CV to cv-files bucket
 *   - getCVSignedUrl : สร้าง signed URL (1 ชั่วโมง) สำหรับ CV file / Generate 1-hour signed URL for a CV file
 *   - deleteCVFile   : ลบไฟล์ CV ออกจาก Supabase / Delete a CV file from Supabase Storage
 * ─────────────────────────────────────────────────────────────────────────────
 */

// อ่าน Supabase endpoint และ anon key จาก environment variables
// Read Supabase project URL and anonymous (public) key from environment variables
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Lazy singleton — Supabase SDK (165 kB) จะโหลดก็ต่อเมื่อมีการเรียก file operation ครั้งแรกเท่านั้น
 * ไม่โหลดตอนเปิดแอป ทำให้ initial bundle เบาลง ~42 kB (gzipped)
 *
 * Lazy singleton: the Supabase SDK is only imported when the first file operation
 * is triggered, keeping it off the critical-path initial bundle.
 */
let _client = null
async function getClient() {
  if (_client) return _client
  const { createClient } = await import('@supabase/supabase-js')
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  return _client
}

// ── Shared validation constants ───────────────────────────────────────────────

/** ขนาดไฟล์สูงสุดที่อนุญาต (MB) / Maximum allowed file size in megabytes */
const MAX_FILE_SIZE_MB = 10

/** ประเภทไฟล์ที่อนุญาตสำหรับ JD Library (เฉพาะ PDF) / Allowed MIME types for JD Library files (PDF only) */
const ALLOWED_TYPES = ['application/pdf']

/**
 * ไฟล์ JD ที่แนบมากับ HC request — รับ PDF, Word, รูปภาพ ตามที่ UI ฟอร์มสัญญาไว้
 * Map นามสกุลไฟล์ → MIME type (ใช้ทั้ง validate และเป็น contentType fallback
 * เมื่อ browser ให้ file.type ว่าง เช่น Windows ที่ registry MIME เพี้ยน)
 */
const JD_REQUEST_ALLOWED = {
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/** หานามสกุลไฟล์ (lowercase รวมจุด) เช่น 'JD ผู้จัดการ.PDF' → '.pdf' */
function fileExt(name) {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

/**
 * ตรวจไฟล์ JD ของ HC request ก่อนอัพโหลด — ใช้ทั้งตอนเลือกไฟล์ในฟอร์ม (fail fast,
 * กัน Firestore doc กำพร้า) และซ้ำใน uploadJDFile
 * เช็คจากนามสกุลไฟล์ ไม่ใช่ file.type — MIME จาก browser เชื่อถือไม่ได้ (ว่างได้บน Windows)
 * @param {File} file
 * @returns {string|null} ข้อความ error ภาษาไทย หรือ null ถ้าผ่าน
 */
export function validateJDFile(file) {
  if (!JD_REQUEST_ALLOWED[fileExt(file.name)]) {
    return 'อัพโหลดได้เฉพาะ PDF, Word (.doc/.docx) หรือรูปภาพ (PNG, JPG) เท่านั้น'
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return `ไฟล์ต้องไม่เกิน ${MAX_FILE_SIZE_MB}MB`
  }
  return null
}

/** Supabase Storage bucket names — อ่านจาก env หรือใช้ default */
const JD_BUCKET = import.meta.env.VITE_SUPABASE_JD_BUCKET || 'jd-files'
const CV_BUCKET = import.meta.env.VITE_SUPABASE_CV_BUCKET || 'cv-files'

// ── JD Files ──────────────────────────────────────────────────────────────────

/**
 * อัพโหลดไฟล์ JD ไปยัง Supabase Storage bucket JD_BUCKET
 * Uploads a Job Description (JD) file to the JD_BUCKET Supabase Storage bucket.
 *
 * กระบวนการ / Process:
 *   1. ตรวจสอบประเภทไฟล์ (PDF/Word/รูปภาพ — ดู JD_REQUEST_ALLOWED) / Validate file type
 *   2. ตรวจสอบขนาดไฟล์ (ไม่เกิน 10MB) / Validate file size (max 10MB)
 *   3. Sanitize ชื่อไฟล์เพื่อความปลอดภัย / Sanitize filename for safety
 *   4. อัพโหลดไปยัง path: {requestId}/{timestamp}_{filename} / Upload to path: {requestId}/{timestamp}_{filename}
 *   5. สร้าง signed URL อายุ 7 วัน / Generate a 7-day signed URL for access
 *
 * @param {File}   file      - ไฟล์ที่จะอัพโหลด (PDF/Word/PNG/JPG, ไม่เกิน 10MB) / File to upload (max 10MB)
 * @param {string} requestId - Firestore doc ID ที่ใช้เป็นชื่อ folder / Firestore document ID used as the storage folder name
 * @returns {Promise<{url: string|null, path: string|null, error: string|null}>}
 *   - url  : signed URL สำหรับเข้าถึงไฟล์ (7 วัน) หรือ null ถ้าล้มเหลว
 *            Signed URL valid for 7 days, or null on failure
 *   - path : storage path ของไฟล์ หรือ null ถ้าล้มเหลว / Storage path, or null on failure
 *   - error: ข้อความ error หรือ null ถ้าสำเร็จ / Error message, or null on success
 */
export async function uploadJDFile(file, requestId) {
  // ตรวจประเภท + ขนาดไฟล์ก่อน (helper เดียวกับที่ฟอร์มใช้ตอนเลือกไฟล์)
  // Validate type + size first (same helper the form uses at select time)
  const invalid = validateJDFile(file)
  if (invalid) return { url: null, path: null, error: invalid }

  const supabase = await getClient()
  try {
    // Sanitize ชื่อไฟล์: แทนที่อักขระพิเศษด้วย underscore เพื่อป้องกัน path traversal
    // Sanitize the filename: replace any character outside [a-zA-Z0-9._-] with underscores
    // to prevent path traversal attacks and storage path issues
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = safeName

    // สร้าง storage path: {requestId}/{timestamp}_{filename}
    // Build the storage path using the Firestore doc ID as folder and a timestamp prefix to avoid collisions
    const filePath = `${requestId}/${Date.now()}_${fileName}`

    // อัพโหลดไฟล์ไปยัง Supabase Storage — upsert: false ป้องกันการเขียนทับโดยบังเอิญ
    // contentType เอาจากนามสกุลเสมอ ไม่ใช้ file.type — bucket jd-files บังคับ MIME allowlist
    // ฝั่ง server ถ้าเครื่อง user ส่ง MIME เพี้ยน (เช่น application/x-pdf บน Windows ที่
    // registry พัง) จะโดน bucket ตอบ 400 ทั้งที่ไฟล์ถูกต้อง — map ของเราตรงกับ allowlist อยู่แล้ว
    // Upload to Supabase Storage — upsert: false prevents accidental overwrites
    const { error: uploadError } = await supabase.storage
      .from(JD_BUCKET)
      .upload(filePath, file, { upsert: false, contentType: JD_REQUEST_ALLOWED[fileExt(file.name)] })

    if (uploadError) throw uploadError

    // สร้าง signed URL อายุ 7 วัน (TA กดเปิดได้)
    // Create a signed URL valid for 7 days so TA staff can open the file
    const { data, error: urlError } = await supabase.storage
      .from(JD_BUCKET)
      .createSignedUrl(filePath, 60 * 60 * 24 * 7) // 604800 วินาที = 7 วัน / 604800 seconds = 7 days

    if (urlError) throw urlError

    return { url: data.signedUrl, path: filePath, error: null }
  } catch (err) {
    console.error('[uploadJDFile]', err)
    return { url: null, path: null, error: err.message }
  }
}

/**
 * สร้าง signed URL ใหม่สำหรับดูไฟล์ JD (อายุ 1 ชั่วโมง)
 * Generates a fresh short-lived signed URL for viewing a JD file.
 * ใช้เมื่อ URL เดิมหมดอายุแล้วและต้องการ URL ใหม่ชั่วคราว
 * Use this when a previously stored signed URL has expired and a fresh one is needed.
 *
 * @param {string} filePath - storage path ของไฟล์ JD (ได้จาก uploadJDFile) / Storage path returned by uploadJDFile
 * @returns {Promise<string|null>} signed URL อายุ 1 ชั่วโมง หรือ null ถ้าเกิด error
 *                                 Signed URL valid for 1 hour, or null on error
 */
export async function getJDSignedUrl(filePath) {
  const supabase = await getClient()
  const { data, error } = await supabase.storage
    .from(JD_BUCKET)
    .createSignedUrl(filePath, 60 * 60) // 3600 วินาที = 1 ชั่วโมง / 3600 seconds = 1 hour

  if (error) return null
  return data.signedUrl
}

/**
 * ดึงรายการไฟล์ทั้งหมดใน bucket JD_BUCKET พร้อมข้อมูล folder และ path
 * Lists all files in the JD_BUCKET bucket, organised by request folder.
 *
 * กระบวนการ 2 ขั้นตอน / Two-step process:
 *   1. ดึงรายการ folder ทั้งหมด (แต่ละ folder = 1 requestId) / List all top-level folders (each = one requestId)
 *   2. วนลูปดึงรายการไฟล์ในแต่ละ folder / Iterate folders and list files within each
 *
 * @returns {Promise<{data: Array<Object>, error: string|null}>}
 *   - data : array ของ file objects พร้อม .folder และ .path ที่เพิ่มเข้ามา
 *            Array of Supabase file metadata objects with extra .folder and .path properties
 *   - error: ข้อความ error หรือ null ถ้าสำเร็จ / Error message string, or null on success
 */
export async function listJDFiles() {
  const supabase = await getClient()
  try {
    // ขั้นตอนที่ 1: ดึง top-level folders (แต่ละอันคือ requestId)
    // Step 1: List top-level "folders" — each represents one request's files
    const { data: folders, error: foldersError } = await supabase.storage
      .from(JD_BUCKET)
      .list('', { limit: 100 })

    if (foldersError) throw foldersError

    let allFiles = []

    // ขั้นตอนที่ 2: วนลูปแต่ละ folder แล้วดึงไฟล์ข้างใน
    // Step 2: Iterate each folder and collect its files
    for (const folder of folders) {
      // ข้ามไฟล์ placeholder ที่ Supabase สร้างสำหรับ folder เปล่า
      // Skip the placeholder file Supabase uses to represent empty folders
      if (folder.name === '.emptyFolderPlaceholder') continue

      const { data: files, error: filesError } = await supabase.storage
        .from(JD_BUCKET)
        .list(folder.name, { limit: 100 })

      if (filesError) {
        // log error แล้วข้ามไป — ไม่ให้ folder เดียวที่ error ทำให้ทั้งหมดล้มเหลว
        // Log and skip this folder; don't let one bad folder fail the entire list
        console.error(`Error listing folder ${folder.name}:`, filesError)
        continue
      }

      // เพิ่ม .folder และ .path เข้าไปใน file metadata เพื่อให้ใช้งานง่ายขึ้น
      // Augment each file object with .folder and .path for easier downstream consumption
      const filesWithDetails = files.map(f => ({
        ...f,
        folder: folder.name,             // requestId ของ folder นี้ / The requestId folder this file belongs to
        path: `${folder.name}/${f.name}` // full storage path สำหรับ signed URL / Full storage path for signed URL generation
      }))

      allFiles = [...allFiles, ...filesWithDetails]
    }

    return { data: allFiles, error: null }
  } catch (err) {
    console.error('[listJDFiles]', err)
    return { data: [], error: err.message }
  }
}

/**
 * ลบไฟล์ JD ออกจาก Supabase Storage bucket JD_BUCKET
 * Deletes a JD file from the JD_BUCKET Supabase Storage bucket.
 *
 * @param {string} filePath - storage path ของไฟล์ที่จะลบ (ได้จาก uploadJDFile) / Storage path of the file to delete
 * @returns {Promise<{success: boolean, error: string|null}>}
 *   - success: true ถ้าลบสำเร็จ / true if deletion was successful
 *   - error  : ข้อความ error หรือ null ถ้าสำเร็จ / Error message, or null on success
 */
export async function deleteJDFile(filePath) {
  // ถ้าไม่มี path ให้ return เงียบๆ — ไม่ throw เพื่อป้องกัน crash จาก call ที่ไม่จำเป็น
  // Guard: if no path is provided, return silently to avoid crashes from optional delete calls
  if (!filePath) return
  const supabase = await getClient()
  try {
    // remove() รับ array ของ paths — ที่นี่ลบทีละ 1 ไฟล์
    // remove() accepts an array of paths — here we delete a single file at a time
    const { error } = await supabase.storage
      .from(JD_BUCKET)
      .remove([filePath])

    if (error) throw error
    return { success: true, error: null }
  } catch (err) {
    console.error('[deleteJDFile]', err)
    return { success: false, error: err.message }
  }
}

/**
 * อัพโหลดไฟล์ JD เข้า JD Library (folder: library/{libDocId}/)
 * Uploads a JD PDF file to the JD Library folder in the JD_BUCKET.
 *
 * @param {File}   file      - ไฟล์ PDF ที่จะอัพโหลด / PDF file to upload
 * @param {string} libDocId  - Firestore doc ID ของ jd_library document ที่สร้างแล้ว
 * @returns {Promise<{url: string|null, path: string|null, error: string|null}>}
 */
export async function uploadJDLibraryFile(file, libDocId) {
  if (!ALLOWED_TYPES.includes(file.type))
    return { url: null, path: null, error: 'อัพโหลดได้เฉพาะไฟล์ PDF เท่านั้น' }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024)
    return { url: null, path: null, error: `ไฟล์ต้องไม่เกิน ${MAX_FILE_SIZE_MB}MB` }
  const supabase = await getClient()
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${libDocId}/${Date.now()}_${safeName}`
    const { error: uploadError } = await supabase.storage
      .from(JD_BUCKET)
      .upload(filePath, file, { upsert: false, contentType: file.type })
    if (uploadError) throw uploadError
    const { data, error: urlError } = await supabase.storage
      .from(JD_BUCKET)
      .createSignedUrl(filePath, 60 * 60 * 24 * 7)
    if (urlError) throw urlError
    return { url: data.signedUrl, path: filePath, error: null }
  } catch (err) {
    console.error('[uploadJDLibraryFile]', err)
    return { url: null, path: null, error: err.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CV Files  (bucket: cv-files)
// รองรับ PDF / DOC / DOCX ไม่เกิน 10MB
// Supports PDF / DOC / DOCX, max 10MB per file
// Path: {requestId}/{timestamp}_{filename}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ประเภทไฟล์ที่อนุญาตสำหรับ CV (PDF, DOC, DOCX)
 * Allowed MIME types for CV files — broader than JD (PDF-only) to accommodate MS Word formats
 */
const CV_ALLOWED_TYPES = [
  'application/pdf',                                                      // PDF
  'application/msword',                                                   // .doc (Word 97-2003)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx (Word 2007+)
]

/**
 * อัพโหลดไฟล์ CV ไปยัง Supabase Storage bucket CV_BUCKET
 * Uploads a CV file (PDF, DOC, or DOCX) to the CV_BUCKET Supabase Storage bucket.
 *
 * กระบวนการเหมือน uploadJDFile แต่ใช้ bucket CV_BUCKET และรองรับไฟล์ประเภทเพิ่มเติม
 * Follows the same process as uploadJDFile but targets the CV_BUCKET bucket
 * and accepts additional file types (DOC, DOCX).
 *
 * @param {File}   file      - ไฟล์ CV ที่จะอัพโหลด (PDF/DOC/DOCX, ไม่เกิน 10MB) / CV file to upload (PDF/DOC/DOCX, max 10MB)
 * @param {string} requestId - Firestore doc ID ที่ใช้เป็นชื่อ folder / Firestore document ID used as the storage folder name
 * @returns {Promise<{url: string|null, path: string|null, error: string|null}>}
 *   - url  : signed URL อายุ 7 วัน หรือ null ถ้าล้มเหลว / 7-day signed URL, or null on failure
 *   - path : storage path หรือ null ถ้าล้มเหลว / Storage path, or null on failure
 *   - error: ข้อความ error หรือ null ถ้าสำเร็จ / Error message, or null on success
 */
export async function uploadCVFile(file, requestId) {
  const supabase = await getClient()
  // ตรวจสอบประเภทไฟล์ — รับ PDF, DOC, DOCX เท่านั้น
  // Validate MIME type — PDF, DOC, and DOCX are accepted
  if (!CV_ALLOWED_TYPES.includes(file.type)) {
    return { url: null, path: null, error: 'อัพโหลดได้เฉพาะ PDF, DOC, DOCX เท่านั้น' }
  }

  // ตรวจสอบขนาดไฟล์ — ต้องไม่เกิน 10MB (shared constant กับ JD)
  // Validate file size using the same 10MB constant as JD uploads
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { url: null, path: null, error: `ไฟล์ต้องไม่เกิน ${MAX_FILE_SIZE_MB}MB` }
  }
  try {
    // Sanitize ชื่อไฟล์ป้องกัน path injection
    // Sanitize filename to prevent path injection via special characters
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')

    // สร้าง storage path: {requestId}/{timestamp}_{safeName}
    // Build storage path with timestamp prefix to avoid name collisions
    const filePath = `${requestId}/${Date.now()}_${safeName}`

    // อัพโหลดไปยัง bucket CV_BUCKET — upsert: false ป้องกันการเขียนทับ
    // Upload to the CV_BUCKET bucket — upsert: false prevents accidental overwrites
    const { error: uploadError } = await supabase.storage
      .from(CV_BUCKET)
      .upload(filePath, file, { upsert: false, contentType: file.type })

    if (uploadError) throw uploadError

    // สร้าง signed URL อายุ 7 วัน สำหรับ download/view CV
    // Create a 7-day signed URL so recruiters can view/download the CV
    const { data, error: urlError } = await supabase.storage
      .from(CV_BUCKET)
      .createSignedUrl(filePath, 60 * 60 * 24 * 7) // 604800 วินาที = 7 วัน / 7 days

    if (urlError) throw urlError

    return { url: data.signedUrl, path: filePath, error: null }
  } catch (err) {
    console.error('[uploadCVFile]', err)
    return { url: null, path: null, error: err.message }
  }
}

/**
 * สร้าง signed URL ใหม่สำหรับดูไฟล์ CV (อายุ 1 ชั่วโมง)
 * Generates a fresh short-lived signed URL for viewing a CV file.
 *
 * @param {string} filePath - storage path ของไฟล์ CV (ได้จาก uploadCVFile) / Storage path returned by uploadCVFile
 * @returns {Promise<string|null>} signed URL อายุ 1 ชั่วโมง หรือ null ถ้าเกิด error
 *                                 1-hour signed URL, or null on error
 */
export async function getCVSignedUrl(filePath) {
  const supabase = await getClient()
  const { data, error } = await supabase.storage
    .from(CV_BUCKET)
    .createSignedUrl(filePath, 60 * 60) // 3600 วินาที = 1 ชั่วโมง / 1 hour

  if (error) return null
  return data.signedUrl
}

/**
 * ลบไฟล์ CV ออกจาก Supabase Storage bucket CV_BUCKET
 * Deletes a CV file from the CV_BUCKET Supabase Storage bucket.
 *
 * @param {string} filePath - storage path ของไฟล์ที่จะลบ (ได้จาก uploadCVFile) / Storage path of the file to delete
 * @returns {Promise<{success: boolean, error: string|null}>}
 *   - success: true ถ้าลบสำเร็จ / true if deletion succeeded
 *   - error  : ข้อความ error หรือ null ถ้าสำเร็จ / Error message, or null on success
 */
export async function deleteCVFile(filePath) {
  // Guard: ตรวจสอบว่ามี path ก่อนดำเนินการ — คืน error แทน undefined
  // Guard: verify path exists before attempting deletion — return error rather than undefined
  if (!filePath) return { success: false, error: 'No path' }
  const supabase = await getClient()
  try {
    // remove() รับ array ของ paths — ที่นี่ลบทีละ 1 ไฟล์
    // remove() accepts an array of paths — here we delete a single file
    const { error } = await supabase.storage
      .from(CV_BUCKET)
      .remove([filePath])

    if (error) throw error
    return { success: true, error: null }
  } catch (err) {
    console.error('[deleteCVFile]', err)
    return { success: false, error: err.message }
  }
}
