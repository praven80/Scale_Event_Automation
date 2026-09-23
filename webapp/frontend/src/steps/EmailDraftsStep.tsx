import { useCallback, useEffect, useRef, useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Table from '@cloudscape-design/components/table'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import Box from '@cloudscape-design/components/box'
import MetricCard from '../components/MetricCard'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import Alert from '@cloudscape-design/components/alert'
import Textarea from '@cloudscape-design/components/textarea'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Toggle from '@cloudscape-design/components/toggle'
import RadioGroup from '@cloudscape-design/components/radio-group'
import { AppState, EmailPayload } from '../types'
import { generateEmailPayloads } from '../utils/emailGenerator'
import { AM_EMAIL_BODY_TEMPLATE, AM_EMAIL_SUBJECT_DEFAULT } from '../templates/emailBody'
import { apiPost } from '../utils/api'
import { useTableState } from '../utils/useTableState'
import { parseCsv } from '../utils/csvParser'

interface Props { state: AppState; update: (u: Partial<AppState>) => void; onSave?: () => void }

export default function EmailDraftsStep({ state, update, onSave }: Props) {
  const [selected, setSelected] = useState<EmailPayload[]>([])
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const savedAliases = new Set(state.savedAMAliases)
  const sentAliases = new Set(state.sentAMAliases)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [kiroStats, setKiroStats] = useState<{ available: number; reserved: number; used: number; total: number } | null>(null)
  const [kiroUploading, setKiroUploading] = useState(false)
  const [excludedAccountIds, setExcludedAccountIds] = useState<Set<string>>(new Set())

  // Load AM-email account exclusions on mount (read-only — managed in dedicated UI)
  useEffect(() => {
    apiPost('/account-exclusions/list', {})
      .then((d: any) => {
        const ids = (d.items || []).map((i: any) => i.accountId).filter(Boolean)
        setExcludedAccountIds(new Set(ids))
      })
      .catch(() => { /* non-fatal */ })
  }, [])

  // Debounced auto-save: save 1s after user stops editing
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const debouncedSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onSave?.(), 1000)
  }, [onSave])

  // Body template: user can edit this, and all per-AM emails are regenerated from it
  // If the saved override doesn't contain any account placeholder, it's a stale pre-filled body — reset it
  const savedOverride = state.amEmailBodyOverride
  const hasAccountPlaceholder = savedOverride && (
    savedOverride.includes('{account_details}') || savedOverride.includes('{account_name}') ||
    savedOverride.includes('{attendee_list}') || savedOverride.includes('{opportunity_list}')
  )
  const isStaleOverride = savedOverride && !hasAccountPlaceholder
  const bodyTemplate = (isStaleOverride ? '' : savedOverride) || AM_EMAIL_BODY_TEMPLATE
  const setBodyTemplate = (v: string) => update({ amEmailBodyOverride: v })

  // Clear stale override on mount
  useEffect(() => {
    if (isStaleOverride) {
      update({ amEmailBodyOverride: '' })
    }
  }, [isStaleOverride])

  // Subject override — this is the template with placeholders like {account_name}
  const subjectTemplate = state.amEmailSubjectOverride || state.config?.am_email_subject || AM_EMAIL_SUBJECT_DEFAULT

  const kiroCodesPerEmail = state.kiroCodesPerEmail || 1

  // Resolve {kiro_credit_code} placeholder for preview display
  // Uses stored kiro_codes (from peek) when available
  const resolveKiroPreview = (body: string, payload?: EmailPayload) => {
    if (!state.kiroCodesEnabled) return body.replace('{kiro_credit_code}', '').replace(/\n\n\n+/g, '\n\n').trim()
    const excludeSet = new Set(state.kiroExcludeDomains.map(d => d.toLowerCase().trim()))
    const isExcluded = payload ? (payload.am_domains || []).some(d => excludeSet.has(d.toLowerCase().trim())) : false
    if (isExcluded) return body.replace('{kiro_credit_code}', '').replace(/\n\n\n+/g, '\n\n').trim()
    const stored = payload?.kiro_codes || (payload?.kiro_code ? [payload.kiro_code] : [])
    const codeLines = stored.length > 0
      ? stored.map((c, i) => stored.length === 1 ? `Kiro Credit Code ($200 credit): ${c}` : `Kiro Credit Code ${i + 1} ($200 credit): ${c}`).join('\n')
      : (kiroCodesPerEmail === 2
          ? `Kiro Credit Code 1 ($200 credit): [Save as draft to assign]\nKiro Credit Code 2 ($200 credit): [Save as draft to assign]`
          : `Kiro Credit Code ($200 credit): [Save as draft to assign]`)
    const preview = `As a follow-up, we would like to provide the attendee(s) with Kiro credits ($200 per code) for use on Bedrock, AgentCore and Kiro. We'd appreciate your help in sharing this with the customer and encouraging them to leverage it to accelerate their agentic AI use case.\n\n${codeLines}`
    return body.replace('{kiro_credit_code}', preview).replace(/\n\n\n+/g, '\n\n').trim()
  }
  const setSubjectTemplate = (v: string) => { update({ amEmailSubjectOverride: v }); debouncedSave() }

  // Always regenerate payloads from enriched data + template on mount
  // This ensures per-AM bodies are correct even when loading stale payloads from S3
  const [regenerated, setRegenerated] = useState(false)
  useEffect(() => {
    if (state.enriched.length > 0 && state.config && !regenerated && excludedAccountIds.size >= 0) {
      const payloads = generateEmailPayloads(state.enriched, state.matchResults.plan, state.config, bodyTemplate, subjectTemplate, excludedAccountIds)
      if (payloads.length > 0) {
        update({ emailPayloads: payloads })
      }
      setRegenerated(true)
    }
  }, [state.enriched, state.config, regenerated, excludedAccountIds])

  const payloads = state.emailPayloads.filter(p => p.am_alias !== 'Not Found' && p.am_name !== 'Not Found')
  const pending = payloads.filter(p => !savedAliases.has(p.am_alias) && !sentAliases.has(p.am_alias))
  const payloadsTable = useTableState(payloads, { defaultSortField: 'am_name' })

  const regeneratePayloads = (template?: string, subjectTpl?: string) => {
    if (state.enriched.length > 0 && state.config) {
      const newPayloads = generateEmailPayloads(state.enriched, state.matchResults.plan, state.config, template || bodyTemplate, subjectTpl || subjectTemplate, excludedAccountIds)
      update({ emailPayloads: newPayloads })
      setPreviewIdx(0)
    }
  }

  const handleSubjectChange = (v: string) => {
    setSubjectTemplate(v)
    // Regenerate all per-AM emails with the new subject template
    if (state.enriched.length > 0 && state.config) {
      const newPayloads = generateEmailPayloads(state.enriched, state.matchResults.plan, state.config, bodyTemplate, v, excludedAccountIds)
      update({ emailPayloads: newPayloads, amEmailSubjectOverride: v })
    }
    debouncedSave()
  }

  const handleBodyTemplateChange = (v: string) => {
    setBodyTemplate(v)
    // Regenerate all per-AM emails with the new template
    if (state.enriched.length > 0 && state.config) {
      const newPayloads = generateEmailPayloads(state.enriched, state.matchResults.plan, state.config, v, subjectTemplate, excludedAccountIds)
      update({ emailPayloads: newPayloads, amEmailBodyOverride: v })
    }
    debouncedSave()
  }

  // Load Kiro credit code stats from backend
  const loadKiroStats = async () => {
    try {
      const data = await apiPost('/kiro/stats', {})
      setKiroStats(data)
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    if (state.kiroCodesEnabled) loadKiroStats()
  }, [state.kiroCodesEnabled])

  // Upload credit codes from a CSV file (single column: code)
  const handleKiroCodesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setKiroUploading(true)
    const rows = await parseCsv<Record<string, string>>(file)
    // Accept first column value regardless of header name
    const codes = rows.map(r => Object.values(r)[0]?.trim()).filter(Boolean) as string[]
    if (codes.length === 0) { setKiroUploading(false); return }
    const data = await apiPost('/kiro/upload', { codes })
    await loadKiroStats()
    setKiroUploading(false)
    setStatusMsg(`Kiro codes uploaded: ${data.uploaded} added, ${data.skipped} skipped.`)
  }

  // Upload exclude list CSV (columns: domain or customer_name, domain)
  const handleExcludeListUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const rows = await parseCsv<Record<string, string>>(file)
    const domains: string[] = []
    for (const row of rows) {
      const keys = Object.keys(row).map(k => k.toLowerCase().trim())
      const domainKey = Object.keys(row).find(k => k.toLowerCase().trim() === 'domain')
      const val = domainKey ? row[domainKey] : Object.values(row).find((_, i) => keys[i] === 'domain')
      if (val?.trim()) domains.push(val.trim().toLowerCase())
      // Also try any column that looks like a domain (contains a dot, no spaces)
      for (const v of Object.values(row)) {
        const t = v?.trim().toLowerCase()
        if (t && t.includes('.') && !t.includes(' ') && !domains.includes(t)) domains.push(t)
      }
    }
    const unique = [...new Set(domains)]
    update({ kiroExcludeDomains: unique })
    setStatusMsg(`Exclude list loaded: ${unique.length} domains.`)
  }

  // For drafts: peek codes (read-only, no DynamoDB writes), inject real codes into body
  const injectKiroDraftCodes = async (items: EmailPayload[]): Promise<EmailPayload[]> => {
    if (!state.kiroCodesEnabled) return items

    const amsToRequest = items.map(p => ({
      alias: p.am_alias,
      email: p.am_email,
      domains: p.am_domains || [],
      accountCount: kiroCodesPerEmail,
    }))

    let assignments: Record<string, string[]> = {}
    try {
      const data = await apiPost('/kiro/peek-batch', {
        ams: amsToRequest,
        excludeDomains: state.kiroExcludeDomains,
      })
      assignments = data.assignments || {}
    } catch (err) {
      console.error('Failed to peek Kiro codes:', err)
    }

    const excludeSet = new Set(state.kiroExcludeDomains.map(d => d.toLowerCase().trim()))
    const updatedPayloads = items.map(p => {
      const isExcluded = (p.am_domains || []).some(d => excludeSet.has(d.toLowerCase().trim()))
      const codes = assignments[p.am_alias] || []
      let kiroSection = ''
      if (!isExcluded) {
        const codeLines = codes.length > 0
          ? codes.map((c, i) => codes.length === 1
              ? `Kiro Credit Code ($200 credit): ${c}`
              : `Kiro Credit Code ${i + 1} ($200 credit): ${c}`).join('\n')
          : kiroCodesPerEmail === 2
            ? `Kiro Credit Code 1 ($200 credit): [No codes available]\nKiro Credit Code 2 ($200 credit): [No codes available]`
            : `Kiro Credit Code ($200 credit): [No codes available]`
        kiroSection = `As a follow-up, we would like to provide the attendee(s) with Kiro credits ($200 per code) for use on Bedrock, AgentCore and Kiro. We'd appreciate your help in sharing this with the customer and encouraging them to leverage it to accelerate their agentic AI use case.\n\n${codeLines}`
      }
      const rawBody = p.body.replace('{kiro_credit_code}', kiroSection)
      const body = rawBody.replace(/\n\n\n+/g, '\n\n').trim()
      // Store all peeked codes so send can claim exactly these same codes
      const savedCodes = codes.length > 0 ? codes : (p.kiro_codes || (p.kiro_code ? [p.kiro_code] : null))
      return { ...p, kiro_codes: savedCodes, kiro_code: codes[0] || p.kiro_code || null, body }
    })

    // Persist peeked codes back to state for preview and send reuse
    update({
      emailPayloads: state.emailPayloads.map(p => {
        const updated = updatedPayloads.find(u => u.am_alias === p.am_alias)
        return updated ? { ...p, kiro_codes: updated.kiro_codes, kiro_code: updated.kiro_code } : p
      })
    })

    return updatedPayloads
  }

  // For send: claim codes in DynamoDB, reusing pre-peeked codes stored in state when available
  const claimAndInjectKiroCodes = async (items: EmailPayload[]): Promise<EmailPayload[]> => {
    if (!state.kiroCodesEnabled) return items

    // Build preAssignments from all codes already peeked during draft
    const preAssignments: Record<string, string[]> = {}
    for (const p of items) {
      const codes = p.kiro_codes || (p.kiro_code ? [p.kiro_code] : null)
      if (codes && codes.length > 0) preAssignments[p.am_alias] = codes
    }

    const amsToRequest = items.map(p => ({
      alias: p.am_alias,
      email: p.am_email,
      domains: p.am_domains || [],
      accountCount: kiroCodesPerEmail,
    }))

    let assignments: Record<string, string[]> = {}
    try {
      const data = await apiPost('/kiro/claim-batch', {
        ams: amsToRequest,
        eventId: state.eventId,
        excludeDomains: state.kiroExcludeDomains,
        preAssignments,
      })
      assignments = data.assignments || {}
    } catch (err) {
      console.error('Failed to claim Kiro codes:', err)
      return items
    }

    return items.map(p => {
      const codes = assignments[p.am_alias] || []
      let kiroSection = ''
      if (codes.length > 0) {
        const codeLines = codes.length === 1
          ? `Kiro Credit Code ($200 credit): ${codes[0]}`
          : codes.map((c, i) => `Kiro Credit Code ${i + 1} ($200 credit): ${c}`).join('\n')
        kiroSection = `As a follow-up, we would like to provide the attendee(s) with Kiro credits ($200 per code) for use on Bedrock, AgentCore and Kiro. We'd appreciate your help in sharing this with the customer and encouraging them to leverage it to accelerate their agentic AI use case.\n\n${codeLines}`
      }
      const rawBody = p.body.replace('{kiro_credit_code}', kiroSection)
      const body = rawBody.replace(/\n\n\n+/g, '\n\n').trim()
      return { ...p, kiro_code: codes[0] || null, kiro_codes: codes.length > 0 ? codes : null, body }
    })
  }

  const processEmails = async (items: EmailPayload[], mode: 'draft' | 'send') => {
    const doneSet = mode === 'draft' ? savedAliases : sentAliases
    const toProcess = items.filter(p => !doneSet.has(p.am_alias))
    if (toProcess.length === 0) {
      setStatusMsg(`All selected emails already ${mode === 'draft' ? 'saved' : 'sent'}.`)
      return
    }

    const setLoading = mode === 'draft' ? setSaving : setSending
    setLoading(true)
    setProgress(0)

    // Drafts peek codes (read-only); Send claims them in DynamoDB
    const toProcessWithCodes = mode === 'send'
      ? await claimAndInjectKiroCodes(toProcess)
      : await injectKiroDraftCodes(toProcess)

    const batchSize = 5
    const concurrency = 10
    const newDone = new Set(doneSet)
    let created = 0
    let failed = 0
    const endpoint = mode === 'draft' ? '/create-drafts' : '/send-emails'
    const action = mode === 'draft' ? 'Saving drafts' : 'Sending emails'

    // Split into batches of 5
    const batches: EmailPayload[][] = []
    for (let i = 0; i < toProcessWithCodes.length; i += batchSize) {
      batches.push(toProcessWithCodes.slice(i, i + batchSize))
    }

    let completed = 0
    const processBatch = async (batch: EmailPayload[]) => {
      try {
        const data = await apiPost(endpoint, {
          emails: batch.map(p => ({
            to: p.am_email,
            subject: p.subject,
            body: p.body,
          })),
        })
        for (const r of (data.results || [])) {
          if (r.status === 'SUCCESS') {
            const match = batch.find(p => p.am_email === r.am_email)
            if (match) newDone.add(match.am_alias)
            created++
          } else {
            failed++
          }
        }
      } catch (err) {
        failed += batch.length
      }
      completed++
      setProgress(Math.round((completed / batches.length) * 100))
      setStatusMsg(`${action}... ${Math.min(completed * batchSize, toProcessWithCodes.length)} of ${toProcessWithCodes.length}`)
    }

    // Run up to `concurrency` batches in parallel
    for (let i = 0; i < batches.length; i += concurrency) {
      const chunk = batches.slice(i, i + concurrency)
      await Promise.all(chunk.map(processBatch))
    }

    if (mode === 'draft') update({ savedAMAliases: [...newDone] })
    else update({ sentAMAliases: [...newDone] })
    setSelected([])
    const label = mode === 'draft' ? 'drafts saved to Outlook' : 'emails sent'
    setStatusMsg(`Done! ${created} ${label}, ${failed} failed.`)
    setLoading(false)
  }

  const isProcessing = saving || sending

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">AM Email Drafts</Header>}>
        <SpaceBetween size="m">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
            <MetricCard label="Total AM Drafts" value={payloads.length} color="blue" />
            <MetricCard label="AMs with Opps" value={payloads.filter(p => p.opp_count > 0).length} color="green" />
            <MetricCard label="AMs (Attendee Only)" value={payloads.filter(p => p.opp_count === 0).length} color="orange" />
            <MetricCard label="Saved to Outlook" value={savedAliases.size} color="purple" />
            <MetricCard label="Sent" value={sentAliases.size} color="teal" />
          </div>

          <Alert type="info">
            Select AMs and click "Save as Drafts" to create email drafts in Outlook, or "Send" to send directly. Works on both macOS and Windows.
          </Alert>

          {excludedAccountIds.size > 0 && (() => {
            const matchedAccountIds = new Set<string>()
            for (const p of payloads) {
              for (const att of state.enriched) {
                if (att['AM Alias'] === p.am_alias && att.Status === 'Matched') {
                  matchedAccountIds.add(att['Account ID'])
                }
              }
            }
            const hits = [...matchedAccountIds].filter(aid => excludedAccountIds.has(aid))
            return (
              <Alert type="warning" header="Account exclusion list active">
                {excludedAccountIds.size.toLocaleString()} accounts are on the AM-email exclusion list.
                {hits.length > 0
                  ? ` ${hits.length} of this event's matched accounts will receive emails WITHOUT the opportunity list (attendees + account name only).`
                  : ` None of this event's matched accounts are on the list — all emails include opportunity details as normal.`}
              </Alert>
            )
          })()}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Kiro Credit Codes</Header>}>
        <SpaceBetween size="m">
          <Toggle
            checked={state.kiroCodesEnabled}
            onChange={({ detail }) => {
              update({ kiroCodesEnabled: detail.checked })
              if (detail.checked) loadKiroStats()
              if (state.enriched.length > 0 && state.config) {
                const newPayloads = generateEmailPayloads(state.enriched, state.matchResults.plan, state.config, bodyTemplate, subjectTemplate, excludedAccountIds)
                update({ kiroCodesEnabled: detail.checked, emailPayloads: newPayloads })
              }
            }}
          >
            Include Kiro credit code in AM emails
          </Toggle>

          {state.kiroCodesEnabled && (
            <SpaceBetween size="m">
              {kiroStats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  <MetricCard label="Available Codes" value={kiroStats.available} color="green" />
                  <MetricCard label="Used (Sent)" value={kiroStats.used} color="purple" />
                  <MetricCard label="Total Codes" value={kiroStats.total} color="blue" />
                </div>
              )}

              <FormField label="Codes per email">
                <RadioGroup
                  value={String(kiroCodesPerEmail)}
                  onChange={({ detail }) => update({ kiroCodesPerEmail: Number(detail.value) })}
                  items={[
                    { value: '1', label: '1 Kiro credit code per AM email (default)' },
                    { value: '2', label: '2 Kiro credit codes per AM email' },
                  ]}
                />
              </FormField>

              <SpaceBetween size="s" direction="horizontal">
                <Button onClick={loadKiroStats}>Refresh Stats</Button>
                <Button
                  variant="inline-link"
                  onClick={async () => {
                    if (!window.confirm('Reset all Kiro codes in DynamoDB? This will make all used/reserved codes available again.')) return
                    try {
                      const data = await apiPost('/kiro/reset', {})
                      await loadKiroStats()
                      setStatusMsg(`Reset ${data.reset} Kiro codes — all codes are available again.`)
                    } catch (err) {
                      setStatusMsg(`Reset failed: ${err instanceof Error ? err.message : String(err)}`)
                    }
                  }}
                >
                  Reset all codes
                </Button>
              </SpaceBetween>

              <FormField
                label="Exclude List"
                description={`${state.kiroExcludeDomains.length} domain(s) excluded. AMs whose customers have any of these domains will not receive a credit code.`}
              >
                <SpaceBetween size="xs" direction="horizontal">
                  <input type="file" accept=".csv" onChange={handleExcludeListUpload} />
                  {state.kiroExcludeDomains.length > 0 && (
                    <Button variant="inline-link" onClick={() => update({ kiroExcludeDomains: [] })}>
                      Clear exclude list
                    </Button>
                  )}
                </SpaceBetween>
              </FormField>

              {state.kiroExcludeDomains.length > 0 && (
                <Alert type="info">
                  Excluded domains: {state.kiroExcludeDomains.join(', ')}
                </Alert>
              )}


            </SpaceBetween>
          )}
        </SpaceBetween>
      </Container>

      {payloads.length > 0 && (
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Email Template</Header>}>
            <ExpandableSection headerText="View / Edit Email Template" defaultExpanded={false}>
              <SpaceBetween size="m">
                <FormField label="Subject Template" description="Supports placeholders: {account_name}, {recipient_name}, {event_name}, {event_date}, etc.">
                  <Input value={subjectTemplate} onChange={({ detail }) => handleSubjectChange(detail.value)} />
                </FormField>
                <FormField label="Body Template" description="Placeholders: {recipient_name}, {account_name}, {attendee_list}, {opportunity_list}, {event_name}, {event_date}, {sender_name}, {sender_team}, {sender_title}, {wiki_link}. Legacy: {account_details} (combined).">
                  <Textarea value={bodyTemplate} onChange={({ detail }) => handleBodyTemplateChange(detail.value)} rows={12} />
                </FormField>
                <Button onClick={() => {
                  update({ amEmailBodyOverride: '', amEmailSubjectOverride: '' })
                  regeneratePayloads(AM_EMAIL_BODY_TEMPLATE, AM_EMAIL_SUBJECT_DEFAULT)
                }}>Reset to Default Template</Button>
              </SpaceBetween>
            </ExpandableSection>
          </Container>

          <Container header={<Header variant="h2">Email Preview</Header>}>
            <ExpandableSection headerText={`Preview — ${payloads[previewIdx]?.am_name || 'N/A'} (${previewIdx + 1} of ${payloads.length})`} defaultExpanded={false}>
              <SpaceBetween size="m">
                <FormField label="Subject">
                  <Input value={payloads[previewIdx]?.subject || ''} readOnly />
                </FormField>
                <Textarea value={resolveKiroPreview(payloads[previewIdx]?.body || '', payloads[previewIdx])} readOnly rows={12} />
                <SpaceBetween size="s" direction="horizontal">
                  <Button disabled={previewIdx === 0} onClick={() => setPreviewIdx(previewIdx - 1)}>Previous AM</Button>
                  <Button disabled={previewIdx >= payloads.length - 1} onClick={() => setPreviewIdx(previewIdx + 1)}>Next AM</Button>
                </SpaceBetween>
              </SpaceBetween>
            </ExpandableSection>
          </Container>

          <Container header={<Header variant="h2" counter={`(${payloads.length})`}>Email List</Header>}>
            <SpaceBetween size="m">
              <Table
                columnDefinitions={[
                  { id: 'am', header: 'AM Name', cell: (e: EmailPayload) => e.am_name, sortingField: 'am_name' },
                  { id: 'email', header: 'AM Email', cell: (e: EmailPayload) => e.am_email, sortingField: 'am_email' },
                  { id: 'accounts', header: 'Accounts', cell: (e: EmailPayload) => e.account_count },
                  { id: 'attendees', header: 'Attendees', cell: (e: EmailPayload) => e.attendee_count },
                  { id: 'opps', header: 'Opps', cell: (e: EmailPayload) => e.opp_count > 0 ? <StatusIndicator type="success">{e.opp_count}</StatusIndicator> : <span>0</span> },
                  { id: 'status', header: 'Status', cell: (e: EmailPayload) =>
                    sentAliases.has(e.am_alias) ? <StatusIndicator type="success">Sent</StatusIndicator> :
                    savedAliases.has(e.am_alias) ? <StatusIndicator type="info">Draft saved</StatusIndicator> :
                    <StatusIndicator type="pending">Pending</StatusIndicator>
                  },
                ]}
                items={payloadsTable.paged}
                selectionType="multi"
                selectedItems={selected}
                onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
                trackBy="am_alias"
                sortingColumn={payloadsTable.sortField ? { sortingField: payloadsTable.sortField } : undefined}
                sortingDescending={!payloadsTable.sortAsc}
                onSortingChange={({ detail }) => payloadsTable.onSort(detail.sortingColumn.sortingField!)}
                filter={<TextFilter filteringText={payloadsTable.filterText} filteringPlaceholder="Filter AMs..." onChange={({ detail }) => payloadsTable.setFilterText(detail.filteringText)} />}
                pagination={<Pagination currentPageIndex={payloadsTable.currentPage} pagesCount={payloadsTable.totalPages} onChange={({ detail }) => payloadsTable.setCurrentPage(detail.currentPageIndex)} />}
                empty={<Box textAlign="center" color="inherit"><b>No emails</b><Box padding={{ bottom: 's' }} variant="p" color="inherit">No AM email payloads generated yet.</Box></Box>}
                variant="embedded"
                stripedRows
                stickyHeader
              />

              <SpaceBetween size="s" direction="horizontal">
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={() => { if (window.confirm(`Save ${selected.length} email drafts to Outlook?`)) processEmails(selected, 'draft') }}
                  disabled={selected.length === 0 || isProcessing}
                >
                  {saving ? 'Saving...' : `Save Selected (${selected.length}) as Drafts`}
                </Button>
                <Button
                  loading={saving}
                  onClick={() => { if (window.confirm(`Save ${pending.length} email drafts to Outlook?`)) processEmails(pending, 'draft') }}
                  disabled={pending.length === 0 || isProcessing}
                >
                  {saving ? 'Saving...' : `Save All (${pending.length}) as Drafts`}
                </Button>
                <Button
                  loading={sending}
                  onClick={() => { if (window.confirm(`Send ${selected.length} emails now? This cannot be undone.`)) processEmails(selected, 'send') }}
                  disabled={selected.length === 0 || isProcessing}
                >
                  {sending ? 'Sending...' : `Send Selected (${selected.length})`}
                </Button>
                <Button
                  loading={sending}
                  onClick={() => { if (window.confirm(`Send ${pending.length} emails now? This cannot be undone.`)) processEmails(pending, 'send') }}
                  disabled={pending.length === 0 || isProcessing}
                >
                  {sending ? 'Sending...' : `Send All (${pending.length})`}
                </Button>
                {savedAliases.size > 0 && (
                  <Button
                    variant="inline-link"
                    onClick={() => { if (window.confirm('Reset draft status? This lets you re-save all drafts.')) { update({ savedAMAliases: [] }); setStatusMsg('Draft status reset.') } }}
                    disabled={isProcessing}
                  >
                    Reset draft status ({savedAliases.size})
                  </Button>
                )}
              </SpaceBetween>

              {isProcessing && <ProgressBar value={progress} label={statusMsg} />}
              {!isProcessing && statusMsg && <StatusIndicator type={statusMsg.includes('failed') ? 'warning' : 'success'}>{statusMsg}</StatusIndicator>}
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      )}
    </SpaceBetween>
  )
}
