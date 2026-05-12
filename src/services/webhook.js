/**
 * webhook.js — Google Apps Script (GAS) Integration Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * All GAS calls are routed through the Firebase Cloud Function proxy at /api/gas.
 * The GAS URL and secret token are stored server-side only — never in the bundle.
 *
 * gasGet(action, params)  → POST /api/gas { type:'get', action, params }  → GAS doGet
 * gasPost(body)           → POST /api/gas { type:'post', body }            → GAS doPost
 */

import { getAuth } from 'firebase/auth'

// Proxy endpoint — served by Firebase Hosting rewrite → Cloud Function gasProxy
const GAS_PROXY = '/api/gas'

// ── Auth token helper ────────────────────────────────────────────────────────
async function getIdToken() {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return user.getIdToken()
}

// ── Core proxy helpers ───────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  const token = await getIdToken()
  const res = await fetch(GAS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ type: 'get', action, params }),
  })
  return res.json()
}

async function gasPost(body) {
  const token = await getIdToken()
  await fetch(GAS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ type: 'post', body }),
  })
}

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
  try {
    await gasGet('maintenance', { active: active.toString() })
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
  return debouncedStatusCall(docId, async () => {
    try {
      const params = { id: docId, status }
      if (assignedToName) params.assignedToName = assignedToName
      if (assignedAt)     params.assignedAt     = assignedAt
      if (startDate)      params.startDate      = startDate
      if (candidateName)  params.candidateName  = candidateName
      if (hcId)           params.hcId           = hcId
      if (offeringDate)   params.offeringDate   = offeringDate
      if (clearInfo)      params.clearInfo      = '1'
      if (cvUrl)          params.cvUrl          = cvUrl
      const json = await gasGet('updateStatus', params)
      if (!json.success) console.error('[sendStatusUpdate] failed:', json.error)
    } catch (err) {
      console.error('[sendStatusUpdate] error:', err)
    }
  })
}

export async function syncBatchToSheets(requests) {
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
      await gasPost({ action: 'syncBatch', rows: chunk })
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
  if (!hcId) return
  try {
    await gasGet('deleteRow', { hcId })
  } catch (err) {
    console.error('[sendDeleteToSheets] error:', err)
  }
}

export async function syncFromSheets() {
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

    const gasJson = await gasGet('getSheetData')
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
  try {
    const json = await gasGet('maxHCID')
    if (json.success) return json.maxSeq || 0
  } catch (err) {
    console.error('[getMaxHCIDFromSheets] error:', err)
  }
  return 0
}

export async function sendToWebhook(data) {
  try {
    await gasPost(data)
    return { success: true, message: 'ส่งข้อมูลไป Google Sheets เรียบร้อย' }
  } catch (err) {
    console.error('Webhook error:', err)
    return { success: false, message: err.message }
  }
}
