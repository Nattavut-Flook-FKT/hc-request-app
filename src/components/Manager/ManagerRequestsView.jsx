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
import { useEffect, useState, useMemo, useRef } from 'react'
import { collection, onSnapshot, orderBy, query, where, limit, getDoc, doc } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { getJDSignedUrl, getCVSignedUrl } from '../../services/supabase'
import { Loader2, FileText, File, UserCheck, Calendar, ChevronDown, ChevronUp, FilePlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/**
 * STATUS — colour token map for every possible request status.
 *
 * Each key is a valid `req.status` string. Each value contains three
 * Tailwind class strings / CSS colour values used across the UI:
 *  - `bar`  – the thin left-edge accent bar inside RequestRow
 *  - `pill` – the small status badge (background + text + border)
 *  - `dot`  – raw CSS colour hex used for the PipelineTrack circle and
 *             Scorecard accent bars (must be a CSS value, not a Tailwind
 *             class, because it is applied via inline `style` props)
 */
// ─── Status colour map ─────────────────────────────────────
const STATUS = {
  Open:         { bar: 'bg-amber-400',   pill: 'bg-amber-50 text-amber-700 border-amber-200',   dot: '#f59e0b' },
  Recruiting:   { bar: 'bg-[#008065]',   pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: '#008065' },
  Interviewing: { bar: 'bg-orange-400',  pill: 'bg-orange-50 text-orange-700 border-orange-200',  dot: '#fb923c' },
  Offering:     { bar: 'bg-indigo-500',  pill: 'bg-indigo-50 text-indigo-700 border-indigo-200',  dot: '#6366f1' },
  Onboarding:   { bar: 'bg-teal-400',    pill: 'bg-teal-50 text-teal-700 border-teal-200',        dot: '#2dd4bf' },
  Closed:       { bar: 'bg-slate-300',   pill: 'bg-slate-50 text-slate-500 border-slate-200',     dot: '#94a3b8' },
  Rejected:     { bar: 'bg-red-400',     pill: 'bg-red-50 text-red-600 border-red-200',           dot: '#f87171' },
  Cancelled:    { bar: 'bg-gray-200',    pill: 'bg-gray-50 text-gray-400 border-gray-200',        dot: '#d1d5db' },
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
function PipelineTrack({ status }) {
  const idx    = getPipelineIndex(status)
  const isEnded = status === 'Rejected' || status === 'Cancelled'

  // Terminal states (Rejected / Cancelled) are not part of the linear
  // progression — render a standalone pill badge instead of the dot row.
  if (isEnded) {
    return (
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${STATUS[status]?.pill ?? ''}`}>
          {status}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-0 w-full">
      {STAGES.map((stage, i) => {
        const done   = i < idx   // stage already passed
        const active = i === idx  // current stage
        const future = i > idx   // stage not yet reached
        const last   = i === STAGES.length - 1 // no connector line after final stage
        const st     = STATUS[stage]

        return (
          <div key={stage} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-0.5 shrink-0" style={{ minWidth: 0 }}>
              {/* Stage dot — colour from STATUS map; ring highlights the active stage */}
              <div
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  done   ? st.bar + ' opacity-60' :
                  active ? st.bar + ' ring-2 ring-offset-1 ring-offset-white dark:ring-offset-slate-900' :
                           'bg-gray-100 dark:bg-slate-800'
                }`}
                style={active ? { '--tw-ring-color': st.dot } : {}}
              />
              {/* Abbreviated stage label — Onboarding → "Onb", Interviewing → "Int", others sliced to 4 chars */}
              <span className={`text-[8px] font-black uppercase tracking-tight leading-none whitespace-nowrap ${
                active ? 'text-gray-700 dark:text-gray-300' :
                done   ? 'text-gray-300 dark:text-slate-700' :
                         'text-gray-200 dark:text-slate-800'
              }`}>
                {stage === 'Onboarding' ? 'Onb' : stage === 'Interviewing' ? 'Int' : stage.slice(0,4)}
              </span>
            </div>
            {/* Hairline connector between dots — hidden after the last stage */}
            {!last && (
              <div className={`flex-1 h-px mx-0.5 transition-all ${
                done ? 'bg-gray-300 dark:bg-slate-700' : 'bg-gray-100 dark:bg-slate-800'
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
      <div className="border-t border-gray-50 dark:border-slate-800 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
        {/* Section 1: Manager's stated reason for the headcount request */}
        {req.reason && (
          <div>
            <p className="text-[9px] font-black text-gray-300 dark:text-slate-700 uppercase tracking-widest mb-1.5">เหตุผลในการขอ</p>
            <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed">"{req.reason}"</p>
          </div>
        )}
        {/* Section 2: Free-text candidate requirements */}
        {req.requirements && (
          <div>
            <p className="text-[9px] font-black text-gray-300 dark:text-slate-700 uppercase tracking-widest mb-1.5">Requirements</p>
            <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed">{req.requirements}</p>
          </div>
        )}
        {/* Section 3: Rejection reason — full-width, red styling to signal terminal failure */}
        {req.rejectReason && (
          <div className="col-span-full">
            <p className="text-[9px] font-black text-red-300 uppercase tracking-widest mb-1.5">เหตุผลการ Reject</p>
            <p className="text-sm text-red-500 dark:text-red-400">{req.rejectReason}</p>
          </div>
        )}
      </div>

      {/* Section 4: File attachments — JD document and CV files (แยก section ชัดเจน) */}
      {(req.jdFilePath || req.cvFiles?.length > 0) && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800 grid grid-cols-2 gap-6">

          {/* JD */}
          <div>
            <p className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-2">Job Description (JD)</p>
            {req.jdFilePath ? (
              <button
                onClick={() => openFile(req.jdFilePath, false)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-gray-400 transition-colors w-full text-left"
              >
                <FileText size={12} strokeWidth={2} className="shrink-0" />
                <span className="truncate">{req.jdFileName || 'JD File'}</span>
              </button>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-slate-600 italic">ยังไม่มีไฟล์ JD</p>
            )}
          </div>

          {/* CV */}
          <div>
            <p className="text-[9px] font-black text-gray-400 dark:text-slate-600 uppercase tracking-widest mb-2">CV ผู้สมัคร</p>
            {req.cvFiles?.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {req.cvFiles.map((cv, i) => (
                  <button key={i} onClick={() => openFile(cv.path, true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-gray-400 transition-colors text-left"
                  >
                    <File size={12} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{cv.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-slate-600 italic">ยังไม่มีไฟล์ CV</p>
            )}
          </div>

        </div>
      )}

      {/* Section 5: Status history timeline — sorted ascending so the oldest event is at the top */}
      {req.statusHistory?.length > 0 && (
        <div className="mt-4">
          <p className="text-[9px] font-black text-gray-300 dark:text-slate-700 uppercase tracking-widest mb-2.5">ประวัติสถานะ</p>
          <div className="flex flex-col gap-0">
            {[...req.statusHistory]
              .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
              .map((h, i) => {
                const st = STATUS[h.status]
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-gray-50 dark:border-slate-800/60 last:border-0">
                    {/* Colour dot matches the status colour from the STATUS map */}
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${st?.bar ?? 'bg-gray-300'}`} />
                    <span className="text-xs font-bold text-gray-700 dark:text-slate-300 w-24 shrink-0">{h.status}</span>
                    <span className="text-[10px] text-gray-400 dark:text-slate-600">
                      {new Date(h.changedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    {/* changedByName is optional — only shown when an actor is recorded */}
                    {h.changedByName && (
                      <span className="text-[10px] text-gray-300 dark:text-slate-700 ml-auto">· {h.changedByName}</span>
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
 *  - Green  (#008065): 0–14 days — within a comfortable SLA window
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
function RequestRow({ req, index }) {
  const [open, setOpen] = useState(false)
  const sla      = computeSLA(req)
  // Only active requests show the live SLA counter; terminal ones are dimmed instead.
  const isActive = !['Closed','Cancelled','Rejected'].includes(req.status)
  const statusCfg = STATUS[req.status] ?? STATUS.Open
  // SLA colour thresholds: green ≤ 14 days, orange 15–30, red > 30
  const slaColor  = sla == null ? '' : sla > 30 ? 'text-red-500' : sla > 14 ? 'text-orange-500' : 'text-[#008065] dark:text-emerald-400'

  return (
    <div
      className={`border-b border-gray-50 dark:border-slate-800 last:border-0 transition-colors ${
        open ? 'bg-gray-50/50 dark:bg-slate-800/20' : 'hover:bg-gray-50/30 dark:hover:bg-slate-800/10'
      } ${!isActive ? 'opacity-55' : ''}`}
    >
      {/* ── Main row ── */}
      <div
        className="flex items-center gap-0 cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        {/* Status bar */}
        <div className={`w-0.5 self-stretch ${statusCfg.bar} shrink-0 mx-4 my-2.5 rounded-full`} />

        {/* Left: position + dept */}
        <div className="py-4 pr-4 w-48 lg:w-56 shrink-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusCfg.pill}`}>
              {req.status}
            </span>
            <span className="text-[8px] font-bold text-gray-300 dark:text-slate-700 uppercase">
              {req.requestType === 'New HC' ? 'New' : 'Replace'}
            </span>
          </div>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight truncate" title={req.position}>
            {req.position}
          </p>
          <p className="text-[10px] text-gray-400 dark:text-slate-600 truncate mt-0.5">{req.department}</p>
        </div>

        {/* Center: pipeline */}
        <div className="flex-1 min-w-0 px-4 py-4 hidden sm:block">
          <PipelineTrack status={req.status} />
        </div>

        {/* Right: TA + SLA + candidate + date */}
        <div className="flex items-center gap-4 px-4 py-4 shrink-0">
          {/* TA */}
          <div className="hidden md:block w-28 text-right">
            {req.assignedToName ? (
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-xs font-semibold text-[#008065] dark:text-emerald-400 truncate max-w-[90px]">
                  {req.assignedToName}
                </span>
                <div className="w-5 h-5 rounded-full bg-[#008065]/10 dark:bg-emerald-900/30 flex items-center justify-center text-[9px] font-black text-[#008065] dark:text-emerald-400 shrink-0">
                  {req.assignedToName[0]?.toUpperCase()}
                </div>
              </div>
            ) : (
              <span className="text-[10px] text-gray-200 dark:text-slate-800 italic">ไม่มี TA</span>
            )}
          </div>

          {/* Candidate */}
          {req.candidateName && (
            <div className="hidden lg:flex items-center gap-1 text-xs font-semibold text-indigo-500 dark:text-indigo-400 shrink-0">
              <UserCheck size={11} strokeWidth={2.5} />
              <span className="max-w-[80px] truncate">{req.candidateName}</span>
            </div>
          )}

          {/* Start date */}
          {req.startDate && (
            <div className="hidden lg:flex items-center gap-1 text-[10px] font-semibold text-teal-500 dark:text-teal-400 shrink-0">
              <Calendar size={10} strokeWidth={2.5} />
              {req.startDate}
            </div>
          )}

          {/* SLA */}
          {sla !== null && isActive && (
            <div className="text-right w-12 shrink-0">
              <p className={`text-base font-black tabular-nums leading-none ${slaColor}`}>{sla}</p>
              <p className="text-[8px] font-bold text-gray-300 dark:text-slate-700 uppercase tracking-widest">วัน</p>
            </div>
          )}

          {/* Date */}
          <p className="text-[10px] text-gray-300 dark:text-slate-700 w-16 text-right shrink-0 hidden md:block">
            {req.createdAt?.toDate?.().toLocaleDateString('th-TH', { day:'2-digit', month:'short' }) ?? ''}
          </p>

          {/* Toggle */}
          <div className="text-gray-200 dark:text-slate-800 shrink-0">
            {open
              ? <ChevronUp size={13} strokeWidth={3} />
              : <ChevronDown size={13} strokeWidth={3} />
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
 * while preserving the layout. Accent colours are applied via inline styles
 * (not Tailwind) because they must exactly match the STATUS dot colours.
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
    { label: 'รอดำเนินการ',   value: stats.open,       accent: '#d97706', label_color: '#92400e' },
    { label: 'กำลัง Recruit', value: stats.active,     accent: '#008065', label_color: '#065f46' },
    { label: 'Offering',      value: stats.offering,   accent: '#4f46e5', label_color: '#3730a3' },
    { label: 'W.Onboarding',  value: stats.onboarding, accent: '#0d9488', label_color: '#115e59' },
    { label: 'ปิดแล้ว',       value: stats.closed,     accent: '#64748b', label_color: '#334155' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map(card => {
        // Cards with zero count are faded to reduce visual weight without removing them.
        const empty = card.value === 0
        return (
          <div
            key={card.label}
            className="relative flex items-stretch rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden transition-opacity duration-200"
            style={{ opacity: empty ? 0.45 : 1 }}
          >
            {/* Left accent bar — 4 px wide coloured stripe matching the status palette */}
            <div className="w-1 shrink-0" style={{ backgroundColor: card.accent }} />
            {/* Content: large count number + small category label */}
            <div className="flex-1 px-4 py-3.5">
              <p
                className="text-2xl font-black tabular-nums leading-none tracking-tight"
                style={{ color: card.accent }}
              >
                {card.value}
              </p>
              <p
                className="text-[9px] font-bold uppercase tracking-widest mt-2 leading-tight dark:opacity-60"
                style={{ color: card.label_color }}
              >
                {card.label}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────
export default function ManagerRequestsView({ user }) {
  const [requests, setRequests] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [tab, setTab] = useState('active')
  const navigate = useNavigate()

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
    let unsub = null
    let cancelled = false
    let handleVisibility = null

    async function init() {
      // 1. โหลด dept mapping จาก settings/deptManagers
      const settingsSnap = await getDoc(doc(db, 'settings', 'deptManagers'))
      if (cancelled) return

      const mapping = settingsSnap.exists() ? settingsSnap.data() : {}
      const myDepts = Object.entries(mapping)
        .filter(([, email]) => email === user.email.toLowerCase())
        .map(([dept]) => dept)

      // ถ้าไม่มีแผนก assign → แสดงว่าง
      if (!myDepts.length) {
        setRequests([])
        setLoading(false)
        return
      }

      // 2. subscribe ตาม department IN myDepts
      const q = query(
        collection(db, 'hc_requests'),
        where('department', 'in', myDepts),
        orderBy('createdAt', 'desc'),
        limit(500)
      )

      const subscribe = () => {
        if (unsub) return
        unsub = onSnapshot(
          q,
          snap => { setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
          err => {
            console.error('[ManagerRequestsView] Firestore error:', err.message)
            console.error('👉 ถ้าเป็น "requires an index" ให้กดลิงก์ด้านบนเพื่อสร้าง index ใน Firebase Console')
            setLoading(false)
          }
        )
      }

      if (cancelled) return
      subscribe()
      handleVisibility = () => { if (document.hidden) { unsub?.(); unsub = null } else subscribe() }
      document.addEventListener('visibilitychange', handleVisibility)
    }

    init()

    return () => {
      cancelled = true
      unsub?.()
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
  const displayed = useMemo(() => {
    if (tab === 'active') return requests.filter(r => !['Closed','Cancelled'].includes(r.status))
    return requests
  }, [requests, tab])

  if (loading) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        {/* Scorecard skeleton — 5 cards */}
        <div className="grid grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-stretch rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden h-[68px]">
              <div className="w-1 shrink-0 bg-gray-100 dark:bg-slate-800" />
              <div className="flex-1 px-4 py-3.5 flex flex-col gap-2">
                <div className="h-5 w-8 rounded bg-gray-100 dark:bg-slate-800" />
                <div className="h-2 w-14 rounded bg-gray-100 dark:bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
        {/* Tab skeleton */}
        <div className="flex gap-2">
          <div className="h-7 w-20 rounded-lg bg-gray-100 dark:bg-slate-800" />
          <div className="h-7 w-16 rounded-lg bg-gray-100 dark:bg-slate-800" />
        </div>
        {/* Row skeletons */}
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800" />
        ))}
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[#008065]/5 dark:bg-emerald-950/20 flex items-center justify-center">
          <FilePlus size={22} className="text-[#008065]/40 dark:text-emerald-700" />
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-500 dark:text-slate-500">ยังไม่มีคำขอ</p>
          <p className="text-xs text-gray-300 dark:text-slate-700 mt-1">กดยื่นคำขอเพื่อเริ่มต้น</p>
        </div>
        <button
          onClick={() => navigate('/request')}
          className="mt-2 px-5 py-2.5 bg-[#008065] hover:bg-[#006b54] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
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
        <div className="flex items-center gap-1 p-1 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800">
          {[
            { v: 'active', l: `กำลังดำเนินการ`, n: activeCount },
            { v: 'all',    l: 'ทั้งหมด',         n: requests.length },
          ].map(t => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                tab === t.v
                  ? 'bg-white dark:bg-slate-900 text-gray-800 dark:text-gray-200 shadow-sm border border-gray-100 dark:border-slate-700'
                  : 'text-gray-400 dark:text-slate-600 hover:text-gray-600'
              }`}
            >
              {t.l}
              {t.n > 0 && (
                <span className={`text-[9px] font-black px-1.5 rounded-full ${
                  tab === t.v ? 'bg-[#008065] text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-600'
                }`}>
                  {t.n}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate('/request')}
          className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white bg-[#008065] hover:bg-[#006b54] rounded-xl transition-colors shadow-sm shadow-[#008065]/20"
        >
          <FilePlus size={13} strokeWidth={3} />
          ยื่นคำขอใหม่
        </button>
      </div>

      {/* Column headers */}
      {displayed.length > 0 && (
        <div className="flex items-center gap-0 px-0 text-[9px] font-black text-gray-300 dark:text-slate-700 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800 pb-2">
          <div className="w-0.5 mx-4 shrink-0" />
          <div className="w-48 lg:w-56 shrink-0">ตำแหน่ง</div>
          <div className="flex-1 hidden sm:block px-4">ความคืบหน้า</div>
          <div className="hidden md:block w-28 text-right px-4">TA</div>
          <div className="hidden lg:block w-24 px-4">Candidate</div>
          <div className="hidden lg:block w-24 px-4">เริ่มงาน</div>
          <div className="w-12 text-right px-4">SLA</div>
          <div className="hidden md:block w-16 text-right px-4">วันที่ยื่น</div>
          <div className="w-5 px-4" />
        </div>
      )}

      {/* Request list */}
      {displayed.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-300 dark:text-slate-700">ไม่มีคำขอที่กำลังดำเนินการ</p>
          <button
            onClick={() => setTab('all')}
            className="mt-2 text-xs text-[#008065] hover:underline font-medium"
          >
            ดูทั้งหมด →
          </button>
        </div>
      ) : (
        <div className="border border-gray-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
          {displayed.map((req, i) => (
            <RequestRow key={req.id} req={req} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
