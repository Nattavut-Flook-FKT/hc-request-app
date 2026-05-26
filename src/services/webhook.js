/**
 * webhook.js — Google Apps Script (GAS) Integration Layer (ชั้น integration กับ Google Sheets)
 * ─────────────────────────────────────────────────────────────────────────────
 * บริการนี้ทำหน้าที่เชื่อมต่อระหว่าง Web App กับ Google Apps Script (GAS)
 * ที่ทำงานบน Google Sheets เพื่อ sync ข้อมูล HC Request
 *
 * sendToWebhook       → POST ข้อมูล HC Request ใหม่เข้า Google Sheets (doPost)
 * sendStatusUpdate    → GET updateStatus เมื่อสถานะเปลี่ยนใน Web App (doGet)
 * syncBatchToSheets   → POST batch upsert หลาย rows พร้อมกัน
 * sendMaintenanceAlert→ แจ้งเตือน Slack ผ่าน GAS เมื่อ admin เปิด/ปิดระบบ
 *
 * หมายเหตุ: GAS ไม่รองรับ CORS preflight ดังนั้น POST ใช้ mode: 'no-cors'
 */

const WEBHOOK_URL = import.meta.env.VITE_GAS_WEBHOOK_URL
const DATA_URL    = import.meta.env.VITE_GAS_DATA_URL
const GAS_SECRET  = import.meta.env.VITE_GAS_SECRET || ''

// ── Date helper ──────────────────────────────────────────────────────────────
function formatDateForSheets(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return isoDate
  const parts = isoDate.split('-')
  if (parts.length !== 3) return isoDate
  const [year, month, day] = parts
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const m = months[parseInt(month, 10) - 1]
  return m ? `${parseInt(day, 10)}-${m}-${year}` : isoDate
}

// ── Rate Limiting (Debounce) ─────────────────────────────────────────────────
const _pending = new Map()

function debouncedStatusCall(docId, fn, delay = 800) {
  if (_pending.has(docId)) {
    clearTimeout(_pending.get(docId).timer)
    _pending.get(docId).resolve('cancelled')
  }
  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      _pending.delete(docId)
      resolve(await fn())
    }, delay)
    _pending.set(docId, { timer, resolve })
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function sendMaintenanceAlert(active) {
  if (!DATA_URL) return
  try {
    const params = new URLSearchParams({ action: 'maintenance', active: active.toString() })
    if (GAS_SECRET) params.set('secret', GAS_SECRET)
    await fetch(`${DATA_URL}?${params.toString()}`)
  } catch (err) {
    console.error('[sendMaintenanceAlert] error:', err)
  }
}

export function sendStatusUpdate(
  docId, status,
  assignedToName = null, assignedAt = null,
  startDate = null, candidateName = null,
  hcId = null, offeringDate = null,
  clearInfo = false, cvUrl = null,
) {
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
      const res  = await fetch(`${DATA_URL}?${params.toString()}`)
      const json = await res.json()
      if (!json.success) console.error('[sendStatusUpdate] failed:', json.error)
    } catch (error) {
      console.error('[sendStatusUpdate] error:', error)
    }
  })
}

export async function syncBatchToSheets(requests) {
  if (!WEBHOOK_URL) {
    console.warn('[syncBatchToSheets] VITE_GAS_WEBHOOK_URL not configured')
    return
  }

  function getIso(val) {
    if (!val) return ''
    if (val?.toDate) return val.toDate().toISOString()
    if (val instanceof Date) return val.toISOString()
    return String(val)
  }

  const STATUS_MAP = {
    Open: 'Open', Recruiting: 'Active Sourcing', Interviewing: 'Interviewing',
    Offering: 'Pending Offer', Onboarding: 'Pending Onboard', Closed: 'Onboard',
    Rejected: 'Turndown', Cancelled: 'Job Cancelled', OnHold: 'On hold',
    Confidential: 'Confidential', InternalTransfer: 'Internal Transfer',
  }

  const rows = requests
    .filter(r => r.position)
    .map(r => ({
      hcId:            r.hcId || r.id || '',
      openDate:        getIso(r.createdAt),
      employmentType:  r.employmentType || 'Monthly',
      requestType:     r.requestType === 'New HC' ? 'New HC' : 'Replace',
      position:        r.position || '',
      jg:              r.jg || '',
      department:      r.department || '',
      division:        r.businessUnit || r.division || '',
      assignedToName:  r.assignedToName || '',
      status:          STATUS_MAP[r.status] || r.status || '',
      candidateName:   r.candidateName || '',
      offeringDate:    r.offeringDate || '',
      startDate:       r.startDate || '',
      contractEndDate: r.contractEndDate || '',
    }))

  if (!rows.length) return

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
      console.log(`[syncBatchToSheets] chunk ${Math.floor(i/CHUNK)+1}: synced ${chunk.length} rows`)
    } catch (err) {
      console.error(`[syncBatchToSheets] chunk error:`, err)
    }
  }
}

export async function syncAllToSheets(onProgress) {
  const { collection, getDocs } = await import('firebase/firestore')
  const { db } = await import('./firebase')
  const snap = await getDocs(collection(db, 'hc_requests'))
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  if (onProgress) onProgress({ loaded: docs.length, total: docs.length })
  await syncBatchToSheets(docs)
  return { total: docs.length }
}

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

export async function syncFromSheets() {
  if (!DATA_URL) return { success: false, error: 'VITE_GAS_DATA_URL not configured' }

  const SHEETS_TO_APP = {
    'To be confirmed': 'Open',   'Open':            'Open',
    'Active Sourcing': 'Recruiting', 'Interviewing':'Interviewing',
    'Pending Offer':   'Offering',   'Pending Onboard':'Onboarding',
    'Onboard':         'Closed',     'Turndown':       'Rejected',
    'Job Cancelled':   'Cancelled',  'On hold':        'OnHold',
    'Internal Transfer':'InternalTransfer', 'Confidential':'Confidential',
    'Recruiting': 'Recruiting', 'Offering': 'Offering',
    'Onboarding': 'Onboarding', 'Closed':   'Closed',
    'Rejected':   'Rejected',   'Cancelled':'Cancelled',
  }

  try {
    const { collection, query, where, getDocs, writeBatch } = await import('firebase/firestore')
    const { db } = await import('./firebase')

    const params = new URLSearchParams({ action: 'getSheetData' })
    if (GAS_SECRET) params.set('secret', GAS_SECRET)
    const gasRes  = await fetch(`${DATA_URL}?${params.toString()}`)
    const gasJson = await gasRes.json()
    if (!gasJson.success) return { success: false, error: gasJson.error }

    const rows = gasJson.rows || []
    if (!rows.length) return { success: true, synced: 0, total: 0 }

    const hcIds  = rows.map(r => r.hcId).filter(Boolean)
    const docMap = {}
    for (let i = 0; i < hcIds.length; i += 30) {
      const chunk = hcIds.slice(i, i + 30)
      const q     = query(collection(db, 'hc_requests'), where('hcId', 'in', chunk))
      const snap  = await getDocs(q)
      snap.forEach(d => { docMap[d.data().hcId] = { ref: d.ref, currentStatus: d.data().status } })
    }

    const { doc: fsDoc, serverTimestamp } = await import('firebase/firestore')
    const RECRUITING_EQUIVALENT = new Set(['Recruiting', 'Interviewing'])
    let synced = 0, created = 0

    for (let i = 0; i < rows.length; i += 400) {
      const batch = writeBatch(db)
      rows.slice(i, i + 400).forEach(row => {
        const entry     = docMap[row.hcId]
        const appStatus = SHEETS_TO_APP[row.status] || 'Open'

        if (entry) {
          const update = {}
          if (appStatus && !(appStatus === 'Recruiting' && RECRUITING_EQUIVALENT.has(entry.currentStatus))) {
            update.status = appStatus
          }
          if (row.pic)           update.assignedToName  = row.pic
          if (row.candidate)     update.candidateName   = row.candidate
          if (row.startDate)     update.startDate       = row.startDate
          if (row.offeringDate)  update.offeringDate    = row.offeringDate
          if (row.contractEndDate) update.contractEndDate = row.contractEndDate
          if (row.division || row.businessUnit) update.businessUnit = row.division || row.businessUnit
          if (Object.keys(update).length > 0) { batch.update(entry.ref, update); synced++ }
        } else if (row.hcId && row.position) {
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
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(data),
      mode: 'no-cors',
    })
    return { success: true, message: 'ส่งข้อมูลไป Google Sheets เรียบร้อย' }
  } catch (error) {
    console.error('Webhook error:', error)
    return { success: false, message: error.message }
  }
}
