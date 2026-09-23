import { useEffect, useRef, useCallback, useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Table from '@cloudscape-design/components/table'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import Box from '@cloudscape-design/components/box'
import Textarea from '@cloudscape-design/components/textarea'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import Alert from '@cloudscape-design/components/alert'
import Toggle from '@cloudscape-design/components/toggle'
import MetricCard from '../components/MetricCard'
import { AppState, CustomerEmailPayload } from '../types'
import { apiPost } from '../utils/api'
import { useTableState } from '../utils/useTableState'
import { parseCsv } from '../utils/csvParser'
import { CUSTOMER_EMAIL_BODY_TEMPLATE, CUSTOMER_EMAIL_SUBJECT_DEFAULT } from '../templates/customerEmailBody'

interface Props { state: AppState; update: (u: Partial<AppState>) => void; onSave?: () => void }

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}

function generateCustomerPayloads(state: AppState, bodyTemplate: string, subjectTemplate: string): CustomerEmailPayload[] {
  if (!state.config) return []

  const attendees = state.filtered.searchable
  if (attendees.length === 0) return []

  const config = state.config
  const payloads: CustomerEmailPayload[] = []

  // Build domain → AM name + email lookup from enriched data
  const domainToAM = new Map<string, { name: string; email: string }>()
  for (const e of state.enriched) {
    if (e.Domain && e['AM Name'] && e['AM Name'] !== 'Not Found') {
      domainToAM.set(e.Domain.toLowerCase(), { name: e['AM Name'], email: e['AM Email'] || '' })
    }
  }

  const excludeSet = new Set(state.kiroExcludeDomains.map(d => d.toLowerCase().trim()))

  for (const att of attendees) {
    const firstName = att.Visitor?.split(' ')[0] || att.Visitor || 'there'
    const domain = att.Domain?.toLowerCase() || ''
    const isExcluded = excludeSet.has(domain)
    const am = domainToAM.get(domain)

    let kiroStatement = ''
    if (state.kiroCodesEnabled && !isExcluded) {
      const amContact = am?.name
        ? (am.email ? `${am.name} (${am.email})` : am.name)
        : 'your AWS Account Manager'
      kiroStatement = `\n---\nAs a thank-you for attending, you are eligible for 2 complimentary AWS credit codes for Bedrock, AgentCore & Kiro — each valued at $200 USD — to accelerate your AI agent development on AWS.\n\nTo claim your codes, please reach out directly to your AWS Account Manager, ${amContact}.\n---`
    }

    const vars = {
      attendee_name: firstName,
      event_name: config.event_name,
      event_date: config.event_date,
      registration_url: config.registration_url || '',
      sender_name: config.am_email_sender_name,
      sender_title: config.am_email_sender_title,
      sender_team: config.am_email_sender_team,
      kiro_statement: kiroStatement,
    }
    const body = fillTemplate(bodyTemplate, vars).replace(/\n\n\n+/g, '\n\n').trim()
    const subject = fillTemplate(subjectTemplate, vars)
    payloads.push({
      email: att.Email,
      name: att.Visitor,
      company: att.Company || att.Domain || '',
      subject,
      body,
    })
  }

  return payloads
}

export default function CustomerEmailStep({ state, update, onSave }: Props) {
  const [selected, setSelected] = useState<CustomerEmailPayload[]>([])
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [previewIdx, setPreviewIdx] = useState(0)
  const [regenerated, setRegenerated] = useState(false)

  const savedSet = new Set(state.savedCustomerEmails)
  const sentSet = new Set(state.sentCustomerEmails)

  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const debouncedSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onSave?.(), 1000)
  }, [onSave])

  const bodyTemplate = state.customerEmailBodyOverride || CUSTOMER_EMAIL_BODY_TEMPLATE
  const subjectTemplate = state.customerEmailSubjectOverride || CUSTOMER_EMAIL_SUBJECT_DEFAULT

  // Generate payloads on mount, and regenerate when kiro settings change
  useEffect(() => {
    if (state.filtered.searchable.length > 0 && state.config && !regenerated) {
      const payloads = generateCustomerPayloads(state, bodyTemplate, subjectTemplate)
      if (payloads.length > 0) update({ customerEmailPayloads: payloads })
      setRegenerated(true)
    }
  }, [state.filtered.searchable, state.config, regenerated])

  useEffect(() => {
    if (state.filtered.searchable.length > 0 && state.config) {
      const payloads = generateCustomerPayloads(state, bodyTemplate, subjectTemplate)
      if (payloads.length > 0) update({ customerEmailPayloads: payloads })
    }
  }, [state.kiroCodesEnabled, state.kiroExcludeDomains])

  const regeneratePayloads = (body?: string, subject?: string) => {
    if (state.filtered.searchable.length > 0 && state.config) {
      const payloads = generateCustomerPayloads(state, body || bodyTemplate, subject || subjectTemplate)
      update({ customerEmailPayloads: payloads })
      setPreviewIdx(0)
    }
  }

  const handleBodyChange = (v: string) => {
    update({ customerEmailBodyOverride: v })
    regeneratePayloads(v, subjectTemplate)
    debouncedSave()
  }

  const handleSubjectChange = (v: string) => {
    update({ customerEmailSubjectOverride: v })
    regeneratePayloads(bodyTemplate, v)
    debouncedSave()
  }

  const payloads = state.customerEmailPayloads
  const pending = payloads.filter(p => !savedSet.has(p.email) && !sentSet.has(p.email))
  const tableState = useTableState(payloads, { defaultSortField: 'name' })

  const processEmails = async (items: CustomerEmailPayload[], mode: 'draft' | 'send') => {
    const doneSet = mode === 'draft' ? savedSet : sentSet
    const toProcess = items.filter(p => !doneSet.has(p.email))
    if (toProcess.length === 0) {
      setStatusMsg(`All selected emails already ${mode === 'draft' ? 'saved' : 'sent'}.`)
      return
    }

    const setLoading = mode === 'draft' ? setSaving : setSending
    setLoading(true)
    setProgress(0)
    setErrorMsg('')

    const batchSize = 5
    const concurrency = 10
    const newDone = new Set(doneSet)
    let created = 0
    let failed = 0
    const endpoint = mode === 'draft' ? '/create-drafts' : '/send-emails'
    const action = mode === 'draft' ? 'Saving drafts' : 'Sending emails'

    const batches: CustomerEmailPayload[][] = []
    for (let i = 0; i < toProcess.length; i += batchSize) {
      batches.push(toProcess.slice(i, i + batchSize))
    }

    let completed = 0
    const processBatch = async (batch: CustomerEmailPayload[]) => {
      try {
        const reqEmails = batch.map(p => ({ to: p.email, subject: p.subject, body: p.body }))
        console.log('[customer-email] sending batch to', endpoint, reqEmails.map(e => e.to))
        const data = await apiPost(endpoint, { emails: reqEmails })
        console.log('[customer-email] response:', JSON.stringify(data))
        for (const r of (data.results || [])) {
          if (r.status === 'SUCCESS') {
            const match = batch.find(p => p.email === r.am_email)
            if (match) newDone.add(match.email)
            created++
          } else {
            failed++
          }
        }
      } catch (err) {
        failed += batch.length
        console.error('[customer-email] batch failed:', err)
        setErrorMsg(`API error: ${err instanceof Error ? err.message : String(err)}`)
      }
      completed++
      setProgress(Math.round((completed / batches.length) * 100))
      setStatusMsg(`${action}... ${Math.min(completed * batchSize, toProcess.length)} of ${toProcess.length}`)
    }

    for (let i = 0; i < batches.length; i += concurrency) {
      await Promise.all(batches.slice(i, i + concurrency).map(processBatch))
    }

    if (mode === 'draft') update({ savedCustomerEmails: [...newDone] })
    else update({ sentCustomerEmails: [...newDone] })
    setSelected([])
    setStatusMsg(`Done! ${created} ${mode === 'draft' ? 'drafts saved' : 'emails sent'}, ${failed} failed.`)
    setLoading(false)
  }

  const isProcessing = saving || sending

  const handleExcludeListUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const rows = await parseCsv<Record<string, string>>(file)
    const domains: string[] = []
    for (const row of rows) {
      const val = row['domain'] || row['Domain'] || row['customer_name'] || row['Customer Name'] || Object.values(row)[0]
      if (val && val.trim()) domains.push(val.trim().toLowerCase())
    }
    const unique = [...new Set(domains)]
    update({ kiroExcludeDomains: unique })
    e.target.value = ''
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Customer Thank-You Emails</Header>}>
        <SpaceBetween size="m">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <MetricCard label="Total Attendees" value={payloads.length} color="blue" />
            <MetricCard label="Pending" value={pending.length} color="orange" />
            <MetricCard label="Saved to Outlook" value={savedSet.size} color="purple" />
            <MetricCard label="Sent" value={sentSet.size} color="teal" />
          </div>
          <Alert type="info">
            Send a thank-you email to each attendee with event materials and the upcoming workshop details.
          </Alert>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Kiro Credit Codes</Header>}>
        <SpaceBetween size="m">
          <Toggle
            checked={state.kiroCodesEnabled}
            onChange={({ detail }) => update({ kiroCodesEnabled: detail.checked })}
          >
            Include Kiro credit code statement in customer emails
          </Toggle>

          {state.kiroCodesEnabled && (
            <SpaceBetween size="m">
              <FormField
                label="Exclude List"
                description={`${state.kiroExcludeDomains.length} domain(s) excluded. Attendees with these domains will not receive the Kiro credit code statement.`}
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
                <FormField label="Subject" description="Supports {attendee_name}, {event_name}, {event_date}">
                  <Input value={subjectTemplate} onChange={({ detail }) => handleSubjectChange(detail.value)} />
                </FormField>
                <FormField label="Body" description="Supports {attendee_name}, {event_name}, {event_date}, {registration_url}, {sender_name}, {sender_title}, {sender_team}, {kiro_statement} (auto-filled per attendee based on Kiro settings and exclude list)">
                  <Textarea value={bodyTemplate} onChange={({ detail }) => handleBodyChange(detail.value)} rows={14} />
                </FormField>
                <Button onClick={() => {
                  update({ customerEmailBodyOverride: '', customerEmailSubjectOverride: '' })
                  regeneratePayloads(CUSTOMER_EMAIL_BODY_TEMPLATE, CUSTOMER_EMAIL_SUBJECT_DEFAULT)
                }}>Reset to Default Template</Button>
              </SpaceBetween>
            </ExpandableSection>
          </Container>

          <Container header={<Header variant="h2">Email Preview</Header>}>
            <ExpandableSection headerText={`Preview — ${payloads[previewIdx]?.name || 'N/A'} (${previewIdx + 1} of ${payloads.length})`} defaultExpanded={false}>
              <SpaceBetween size="m">
                <FormField label="Subject">
                  <Input value={payloads[previewIdx]?.subject || ''} readOnly />
                </FormField>
                <Textarea value={payloads[previewIdx]?.body || ''} readOnly rows={14} />
                <SpaceBetween size="s" direction="horizontal">
                  <Button disabled={previewIdx === 0} onClick={() => setPreviewIdx(previewIdx - 1)}>Previous</Button>
                  <Button disabled={previewIdx >= payloads.length - 1} onClick={() => setPreviewIdx(previewIdx + 1)}>Next</Button>
                </SpaceBetween>
              </SpaceBetween>
            </ExpandableSection>
          </Container>

          <Container header={<Header variant="h2" counter={`(${payloads.length})`}>Attendee List</Header>}>
            <SpaceBetween size="m">
              <Table
                columnDefinitions={[
                  { id: 'name', header: 'Name', cell: (e: CustomerEmailPayload) => e.name, sortingField: 'name' },
                  { id: 'email', header: 'Email', cell: (e: CustomerEmailPayload) => e.email, sortingField: 'email' },
                  { id: 'company', header: 'Company', cell: (e: CustomerEmailPayload) => e.company, sortingField: 'company' },
                  { id: 'status', header: 'Status', cell: (e: CustomerEmailPayload) =>
                    sentSet.has(e.email) ? <StatusIndicator type="success">Sent</StatusIndicator> :
                    savedSet.has(e.email) ? <StatusIndicator type="info">Draft saved</StatusIndicator> :
                    <StatusIndicator type="pending">Pending</StatusIndicator>
                  },
                ]}
                items={tableState.paged}
                selectionType="multi"
                selectedItems={selected}
                onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
                trackBy="email"
                sortingColumn={tableState.sortField ? { sortingField: tableState.sortField } : undefined}
                sortingDescending={!tableState.sortAsc}
                onSortingChange={({ detail }) => tableState.onSort(detail.sortingColumn.sortingField!)}
                filter={<TextFilter filteringText={tableState.filterText} filteringPlaceholder="Filter attendees..." onChange={({ detail }) => tableState.setFilterText(detail.filteringText)} />}
                pagination={<Pagination currentPageIndex={tableState.currentPage} pagesCount={tableState.totalPages} onChange={({ detail }) => tableState.setCurrentPage(detail.currentPageIndex)} />}
                empty={<Box textAlign="center"><b>No attendees</b></Box>}
                variant="embedded"
                stripedRows
                stickyHeader
              />

              <SpaceBetween size="s" direction="horizontal">
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={() => { if (window.confirm(`Save ${selected.length} drafts to Outlook?`)) processEmails(selected, 'draft') }}
                  disabled={selected.length === 0 || isProcessing}
                >
                  {saving ? 'Saving...' : `Save Selected (${selected.length}) as Drafts`}
                </Button>
                <Button
                  loading={saving}
                  onClick={() => { if (window.confirm(`Save all ${pending.length} drafts to Outlook?`)) processEmails(pending, 'draft') }}
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
                  onClick={() => { if (window.confirm(`Send all ${pending.length} emails now? This cannot be undone.`)) processEmails(pending, 'send') }}
                  disabled={pending.length === 0 || isProcessing}
                >
                  {sending ? 'Sending...' : `Send All (${pending.length})`}
                </Button>
                <Button
                  variant="inline-link"
                  onClick={() => { update({ savedCustomerEmails: [], sentCustomerEmails: [] }); setStatusMsg('Status reset.'); setErrorMsg('') }}
                  disabled={isProcessing}
                >
                  Reset status ({savedSet.size + sentSet.size} done)
                </Button>
              </SpaceBetween>

              {isProcessing && <ProgressBar value={progress} label={statusMsg} />}
              {!isProcessing && errorMsg && <Alert type="error">{errorMsg}</Alert>}
              {!isProcessing && !errorMsg && statusMsg && <Alert type={statusMsg.includes('0 drafts') || statusMsg.includes('0 emails') ? 'warning' : 'success'}>{statusMsg}</Alert>}
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      )}

      {payloads.length === 0 && (
        <Alert type="info">No attendees found. Complete the Filter & Classify step first.</Alert>
      )}
    </SpaceBetween>
  )
}
