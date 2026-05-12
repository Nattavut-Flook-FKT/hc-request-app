const { onRequest } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

admin.initializeApp()

const ALLOWED_ORIGINS = [
  'https://hcrequest.web.app',
  'https://hcrequest.firebaseapp.com',
]

/**
 * GAS Proxy — keeps GAS URL and secret server-side only.
 * Frontend calls POST /api/gas with { type, action, params, body }.
 * Function verifies Firebase Auth token then forwards to GAS.
 */
exports.gasProxy = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return }

  // Verify Firebase ID token — only authenticated @freshket.co users can call GAS
  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    await admin.auth().verifyIdToken(idToken)
  } catch {
    res.status(401).json({ error: 'Invalid token' }); return
  }

  const GAS_DATA_URL    = process.env.GAS_DATA_URL    || ''
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || ''
  const GAS_SECRET      = process.env.GAS_SECRET      || ''

  const { type, action, params = {}, body } = req.body || {}

  try {
    if (type === 'get') {
      // Forward to GAS doGet
      if (!GAS_DATA_URL) { res.status(500).json({ error: 'GAS_DATA_URL not configured' }); return }
      const urlParams = new URLSearchParams({ action, ...params })
      if (GAS_SECRET) urlParams.set('secret', GAS_SECRET)
      const gasRes = await fetch(`${GAS_DATA_URL}?${urlParams}`, { redirect: 'follow' })
      const data = await gasRes.json()
      res.json(data)

    } else if (type === 'post') {
      // Forward to GAS doPost (GAS doesn't support CORS — server-side fetch has no issue)
      if (!GAS_WEBHOOK_URL) { res.status(500).json({ error: 'GAS_WEBHOOK_URL not configured' }); return }
      await fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body),
      })
      res.json({ success: true })

    } else {
      res.status(400).json({ error: 'Invalid type — use "get" or "post"' })
    }
  } catch (err) {
    console.error('[gasProxy] error:', err)
    res.status(500).json({ error: err.message })
  }
})
