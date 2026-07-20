/**
 * @file ManagerRequestsView.jsx
 * @description Status board that lets a Manager track all of their own HC
 * (headcount) requests in real time.
 *
 * @overview
 * The component subscribes to the `hc_requests` Firestore collection,
 * filtering by `requesterEmail == user.email` (up to 200 documents,
 * ordered newest-first). It uses the Page Visibility API to tear down the
 * Firestore listener whenever the browser tab is hidden and re-subscribe
 * when the tab becomes visible again — avoiding unnecessary read costs and
 * stale-listener issues on mobile.
 *
 * @architecture
 * Sub-components (all defined in this file):
 *  - PipelineTrack   – horizontal progress dots for the 6-stage pipeline
 *  - ExpandedDetail  – collapsible detail panel (reason, requirements,
 *                      reject reason, JD/CV file buttons, status history)
 *  - RequestRow      – single table row with expand/collapse, SLA counter,
 *                      candidate name, and start date
 *  - Scorecard       – 5-card summary strip (Open / Recruiting+Interviewing /
 *                      Offering / Onboarding / Closed)
 *
 * @constants
 *  - STATUS  – per-status Tailwind class sets (bar, pill, dot colour)
 *  - STAGES  – ordered array of the 6 pipeline stages
 *
 * @functions
 *  - getPipelineIndex – maps a status string to its 0-based index in STAGES
 *  - computeSLA       – calculates elapsed "active" calendar days for a
 *                       request, pausing the clock during Offering/Onboarding
 *                       and resetting it when the pipeline loops back
 *
 * @param {{ email: string }} user – The currently authenticated user object.
 *   Only `user.email` is consumed; the Firestore query is skipped entirely
 *   when this prop is absent.
 */
import { useEffect, useState, useMemo } from 'react'
import { collection, onSnapshot, orderBy, query, where, limit, getDoc, doc } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { getJDSignedUrl, getCVSignedUrl } from '../../services/supabase'
import { Loader2, FileText, File, UserCheck, Calendar, ChevronDown, ChevronUp, ChevronsUpDown, FilePlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getDepartments } from '../../data/orgStructure'
import { resolveDeptNames } from '../../data/deptMapping'
import { grantedKeys } from '../../utils/grants'
import { slaLimit } from '../../utils/sla'

/**
 * STATUS — colour token map for every possible request status (DS tokens).
 *
 * Each key is a valid `req.status` string. Each value contains Tailwind
 * class strings used across the UI:
 *  - `bar`  – the thin left-edge accent bar inside RequestRow
 *  - `pill` – the small status badge (background + text + border)
 *  - `ring` – ring color class for the active PipelineTrack dot
 */
// ─── Status colour map ─────────────────────────────────────
const STATUS = {
  Open:         { bar: 'bg-yellow-600',     pill: 'bg-yellow-50 text-yellow-900 border-yellow-100',     ring: 'ring-yellow-600' },
  Recruiting:   { bar: 'bg-dark-green-600', pill: 'bg-dark-green-50 text-dark-green-900 border-dark-green-100', ring: 'ring-dark-green-600' },
  Interviewing: { bar: 'bg-orange-600',     pill: 'bg-orange-50 text-orange-900 border-orange-100',     ring: 'ring-orange-600' },
  Offering:     { bar: 'bg-purple-600',     pill: 'bg-purple-50 text-purple-900 border-purple-100',     ring: 'ring-purple-600' },
  Onboarding:   { bar: 'bg-teal-600',       pill: 'bg-teal-50 text-teal-900 border-teal-100',           ring: 'ring-teal-600' },
  Closed:       { bar: 'bg-neutral-300',    pill: 'bg-neutral-50 text-neutral-500 border-neutral-100',  ring: 'ring-neutral-300' },
  Rejected:     { bar: 'bg-red-600',        pill: 'bg-red-50 text-red-700 border-red-100',              ring: 'ring-red-600' },
  Cancelled:    { bar: 'bg-neutral-200',    pill: 'bg-neutral-50 text-neutral-400 border-neutral-100',  ring: 'ring-neutral-200' },
  PendingApproval: { bar: 'bg-purple-600',  pill: 'bg-purple-50 text-purple-900 border-purple-100',     ring: 'ring-purple-600' },
  RejectedByCEO:   { bar: 'bg-red-600',     pill: 'bg-red-50 text-red-700 border-red-100',              ring: 'ring-red-600' },
}

/**
 * STAGES — ordered list of the six standard pipeline steps.
 * The index position (0–5) is used by PipelineTrack to determine which
 * dots are "done" (index < current), "active" (index === current), or
 * "future" (index > current). Rejected and Cancelled are terminal states
 * that sit outside this linear progression and are rendered separately.
 */
// ─── Pipeline stages ───────────────────────────────────────
const STAGES = ['Open','Recruiting','Interviewing','Offering','Onboarding','Closed']

function getPipelineIndex(status) {
  const i = STAGES.indexOf(status)
  return i === -1 ? -1 : i
}

/**
 * computeSLA — calculate the number of "active" calendar days for a request.
 *
 * The SLA clock only ticks while the pipeline is in a "working" state
 * (Open → Recruiting → Interviewing). It is deliberately paused and later
 * reset under two specific conditions:
 *
 * Pause logic:
 *   When a request moves to Offering or Onboarding the clock stops — the
 *   recruiting team is no longer actively working a new candidate. Any time
 *   already accumulated is banked into `acc` and `start` is set to null.
 *
 * Reset logic (pipeline loop):
 *   If, after an Onboarding transition, the request drops back to Recruiting
 *   or Interviewing (e.g. the candidate fell through and recruitment restarts),
 *   the entire accumulated counter is wiped to zero (`acc = 0`) and the clock
 *   restarts from that moment. This means only the current recruitment attempt
 *   is measured — previous failed cycles do not inflate the SLA.
 *
 * Terminal states (Closed / Cancelled):
 *   The clock is stopped and the remaining open interval is banked. No further
 *   accumulation occurs.
 *
 * If the history contains no terminal event and `start` is still set at the
 * end of the loop, the interval from `start` to right now is added, giving a
 * live "elapsed so far" figure for in-flight requests.
 *
 * @param {object} req – Firestore request document (with Timestamp `createdAt`
 *   and optional `statusHistory` array of `{ status, changedAt }` entries).
 * @returns {number|null} Elapsed days (integer, floored), or null if
 *   `createdAt` is missing.
 */
// ─── SLA calculation ──────────────────────────────────────
function computeSLA(req) {
  const createdAt = req.createdAt?.toDate?.()
  if (!createdAt) return null
  const DONE = new Set(['Closed', 'Cancelled'])
  const history = [...(req.statusHistory ?? [])]
    .map(e => ({ status: e.status, t: new Date(e.changedAt) }))
    .filter(e => !isNaN(e.t))
    .sort((a, b) => a.t - b.t)
  let acc = 0, start = createdAt, lastOnboarding = false
  for (const { status, t } of history) {
    if (status === 'Offering')    { if (start) { acc += t - start; start = null }; lastOnboarding = false }
    else if (status === 'Onboarding') { if (start) { acc += t - start; start = null }; lastOnboarding = true }
    else if (status === 'Recruiting' || status === 'Interviewing') {
      if (lastOnboarding) { acc = 0; start = t; lastOnboarding = false }
      else if (!start) start = t
    } else if (DONE.has(status)) { if (start) { acc += t - start; start = null }; lastOnboarding = false }
  }
  if (start) acc += new Date() - start
  return Math.floor(acc / 86400000)
}

/**
 * PipelineTrack — horizontal row of progress dots for the 6-stage pipeline.
 *
 * Each stage is rendered as a small coloured circle with a truncated label
 * beneath it, connected to the next stage by a hairline rule. Dot and
 * connector opacity communicate three visual states:
 *   - done   (i < currentIndex): coloured dot at 60 % opacity, grey line
 *   - active (i === currentIndex): coloured dot with a ring, bold label
 *   - future (i > currentIndex): muted grey dot, faint line
 *
 * Special case: Rejected and Cancelled are terminal states that do not map to
 * any step in STAGES. For these, the component short-circuits and renders only
 * a status pill badge instead of the dot row.
 *
 * @param {{ status: string }} props
 */
// ─── Pipeline Track ────────────────────────────────────────
// label ที่อ่านง่ายกว่า raw status สำหรับ pill พิเศษ (CEO approval gate, beta)
const PILL_LABEL = { PendingApproval: 'รอ CEO อนุมัติ', RejectedByCEO: 'CEO ไม่อนุมัติ' }

function PipelineTrack({ status }) {
  const idx    = getPipelineIndex(status)
  const isEnded = status === 'Rejected' || status === 'Cancelled' || status === 'PendingApproval' || status === 'RejectedByCEO'

  // Terminal states (Rejected / Cancelled / PendingApproval / RejectedByCEO) are not part of
  // the linear progression — render a standalone pill badge instead of the dot row.
  if (isEnded) {
    return (
      <div className="flex items-center gap-1.5">
        <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${STATUS[status]?.pill ?? ''}`}>
          {PILL_LABEL[status] ?? status}
        </span>
      </div>
    )
  }

  return (
    <div className="flex w-full items-center gap-0">
      {STAGES.map((stage, i) => {
        const done   = i < idx   // stage already passed
        const active = i === idx  // current stage
        const last   = i === STAGES.length - 1 // no connector line after final stage
        const st     = STATUS[stage]

        return (
          <div key={stage} className="flex min-w-0 flex-1 items-center">
            <div className="flex shrink-0 flex-col items-center gap-0.5" style={{ minWidth: 0 }}>
              {/* Stage dot — colour from STATUS map; ring highlights the active stage */}
              <div
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  done   ? st.bar + ' opacity-60' :
                  active ? st.bar + ' ring-2 ring-offset-1 ring-offset-white ' + st.ring :
                           'bg-neutral-100'
                }`}
              />
              {/* Abbreviated stage label — Onboarding → "Onb", Interviewing → "Int", others sliced to 4 chars */}
              <span className={`whitespace-nowrap text-[9px] font-bold leading-none ${
                active ? 'text-neutral-700' :
                done   ? 'text-neutral-300' :
                         'text-neutral-200'
              }`}>
                {stage === 'Onboarding' ? 'Onb' : stage === 'Interviewing' ? 'Int' : stage.slice(0,4)}
              </span>
            </div>
            {/* Hairline connector between dots — hidden after the last stage */}
            {!last && (
              <div className={`mx-0.5 h-px flex-1 transition-all ${
                done ? 'bg-neutral-300' : 'bg-neutral-100'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * ExpandedDetail — collapsible panel shown below a RequestRow when expanded.
 *
 * Renders up to four sections, each only when the relevant data exists:
 *  1. Reason (เหตุผลในการขอ) — the manager's stated rationale for the request
 *  2. Requirements — free-text candidate requirements
 *  3. Reject reason (เหตุผลการ Reject) — populated when status is Rejected;
 *     spans both columns and uses red styling to draw attention
 *  4. File attachments — signed-URL buttons for the JD file and any CV files;
 *     URLs are fetched lazily from Supabase Storage on click rather than at
 *     render time to avoid unnecessary signed-URL generation
 *  5. Status history timeline — all statusHistory entries sorted ascending by
 *     changedAt, each row showing a coloured dot, status label, timestamp, and
 *     optional name of the user who made the change
 *
 * @param {{ req: object }} props – The full Firestore request document.
 */
// ─── Expandable detail section ─────────────────────────────
function ExpandedDetail({ req }) {
  /**
   * openFile — fetch a short-lived signed URL from Supabase Storage and open
   * it in a new tab. JD files use the JD bucket; CV files use the CV bucket.
   * @param {string} path  – Storage object path stored on the request document
   * @param {boolean} isCV – true for CV files, false for JD files
   */
  async function openFile(path, isCV) {
    const url = isCV ? await getCVSignedUrl(path) : await getJDSignedUrl(path)
    if (url) window.open(url, '_blank')
  }

  return (
    <div className="px-6 pb-5 pt-2">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 border-t border-neutral-100 pt-4 sm:grid-cols-2">
        {/* Section 1: Manager's stated reason for the headcount request */}
        {req.reason && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold text-neutral-300">เหตุผลในการขอ</p>
            <p className="text-sm leading-relaxed text-neutral-600">"{req.reason}"</p>
          </div>
        )}
        {/* Section 2: Free-text candidate requirements */}
        {req.requirements && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold text-neutral-300">Requirements</p>
            <p className="text-sm leading-relaxed text-neutral-600">{req.requirements}</p>
          </div>
        )}
        {/* Section 3: Rejection reason — full-width, red styling to signal terminal failure */}
        {req.rejectReason && (
          <div className="col-span-full">
            <p className="mb-1.5 text-[11px] font-bold text-red-300">เหตุผลการ Reject</p>
            <p className="text-sm text-red-600">{req.rejectReason}</p>
          </div>
        )}
      </div>

      {/* Section 4: File attachments — JD document and CV files (แยก section ชัดเจน) */}
      {(req.jdFilePath || req.cvFiles?.length > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-6 border-t border-neutral-100 pt-4">

          {/* JD */}
          <div>
            <p className="mb-2 text-[11px] font-bold text-neutral-400">Job Description (JD)</p>
            {req.jdFilePath ? (
              <button
                onClick={() => openFile(req.jdFilePath, false)}
                className="flex w-full items-center gap-1.5 rounded-lg border border-neutral-100 px-3 py-1.5 text-left text-[11px] font-bold text-neutral-600 transition-colors hover:border-neutral-300"
              >
                <FileText size={12} strokeWidth={1} absoluteStrokeWidth className="shrink-0" />
                <span className="truncate">{req.jdFileName || 'JD File'}</span>
              </button>
            ) : (
              <p className="text-[11px] italic text-neutral-400">ยังไม่มีไฟล์ JD</p>
            )}
          </div>

          {/* CV */}
          <div>
            <p className="mb-2 text-[11px] font-bold text-neutral-400">CV ผู้สมัคร</p>
            {req.cvFiles?.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {req.cvFiles.map((cv, i) => (
                  <button key={i} onClick={() => openFile(cv.path, true)}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-100 px-3 py-1.5 text-left text-[11px] font-bold text-neutral-600 transition-colors hover:border-neutral-300"
                  >
                    <File size={12} strokeWidth={1} absoluteStrokeWidth className="shrink-0" />
                    <span className="truncate">{cv.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] italic text-neutral-400">ยังไม่มีไฟล์ CV</p>
            )}
          </div>

        </div>
      )}

      {/* Section 5: Status history timeline — sorted ascending so the oldest event is at the top */}
      {req.statusHistory?.length > 0 && (
        <div className="mt-4">
          <p className="mb-2.5 text-[11px] font-bold text-neutral-300">ประวัติสถานะ</p>
          <div className="flex flex-col gap-0">
            {[...req.statusHistory]
              .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
              .map((h, i) => {
                const st = STATUS[h.status]
                return (
                  <div key={i} className="flex items-center gap-3 border-b border-neutral-100 py-1.5 last:border-0">
                    {/* Colour dot matches the status colour from the STATUS map */}
                    <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${st?.bar ?? 'bg-neutral-300'}`} />
                    <span className="w-24 shrink-0 text-xs font-bold text-neutral-700">{h.status}</span>
                    <span className="text-[11px] text-neutral-400">
                      {new Date(h.changedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    {/* changedByName is optional — only shown when an actor is recorded */}
                    {h.changedByName && (
                      <span className="ml-auto text-[11px] text-neutral-300">· {h.changedByName}</span>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * RequestRow — a single row in the requests table with expand/collapse.
 *
 * The row header displays (left to right):
 *  - Thin coloured accent bar matching the current status
 *  - Position name, department, status pill, and request type badge
 *  - PipelineTrack progress dots (hidden on small screens)
 *  - Assigned TA name with avatar initial (hidden on small screens)
 *  - Candidate name (hidden on medium and smaller screens)
 *  - Expected start date (hidden on medium and smaller screens)
 *  - SLA day counter (only for active requests — Closed/Cancelled/Rejected are excluded)
 *  - Request created-at date
 *  - Chevron toggle icon
 *
 * SLA colour thresholds (applied to the day counter):
 *  - Green  (dark-green-700): 0–14 days — within a comfortable SLA window
 *  - Orange (text-orange-500): 15–30 days — approaching the limit, needs attention
 *  - Red    (text-red-500): > 30 days — SLA breached, urgent escalation needed
 *
 * Clicking anywhere on the row header toggles the ExpandedDetail panel, which
 * uses a CSS grid-rows transition (0fr → 1fr) for a smooth height animation.
 *
 * Closed/Cancelled/Rejected rows are rendered at 55 % opacity to visually
 * de-emphasise terminal states relative to in-flight requests.
 *
 * @param {{ req: object, index: number }} props
 *   - req   – Firestore document for a single HC request
 *   - index – Row position (currently unused, reserved for future striping)
 */
// ─── Single Request Row ────────────────────────────────────
function RequestRow({ req }) {
  const [open, setOpen] = useState(false)
  const sla      = computeSLA(req)
  // Only active requests show the live SLA counter; terminal ones are dimmed instead.
  const isActive = !['Closed','Cancelled','Rejected'].includes(req.status)
  const statusCfg = STATUS[req.status] ?? STATUS.Open
  // SLA colour thresholds ตาม limit ของ request (Tech/JG9+ = 45 วัน, ต่ำกว่า = 30): เขียว ≤ ครึ่ง limit, ส้ม ≤ limit, แดง > limit
  const limit     = slaLimit(req)
  const slaColor  = sla == null ? '' : sla > limit ? 'text-red-600' : sla > limit / 2 ? 'text-orange-600' : 'text-dark-green-700'

  return (
    <div
      className={`border-b border-neutral-100 last:border-0 transition-colors ${
        open ? 'bg-neutral-50' : 'hover:bg-neutral-50/60'
      } ${!isActive ? 'opacity-55' : ''}`}
    >
      {/* ── Main row ── */}
      <div
        className="flex items-center gap-0 cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        {/* Status bar */}
        <div className={`mx-4 my-2.5 w-0.5 shrink-0 self-stretch rounded-full ${statusCfg.bar}`} />

        {/* Left: position + dept */}
        <div className="w-48 shrink-0 py-4 pr-4 lg:w-56">
          <p className="mb-0.5 font-mono text-[10px] font-bold text-neutral-300">{req.hcId || req.id.slice(0, 7)}</p>
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${statusCfg.pill}`}>
              {req.status}
            </span>
            <span className="text-[10px] font-bold text-neutral-300">
              {req.requestType === 'New HC' ? 'New' : 'Replace'}
            </span>
          </div>
          <p className="truncate text-sm font-bold leading-tight text-neutral-900" title={req.position}>
            {req.position}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-neutral-400">{req.department}</p>
        </div>

        {/* Center: pipeline */}
        <div className="hidden min-w-0 flex-1 px-4 py-4 sm:block">
          <PipelineTrack status={req.status} />
        </div>

        {/* Right: TA + SLA + candidate + date */}
        <div className="flex shrink-0 items-center gap-4 px-4 py-4">
          {/* TA */}
          <div className="hidden w-28 text-right md:block">
            {req.assignedToName ? (
              <div className="flex items-center justify-end gap-1.5">
                <span className="max-w-[90px] truncate text-xs font-bold text-dark-green-700">
                  {req.assignedToName}
                </span>
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-dark-green-50 text-[10px] font-bold text-dark-green-700">
                  {req.assignedToName[0]?.toUpperCase()}
                </div>
              </div>
            ) : (
              <span className="text-[11px] italic text-neutral-200">ไม่มี TA</span>
            )}
          </div>

          {/* Candidate */}
          {req.candidateName && (
            <div className="hidden shrink-0 items-center gap-1 text-xs font-bold text-purple-600 lg:flex">
              <UserCheck size={11} strokeWidth={1} absoluteStrokeWidth />
              <span className="max-w-[80px] truncate">{req.candidateName}</span>
            </div>
          )}

          {/* Start date */}
          {req.startDate && (
            <div className="hidden shrink-0 items-center gap-1 text-[11px] font-bold text-teal-700 lg:flex">
              <Calendar size={10} strokeWidth={1} absoluteStrokeWidth />
              {req.startDate}
            </div>
          )}

          {/* SLA */}
          {sla !== null && isActive && (
            <div className="w-12 shrink-0 text-right">
              <p className={`text-base font-bold leading-none tabular-nums ${slaColor}`}>{sla}</p>
              <p className="text-[10px] font-bold text-neutral-300">วัน</p>
            </div>
          )}

          {/* Date */}
          <p className="hidden w-16 shrink-0 text-right text-[11px] text-neutral-300 md:block">
            {req.createdAt?.toDate?.().toLocaleDateString('th-TH', { day:'2-digit', month:'short' }) ?? ''}
          </p>

          {/* Toggle */}
          <div className="shrink-0 text-neutral-200">
            {open
              ? <ChevronUp size={13} strokeWidth={1} absoluteStrokeWidth />
              : <ChevronDown size={13} strokeWidth={1} absoluteStrokeWidth />
            }
          </div>
        </div>
      </div>

      {/* ── Expanded ── */}
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <ExpandedDetail req={req} />
        </div>
      </div>
    </div>
  )
}

/**
 * Scorecard — a five-card summary strip at the top of the view.
 *
 * Each card shows a count and a label for one pipeline bucket:
 *  1. รอดำเนินการ (Open)                  – requests waiting to be actioned
 *  2. กำลัง Recruit (Recruiting + Interviewing) – combined active-recruitment count
 *  3. Offering                              – requests at the offer stage
 *  4. W.Onboarding                          – candidates accepted, awaiting start
 *  5. ปิดแล้ว (Closed)                      – successfully filled requests
 *
 * Cards with a zero count are faded to 45 % opacity to reduce visual noise
 * while preserving the layout. Accent colours use literal DS token classes
 * per card (not dynamically computed) so the Tailwind scanner picks them up.
 *
 * @param {{ stats: object }} props
 *   - stats.open       – count of Open requests
 *   - stats.active     – count of Recruiting + Interviewing requests
 *   - stats.offering   – count of Offering requests
 *   - stats.onboarding – count of Onboarding requests
 *   - stats.closed     – count of Closed requests
 */
// ─── Scorecard ─────────────────────────────────────────────
function Scorecard({ stats }) {
  const cards = [
    { label: 'รอดำเนินการ',   value: stats.open,       bar: 'bg-yellow-600',     text: 'text-yellow-900',     labelText: 'text-yellow-700' },
    { label: 'กำลัง Recruit', value: stats.active,     bar: 'bg-dark-green-600', text: 'text-dark-green-700', labelText: 'text-dark-green-600' },
    { label: 'Offering',      value: stats.offering,   bar: 'bg-purple-600',     text: 'text-purple-700',     labelText: 'text-purple-600' },
    { label: 'W.Onboarding',  value: stats.onboarding, bar: 'bg-teal-700',       text: 'text-teal-800',       labelText: 'text-teal-700' },
    { label: 'ปิดแล้ว',       value: stats.closed,     bar: 'bg-neutral-400',    text: 'text-neutral-600',    labelText: 'text-neutral-400' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map(card => {
        // Cards with zero count are faded to reduce visual weight without removing them.
        const empty = card.value === 0
        return (
          <div
            key={card.label}
            className={`relative flex items-stretch overflow-hidden rounded-xl border border-neutral-100 bg-white transition-opacity duration-200 ${empty ? 'opacity-45' : ''}`}
          >
            {/* Left accent bar — coloured stripe matching the status palette */}
            <div className={`w-1 shrink-0 ${card.bar}`} />
            {/* Content: large count number + small category label */}
            <div className="flex-1 px-4 py-3.5">
              <p className={`text-2xl font-bold leading-none tabular-nums ${card.text}`}>
                {card.value}
              </p>
              <p className={`mt-2 text-[11px] font-bold leading-tight ${card.labelText}`}>
                {card.label}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// สถานะที่ถือว่า "จบแล้ว" — ใช้ในแท็บประวัติ (ดูย้อนหลังของแผนก)
const HISTORY_STATUSES = ['Closed', 'Cancelled', 'Rejected', 'RejectedByCEO']

// สถานะที่ Manager ไม่ต้องเห็นในหน้า "คำขอของฉัน" เลย (ทุกแท็บ) — ทั้งของตัวเองและแผนกอื่น
const HIDDEN_STATUSES = new Set(['OnHold', 'Cancelled', 'Rejected', 'NoShow'])

// PendingApproval/RejectedByCEO (CEO approval gate, beta) — ต่างจาก HIDDEN_STATUSES ตรงที่
// ผู้ยื่นเองต้องเห็นสถานะคำขอตัวเอง (ไม่งั้นจะงงว่าทำไม TA ไม่ดำเนินการต่อ) แค่ "แผนกอื่น" ไม่ต้องเห็น
// — ซ่อนเฉพาะจาก deptChunkDocs เท่านั้น ไม่ซ่อนจาก ownDocs
const DEPT_ONLY_HIDDEN_STATUSES = new Set(['PendingApproval', 'RejectedByCEO'])

// ─── Main ──────────────────────────────────────────────────
export default function ManagerRequestsView({ user }) {
  const [requests, setRequests] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [tab, setTab] = useState('active')
  const [historyYear, setHistoryYear] = useState(null) // ตัวกรองปีของแท็บประวัติ — null = ทุกปี
  const [sortField, setSortField] = useState('createdAt') // 'createdAt' (ค่าเริ่มต้น) | 'hcId'
  const [sortDir, setSortDir] = useState('desc')
  const navigate = useNavigate()

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  /**
   * Firestore realtime listener — subscribes to requests ตามแผนกที่ Manager ดูแล
   *
   * Flow:
   *   1. fetch settings/deptManagers → หาแผนกที่ user.email ถูก assign
   *   2. query hc_requests WHERE department IN [myDepts] ORDER BY createdAt DESC
   *
   * Page Visibility API: pause listener เมื่อ tab ซ่อน, resume เมื่อกลับมา
   * Dependency: [user?.email] — re-runs เมื่อ user เปลี่ยน
   */
  useEffect(() => {
    if (!user?.email) return
    let unsubOwn   = null   // listener สำหรับ request ที่ตัวเองยื่น
    let unsubDepts = []     // listeners สำหรับ request ของแผนกที่ดูแล (1 ตัวต่อ chunk ≤30 แผนก)
    let ownDocs    = []     // snapshot cache ฝั่ง requesterEmail
    let deptChunkDocs = []  // snapshot cache ฝั่ง department — array ต่อ chunk
    let cancelled = false
    let handleVisibility = null

    // merge + dedup หลาย snapshot array โดยใช้ doc id เป็น key
    // ownList: request ที่ตัวเองยื่น — เห็น PendingApproval/RejectedByCEO ของตัวเองด้วย
    // deptLists: request ของแผนกที่ดูแล (ไม่ใช่ของตัวเอง) — ซ่อน PendingApproval/RejectedByCEO เพิ่ม
    function mergeRequests(ownList, deptLists) {
      const map = new Map()
      for (const r of ownList) if (!HIDDEN_STATUSES.has(r.status)) map.set(r.id, r)
      for (const r of deptLists.flat()) {
        if (!HIDDEN_STATUSES.has(r.status) && !DEPT_ONLY_HIDDEN_STATUSES.has(r.status)) map.set(r.id, r)
      }
      return [...map.values()].sort((x, y) => {
        const tx = x.createdAt?.toMillis?.() ?? 0
        const ty = y.createdAt?.toMillis?.() ?? 0
        return ty - tx   // newest first
      })
    }

    async function init() {
      // 1. โหลด dept mapping จาก settings/deptManagers + division mapping จาก settings/divisionManagers
      const [settingsSnap, divisionSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'deptManagers')),
        getDoc(doc(db, 'settings', 'divisionManagers')),
      ])
      if (cancelled) return

      // grantedKeys รองรับทั้งค่าเก่า (อีเมลเดี่ยว) และใหม่ (array — 1 แผนกหลาย Manager)
      const mapping  = settingsSnap.exists() ? settingsSnap.data() : {}
      const myDeptsDirect = grantedKeys(mapping, user.email)

      // Head of Division — grant ทั้งสาย → เห็นทุกแผนกในสายนั้นด้วย ไม่ใช่แค่แผนกที่ระบุตรงๆ
      const divisionMapping = divisionSnap.exists() ? divisionSnap.data() : {}
      const myDivisions = grantedKeys(divisionMapping, user.email)
      const myDeptsFromDivisions = myDivisions.flatMap((division) => getDepartments(division))

      const myDepts = [...new Set([...myDeptsDirect, ...myDeptsFromDivisions])]

      // ขยายชื่อแผนกให้ครอบคลุมชื่อแบบ Sheets/Maindata ด้วย (resolveDeptNames จาก deptMapping.js)
      // ข้อมูลเก่าที่ import/sync จาก Sheets ใช้ชื่ออีกชุด เช่น grant "Logistic" → แถวเก่าเป็น "Logistics"
      // ถ้าไม่ขยาย ประวัติย้อนหลังของแผนกจะล่องหนจาก query ด้านล่าง
      const expandedDepts = [...new Set(myDepts.flatMap(d => [d, ...resolveDeptNames(d)]))]

      // Firestore 'in' รับสูงสุด 30 ค่า → แตกเป็น chunk แล้ว subscribe แยกกัน
      const IN_LIMIT = 30
      const deptChunks = []
      for (let i = 0; i < expandedDepts.length; i += IN_LIMIT) {
        deptChunks.push(expandedDepts.slice(i, i + IN_LIMIT))
      }
      deptChunkDocs = deptChunks.map(() => [])

      const userEmail = user.email.toLowerCase()

      // 2a. Query หลัก — request ที่ตัวเองยื่น (requesterEmail)
      //     ทำงานเสมอ ไม่ต้องรอ deptManagers
      const qOwn = query(
        collection(db, 'hc_requests'),
        where('requesterEmail', '==', userEmail),
        orderBy('createdAt', 'desc'),
        limit(1000)
      )

      const subscribeOwn = () => {
        if (unsubOwn) return
        unsubOwn = onSnapshot(
          qOwn,
          snap => {
            ownDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            setRequests(mergeRequests(ownDocs, deptChunkDocs))
            setLoading(false)
          },
          err => {
            console.error('[ManagerRequestsView] own-query error:', err.message)
            setLoading(false)
          }
        )
      }

      // 2b. Query เสริม — request ของแผนกที่ดูแล (department) 1 listener ต่อ chunk
      //     limit 1000/chunk เพื่อให้เห็นประวัติย้อนหลังหลายปี ไม่ใช่แค่ 500 ล่าสุด
      const subscribeDepts = () => {
        if (unsubDepts.length || !deptChunks.length) return
        unsubDepts = deptChunks.map((chunk, ci) => {
          const qDept = query(
            collection(db, 'hc_requests'),
            where('department', 'in', chunk),
            orderBy('createdAt', 'desc'),
            limit(1000)
          )
          return onSnapshot(
            qDept,
            snap => {
              deptChunkDocs[ci] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
              setRequests(mergeRequests(ownDocs, deptChunkDocs))
              setLoading(false)
            },
            err => {
              console.error('[ManagerRequestsView] dept-query error:', err.message)
              console.error('👉 ถ้าเป็น "requires an index" ให้กดลิงก์ด้านบนเพื่อสร้าง index ใน Firebase Console')
            }
          )
        })
      }

      if (cancelled) return
      subscribeOwn()
      subscribeDepts()

      handleVisibility = () => {
        if (document.hidden) {
          unsubOwn?.(); unsubOwn = null
          unsubDepts.forEach(u => u?.()); unsubDepts = []
        } else {
          subscribeOwn()
          subscribeDepts()
        }
      }
      document.addEventListener('visibilitychange', handleVisibility)
    }

    init()

    return () => {
      cancelled = true
      unsubOwn?.()
      unsubDepts.forEach(u => u?.())
      if (handleVisibility) document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [user?.email])

  /**
   * stats — pipeline bucket counts derived from the full requests array.
   *
   * Computed once per snapshot update and passed to the Scorecard component.
   * Recruiting and Interviewing are combined into a single `active` bucket
   * because both represent "currently being worked" from the manager's POV.
   * Cancelled requests are excluded from the `total` count since they were
   * never actioned and would inflate the number.
   */
  const stats = useMemo(() => ({
    open:       requests.filter(r => r.status === 'Open').length,
    active:     requests.filter(r => ['Recruiting','Interviewing'].includes(r.status)).length,
    offering:   requests.filter(r => r.status === 'Offering').length,
    onboarding: requests.filter(r => r.status === 'Onboarding').length,
    closed:     requests.filter(r => r.status === 'Closed').length,
    total:      requests.filter(r => r.status !== 'Cancelled').length,
  }), [requests])

  /**
   * displayed — the subset of requests rendered in the table.
   *
   * "active" tab: excludes Closed and Cancelled requests, showing only the
   *   requests that still require attention. Rejected is intentionally kept
   *   visible here so the manager can see which requests were turned down
   *   before they clear them by switching to the "all" view.
   * "all" tab: returns the full unfiltered array.
   *
   * Re-computed whenever the requests array updates or the user switches tabs.
   */
  // เคสประวัติทั้งหมด (ยังไม่กรองปี) — ใช้ทั้งนับ badge บนแท็บ และ derive รายการปี
  const historyAll = useMemo(
    () => requests.filter(r => HISTORY_STATUSES.includes(r.status)),
    [requests]
  )

  // รายการปีที่มีข้อมูลจริง (จาก createdAt) เรียงใหม่ → เก่า สำหรับ chips กรองปี
  const historyYears = useMemo(() => {
    const ys = new Set()
    historyAll.forEach(r => {
      const y = r.createdAt?.toDate?.()?.getFullYear()
      if (y) ys.add(y)
    })
    return [...ys].sort((a, b) => b - a)
  }, [historyAll])

  const displayed = useMemo(() => {
    let list
    if (tab === 'active') list = requests.filter(r => !['Closed','Cancelled','RejectedByCEO'].includes(r.status))
    else if (tab === 'history') list = !historyYear ? historyAll : historyAll.filter(r => r.createdAt?.toDate?.()?.getFullYear() === historyYear)
    else list = requests

    if (sortField === 'hcId') {
      // เรียงตามเลขรัน HC (เช่น "HC-2026-0012") แทนการเทียบ string ตรงๆ
      const parseSeq = (id) => { const m = (id || '').match(/(\d+)-(\d+)$/); return m ? parseInt(m[1]) * 100000 + parseInt(m[2]) : 0 }
      list = [...list].sort((a, b) => sortDir === 'asc' ? parseSeq(a.hcId) - parseSeq(b.hcId) : parseSeq(b.hcId) - parseSeq(a.hcId))
    }
    return list
  }, [requests, tab, historyAll, historyYear, sortField, sortDir])

  if (loading) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        {/* Scorecard skeleton — 5 cards */}
        <div className="grid grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex h-[68px] items-stretch overflow-hidden rounded-xl border border-neutral-100 bg-white">
              <div className="w-1 shrink-0 bg-neutral-100" />
              <div className="flex flex-1 flex-col gap-2 px-4 py-3.5">
                <div className="h-5 w-8 rounded bg-neutral-100" />
                <div className="h-2 w-14 rounded bg-neutral-100" />
              </div>
            </div>
          ))}
        </div>
        {/* Tab skeleton */}
        <div className="flex gap-2">
          <div className="h-7 w-20 rounded-lg bg-neutral-100" />
          <div className="h-7 w-16 rounded-lg bg-neutral-100" />
        </div>
        {/* Row skeletons */}
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl border border-neutral-100 bg-neutral-50" />
        ))}
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-dark-green-50">
          <FilePlus size={22} strokeWidth={1} absoluteStrokeWidth className="text-dark-green-300" />
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-neutral-500">ยังไม่มีคำขอ</p>
          <p className="mt-1 text-xs text-neutral-300">กดยื่นคำขอเพื่อเริ่มต้น</p>
        </div>
        <button
          onClick={() => navigate('/request')}
          className="mt-2 rounded-lg bg-dark-green-600 px-5 py-2.5 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700"
        >
          ยื่นคำขอใหม่
        </button>
      </div>
    )
  }

  const activeCount = stats.open + stats.active + stats.offering + stats.onboarding

  return (
    <div className="flex flex-col gap-5">
      {/* Scorecard */}
      <Scorecard stats={stats} />

      {/* Tab + new button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5 rounded-full border border-neutral-100 p-0.5">
          {[
            { v: 'active',  l: `กำลังดำเนินการ`, n: activeCount },
            { v: 'history', l: 'ประวัติ',          n: historyAll.length },
            { v: 'all',     l: 'ทั้งหมด',          n: requests.length },
          ].map(t => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-normal transition-colors ${
                tab === t.v
                  ? 'bg-green-fresh-50 text-green-fresh-900'
                  : 'text-neutral-900 hover:bg-neutral-50'
              }`}
            >
              {t.l}
              {t.n > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${
                  tab === t.v ? 'bg-dark-green-600 text-neutral-50' : 'bg-neutral-100 text-neutral-400'
                }`}>
                  {t.n}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate('/request')}
          className="flex items-center gap-1.5 rounded-lg bg-dark-green-600 px-4 py-2 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700"
        >
          <FilePlus size={13} strokeWidth={1} absoluteStrokeWidth />
          ยื่นคำขอใหม่
        </button>
      </div>

      {/* Year filter — เฉพาะแท็บประวัติ: กรองตามปีที่ยื่น (derive จากข้อมูลจริง) */}
      {tab === 'history' && historyYears.length > 0 && (
        <div className="flex items-center gap-0.5 self-start rounded-full border border-neutral-100 p-0.5">
          {[null, ...historyYears].map(y => (
            <button
              key={y ?? 'all'}
              onClick={() => setHistoryYear(y)}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                historyYear === y
                  ? 'bg-green-fresh-50 font-bold text-green-fresh-900'
                  : 'font-normal text-neutral-900 hover:bg-neutral-50'
              }`}
            >
              {y ?? 'ทุกปี'}
            </button>
          ))}
        </div>
      )}

      {/* Column headers */}
      {displayed.length > 0 && (
        <div className="flex items-center gap-0 border-b border-neutral-100 px-0 pb-2 text-[11px] font-bold text-neutral-300">
          <div className="mx-4 w-0.5 shrink-0" />
          <button
            onClick={() => toggleSort('hcId')}
            className={`flex w-48 shrink-0 items-center gap-1 text-left transition-colors lg:w-56 ${sortField === 'hcId' ? 'text-dark-green-700' : 'hover:text-neutral-500'}`}
          >
            REQ ID / ตำแหน่ง
            {sortField === 'hcId'
              ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
              : <ChevronsUpDown size={11} className="text-neutral-200" />}
          </button>
          <div className="hidden flex-1 px-4 sm:block">ความคืบหน้า</div>
          <div className="hidden w-28 px-4 text-right md:block">TA</div>
          <div className="hidden w-24 px-4 lg:block">Candidate</div>
          <div className="hidden w-24 px-4 lg:block">เริ่มงาน</div>
          <div className="w-12 px-4 text-right">SLA</div>
          <div className="hidden w-16 px-4 text-right md:block">วันที่ยื่น</div>
          <div className="w-5 px-4" />
        </div>
      )}

      {/* Request list */}
      {displayed.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-neutral-300">
            {tab === 'history'
              ? historyYear ? `ไม่มีประวัติในปี ${historyYear}` : 'ยังไม่มีประวัติคำขอที่จบแล้ว'
              : 'ไม่มีคำขอที่กำลังดำเนินการ'}
          </p>
          <button
            onClick={() => { setTab('all'); setHistoryYear(null) }}
            className="mt-2 text-xs font-bold text-dark-green-700 hover:underline"
          >
            ดูทั้งหมด →
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white">
          {displayed.map((req) => (
            <RequestRow key={req.id} req={req} />
          ))}
        </div>
      )}
    </div>
  )
}
