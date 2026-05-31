// =====================================
// CONFIG
// =====================================
// Firebase project ID — อ่านจาก Script Properties (key: FIREBASE_PROJECT_ID)

// ── JG Label Map — แปลง JG code → ชื่อเต็ม สำหรับ Sheets column Rank ──────
var JG_LABELS = {
  'JG14': 'JG14 — Chief Executive Officer',
  'JG13': 'JG13 — C-Level',
  'JG12': 'JG12 — Vice President',
  'JG11': 'JG11 — Head of Department',
  'JG10': 'JG10 — Senior Manager / Associate Director',
  'JG9':  'JG9 — Manager / Lead',
  'JG8':  'JG8 — Assistant Manager / Team Lead',
  'JG7':  'JG7 — Senior Supervisor / Senior Specialist',
  'JG6':  'JG6 — Supervisor / Specialist',
  'JG5':  'JG5 — Senior Officer / Executive',
  'JG4':  'JG4 — Officer',
  'JG3':  'JG3 — Staff / Assistant',
  'JG2':  'JG2 — Master',
  'JG1':  'JG1 — Staff (Monthly)',
  'JG0':  'JG0 — Contract Staff',
  'Internship': 'Internship',
}
function getJGLabel_(jg) { return jg ? (JG_LABELS[jg] || jg) : '' }

// ชื่อ sheet หลักที่ใช้เก็บข้อมูลทั้งหมด (ใช้ sheet เดียวต่อเนื่องไม่แยกปี)
var JOB_OPENINGS_SHEET = 'Job Openings 2025'

function resolveJobOpeningSheet_(_hcId) {
  return JOB_OPENINGS_SHEET
}

/**
 * setStatusSafe_ — เขียนค่า status ลงใน cell โดยรองรับ Sheets ที่มี strict validation
 * ถ้า setValue() throw (validation reject) → ล้าง validation แล้ว retry
 * จากนั้น reapply STATUS_DROPDOWN_LIST เพื่อรักษา chip display style
 */
var STATUS_DROPDOWN_LIST = [
  'To be confirmed', 'Active Sourcing', 'Pending Offer', 'Offer Accepted',
  'Onboard', 'Job Cancelled', 'Turndown', 'On hold', 'Internal Transfer', 'Confidential'
]
function setStatusSafe_(cell, value) {
  try {
    cell.setValue(value)
  } catch (e) {
    // validation ปัจจุบันของ cell ไม่รองรับค่านี้ — ล้าง validation แล้ว retry
    try { cell.clearDataValidations() } catch(_) {}
    try {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(STATUS_DROPDOWN_LIST, true)
        .setAllowInvalid(true).build()
      cell.setDataValidation(rule)
    } catch(_) {}
    cell.setValue(value)
  }
}

// Columns ใน sheet "Job Openings YYYY" (1-based index)
// ถ้า header เปลี่ยน ให้แก้ค่าตรงนี้
var COL_OPEN_JOBS  = 1   // A: Open Jobs
var COL_EMP_TYPE   = 2   // B: Emp. Type
var COL_JOB_TYPE   = 3   // C: Job Type
var COL_HCID       = 4   // D: HCID
var COL_POSITION   = 5   // E: Position
var COL_RANK       = 6   // F: Rank
var COL_DEPT       = 7   // G: Department
var COL_BU         = 8   // H: Business Unit
var COL_PIC        = 9   // I: PIC
var COL_STATUS     = 10  // J: Status
var COL_CANDIDATE  = 11  // K: Offered Candidate
var COL_OFFER_DATE = 12  // L: Offering Date
var COL_START_DATE = 16  // P: Onboard Date

// =====================================
// REVERSE SYNC: Sheets → Firestore
// =====================================

/**
 * รันครั้งเดียวจาก GAS Editor เพื่อสร้าง Installable Trigger
 * Run → setupTriggers (ต้องการสิทธิ์ scriptowner เท่านั้น)
 *
 * Simple onEdit trigger ใช้ UrlFetchApp ไม่ได้ → ต้องเป็น Installable Trigger เท่านั้น
 */
function setupTriggers() {
  // ลบ trigger onSheetEdit เดิมก่อน (ป้องกัน duplicate)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onSheetEdit') {
      ScriptApp.deleteTrigger(t)
      Logger.log('Deleted existing onSheetEdit trigger')
    }
  })
  // สร้าง Installable onEdit trigger ใหม่
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create()
  Logger.log('✅ onSheetEdit trigger created — Sheets → Firestore sync is now active')
}

/**
 * onEdit trigger — ตรวจจับการแก้ไขใน sheet "Job Openings YYYY"
 *
 * เมื่อ TA แก้ค่า Status (col J), PIC (col I) หรือ Offering Date (col L) ใน Sheets
 * script จะอ่าน HCID (col D) แล้วอัพเดต Firestore ผ่าน REST API
 *
 * ⚠️  ต้องรัน setupTriggers() ก่อน 1 ครั้งเพื่อสร้าง Installable Trigger
 * (Simple Trigger ใช้ UrlFetchApp ไม่ได้)
 */
function onSheetEdit(e) {
  try {
    var sheet = e.source.getActiveSheet()
    // ทำงานเฉพาะ sheet ชื่อ "Job Openings YYYY"
    if (!sheet.getName().startsWith('Job Openings')) return

    var range    = e.range
    var startCol = range.getColumn()
    var startRow = range.getRow()
    var numRows  = range.getNumRows()
    var numCols  = range.getNumColumns()

    // ตรวจว่า range ครอบคลุม col ที่ต้องการ sync
    var hasPic       = startCol <= COL_PIC       && (startCol + numCols - 1) >= COL_PIC
    var hasStatus    = startCol <= COL_STATUS    && (startCol + numCols - 1) >= COL_STATUS
    var hasOfferDate = startCol <= COL_OFFER_DATE && (startCol + numCols - 1) >= COL_OFFER_DATE
    var hasCandidate = startCol <= COL_CANDIDATE  && (startCol + numCols - 1) >= COL_CANDIDATE
    var hasStartDate = startCol <= COL_START_DATE && (startCol + numCols - 1) >= COL_START_DATE
    if (!hasPic && !hasStatus && !hasOfferDate && !hasCandidate && !hasStartDate) return

    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    // วน process ทุก row ใน range (รองรับ multi-cell paste)
    for (var ri = 0; ri < numRows; ri++) {
      var row = startRow + ri
      if (row <= 1) continue // ข้าม header row

      var hcId = sheet.getRange(row, COL_HCID).getValue()
      if (!hcId) continue

      var status        = sheet.getRange(row, COL_STATUS).getValue()
      var pic           = sheet.getRange(row, COL_PIC).getValue()
      var candidateName = sheet.getRange(row, COL_CANDIDATE).getValue()
      var startDate     = sheet.getRange(row, COL_START_DATE).getValue()
      var offeringDate  = sheet.getRange(row, COL_OFFER_DATE).getValue()

      // แปลง Date objects เป็น string D-MMM-YYYY
      function fmtDate_(d) {
        if (!d) return null
        if (d instanceof Date && !isNaN(d)) return d.getDate() + '-' + months[d.getMonth()] + '-' + d.getFullYear()
        return d.toString().trim() || null
      }

      // อัพเดต Firestore
      var result = updateFirestoreByHcId_(hcId, {
        status:         status                 || null,
        assignedToName: pic                    || null,
        candidateName:  candidateName          || null,
        startDate:      fmtDate_(startDate),
        offeringDate:   fmtDate_(offeringDate),
      })
      Logger.log('[onSheetEdit] row=' + row + ' hcId=' + hcId + ' → ' + JSON.stringify(result))
    }
  } catch (err) {
    Logger.log('[onSheetEdit] ERROR: ' + err.message)
  }
}

/**
 * อัพเดต Firestore document ที่มี hcId ตรงกัน
 * ใช้ Firestore REST API + ScriptApp.getOAuthToken() สำหรับ authentication
 *
 * ขั้นตอน:
 *   1. Query Firestore: hc_requests WHERE hcId == hcId (limit 1)
 *   2. ได้ document name (resource path) มา
 *   3. PATCH document ด้วย fields ที่ต้องการอัพเดต
 *
 * @param {string} hcId  - HCID เช่น 'REQ-2026-411'
 * @param {object} data  - { status, assignedToName, candidateName, startDate }
 * @returns {object}     - { success, docId } หรือ { success: false, error }
 */
function updateFirestoreByHcId_(hcId, data) {
  var baseUrl = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents'
  var token   = ScriptApp.getOAuthToken()
  var headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }

  // ── Step 1: Query ──────────────────────────────────────────────────────────
  var queryPayload = {
    structuredQuery: {
      from: [{ collectionId: 'hc_requests' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'hcId' },
          op: 'EQUAL',
          value: { stringValue: hcId.toString().trim() }
        }
      },
      limit: 1
    }
  }

  var queryResp = UrlFetchApp.fetch(baseUrl + ':runQuery', {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(queryPayload),
    muteHttpExceptions: true
  })

  var queryData = JSON.parse(queryResp.getContentText())
  if (!queryData[0] || !queryData[0].document) {
    return { success: false, error: 'Document not found for hcId: ' + hcId }
  }

  var docName = queryData[0].document.name  // full resource path
  var docId   = docName.split('/').pop()

  // ── Step 2: สร้าง fields object สำหรับ PATCH ─────────────────────────────
  // เฉพาะ field ที่มีค่า (ไม่ส่ง null ไปเพื่อป้องกัน overwrite ข้อมูลที่มีอยู่)
  var fields = {}
  var updateMask = []

  // แปลง Sheets display status → app internal status ก่อนเช็ค VALID_STATUSES
  // (เมื่อ TA แก้ใน Sheets ค่าจะเป็น display name เช่น 'Active Sourcing', 'To be confirmed')
  var SHEETS_TO_APP_STATUS = {
    'To be confirmed':   'Open',              'Open':              'Open',
    'Active Sourcing':   'Recruiting',        'Interviewing':      'Interviewing',
    'Pending Offer':     'Offering',          'Pending Onboard':   'Onboarding',  'Offer Accepted':    'Onboarding',
    'Onboard':           'Closed',            'Job Cancelled':     'Cancelled',
    'Turndown':          'Rejected',          'On hold':           'OnHold',
    'Internal Transfer': 'InternalTransfer',  'Confidential':      'Confidential',
  }
  var VALID_STATUSES = ['Open','Recruiting','Interviewing','Offering','Onboarding',
                        'Rejected','Closed','Cancelled','OnHold','InternalTransfer','Confidential']
  var appStatus = data.status ? (SHEETS_TO_APP_STATUS[data.status] || data.status) : null

  if (appStatus && VALID_STATUSES.includes(appStatus)) {
    fields['status'] = { stringValue: appStatus }
    updateMask.push('status')
  }
  if (data.assignedToName) {
    fields['assignedToName'] = { stringValue: data.assignedToName }
    updateMask.push('assignedToName')
  }
  if (data.candidateName) {
    fields['candidateName'] = { stringValue: data.candidateName }
    updateMask.push('candidateName')
  }
  if (data.startDate) {
    fields['startDate'] = { stringValue: data.startDate }
    updateMask.push('startDate')
  }
  if (data.offeringDate) {
    fields['offeringDate'] = { stringValue: data.offeringDate }
    updateMask.push('offeringDate')
  }

  if (updateMask.length === 0) return { success: true, docId, note: 'nothing to update' }

  // ── Step 3: PATCH document ─────────────────────────────────────────────────
  // updateMask ระบุเฉพาะ field ที่ต้องการอัพเดต (ไม่ลบ field อื่น)
  var patchUrl = baseUrl + '/hc_requests/' + docId + '?'
    + updateMask.map(function(f) { return 'updateMask.fieldPaths=' + f }).join('&')

  var patchResp = UrlFetchApp.fetch(patchUrl, {
    method: 'patch',
    headers: headers,
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  })

  var patchStatus = patchResp.getResponseCode()
  if (patchStatus !== 200) {
    return { success: false, error: 'PATCH failed: ' + patchResp.getContentText() }
  }

  return { success: true, docId: docId }
}

// =====================================
// SLACK NOTIFICATIONS
// =====================================
// อ่าน Slack webhook URL จาก Script Properties (GAS Editor → Project Settings → Script Properties)
// key: SLACK_NEW_REQUEST, SLACK_UPDATES
var _props              = PropertiesService.getScriptProperties()
var FIREBASE_PROJECT_ID = _props.getProperty('FIREBASE_PROJECT_ID') || 'hcrequest'
var SLACK_NEW_REQUEST   = _props.getProperty('SLACK_NEW_REQUEST')   || ''
var SLACK_UPDATES       = _props.getProperty('SLACK_UPDATES')       || ''
var SLACK_SUBTEAM       = _props.getProperty('SLACK_SUBTEAM')       || ''
var APP_URL             = _props.getProperty('APP_URL')             || 'https://hcrequest.web.app'
// HR Spreadsheet (MainData + Manager_Access) — ต้องตั้งค่าใน Script Properties
// key: HR_SPREADSHEET_ID  (ไม่มี fallback เพื่อป้องกัน spreadsheet ID หลุดในโค้ด)
var HR_SPREADSHEET_ID   = _props.getProperty('HR_SPREADSHEET_ID')   || ''
// Secret token สำหรับป้องกัน GAS endpoint — ต้องตั้งค่าใน Script Properties
// key: DEPLOY_SECRET  (ใส่ random string เช่น uuid หรือ passphrase)
// Web app ส่ง ?secret=XXX มาทุก request ที่ mutate ข้อมูล
var DEPLOY_SECRET     = _props.getProperty('DEPLOY_SECRET')     || ''

/**
 * ตรวจ secret token ที่ส่งมาใน request parameter
 * ถ้า DEPLOY_SECRET ไม่ได้ตั้งค่าไว้ใน Script Properties → ผ่านทุก request (backward compat)
 * ถ้าตั้งค่าแล้ว → ต้อง match เท่านั้น
 */
function isValidSecret_(e) {
  if (!DEPLOY_SECRET) return true  // ยังไม่ได้ตั้งค่า → ผ่าน (เพื่อ backward compat)
  return (e.parameter.secret || '') === DEPLOY_SECRET
}

/**
 * เปิด HR Spreadsheet (ไฟล์แยก — มี MainData + Manager_Access)
 * อ่าน ID จาก Script Properties (GAS Editor → Project Settings → Script Properties)
 * key: HR_SPREADSHEET_ID
 */
function getHrSpreadsheet_() {
  if (!HR_SPREADSHEET_ID) throw new Error('HR_SPREADSHEET_ID not set in Script Properties')
  return SpreadsheetApp.openById(HR_SPREADSHEET_ID)
}

function slackNewRequest(data) {
  Logger.log('[slackNewRequest] START hcId=' + data.hcId + ' url_set=' + (SLACK_NEW_REQUEST ? SLACK_NEW_REQUEST.substring(0,40) + '…' : 'EMPTY'))
  var emoji = data.requestType === 'New HC' ? '🆕' : '🔁'
  var type  = data.requestType === 'New HC'
    ? 'New HC × ' + data.headcount
    : 'Replacement (ทดแทน ' + (data.replacementFor || '-') + ')'
  var mention = SLACK_SUBTEAM ? ' ' + SLACK_SUBTEAM : ''
  var text = emoji + ' *HC Request ใหม่*' + mention + '\n' +
    '*ตำแหน่ง:* ' + data.position + '  |  *JG:* ' + data.jg + '\n' +
    '*แผนก:* ' + data.department + '  |  *Location:* ' + data.orgTrack + '\n' +
    '*ประเภท:* ' + type + '\n' +
    '*ผู้ยื่น:* ' + data.requesterName + '\n' +
    '🔗 ' + APP_URL + '/all-requests'
  Logger.log('[slackNewRequest] calling sendSlack_ …')
  sendSlack_(SLACK_NEW_REQUEST, text)
  Logger.log('[slackNewRequest] DONE')
}

function slackStatusUpdate(position, department, oldStatus, newStatus, assignedTo, candidateName) {
  var icons = { Recruiting:'🔍', Interviewing:'🗣️', Offering:'📋', Onboarding:'🟦', Rejected:'❌', Closed:'✅', Cancelled:'🚫', Open:'📂' }
  var emoji = icons[newStatus] || '🔄'
  var taLine = assignedTo ? '\n*คนรับเคส:* ' + assignedTo : ''
  var candidateLine = (newStatus === 'Onboarding' && candidateName) ? '\n*Candidate:* ' + candidateName : ''
  var text = emoji + ' *Status อัพเดต*\n' +
    '*ตำแหน่ง:* ' + position + ' (' + department + ')\n' +
    '*สถานะ:* ' + oldStatus + ' → *' + newStatus + '*' + taLine + candidateLine
  sendSlack_(SLACK_UPDATES, text)
}

function sendSlack_(webhookUrl, text) {
  if (!webhookUrl) { Logger.log('[sendSlack_] SKIP — webhookUrl is empty'); return }
  try {
    var resp = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true
    })
    Logger.log('[sendSlack_] HTTP ' + resp.getResponseCode() + ' body=' + resp.getContentText().substring(0, 80))
  } catch (err) {
    Logger.log('[sendSlack_] EXCEPTION: ' + err.message)
  }
}

// =====================================
// DO GET
// =====================================
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()

  // ── DEBUG ──────────────────────────────────────────────────────────────────
  if (e.parameter.action === 'debug') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var info = { ssId: null, ssName: null, sheets: [], jobSheetFound: false, jobSheetRows: 0 }
    if (ss) {
      info.ssId   = ss.getId()
      info.ssName = ss.getName()
      info.sheets = ss.getSheets().map(function(s) { return s.getName() })
      var js = ss.getSheetByName(JOB_OPENINGS_SHEET)
      if (js) { info.jobSheetFound = true; info.jobSheetRows = js.getLastRow() }
    } else {
      info.error = 'getActiveSpreadsheet() returned null'
    }
    return responseJson_(info)
  }

  // ── DEBUG HR: เช็คการเข้าถึง HR Spreadsheet ──────────────────────────────
  // เรียกด้วย ?action=debugHR
  if (e.parameter.action === 'debugHR') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    try {
      var hrSsTest = getHrSpreadsheet_()
      var hrSheets = hrSsTest.getSheets().map(function(s) { return s.getName() })
      var mdSheet  = hrSsTest.getSheetByName('MainData')
      var mgSheetT = hrSsTest.getSheetByName('Manager_Access')
      return responseJson_({
        hrSsName: hrSsTest.getName(),
        sheets: hrSheets,
        mainDataFound: !!mdSheet,
        mainDataRows: mdSheet ? mdSheet.getLastRow() : 0,
        mainDataCols: mdSheet ? mdSheet.getLastColumn() : 0,
        managerAccessFound: !!mgSheetT,
        sampleRow: mdSheet && mdSheet.getLastRow() > 1 ? mdSheet.getRange(2, 1, 1, mdSheet.getLastColumn()).getValues()[0] : []
      })
    } catch(err) {
      return responseJson_({ error: err.message })
    }
  }

  // ── TEST CLEAR: ทดสอบล้าง candidate + startDate โดยตรง ────────────────────
  // เรียกด้วย ?action=testClear&hcId=REQ-2026-411&secret=XXX
  if (e.parameter.action === 'testClear') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var testHcId = e.parameter.hcId
    if (!testHcId) return responseJson_({ error: 'missing hcId param' })
    var jobSheet = ss.getSheetByName(JOB_OPENINGS_SHEET)
    if (!jobSheet) return responseJson_({ error: 'sheet not found: ' + JOB_OPENINGS_SHEET })
    var lastRow = jobSheet.getLastRow()
    var hcidVals = jobSheet.getRange(2, COL_HCID, lastRow - 1, 1).getValues()
    for (var i = 0; i < hcidVals.length; i++) {
      if (hcidVals[i][0].toString().trim() === testHcId.toString().trim()) {
        var rowNum = i + 2
        var before = {
          candidate: jobSheet.getRange(rowNum, COL_CANDIDATE).getValue(),
          startDate: jobSheet.getRange(rowNum, COL_START_DATE).getValue(),
        }
        jobSheet.getRange(rowNum, COL_CANDIDATE).setValue('')
        jobSheet.getRange(rowNum, COL_START_DATE).setValue('')
        return responseJson_({ success: true, rowNum: rowNum, before: before, cleared: true })
      }
    }
    return responseJson_({ success: false, error: 'hcId not found: ' + testHcId })
  }

  // ── DELETE ROW: ลบ row ออกจาก JOB_OPENINGS_SHEET โดยใช้ HCID ───────────────
  // เรียกด้วย ?action=deleteRow&hcId=REQ-2026-NNN&secret=XXX
  if (e.parameter.action === 'deleteRow') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var delHcId = e.parameter.hcId
    if (!delHcId) return responseJson_({ error: 'missing hcId param' })
    var delSheetName = resolveJobOpeningSheet_(delHcId)
    var delSheet = ss.getSheetByName(delSheetName)
    if (!delSheet) return responseJson_({ error: 'sheet not found: ' + delSheetName })
    var delLastRow = delSheet.getLastRow()
    if (delLastRow < 2) return responseJson_({ success: false, error: 'sheet is empty' })
    var delHcids = delSheet.getRange(2, COL_HCID, delLastRow - 1, 1).getValues()
    for (var di = 0; di < delHcids.length; di++) {
      if (delHcids[di][0].toString().trim() === delHcId.toString().trim()) {
        delSheet.deleteRow(di + 2)
        return responseJson_({ success: true, deleted: delHcId, rowNum: di + 2 })
      }
    }
    return responseJson_({ success: false, error: 'hcId not found: ' + delHcId })
  }

  if (e.parameter.action === 'maintenance') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var isDown = e.parameter.active === 'true'
    var msg = isDown
      ? '🔴 *ระบบ HC Request ปิดปรับปรุงชั่วคราว*' + (SLACK_SUBTEAM ? ' ' + SLACK_SUBTEAM : '') + '\nไม่สามารถเข้าใช้งานได้ขณะนี้ กรุณารอสักครู่'
      : '🟢 *ระบบ HC Request เปิดใช้งานแล้ว*' + (SLACK_SUBTEAM ? ' ' + SLACK_SUBTEAM : '') + '\nสามารถเข้าใช้งานได้ที่ ' + APP_URL
    sendSlack_(SLACK_NEW_REQUEST, msg)
    sendSlack_(SLACK_UPDATES, msg)
    return responseJson_({ success: true })
  }

  if (e.parameter.action === 'updateStatus') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    try {
      const docId          = e.parameter.id
      const newStatus      = e.parameter.status
      const assignedToName = e.parameter.assignedToName || null
      const startDate      = e.parameter.startDate      || null
      const candidateName  = e.parameter.candidateName  || null
      const hcId           = e.parameter.hcId           || null   // HCID เช่น REQ-2026-411
      const offeringDate   = e.parameter.offeringDate   || null   // วัน Offer ISO string
      const clearInfo      = e.parameter.clearInfo === '1'        // ล้าง candidateName + startDate
      const cvUrl          = e.parameter.cvUrl          || null   // ลิ้ง CV (Google Drive, etc.)

      const VALID = ['Open','Recruiting','Interviewing','Offering','Onboarding','Rejected','Closed','Cancelled']
      if (!docId || !newStatus)       return responseJson_({ success: false, error: 'Missing params' })
      if (!VALID.includes(newStatus)) return responseJson_({ success: false, error: 'Invalid status: ' + newStatus })

      // ── แปลง internal status → Sheets status ──────────────────────────────
      const sheetsStatus = toSheetsStatus_(newStatus)

      var position = '', dept = '', oldStatus = ''

      // ── อัพเดต JOB_OPENINGS_SHEET โดยใช้ HCID (ถ้ามี) ──────────────────────
      if (hcId) {
        const jobSheet = ss.getSheetByName(resolveJobOpeningSheet_(hcId))
        if (jobSheet && jobSheet.getLastRow() > 1) {
          const hcidValues = jobSheet.getRange(2, COL_HCID, jobSheet.getLastRow() - 1, 1).getValues()
          for (let i = 0; i < hcidValues.length; i++) {
            if (hcidValues[i][0].toString().trim() === hcId.toString().trim()) {
              const rowNum = i + 2
              oldStatus = jobSheet.getRange(rowNum, COL_STATUS).getValue()
              position  = jobSheet.getRange(rowNum, COL_POSITION).getValue()
              dept      = jobSheet.getRange(rowNum, COL_DEPT).getValue()

              setStatusSafe_(jobSheet.getRange(rowNum, COL_STATUS), sheetsStatus)
              if (assignedToName) {
                jobSheet.getRange(rowNum, COL_PIC).setValue(assignedToName)
              }
              if (clearInfo) {
                jobSheet.getRange(rowNum, COL_CANDIDATE).setValue('')   // ล้างชื่อ Candidate (ล้าง formula ด้วย)
                jobSheet.getRange(rowNum, COL_START_DATE).setValue('')  // ล้างวันเริ่มงาน
              } else {
                if (candidateName) {
                  if (cvUrl) {
                    // มี CV URL → เขียนเป็น HYPERLINK formula: ชื่อ Candidate กลายเป็น clickable link
                    var safeUrl  = cvUrl.replace(/"/g, '""')          // escape double-quotes ใน URL
                    var safeName = candidateName.replace(/"/g, '""')  // escape double-quotes ในชื่อ
                    jobSheet.getRange(rowNum, COL_CANDIDATE).setFormula('=HYPERLINK("' + safeUrl + '","' + safeName + '")')
                  } else {
                    jobSheet.getRange(rowNum, COL_CANDIDATE).setValue(candidateName)
                  }
                }
                if (startDate === 'CLEAR') {
                  jobSheet.getRange(rowNum, COL_START_DATE).setValue('')  // ล้าง Onboard Date
                } else if (startDate) {
                  var sd = new Date(startDate)
                  var sdMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                  if (!isNaN(sd)) {
                    jobSheet.getRange(rowNum, COL_START_DATE).setValue(sd.getDate() + '-' + sdMonths[sd.getMonth()] + '-' + sd.getFullYear())
                  } else {
                    jobSheet.getRange(rowNum, COL_START_DATE).setValue(startDate)
                  }
                }
              }
              if (offeringDate === 'CLEAR') {
                // กลับไปสถานะก่อน Offering → ล้างค่า
                jobSheet.getRange(rowNum, COL_OFFER_DATE).setValue('')
                jobSheet.getRange(rowNum, 13).setValue('')  // Offer Month
                jobSheet.getRange(rowNum, 14).setValue('')  // Offer Year
                jobSheet.getRange(rowNum, 15).setValue('')  // SLA Offer (Y.M.D)
              } else if (offeringDate) {
                var od = new Date(offeringDate)
                var oMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                jobSheet.getRange(rowNum, COL_OFFER_DATE).setValue(od.getDate() + '-' + oMonths[od.getMonth()] + '-' + od.getFullYear())
                jobSheet.getRange(rowNum, 13).setValue(String(od.getMonth() + 1).padStart(2, '0'))  // Offer Month
                jobSheet.getRange(rowNum, 14).setValue(String(od.getFullYear()))                    // Offer Year
                // SLA Offer (Y.M.D) = จำนวนวันตั้งแต่ Open Date ถึง Offering Date (col O = 15)
                var openDateVal = jobSheet.getRange(rowNum, COL_OPEN_JOBS).getValue()
                if (openDateVal) {
                  var openDateObj = openDateVal instanceof Date ? openDateVal : new Date(openDateVal)
                  var slaDays = Math.round((od - openDateObj) / (1000 * 60 * 60 * 24))
                  if (slaDays >= 0) jobSheet.getRange(rowNum, 15).setValue(slaDays)
                }
              }
              break
            }
          }
        }
      }

      // ── อัพเดต HC_Request sheet (legacy) ────────────────────────────────────
      const sheet = ss.getSheetByName('HC_Request')
      if (sheet) {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        const idColIdx        = headers.indexOf('Request ID')
        const statusColIdx    = headers.indexOf('Status')
        const taColIdx        = headers.indexOf('คนรับเคส')
        const startDateColIdx = headers.indexOf('วันที่เริ่มงาน')
        const candidateColIdx = headers.indexOf('ชื่อ Candidate')
        const posColIdx       = headers.indexOf('ตำแหน่ง')
        const deptColIdx      = headers.indexOf('แผนก')

        if (idColIdx !== -1) {
          for (let i = 2; i <= sheet.getLastRow(); i++) {
            if (sheet.getRange(i, idColIdx + 1).getValue() === docId) {
              if (!position) position = posColIdx  !== -1 ? sheet.getRange(i, posColIdx  + 1).getValue() : ''
              if (!dept)     dept     = deptColIdx !== -1 ? sheet.getRange(i, deptColIdx + 1).getValue() : ''
              if (!oldStatus) oldStatus = statusColIdx !== -1 ? sheet.getRange(i, statusColIdx + 1).getValue() : ''

              if (statusColIdx    !== -1) sheet.getRange(i, statusColIdx    + 1).setValue(newStatus)
              if (assignedToName && taColIdx        !== -1) sheet.getRange(i, taColIdx        + 1).setValue(assignedToName)
              if (startDate      && startDateColIdx !== -1) sheet.getRange(i, startDateColIdx + 1).setValue(startDate)
              if (candidateName  && candidateColIdx !== -1) sheet.getRange(i, candidateColIdx + 1).setValue(candidateName)
              break
            }
          }
        }
      }

      slackStatusUpdate(position, dept, oldStatus, newStatus, assignedToName, candidateName)
      return responseJson_({ success: true })
    } catch (err) {
      return responseJson_({ success: false, error: err.message })
    }
  }

  // ── UPDATE OPEN DATE: แก้ Column A (Open Jobs) ย้อนหลัง ─────────────────────
  // เรียกด้วย ?action=updateOpenDate&hcId=REQ-2026-XXX&openDate=ISO_STRING&secret=XXX
  if (e.parameter.action === 'updateOpenDate') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var hcIdParam   = e.parameter.hcId     || ''
    var openDateParam = e.parameter.openDate || ''
    if (!hcIdParam || !openDateParam) return responseJson_({ success: false, error: 'Missing hcId or openDate' })
    try {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      var d = new Date(openDateParam)
      if (isNaN(d)) return responseJson_({ success: false, error: 'Invalid openDate: ' + openDateParam })
      var openDateFmt = d.getDate() + '-' + months[d.getMonth()] + '-' + d.getFullYear()

      var jobSheet = ss.getSheetByName(resolveJobOpeningSheet_(hcIdParam))
      if (!jobSheet || jobSheet.getLastRow() <= 1) return responseJson_({ success: false, error: 'Sheet not found or empty' })

      var hcidVals = jobSheet.getRange(2, COL_HCID, jobSheet.getLastRow() - 1, 1).getValues()
      var updated = false
      for (var i = 0; i < hcidVals.length; i++) {
        if (hcidVals[i][0].toString().trim() === hcIdParam.toString().trim()) {
          jobSheet.getRange(i + 2, COL_OPEN_JOBS).setValue(openDateFmt)
          updated = true
          break
        }
      }
      return responseJson_({ success: updated, row: updated ? 'updated' : 'not found', openDate: openDateFmt })
    } catch(err) {
      return responseJson_({ success: false, error: err.message })
    }
  }

  // ── FETCH CSV PROXY: ดึง CSV จาก URL ผ่าน GAS (ไม่มีปัญหา CORS) ─────────────
  // เรียกด้วย ?action=fetchCSV&url=ENCODED_URL&secret=XXX
  // GAS ใช้ UrlFetchApp ซึ่งทำงาน server-side ไม่ถูก browser CORS block
  if (e.parameter.action === 'fetchCSV') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var fetchUrl = e.parameter.url
    if (!fetchUrl) return responseJson_({ error: 'Missing url parameter' })
    // ── SSRF protection: ป้องกัน GCP metadata และ private IP ────────────────
    if (!/^https?:\/\//i.test(fetchUrl)) return responseJson_({ error: 'URL ต้องเป็น HTTP หรือ HTTPS เท่านั้น' })
    var urlLower = fetchUrl.toLowerCase()
    var ssrfBlocked = ['metadata.google.internal','169.254.','192.168.','10.0.','127.0.0.1','localhost','0.0.0.0','::1','file://']
    for (var bi = 0; bi < ssrfBlocked.length; bi++) {
      if (urlLower.indexOf(ssrfBlocked[bi]) !== -1) return responseJson_({ error: 'URL ไม่ได้รับอนุญาต' })
    }
    try {
      var fetchResp = UrlFetchApp.fetch(fetchUrl, {
        muteHttpExceptions: true,
        followRedirects: true,
      })
      var fetchCode = fetchResp.getResponseCode()
      if (fetchCode !== 200) return responseJson_({ error: 'HTTP ' + fetchCode + ' — ตรวจสอบว่า Sheet เป็น public' })
      var csvText = fetchResp.getContentText()
      // ตรวจว่าเป็น HTML (Google login redirect) แทนที่จะเป็น CSV
      if (csvText.trim().startsWith('<')) return responseJson_({ error: 'Sheet ต้องเป็น public — เปิด "Anyone with link can view"' })
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, csv: csvText }))
        .setMimeType(ContentService.MimeType.JSON)
    } catch (fcErr) {
      return responseJson_({ error: fcErr.message })
    }
  }

  // ── FETCH SHEET BY ID: อ่าน Sheet โดยตรงผ่าน SpreadsheetApp (ไม่ต้อง public) ────
  // GAS รันในฐานะเจ้าของ script ซึ่งมี access ถึง Sheet ใน same Google account อยู่แล้ว
  // เรียกด้วย ?action=fetchSheetById&spreadsheetId=XXX&gid=YYY&secret=XXX
  // return: { success: true, headers: [...], rows: [[...], ...] }
  if (e.parameter.action === 'fetchSheetById') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var fsbId  = e.parameter.spreadsheetId
    var fsbGid = e.parameter.gid || '0'
    if (!fsbId) return responseJson_({ error: 'Missing spreadsheetId' })
    try {
      var fsbSs = SpreadsheetApp.openById(fsbId)
      // ค้นหา sheet ตาม gid
      var fsbSheet = null
      var fsbSheets = fsbSs.getSheets()
      for (var si = 0; si < fsbSheets.length; si++) {
        if (String(fsbSheets[si].getSheetId()) === String(fsbGid)) {
          fsbSheet = fsbSheets[si]
          break
        }
      }
      if (!fsbSheet) fsbSheet = fsbSs.getSheets()[0] // fallback → sheet แรก
      var fsbLastRow = fsbSheet.getLastRow()
      var fsbLastCol = fsbSheet.getLastColumn()
      if (fsbLastRow < 2 || fsbLastCol < 1) return responseJson_({ success: true, headers: [], rows: [] })
      var fsbAll     = fsbSheet.getRange(1, 1, fsbLastRow, fsbLastCol).getValues()
      var fsbHeaders = fsbAll[0].map(function(h) { return String(h).trim() })
      var fsbRows    = fsbAll.slice(1)
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, headers: fsbHeaders, rows: fsbRows }))
        .setMimeType(ContentService.MimeType.JSON)
    } catch (fsbErr) {
      return responseJson_({ error: fsbErr.message })
    }
  }

  // ── MAX HCID: ค้นหา seq สูงสุดของปีนี้ใน Sheet — ใช้สร้าง HCID ถัดไป ──────
  // เรียกด้วย ?action=maxHCID&secret=XXX
  if (e.parameter.action === 'maxHCID') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    try {
      var mYear   = new Date().getFullYear()
      var mPrefix = 'REQ-' + mYear + '-'
      var mSheet  = ss ? ss.getSheetByName(resolveJobOpeningSheet_(null)) : null
      var mMaxSeq = 0
      if (mSheet && mSheet.getLastRow() > 1) {
        // จำกัดที่ 1,000 แถวแรก — ตัด orphaned rows ที่อยู่แถว 1700+ ทิ้ง
        var mScanRows = Math.min(mSheet.getLastRow() - 1, 1000)
        var mVals = mSheet.getRange(2, COL_HCID, mScanRows, 1).getValues()
        mVals.forEach(function(row) {
          var v = (row[0] || '').toString().trim()
          if (v.indexOf(mPrefix) === 0) {
            var seq = parseInt(v.split('-')[2]) || 0
            if (seq > mMaxSeq) mMaxSeq = seq
          }
        })
      }
      return responseJson_({
        success:  true,
        year:     mYear,
        maxSeq:   mMaxSeq,
        nextHCID: mPrefix + (mMaxSeq + 1),
      })
    } catch (mErr) {
      return responseJson_({ success: false, error: mErr.message })
    }
  }

  // ── LAST SYNC LOG: ดูผลล่าสุดของ syncBatch POST call ──────────────────────
  // เรียกได้หลังกด Sync ทันที: ?action=lastSyncLog&secret=XXX
  if (e.parameter.action === 'lastSyncLog') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    var raw = PropertiesService.getScriptProperties().getProperty('_lastSyncLog')
    return responseJson_({ log: raw ? JSON.parse(raw) : null, note: 'ผล POST syncBatch ล่าสุด — null = ยังไม่เคยถูกเรียก' })
  }

  // ── TEST WRITE: เขียน 1 row ทดสอบลง Sheet แล้วคืน JSON — ใช้ debug ว่า GAS เขียน Sheet ได้จริงมั้ย ──
  // เรียกด้วย ?action=testWrite&secret=XXX  (เปิด URL ใน browser ได้เลย — GET response อ่านได้)
  if (e.parameter.action === 'testWrite') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    try {
      var twSheet = ss ? ss.getSheetByName(JOB_OPENINGS_SHEET) : null
      if (!ss)      return responseJson_({ error: 'getActiveSpreadsheet() returned null — script ไม่ได้ bind กับ spreadsheet' })
      if (!twSheet) return responseJson_({ error: 'Sheet not found: ' + JOB_OPENINGS_SHEET + ' | available: ' + ss.getSheets().map(function(s){return s.getName()}).join(', ') })
      var twLastRow = twSheet.getLastRow()
      var twResult  = syncBatchHandler_(ss, [{
        hcId:           'TEST-9999',
        openDate:       '2026-01-01',
        employmentType: 'Monthly',
        requestType:    'New HC',
        position:       'TEST POSITION',
        jg:             'JG5',
        department:     'TEST DEPT',
        businessUnit:   'TEST BU',
        assignedToName: 'Tester',
        status:         'Open',
        candidateName:  '',
        offeringDate:   '',
        startDate:      '',
        contractEndDate:'',
      }])
      var twNewLast = twSheet.getLastRow()
      return responseJson_({
        testWrite: 'done',
        sheetName: JOB_OPENINGS_SHEET,
        rowsBefore: twLastRow,
        rowsAfter: twNewLast,
        syncResult: JSON.parse(twResult.getContent()),
      })
    } catch (twErr) {
      return responseJson_({ error: twErr.message, stack: twErr.stack })
    }
  }

  // ── GET SHEET DATA: ส่ง rows กลับเป็น JSON ให้ frontend ทำ Firestore batch write เอง
  // เร็วกว่า syncFromSheets แบบเดิม (ที่เรียก Firestore REST API ทีละ row) มาก
  // เรียกด้วย ?action=getSheetData&secret=XXX
  if (e.parameter.action === 'getSheetData') {
    if (!isValidSecret_(e)) return responseJson_({ error: 'Unauthorized' })
    try {
      var gdSheet = ss.getSheetByName(JOB_OPENINGS_SHEET)
      if (!gdSheet) return responseJson_({ error: 'Sheet not found: ' + JOB_OPENINGS_SHEET })

      var gdLastRow = gdSheet.getLastRow()
      if (gdLastRow < 2) return responseJson_({ success: true, rows: [] })

      var COL_CONTRACT_END = 17  // Q: Contract End Date
      var gdCols   = Math.max(COL_STATUS, COL_PIC, COL_CANDIDATE, COL_START_DATE, COL_CONTRACT_END)
      var gdData   = gdSheet.getRange(2, 1, gdLastRow - 1, gdCols).getValues()
      var gdMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

      function fmtDateCell_(raw) {
        if (!raw) return ''
        if (raw instanceof Date && !isNaN(raw)) return raw.getDate() + '-' + gdMonths[raw.getMonth()] + '-' + raw.getFullYear()
        return raw.toString().trim()
      }

      var gdRows = []
      gdData.forEach(function(row) {
        var hcId = (row[COL_HCID - 1] || '').toString().trim()
        if (!hcId) return

        // แยก JG code จาก rank label เช่น "JG5 — Senior Officer / Executive" → "JG5"
        var rankRaw = (row[COL_RANK - 1] || '').toString().trim()
        var jgCode  = rankRaw ? rankRaw.split(/\s|—/)[0].trim() : ''

        gdRows.push({
          hcId:           hcId,
          openDate:       fmtDateCell_(row[COL_OPEN_JOBS  - 1]),
          employmentType: (row[COL_EMP_TYPE  - 1] || '').toString().trim(),
          requestType:    (row[COL_JOB_TYPE  - 1] || '').toString().trim(),
          position:       (row[COL_POSITION  - 1] || '').toString().trim(),
          jg:             jgCode,
          department:     (row[COL_DEPT      - 1] || '').toString().trim(),
          businessUnit:   (row[COL_BU        - 1] || '').toString().trim(),
          pic:            (row[COL_PIC       - 1] || '').toString().trim(),
          status:         (row[COL_STATUS    - 1] || '').toString().trim(),
          candidate:      (row[COL_CANDIDATE - 1] || '').toString().trim(),
          offeringDate:   fmtDateCell_(row[COL_OFFER_DATE - 1]),
          startDate:      fmtDateCell_(row[COL_START_DATE - 1]),
          contractEndDate:fmtDateCell_(row[COL_CONTRACT_END - 1]),
        })
      })

      return responseJson_({ success: true, rows: gdRows })
    } catch (gdErr) {
      return responseJson_({ success: false, error: gdErr.message })
    }
  }

  // ดึงข้อมูลพนักงานและ Manager จาก Spreadsheet แยก (HR database)
  // ครอบด้วย try/catch เพื่อป้องกัน crash → GAS จะคืน JSON error (มี CORS header) แทน HTML
  try {
    const hrSs      = getHrSpreadsheet_()

    const mgSheet   = hrSs.getSheetByName('Manager_Access')
    if (!mgSheet) return responseJson_({ error: 'Sheet Manager_Access not found in HR spreadsheet' })
    const mgData    = mgSheet.getDataRange().getValues()
    const managers  = {}
    for (let i = 1; i < mgData.length; i++) {
      if (mgData[i][0]) managers[mgData[i][0].trim()] = mgData[i][1] ? mgData[i][1].trim() : ''
    }

    const mainSheet = hrSs.getSheetByName('MainData')
    if (!mainSheet) return responseJson_({ error: 'Sheet MainData not found in HR spreadsheet' })
    const mainData  = mainSheet.getDataRange().getValues()
    const employees = {}, positionsByDept = {}
    for (let i = 1; i < mainData.length; i++) {
      const name = mainData[i][1]?.toString().trim()
      const dept = mainData[i][3]?.toString().trim()
      const pos  = mainData[i][4]?.toString().trim()
      if (name && dept) {
        if (!employees[dept]) employees[dept] = []
        employees[dept].push(name)
      }
      if (pos && dept) {
        if (!positionsByDept[dept]) positionsByDept[dept] = new Set()
        positionsByDept[dept].add(pos)
      }
    }
    const positions = {}
    for (const [dept, set] of Object.entries(positionsByDept)) {
      positions[dept] = [...set].sort()
    }
    return ContentService
      .createTextOutput(JSON.stringify({ managers, positions, employees }))
      .setMimeType(ContentService.MimeType.JSON)
  } catch (err) {
    return responseJson_({ error: 'HR data load failed: ' + err.message })
  }
}

// =====================================
// DO POST
// =====================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents)
    var ss   = SpreadsheetApp.getActiveSpreadsheet()

    // ─── syncBatch ──────────────────────────────────────────
    if (data.action === 'syncBatch') {
      var syncLog = { time: new Date().toISOString(), rowsReceived: (data.rows || []).length, result: null, error: null }
      try {
        var syncResult = syncBatchHandler_(ss, data.rows || [])
        syncLog.result = JSON.parse(syncResult.getContent())
        PropertiesService.getScriptProperties().setProperty('_lastSyncLog', JSON.stringify(syncLog))
        return syncResult
      } catch (sbErr) {
        syncLog.error = sbErr.message
        PropertiesService.getScriptProperties().setProperty('_lastSyncLog', JSON.stringify(syncLog))
        return responseJson_({ success: false, error: sbErr.message, rows: (data.rows || []).length })
      }
    }

    // ─── New HC / Replacement request ────────────────────────
    // 1) upsert เข้า "Job Openings YYYY" ทันที (sheet หลักที่ TA ใช้งาน)
    // 2) append เข้า "HC_Request" (sheet สำรอง/legacy)
    // 3) ส่ง Slack notification

    // แปลง createdAt เป็น Date สำหรับ openDate
    var openDateObj = data.createdAt ? new Date(data.createdAt) : new Date()
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    var openDateFmt = openDateObj.getDate() + '-' + months[openDateObj.getMonth()] + '-' + openDateObj.getFullYear()

    // Map ข้อมูลให้ตรงกับ format ของ syncBatchHandler_
    var jobOpeningRow = {
      hcId:           data.hcId || data.id || '',   // REQ-YYYY-NNN
      openDate:       openDateFmt,
      employmentType: data.employmentType || 'Monthly',
      requestType:    data.requestType === 'New HC' ? 'New HC' : 'Replace',
      position:       data.position || '',
      jg:             data.jg || '',
      department:     data.department || '',
      businessUnit:   data.businessUnit || data.division || '',
      assignedToName: '',                           // ยังไม่มี TA ตอน Open
      status:         'Open',
      candidateName:  '',
      offeringDate:   '',
      startDate:      '',
      contractEndDate: '',
    }
    // ── Slack ก่อนเลย — ไม่ให้ Sheets error มาบล็อก ─────────────────────────
    Logger.log('[doPost] hcId=' + (data.hcId || data.id) + ' maintenance=' + data.maintenance)
    if (!data.maintenance) {
      Logger.log('[doPost] calling slackNewRequest …')
      try { slackNewRequest(data) } catch (slackErr) {
        Logger.log('[doPost] slackNewRequest error: ' + slackErr.message)
      }
    } else {
      Logger.log('[doPost] SKIPPED Slack — maintenance=true')
    }

    // ── Sheets sync ────────────────────────────────────────────────────────────
    try {
      syncBatchHandler_(ss, [jobOpeningRow])
    } catch (sheetErr) {
      Logger.log('[doPost] syncBatchHandler_ error: ' + sheetErr.message)
    }

    // HC_Request sheet (legacy — เก็บไว้เพื่อ backward compat)
    try {
      var sheet = ss.getSheetByName('HC_Request') || ss.insertSheet('HC_Request')
      if (sheet.getLastRow() === 0) {
        sheet.appendRow([
          'Status','ประเภทคำขอ','Job Grade','ตำแหน่ง','แผนก','Google Drive Link',
          'ชื่อผู้ยื่น','คนรับเคส','จำนวน HC','เหตุผล','Requirements',
          'วันที่เริ่มงาน','วันที่ลาออก (LWD)','ทดแทน (ชื่อ)','Email ผู้ยื่น','Timestamp','Request ID',
          'ชื่อ Candidate',
        ])
        sheet.getRange(1, 1, 1, 18).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff')
        sheet.setFrozenRows(1)
      }
      var isNew = data.requestType === 'New HC'
      sheet.appendRow([
        data.status, data.requestType, data.jg, data.position, data.department,
        data.driveLink || '', data.requesterName, '',
        data.headcount, data.reason, data.requirements || '',
        isNew ? data.targetStartDate : '', isNew ? '' : data.targetStartDate,
        data.replacementFor || '', data.requesterEmail,
        new Date(data.createdAt), data.id,
        '',
      ])
    } catch (legacyErr) {
      Logger.log('[doPost] HC_Request legacy sheet error: ' + legacyErr.message)
    }

    return responseJson_({ success: true })
  } catch (err) {
    return responseJson_({ success: false, error: err.message })
  }
}

// =====================================
// STATUS MAPPING HELPER
// แปลง internal app status → Sheets display status (ค่าที่อยู่ใน data validation dropdown)
// ────────────────────────────────────────────────────────────────────────────
// Sheets dropdown อนุญาต: Active Sourcing, Pending Offer, Pending Onboard,
//   Onboard, Internal Transfer, Job Cancelled, Confidential, To be confirmed, On hold
// =====================================
function toSheetsStatus_(appStatus) {
  var map = {
    'Open':           'To be confirmed',   // ยังไม่เริ่ม → รอยืนยัน
    'Recruiting':     'Active Sourcing',
    'Interviewing':   'Active Sourcing',   // Interviewing ไม่มีใน dropdown
    'Offering':       'Pending Offer',
    'Onboarding':     'Offer Accepted',
    'Closed':         'Onboard',
    'Rejected':       'Job Cancelled',     // Turndown ไม่มีใน dropdown
    'Cancelled':      'Job Cancelled',
    // pass-through (ค่าที่เขียนใน Sheets อยู่แล้ว)
    'Active Sourcing':  'Active Sourcing',
    'Pending Offer':    'Pending Offer',
    'Pending Onboard':  'Offer Accepted',
    'Offer Accepted':   'Offer Accepted',
    'To be confirmed':  'To be confirmed',
    'Job Cancelled':    'Job Cancelled',
    'On hold':          'On hold',
    'Internal Transfer':'Internal Transfer',
    'Confidential':     'Confidential',
  }
  return map[appStatus] || appStatus
}

// =====================================
// SYNC BATCH HANDLER
// upsert rows ลง sheet "Job Openings YYYY" โดยใช้ HCID เป็น key
// - ดึงปีจาก HCID (REQ-2025-001 → "Job Openings 2025")
//   ไม่สร้าง sheet ใหม่ถ้ามีอยู่แล้ว เพียงแต่ append/update rows
// - ถ้ายังไม่มี sheet สำหรับปีนั้น จะสร้างใหม่พร้อม header
// =====================================
function syncBatchHandler_(ss, rows) {
  if (!rows || rows.length === 0) return responseJson_({ success: true, synced: 0 })

  var HEADERS = [
    'Open Jobs','Emp. Type','Job Type','HCID','Position','Rank',
    'Department','Business Unit','PIC','Status','Offered Candidate',
    'Offering Date','Offer Month','Offer Year','SLA Offer (Y.M.D)',
    'Onboard Date','Contract End Date','Over SLA','Weeks Offer'
  ]
  var HCID_COL = 4  // column D (1-based)

  // ── cache: sheetName → { sheet, rowMap } ────────────────────────────────
  // สร้างครั้งเดียวต่อ sheet เพื่อลดจำนวน API calls
  var sheetCache = {}

  function getSheetContext(sheetName) {
    if (sheetCache[sheetName]) return sheetCache[sheetName]

    var sheet = ss.getSheetByName(sheetName)

    // สร้าง sheet ใหม่ถ้ายังไม่มีสำหรับปีนั้น
    if (!sheet) {
      sheet = ss.insertSheet(sheetName)
      sheet.appendRow(HEADERS)
      sheet.getRange(1, 1, 1, HEADERS.length)
        .setFontWeight('bold')
        .setBackground('#008065')
        .setFontColor('#ffffff')
      sheet.setFrozenRows(1)
    } else {
      // ── ตรวจว่า row 1 เป็น header แล้วหรือยัง ──────────────────────────
      // ถ้า A1 ไม่ใช่ 'Open Jobs' → sheet ยังไม่มี header row (ข้อมูลเริ่มตั้งแต่ row 1)
      // แก้โดย insert row ว่างที่ row 1 แล้วใส่ header + formatting
      var firstCell = sheet.getRange(1, 1).getValue().toString().trim()
      if (firstCell !== 'Open Jobs') {
        sheet.insertRowBefore(1)
        // ขยาย column ก่อนถ้า sheet มีน้อยกว่า HEADERS.length
        var hCurCols = sheet.getMaxColumns()
        if (hCurCols < HEADERS.length) sheet.insertColumnsAfter(hCurCols, HEADERS.length - hCurCols)
        sheet.getRange(1, 1, 1, HEADERS.length)
          .setValues([HEADERS])
          .setFontWeight('bold')
          .setBackground('#008065')
          .setFontColor('#ffffff')
        sheet.setFrozenRows(1)
      }
    }

    // สร้าง rowMap: HCID → rowNumber (เริ่มจาก row 2 เสมอ เพราะ row 1 = header)
    var rowMap = {}
    var lastRow = sheet.getLastRow()
    if (lastRow > 1) {
      sheet.getRange(2, HCID_COL, lastRow - 1, 1).getValues()
        .forEach(function(cell, i) {
          if (cell[0]) rowMap[cell[0].toString().trim()] = i + 2
        })
    }

    sheetCache[sheetName] = { sheet: sheet, rowMap: rowMap }
    return sheetCache[sheetName]
  }

  var synced = 0
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  rows.forEach(function(r) {
    if (!r.hcId) return

    // ใช้ sheet ตามปีของ HCID (REQ-2025-001 → 'Job Openings 2025', REQ-2026-411 → 'Job Openings 2026')
    var ctx = getSheetContext(resolveJobOpeningSheet_(r.hcId))

    // ── แปลง dates ─────────────────────────────────────────────────────────
    var openDate = ''
    if (r.openDate) {
      try {
        var d = new Date(r.openDate)
        openDate = d.getDate() + '-' + months[d.getMonth()] + '-' + d.getFullYear()
      } catch(_) {}
    }

    var offeringDateFmt = '', offerMonth = '', offerYear = ''
    if (r.offeringDate) {
      try {
        var od = new Date(r.offeringDate)
        offeringDateFmt = od.getDate() + '-' + months[od.getMonth()] + '-' + od.getFullYear()
        offerMonth = String(od.getMonth() + 1).padStart(2, '0')
        offerYear  = String(od.getFullYear())
      } catch(_) {}
    }

    var rowData = [
      openDate,
      r.employmentType || 'Monthly',
      r.requestType    || '',
      r.hcId,
      r.position       || '',
      getJGLabel_(r.jg),
      r.department     || '',
      r.businessUnit   || '',
      r.assignedToName || '',
      toSheetsStatus_(r.status || ''),
      r.candidateName  || '',
      offeringDateFmt,
      offerMonth,
      offerYear,
      '',                        // SLA Offer (Y.M.D) — computed separately
      r.startDate      || '',
      r.contractEndDate|| '',
      '',                        // Over SLA — computed separately
      '',                        // Weeks Offer — computed separately
    ]

    var hcIdKey     = r.hcId.toString().trim()
    var existingRow = ctx.rowMap[hcIdKey]

    if (existingRow) {
      // อัพเดต row ที่มีอยู่ทันที (scattered → ต้องทำทีละ row)
      // ใช้ setStatusSafe_ ก่อน setValues เพื่อป้องกัน strict validation throw
      setStatusSafe_(ctx.sheet.getRange(existingRow, COL_STATUS), rowData[COL_STATUS - 1])
      ctx.sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData])
      synced++
    } else {
      // เก็บ row ใหม่ไว้ก่อน → จะ batch write ทีเดียวตอนท้าย
      if (!ctx.newRows) ctx.newRows = []
      ctx.newRows.push({ hcIdKey: hcIdKey, rowData: rowData })
    }
  })

  // ── Batch write แถวใหม่ทั้งหมดในแต่ละ sheet ครั้งเดียว ──────────────────
  // ใช้ setValues([...]) แทน appendRow() ในลูป → เร็วกว่า 10-20x
  Object.keys(sheetCache).forEach(function(sheetName) {
    var ctx = sheetCache[sheetName]
    if (!ctx.newRows || ctx.newRows.length === 0) return

    // หา last row ที่มีค่าใน HCID column (col D) จริงๆ
    // ป้องกัน getLastRow() คืนค่าสูงเกินจริงเพราะ row เก่าที่เหลือจาก sync ก่อนหน้า
    var totalRows = ctx.sheet.getLastRow()
    var lastDataRow = 1
    if (totalRows > 1) {
      var hcidVals = ctx.sheet.getRange(2, HCID_COL, totalRows - 1, 1).getValues()
      for (var ri = hcidVals.length - 1; ri >= 0; ri--) {
        if (hcidVals[ri][0]) { lastDataRow = ri + 2; break }
      }
    }
    var startRow = lastDataRow + 1
    var allRowData = ctx.newRows.map(function(nr) { return nr.rowData })

    // ขยาย column ถ้า sheet มีน้อยกว่า HEADERS.length
    var curCols = ctx.sheet.getMaxColumns()
    if (curCols < HEADERS.length) {
      ctx.sheet.insertColumnsAfter(curCols, HEADERS.length - curCols)
    }
    // ขยาย row ถ้า sheet มีน้อยกว่า startRow + rows ที่จะเพิ่ม
    var curRows = ctx.sheet.getMaxRows()
    var neededRows = startRow + allRowData.length - 1
    if (curRows < neededRows) {
      ctx.sheet.insertRowsAfter(curRows, neededRows - curRows)
    }

    var range = ctx.sheet.getRange(startRow, 1, allRowData.length, HEADERS.length)
    // ไม่ต้อง setDataValidation(null) — GAS เขียนค่าได้โดยไม่สนใจ validation rules
    range.setValues(allRowData)

    // คัดลอก format + Chip-style validation จาก row 2 ไปยัง row ใหม่
    // เพื่อให้ row ใหม่ได้ Chip display style เหมือนกับ row ที่มีอยู่แล้ว
    var templateLastRow = ctx.sheet.getLastRow()
    if (templateLastRow >= 2) {
      var templateRange = ctx.sheet.getRange(2, 1, 1, HEADERS.length)
      templateRange.copyTo(range, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false)
      templateRange.copyTo(range, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false)
      // หลัง copyTo ให้ setValues อีกครั้งเพราะ PASTE_FORMAT อาจล้างค่า
      range.setValues(allRowData)
    }

    // อัพเดต rowMap ด้วย
    ctx.newRows.forEach(function(nr, i) {
      ctx.rowMap[nr.hcIdKey] = startRow + i
    })
    synced += ctx.newRows.length
  })

  var sheets = Object.keys(sheetCache).join(', ')
  return responseJson_({ success: true, synced: synced, sheets: sheets })
}

// ── applySheetValidation_: ตั้ง dropdown validation บน Emp. Type / Job Type / Rank / Dept / BU / PIC / Status ──
// เรียกหลัง batch write เพื่อให้ Sheets มี dropdown picker เหมือน Sheets ต้นฉบับ
function applySheetValidation_(sheet) {
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return  // ไม่มี data rows

  var dataRows = lastRow - 1  // ไม่รวม header

  // ── Emp. Type (col B) ──────────────────────────────────────────────────────
  sheet.getRange(2, COL_EMP_TYPE, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['Monthly', 'Daily', 'Contract', 'Intern'], true)
      .setAllowInvalid(false).build()
  )

  // ── Job Type (col C) ───────────────────────────────────────────────────────
  sheet.getRange(2, COL_JOB_TYPE, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['New HC', 'Replace'], true)
      .setAllowInvalid(false).build()
  )

  // ── Rank (col F) — static JG label list ────────────────────────────────────
  var rankList = Object.keys(JG_LABELS).map(function(k) { return JG_LABELS[k] })
  sheet.getRange(2, COL_RANK, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(rankList, true)
      .setAllowInvalid(true).build()  // allowInvalid=true เพราะข้อมูลเก่าอาจมี format ต่างกัน
  )

  // ── Department (col G) — dynamic: อ่านค่า unique จาก column นั้นเลย ─────────
  var deptRaw = sheet.getRange(2, COL_DEPT, dataRows, 1).getValues()
  var deptSet = {}
  deptRaw.forEach(function(r) { var v = (r[0] || '').toString().trim(); if (v) deptSet[v] = true })
  var deptList = Object.keys(deptSet).sort()
  if (deptList.length > 0) {
    sheet.getRange(2, COL_DEPT, dataRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(deptList.slice(0, 500), true)
        .setAllowInvalid(true).build()
    )
  }

  // ── Business Unit (col H) — dynamic ────────────────────────────────────────
  var buRaw = sheet.getRange(2, COL_BU, dataRows, 1).getValues()
  var buSet = {}
  buRaw.forEach(function(r) { var v = (r[0] || '').toString().trim(); if (v) buSet[v] = true })
  var buList = Object.keys(buSet).sort()
  if (buList.length > 0) {
    sheet.getRange(2, COL_BU, dataRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(buList.slice(0, 500), true)
        .setAllowInvalid(true).build()
    )
  }

  // ── PIC (col I) — dynamic ──────────────────────────────────────────────────
  var picRaw = sheet.getRange(2, COL_PIC, dataRows, 1).getValues()
  var picSet = {}
  picRaw.forEach(function(r) { var v = (r[0] || '').toString().trim(); if (v) picSet[v] = true })
  var picList = Object.keys(picSet).sort()
  if (picList.length > 0) {
    sheet.getRange(2, COL_PIC, dataRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(picList.slice(0, 500), true)
        .setAllowInvalid(true).build()
    )
  }

  // ── Status (col J) ─────────────────────────────────────────────────────────
  sheet.getRange(2, COL_STATUS, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList([
        'To be confirmed',
        'Active Sourcing',
        'Pending Offer',
        'Offer Accepted',
        'Onboard',
        'Job Cancelled',
        'Turndown',
        'On hold',
        'Internal Transfer',
        'Confidential',
      ], true)
      .setAllowInvalid(false).build()
  )
}

// ── Helper ──────────────────────────────────────────────────────
function responseJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
}
