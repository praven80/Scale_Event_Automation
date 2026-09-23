// Builds the per-event "attendee detail" CSV with a one-time header block at the
// top, then a blank separator row, then the per-attendee table. Mirrors the layout
// produced by the standalone `export_events_513_514.py` script so people don't
// have to run a Python tool to get the same artifact.
//
// Header rows (key,value):
//   Event Date, Event Name, Event Type, Event Host,
//   Target Audience, Event URL,
//   What did the audience learn?, Event Info,
//   Total Attendees (matched), Distinct Accounts,
//   Non-AGS Accounts (in exclusion list)
//
// Per-attendee columns:
//   Account ID (18-char), Account Name, AM Alias, Opp IDs,
//   First Name, Last Name, Email, Non-AGS Account

import Papa from 'papaparse'
import { AppState } from '../types'

export interface ExportEventDetailOptions {
  state: AppState
  /** Optional set of SFDC Account IDs marked as Non-AGS. Pass from the AM-account
   *  exclusions list when available; otherwise the column is left blank. */
  excludedAccountIds?: Set<string>
  /** Override the auto-detected event type (e.g. "Virtual" or "In-Person"). */
  eventType?: string
  /** Override the host shown in the header (defaults to config.am_email_sender_name). */
  primaryHost?: string
}

export function buildEventDetailCsv(opts: ExportEventDetailOptions): string {
  const { state, excludedAccountIds, eventType, primaryHost } = opts
  const config = state.config
  if (!config) {
    throw new Error('Cannot build event detail CSV — event config is missing.')
  }

  // Build account-id -> distinct opp-ids map
  const oppsByAccount = new Map<string, Set<string>>()
  for (const p of state.matchResults.plan) {
    const aid = (p['Account ID'] || '').trim()
    const oid = (p['Opp ID'] || '').trim()
    if (!aid || !oid) continue
    if (!oppsByAccount.has(aid)) oppsByAccount.set(aid, new Set())
    oppsByAccount.get(aid)!.add(oid)
  }

  // Group matched attendees by Account ID — one row per company. Contact names and
  // emails are comma-joined within the row.
  type Row = {
    'Account ID (18-char)': string
    'Account Name': string
    'Territory': string
    'Region': string
    'Division': string
    'AM ID': string
    'AM Alias': string
    'Opp IDs': string
    'Contacts': string
    'Contact Emails': string
    'Attendee Count': string
    'Non-AGS Account': string
  }

  const byAccount = new Map<string, {
    accountName: string
    territory: string
    region: string
    division: string
    amId: string
    amAlias: string
    contacts: string[]
    emails: string[]
  }>()

  for (const att of state.enriched) {
    if (att.Status !== 'Matched') continue
    const aid = (att['Account ID'] || '').trim()
    if (!aid) continue
    if (!byAccount.has(aid)) {
      byAccount.set(aid, {
        accountName: att['SFDC Account Name'] || '',
        territory: att.Territory || '',
        region: att.Region || '',
        division: att.Division || '',
        amId: att['AM ID'] || '',
        amAlias: att['AM Alias'] || '',
        contacts: [],
        emails: [],
      })
    }
    const entry = byAccount.get(aid)!
    const name = (att.Visitor || '').trim()
    const email = (att.Email || '').trim()
    if (name) entry.contacts.push(name)
    if (email) entry.emails.push(email)
  }

  const rows: Row[] = []
  for (const [aid, e] of byAccount) {
    const opps = oppsByAccount.get(aid)
    rows.push({
      'Account ID (18-char)': aid,
      'Account Name': e.accountName,
      'Territory': e.territory,
      'Region': e.region,
      'Division': e.division,
      'AM ID': e.amId,
      'AM Alias': e.amAlias,
      'Opp IDs': opps ? [...opps].sort().join(';') : '',
      'Contacts': e.contacts.join(', '),
      'Contact Emails': e.emails.join(', '),
      'Attendee Count': String(e.contacts.length || e.emails.length),
      'Non-AGS Account': excludedAccountIds && aid && excludedAccountIds.has(aid) ? 'Y' : '',
    })
  }
  rows.sort((a, b) => a['Account Name'].toLowerCase().localeCompare(b['Account Name'].toLowerCase()))

  const distinctAccounts = rows.length
  const totalAttendees = state.enriched.filter(a => a.Status === 'Matched').length
  const nonAgs = rows.filter(r => r['Non-AGS Account'] === 'Y').length

  const detectedHost = primaryHost
    || state.primaryHost
    || config.am_email_sender_name
    || ''

  // Audience + learnings come from config (added in EventConfig). Fallback to
  // event_summary so older events that don't have these fields still produce a
  // useful header.
  const audience =
    (config as any).target_audience
    || ''
  const learnings =
    (config as any).audience_learnings
    || ''

  // Header block as 2-column rows
  const headerRows: string[][] = [
    ['Event Date', config.event_date || ''],
    ['Event Name', config.event_name || ''],
    ['Event Type', eventType || state.pre?.eventType || 'Virtual'],
    ['Event Host', detectedHost],
    ['Target Audience', audience],
    ['Event URL', config.registration_url || ''],
    ['What did the audience learn?', learnings],
    ['Event Info', config.event_summary || ''],
    ['Total Attendees (matched)', String(totalAttendees)],
    ['Distinct Accounts', String(distinctAccounts)],
    ['Non-AGS Accounts (in exclusion list)', String(nonAgs)],
    [],   // blank row separator
  ]

  // Per-account table (one row per company, contacts comma-joined)
  const attendeeColumns = [
    'Account ID (18-char)', 'Account Name', 'Territory', 'Region', 'Division',
    'AM ID', 'AM Alias', 'Opp IDs', 'Contacts', 'Contact Emails',
    'Attendee Count', 'Non-AGS Account',
  ]
  const attendeeRows: string[][] = [
    attendeeColumns,
    ...rows.map(r => attendeeColumns.map(c => (r as any)[c] ?? '')),
  ]

  const allRows = [...headerRows, ...attendeeRows]
  return Papa.unparse(allRows)
}

export function downloadEventDetailCsv(opts: ExportEventDetailOptions): void {
  const csv = buildEventDetailCsv(opts)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = (opts.state.config?.event_date || 'event').replace(/[^0-9-]/g, '')
  a.href = url
  a.download = `event_${date}_attendee_detail.csv`
  a.click()
  URL.revokeObjectURL(url)
}
