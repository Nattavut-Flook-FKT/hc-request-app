/**
 * webhook.js — Google Apps Script (GAS) Integration Layer (ชั้น integration กับ Google Sheets)
 * ─────────────────────────────────────────────────────────────────────────────
 * บริการนี้ทำหน้าที่เชื่อมต่อระหว่าง Web App กับ Google Apps Script (GAS)
 * ที่ทำงานบน Google Sheets เพื่อ sync ข้อมูล HC Request
 *
 * This service bridges the web application and Google Apps Script (GAS)
 * running on Google Sheets to keep HC Request data synchronised.
 *
 * sendToWebhook       → POST ข้อมูล HC Request ใหม่เข้า Google Sheets (doPost)
 *                        POST new HC Request data to Google Sheets (GAS doPost handler)
 * sendStatusUpdate    → GET updateStatus เมื่อสถานะเปลี่ยนใน Web App (doGet)
 *                        GET request to sync a status change to Sheets (GAS doGet handler)
 * syncBatchToSheets   → POST batch upsert หลาย rows พร้อมกัน / POST batch upsert of multiple rows
 * sendMaintenanceAlert→ แจ้งเตือน Slack ผ่าน GAS เมื่อ admin เปิด/ปิดระบบ
 *                        Notify Slack via GAS when admin toggles maintenance mode
 *
 * หมายเหตุ: GAS ไม่รองรับ CORS preflight ดังนั้น POST ใช้ mode: 'no-cors'
 * Note: GAS does not support CORS preflight, so all POST requests use mode: 'no-cors'.
 *
 * Functions exported:
 *   - sendMaintenanceAlert : แจ้ง Slack ทั้ง 2 channel เมื่อ maintenance เปิด/ปิด / Notify Slack of maintenance mode toggle
 *   - sendStatusUpdate     : sync สถานะ request ไปยัง Sheets พร้อม debounce / Debounced status sync to Sheets
 *   - syncBatchToSheets    : batch upsert หลาย requests ไปยัง Sheets ครั้งเดียว / Batch-upsert multiple requests to Sheets
 *   - sendToWebhook        : ส่งข้อมูล request ใหม่ผ่าน GAS webhook / Send a new request via the GAS webhook
 * ─────────────────────────────────────────────────────────────────────────────
 */

// GAS webhook URL สำหรับ POST (doPost handler) — ใช้สำหรับ create/sync batch
// GAS webhook URL for POST requests (doPost handler) — used for create and batch sync
const WEBHOOK_URL = import.meta.env.VITE_GAS_WEBHOOK_URL

// GAS data URL สำหรับ GET (doGet handler) — ใช้สำหรับ status update และ query
// GAS data URL for GET requests (doGet handler) — used for status updates and data queries
const DATA_URL = import.meta.env.VITE_GAS_DATA_URL

// Secret token สำหรับ GAS endpoint authentication
// ต้องตรงกับ DEPLOY_SECRET ใน GAS Script Properties
const GAS_SECRET = import.meta.env.VITE_GAS_SECRET || ''

// ── Rate Limiting (Debounce) ──────────────────────────────────────────────────
// Rate limiting: debounce sendStatusUpdate ต่อ docId 800ms
// ป้องกัน spam เมื่อ user เปลี่ยน status หลายครั้งเร็วๆ
// Per-docId debounce of 800ms prevents flooding GAS with rapid consecutive status changes
// (e.g., user clicks a status dropdown multiple times quickly)

/**
 * Map ที่เก็บ pending debounce timer สำหรับแต่ละ docId
 * Holds one pending {timer, resolve} entry per docId being debounced.
 * @type {Map<string, {timer: ReturnType<typeof setTimeout>, resolve: Function}>}
 */
const _pending = new Map() // docId → { timer, resolve }

/**
 * Debounce wrapper สำหรับ GAS status update calls
 * Debounces an async function call per docId with a configurable delay.
 *
 * ถ้ามี call ที่รออยู่สำหรับ docId เดียวกัน จะยกเลิกของเดิมและเริ่มนับใหม่
 * If a pending call exists for the same docId, it is cancelled and the timer restarts.
 * การ call ที่ถูกยกเลิกจะ resolve ด้วย 'cancelled' แทนที่จะ reject
 * Cancelled calls resolve with the string 'cancelled' rather than rejecting.
 *
 * @param {string}   docId     - Firestore doc ID ที่ใช้เป็น key สำหรับ debounce / Firestore document ID used as the debounce key
 * @param {Function} fn        - async function ที่จะเรียกหลัง delay / Async function to invoke after the delay
 * @param {number}   [delay=800] - delay ในหน่วย ms (default 800ms) / Delay in milliseconds (default 800ms)
 * @returns {Promise<any>} ผลลัพธ์จาก fn() หรือ 'cancelled' ถ้าถูก debounce ออกไป
 *                         Result of fn(), or the string 'cancelled' if debounced away
 */
function debouncedStatusCall(docId, fn, delay = 800) {
  // ยกเลิก timer ที่รออยู่สำหรับ docId นี้ (ถ้ามี)
  // Cancel any existing pending timer for this docId
  if (_pending.has(docId)) {
    clearTimeout(_pending.get(docId).timer)
    _pending.get(docId).resolve('cancelled') // resolve การ call เก่าด้วย 'cancelled'
  }
  return new Promise((resolve) => {
    // ตั้ง timer ใหม่และเก็บไว้ใน _pending map
    // Set a new timer and store it in the pending map
    const timer = setTimeout(async () => {
      _pending.delete(docId)       // ลบออกจาก map เมื่อ timer ทำงาน / Remove from map when timer fires
      resolve(await fn())          // รัน fn จริงๆ และ resolve ด้วยผลลัพธ์ / Execute fn and resolve with its result
    }, delay)
    _pending.set(docId, { timer, resolve })
  })
}

/**
 * แจ้ง Slack ทั้ง 2 channel ผ่าน GAS เมื่อ admin เปิด/ปิดระบบ maintenance
 * Notifies both Slack channels via GAS when an admin toggles maintenance mode.
 *
 * ส่ง GET request ไปยัง DATA_URL พร้อม action=maintenance และ active flag
 * Sends a GET request to the GAS doGet endpoint with action=maintenance and an active flag.
 *
 * @param {boolean} active - true = เปิด maintenance, false = ปิด maintenance
 *                           true = maintenance ON, false = maintenance OFF
 * @returns {Promise<void>} ไม่คืนค่า — errors จะถูก log เท่านั้น
 *                          Returns nothing — errors are logged only
 */
// แจ้ง Slack ทั้ง 2 channel ผ่าน GAS เมื่อ admin เปิด/ปิดระบบ
export async function sendMaintenanceAlert(active) {
  // ถ้า DATA_URL ไม่ได้ตั้งค่าให้ return เงียบๆ
  // If DATA_URL is not configured, silently skip to avoid errors in dev
  if (!DATA_URL) return
  try {
    const params = new URLSearchParams({ action: 'maintenance', active: active.toString() })
    if (GAS_SECRET) params.set('secret', GAS_SECRET)
    await fetch(`${DATA_URL}?${params.toString()}`)
  } catch (err) {
    console.error('[sendMaintenanceAlert] error:', err)
  }
}

/**
 * Sync สถานะ request ไปยัง Google Sheets เมื่อมีการเปลี่ยนแปลงใน Web App
 * Syncs a request's status change to Google Sheets via the GAS doGet endpoint.
 *
 * ใช้ DATA_URL (doGet) แทน WEBHOOK_URL เพราะ updateStatus handler อยู่ใน doGet
 * Uses DATA_URL (doGet) instead of WEBHOOK_URL because the updateStatus handler lives in doGet.
 * มีระบบ debounce 800ms ต่อ docId เพื่อกรอง rapid updates
 * A per-docId 800ms debounce filters out rapid consecutive updates.
 *
 * @param {string}      docId           - Firestore doc ID ของ request / Firestore document ID of the request
 * @param {string}      status          - สถานะใหม่ (เช่น 'Recruiting', 'Closed') / New status value
 * @param {string|null} [assignedToName=null] - ชื่อ TA ที่ได้รับมอบหมาย (ถ้ามี) / Assigned TA's display name (if any)
 * @param {string|null} [assignedAt=null]     - วันเวลาที่มอบหมาย ISO string (ถ้ามี) / ISO datetime of assignment (if any)
 * @param {string|null} [startDate=null]      - วันเริ่มงาน ISO string (ถ้ามี) / Candidate start date ISO string (if any)
 * @param {string|null} [candidateName=null]  - ชื่อผู้สมัครที่เลือก (ถ้ามี) / Selected candidate's name (if any)
 * @returns {Promise<void|'cancelled'>} resolve เมื่อ GAS ตอบกลับ หรือ 'cancelled' ถ้าถูก debounce
 *                                      Resolves when GAS responds, or 'cancelled' if debounced away
 */
export function sendStatusUpdate(docId, status, assignedToName = null, assignedAt = null, startDate = null, candidateName = null, hcId = null, offeringDate = null, clearInfo = false, cvUrl = null) {
  if (!DATA_URL) {
    console.error('[sendStatusUpdate] VITE_GAS_DATA_URL not configured')
    return Promise.resolve()
  }
  return debouncedStatusCall(docId, async () => {
    try {
      const params = new URLSearchParams({ action: 'updateStatus', id: docId, status })
      if (assignedToName) params.set('assignedToName', assignedToName)
      if (assignedAt)     params.set('assignedAt', assignedAt)
      if (startDate)      params.set('startDate', startDate)
      if (candidateName)  params.set('candidateName', candidateName)
      if (hcId)           params.set('hcId', hcId)
      if (offeringDate)   params.set('offeringDate', offeringDate)
      if (clearInfo)      params.set('clearInfo', '1')
      if (cvUrl)          params.set('cvUrl', cvUrl)
      if (GAS_SECRET)     params.set('secret', GAS_SECRET)
      const url = `${DATA_URL}?${params.toString()}`
      const res = await fetch(url)
      const json = await res.json()
      if (!json.success) console.error('[sendStatusUpdate] failed:', json.error)
    } catch (error) {
      console.error('[sendStatusUpdate] error:', error)
    }
  })
}

/**
 * Sync ข้อมูลทั้งหมด (หรือ batch) ไปยัง Google Sheets ผ่าน GAS
 * Batch-upserts an array of request objects to Google Sheets via the GAS doPost endpoint.
 * GAS จะ upsert แต่ละ row โดยใช้ HCID เป็น key
 * GAS uses the HCID as a unique key to upsert each row (insert or update).
 *
 * ขั้นตอน / Process:
 *   1. Map app status names → Sheets status names ผ่าน STATUS_MAP
 *      Map app-side status values to the display names expected by Google Sheets
 *   2. Filter rows ที่ไม่มี position ออก / Filter out rows without a position
 *   3. Normalize date fields — รองรับ Firestore Timestamp, JS Date, หรือ string
 *      Normalize date fields — handles Firestore Timestamp objects, JS Dates, and plain strings
 *   4. POST ด้วย mode: 'no-cors' เพราะ GAS ไม่รองรับ CORS preflight
 *      POST with mode: 'no-cors' because GAS does not support CORS preflight
 *
 * @param {Array<Object>} requests - Array ของ request objects (Firestore docs หรือ raw rows)
 *                                   Array of request objects from Firestore or raw data
 * @returns {Promise<void>} ไม่คืนค่า — errors จะถูก log เท่านั้น / Returns nothing — errors are logged only
 */
export async function syncBatchToSheets(requests) {
  if (!WEBHOOK_URL) {
    console.warn('[syncBatchToSheets] VITE_GAS_WEBHOOK_URL not configured')
    return
  }

  /**
   * แปลงค่า date/timestamp เป็น ISO string สำหรับส่งไปยัง GAS
   * Converts any date representation to an ISO 8601 string for GAS consumption.
   * รองรับ Firestore Timestamp (.toDate()), JS Date, หรือ string ธรรมดา
   * Handles Firestore Timestamp objects (with .toDate()), native JS Dates, and plain strings.
   * @param {*} val - ค่าที่จะแปลง / Value to convert
   * @returns {string} ISO string หรือ '' ถ้า val เป็น falsy / ISO string, or empty string if val is falsy
   */
  function getIso(val) {
    if (!val) return ''
    if (val?.toDate) return val.toDate().toISOString()  // Firestore Timestamp → ISO string
    if (val instanceof Date) return val.toISOString()   // JS Date → ISO string
    return String(val)                                  // อื่นๆ แปลงเป็น string ตรงๆ / Other: coerce to string
  }

  /**
   * Map สถานะของแอป → ชื่อสถานะใน Google Sheets
   * Maps internal app status values to the display names used in Google Sheets.
   * ใช้เพื่อให้ชื่อสถานะใน Sheets อ่านง่ายสำหรับฝ่าย HR
   * Ensures Sheets shows human-readable status names for HR staff.
   */
  const STATUS_MAP = {
    Open:             'Open',
    Recruiting:       'Active Sourcing',
    Interviewing:     'Interviewing',
    Offering:         'Pending Offer',
    Onboarding:       'Pending Onboard',
    Closed:           'Onboard',
    Rejected:         'Turndown',
    Cancelled:        'Job Cancelled',
    OnHold:           'On hold',
    Confidential:     'Confidential',
    InternalTransfer: 'Internal Transfer',
  }

  // แปลง request objects เป็น row format ที่ GAS คาดหวัง
  // Transform request objects into the flat row format expected by the GAS syncBatch handler
  const rows = requests
    .filter(r => r.position) // กรอง rows ที่ไม่มี position ออก — GAS ต้องการ position / Skip rows without a position — required by GAS
    .map(r => ({
      hcId:            r.hcId || r.id || '',                                // HCID หรือ Firestore ID / HCID or Firestore doc ID
      openDate:        getIso(r.createdAt),                                  // วันที่เปิด request / Request creation date
      employmentType:  r.employmentType || 'Monthly',                        // ประเภทการจ้าง / Employment type (default: Monthly)
      requestType:     r.requestType === 'New HC' ? 'New HC' : 'Replace',   // ประเภท request: New HC หรือ Replace / New HC or Replacement
      position:        r.position || '',                                     // ตำแหน่งงาน / Job position
      jg:              r.jg || '',                                           // Job Grade / Job grade
      department:      r.department || '',                                   // แผนก / Department
      division:        r.businessUnit || r.division || '',                   // Division (Col H) / Division or business unit
      assignedToName:  r.assignedToName || '',                               // ชื่อ TA ที่ได้รับมอบหมาย / Assigned TA name
      status:          STATUS_MAP[r.status] || r.status || '',               // สถานะ (แปลงผ่าน STATUS_MAP) / Mapped status
      candidateName:   r.candidateName || '',                                // ชื่อผู้สมัคร / Candidate name
      offeringDate:    r.offeringDate || '',                                 // วันที่ offer / Offering date
      startDate:       r.startDate || '',                                    // วันเริ่มงาน / Start date
      contractEndDate: r.contractEndDate || '',                              // วันสิ้นสุดสัญญา (สำหรับ contract) / Contract end date
    }))

  // ถ้าไม่มี rows ที่จะ sync ให้ return เงียบๆ
  // If there are no valid rows after filtering, skip the POST entirely
  if (!rows.length) return

  // ── แบ่ง rows เป็น chunk ขนาด 100 แล้วส่งทีละ chunk ───────────────────────
  // GAS มี execution time limit — ส่งทีละ 100 แถวป้องกัน timeout
  const CHUNK = 100
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'syncBatch', rows: chunk }),
        mode: 'no-cors',
      })
      console.log(`[syncBatchToSheets] chunk ${Math.floor(i/CHUNK)+1}: synced ${chunk.length} rows (${i+chunk.length}/${rows.length})`)
    } catch (err) {
      console.error(`[syncBatchToSheets] chunk ${Math.floor(i/CHUNK)+1} error:`, err)
    }
  }
}

/**
 * ดึง hc_requests ทั้งหมดจาก Firestore แล้ว push ไป Google Sheets
 * ใช้เมื่อต้องการ sync Firestore → Sheets แบบ on-demand (เช่น กรณีเปิดเคสใหม่แล้วไม่ไป Sheets)
 */
export async function syncAllToSheets(onProgress) {
  const { collection, getDocs } = await import('firebase/firestore')
  const { db } = await import('./firebase')
  const snap = await getDocs(collection(db, 'hc_requests'))
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  if (onProgress) onProgress({ loaded: docs.length, total: docs.length })
  await syncBatchToSheets(docs)
  return { total: docs.length }
}

/**
 * ส่งข้อมูล HC Request ใหม่ไปยัง Google Apps Script Webhook
 * Sends a new HC Request's data to the Google Apps Script Webhook (doPost handler).
 *
 * ใช้ text/plain + no-cors เพราะ GAS ไม่รองรับ CORS preflight
 * Uses text/plain Content-Type and no-cors mode because GAS cannot handle CORS preflight requests.
 * Response จาก no-cors จะเป็น opaque — ถ้าไม่ throw ถือว่าสำเร็จ
 * With no-cors, the response is opaque — success is assumed if no network error is thrown.
 *
 * @param {Object} data - ข้อมูล request ที่จะส่งไปยัง GAS / Request data payload to send to GAS
 * @returns {Promise<{success: boolean, message: string}>}
 *   - success: true ถ้าส่งสำเร็จ (ไม่มี throw), false ถ้าเกิด error
 *              true if sent without a network error, false if an error was thrown
 *   - message: ข้อความผลลัพธ์ภาษาไทย หรือ error message ถ้าล้มเหลว
 *              Thai result message, or the error message on failure
 */
/**
 * แจ้ง GAS ให้ลบ row ใน Google Sheets เมื่อ Admin ลบ request
 * Notifies GAS to delete the corresponding row in "Job Openings" sheet.
 *
 * @param {string} hcId - HCID ของ request เช่น 'REQ-2026-042'
 * @returns {Promise<void>}
 */
export async function sendDeleteToSheets(hcId) {
  if (!DATA_URL || !hcId) return
  try {
    const params = new URLSearchParams({ action: 'deleteRow', hcId })
    if (GAS_SECRET) params.set('secret', GAS_SECRET)
    await fetch(`${DATA_URL}?${params.toString()}`)
  } catch (err) {
    console.error('[sendDeleteToSheets] error:', err)
  }
}

/**
 * Sync ข้อมูลจาก Google Sheets → Firestore แบบ on-demand (เร็ว)
 *
 * แนวทาง: GAS แค่ return rows เป็น JSON (ไม่ยุ่ง Firestore)
 * แล้ว frontend query + writeBatch ใน Firebase SDK เอง
 * → เร็วกว่าการให้ GAS เรียก Firestore REST API ทีละ row ~10×
 *
 * Status mapping: Sheets display → app internal
 *   "Active Sourcing" → "Recruiting", "Pending Offer" → "Offering" ฯลฯ
 *
 * @returns {Promise<{success: boolean, synced: number, total: number}>}
 */
export async function syncFromSheets() {
  if (!DATA_URL) return { success: false, error: 'VITE_GAS_DATA_URL not configured' }

  // ── แปลง Sheets display status → internal app status ─────────────────────
  const SHEETS_TO_APP = {
    'To be confirmed': 'Open',          // new mapping: GAS เขียน 'To be confirmed' สำหรับ Open
    'Open':            'Open',          // legacy (เผื่อมีค่าเก่า)
    'Active Sourcing': 'Recruiting',
    'Interviewing':    'Interviewing',  // legacy
    'Pending Offer':   'Offering',
    'Pending Onboard': 'Onboarding',
    'Onboard':         'Closed',
    'Turndown':        'Rejected',      // legacy
    'Job Cancelled':   'Cancelled',
    'On hold':           'OnHold',           // On hold → OnHold status
    'Internal Transfer': 'InternalTransfer', // Internal Transfer → InternalTransfer
    'Confidential':      'Confidential',     // Confidential → Confidential
    // passthrough — in case internal names are written directly in Sheets
    'Recruiting': 'Recruiting', 'Offering':  'Offering',
    'Onboarding': 'Onboarding', 'Closed':    'Closed',
    'Rejected':   'Rejected',   'Cancelled': 'Cancelled',
  }

  try {
    // ── Step 1: ดึง rows จาก GAS (อ่าน Sheets เท่านั้น ไม่ยุ่ง Firestore) ──
    const { collection, query, where, getDocs, writeBatch } =
      await import('firebase/firestore')
    const { db } = await import('./firebase')

    const params = new URLSearchParams({ action: 'getSheetData' })
    if (GAS_SECRET) params.set('secret', GAS_SECRET)
    const gasRes  = await fetch(`${DATA_URL}?${params.toString()}`)
    const gasJson = await gasRes.json()
    if (!gasJson.success) return { success: false, error: gasJson.error }

    const rows = gasJson.rows || []
    if (!rows.length) return { success: true, synced: 0, total: 0 }

    // ── Step 2: Query Firestore หา docRef จาก hcId ───────────────────────────
    // Firestore 'in' query รองรับสูงสุด 30 items ต่อ chunk
    const hcIds  = rows.map(r => r.hcId).filter(Boolean)
    const docMap = {}   // hcId → { ref, currentStatus }

    for (let i = 0; i < hcIds.length; i += 30) {
      const chunk = hcIds.slice(i, i + 30)
      const q     = query(collection(db, 'hc_requests'), where('hcId', 'in', chunk))
      const snap  = await getDocs(q)
      snap.forEach(d => { docMap[d.data().hcId] = { ref: d.ref, currentStatus: d.data().status } })
    }

    // ── Step 3: writeBatch — อัปเดต/สร้าง docs ────────────────────────────────
    const { doc: fsDoc, serverTimestamp } = await import('firebase/firestore')
    const RECRUITING_EQUIVALENT = new Set(['Recruiting', 'Interviewing'])
    let synced = 0
    let created = 0

    for (let i = 0; i < rows.length; i += 400) {
      const batch = writeBatch(db)
      rows.slice(i, i + 400).forEach(row => {
        const entry    = docMap[row.hcId]
        const appStatus = SHEETS_TO_APP[row.status] || 'Open'

        if (entry) {
          // ── UPDATE: doc มีอยู่แล้วใน Firestore ──────────────────────────
          const update = {}
          if (appStatus && !(appStatus === 'Recruiting' && RECRUITING_EQUIVALENT.has(entry.currentStatus))) {
            update.status = appStatus
          }
          if (row.pic)                          update.assignedToName  = row.pic
          if (row.candidate)                    update.candidateName   = row.candidate
          if (row.startDate)                    update.startDate       = row.startDate
          if (row.offeringDate)                 update.offeringDate    = row.offeringDate
          if (row.contractEndDate)              update.contractEndDate = row.contractEndDate
          if (row.division || row.businessUnit) update.businessUnit    = row.division || row.businessUnit
          if (Object.keys(update).length > 0) { batch.update(entry.ref, update); synced++ }
        } else if (row.hcId && row.position) {
          // ── CREATE: row ใหม่ที่ TA เพิ่มใน Sheets แต่ยังไม่มีใน Firestore ─
          const newRef = fsDoc(collection(db, 'hc_requests'))
          batch.set(newRef, {
            hcId:           row.hcId,
            position:       row.position       || '',
            department:     row.department     || '',
            businessUnit:   row.division || row.businessUnit || '',
            jg:             row.jg             || '',
            requestType:    row.requestType    || 'New HC',
            employmentType: row.employmentType || 'Monthly',
            assignedToName: row.pic            || '',
            status:         appStatus,
            candidateName:  row.candidate      || '',
            startDate:      row.startDate      || '',
            offeringDate:   row.offeringDate   || '',
            contractEndDate:row.contractEndDate|| '',
            headcount:      1,
            reason:         'นำเข้าจาก Google Sheets',
            requesterName:  'Sheets Import',
            requesterEmail: '',
            createdAt:      row.openDate ? new Date(row.openDate) : serverTimestamp(),
            importedAt:     serverTimestamp(),
            importedBy:     'sheets-sync',
          })
          created++
        }
      })
      await batch.commit()
    }

    return { success: true, synced, created, total: rows.length }
  } catch (err) {
    console.error('[syncFromSheets] error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * ดึง max HCID seq จาก Google Sheets (สำหรับใช้สร้าง HCID ถัดไป)
 * Returns the highest seq number for the current year found in Sheets, or 0 if unavailable.
 */
export async function getMaxHCIDFromSheets() {
  if (!DATA_URL) return 0
  try {
    const params = new URLSearchParams({ action: 'maxHCID' })
    if (GAS_SECRET) params.set('secret', GAS_SECRET)
    const res  = await fetch(`${DATA_URL}?${params.toString()}`)
    const json = await res.json()
    if (json.success) return json.maxSeq || 0
  } catch (err) {
    console.error('[getMaxHCIDFromSheets] error:', err)
  }
  return 0
}

export async function sendToWebhook(data) {
  if (!WEBHOOK_URL) {
    console.warn('GAS Webhook URL not configured')
    return { success: false, message: 'Webhook URL not configured' }
  }

  try {
    // GAS ไม่รองรับ CORS preflight → ใช้ text/plain + no-cors
    // e.postData.contents ใน GAS ยังอ่านได้ปกติ
    // GAS does not support CORS preflight — use text/plain + no-cors.
    // The GAS script can still read and JSON.parse e.postData.contents normally.
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(data),
      mode: 'no-cors',
    })
    // no-cors คืน opaque response → ถือว่าสำเร็จถ้าไม่ throw
    // no-cors returns an opaque response — treat as success if no exception is thrown
    return { success: true, message: 'ส่งข้อมูลไป Google Sheets เรียบร้อย' }
  } catch (error) {
    console.error('Webhook error:', error)
    return { success: false, message: error.message }
  }
}
