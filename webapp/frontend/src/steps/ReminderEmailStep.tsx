import { useRef, useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Textarea from '@cloudscape-design/components/textarea'
import Button from '@cloudscape-design/components/button'
import Alert from '@cloudscape-design/components/alert'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import Box from '@cloudscape-design/components/box'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import MetricCard from '../components/MetricCard'
import { AppState, PreEventState } from '../types'
import { apiPost } from '../utils/api'
import { parseCsv } from '../utils/csvParser'
import { REMINDER_EMAIL_TEMPLATE } from '../templates/reminderEmailBody'
import { useTableState } from '../utils/useTableState'

type Registrant = { Name: string; Email: string }

interface Props {
  state: AppState
  update: (u: Partial<AppState>) => void
  updatePre: (u: Partial<PreEventState>) => void
}

export default function ReminderEmailStep({ state, update, updatePre }: Props) {
  const config = state.config!
  const fileRef = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [selected, setSelected] = useState<Registrant[]>([])

  const defaultSubject = `Reminder: ${config?.event_name || ''} - ${config?.event_date || ''}`
  const defaultBody = config
    ? REMINDER_EMAIL_TEMPLATE
        .replace(/{event_name}/g, config.event_name)
        .replace(/{event_date}/g, config.event_date)
        .replace(/{registration_url}/g, config.registration_url)
        .replace(/{event_summary}/g, config.event_summary)
        .replace(/{sender_name}/g, config.am_email_sender_name)
        .replace(/{sender_title}/g, config.am_email_sender_title)
        .replace(/{sender_team}/g, config.am_email_sender_team)
    : REMINDER_EMAIL_TEMPLATE

  const subject = state.pre.reminderSubject || defaultSubject
  const body = state.pre.reminderBody || defaultBody
  const setSubject = (v: string) => updatePre({ reminderSubject: v })
  const setBody = (v: string) => updatePre({ reminderBody: v })

  const registrants = state.pre.registrants
  const tableState = useTableState(registrants, { defaultSortField: 'Name' })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const rows = await parseCsv<Record<string, string>>(file)
    const parsed: Registrant[] = []
    for (const row of rows) {
      const keys = Object.keys(row)
      const findCol = (names: string[]) => {
        for (const n of names) {
          const found = keys.find(k => k.toLowerCase().trim() === n.toLowerCase())
          if (found) return row[found] || ''
        }
        return ''
      }
      const firstName = findCol(['first name', 'firstname', 'first_name'])
      const lastName = findCol(['last name', 'lastname', 'last_name'])
      const name = findCol(['name', 'visitor', 'attendee', 'full name']) || `${firstName} ${lastName}`.trim()
      const email = findCol(['email', 'email address', 'e-mail'])
      if (email) parsed.push({ Name: name, Email: email })
    }
    updatePre({ registrationFile: file, registrants: parsed })
  }

  const processEmails = async (items: Registrant[], mode: 'draft' | 'send') => {
    if (items.length === 0) return
    if (!window.confirm(`${mode === 'draft' ? 'Save' : 'Send'} ${items.length} reminder emails?`)) return

    setSending(true)
    setProgress(0)
    const endpoint = mode === 'draft' ? '/create-drafts' : '/send-emails'
    const batchSize = 5
    const batches: Registrant[][] = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }

    let created = 0
    let failed = 0
    for (let i = 0; i < batches.length; i++) {
      try {
        const data = await apiPost(endpoint, {
          emails: batches[i].map(r => ({
            to: r.Email,
            subject,
            body: body.replace(/{recipient_name}/g, r.Name.split(' ')[0] || 'there'),
          })),
        })
        for (const r of (data.results || [])) {
          if (r.status === 'SUCCESS') created++
          else failed++
        }
      } catch {
        failed += batches[i].length
      }
      setProgress(Math.round(((i + 1) / batches.length) * 100))
      setStatusMsg(`Processing... ${Math.min((i + 1) * batchSize, items.length)} of ${items.length}`)
    }

    updatePre({
      reminderEmailsSent: state.pre.reminderEmailsSent + created,
      checklist: { ...state.pre.checklist, reminderEmailSent: created > 0 },
    })
    setSelected([])
    const label = mode === 'draft' ? 'drafts saved' : 'emails sent'
    setStatusMsg(`Done! ${created} ${label}, ${failed} failed.`)
    setSending(false)
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Customer Reminder Emails</Header>}>
        <Alert type="info">
          Upload a registration CSV to send "Know before you go" reminder emails to registered customers.
        </Alert>
      </Container>

      <Container header={<Header variant="h2">Upload Registrations</Header>}>
        <SpaceBetween size="m">
          <FormField label="Registration CSV" description="CSV with Name/Email columns">
            <input ref={fileRef} type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
            <SpaceBetween size="s" direction="horizontal">
              <Button onClick={() => fileRef.current?.click()}>Choose file</Button>
              {state.pre.registrationFile && (
                <StatusIndicator type="success">
                  {state.pre.registrationFile.name} — {registrants.length} registrants loaded
                </StatusIndicator>
              )}
            </SpaceBetween>
          </FormField>
        </SpaceBetween>
      </Container>

      {registrants.length > 0 && (
        <>
          <Container header={<Header variant="h2">Reminder Email Template</Header>}>
            <ExpandableSection headerText="View / Edit Email" defaultExpanded={false}>
              <SpaceBetween size="m">
                <FormField label="Subject">
                  <Input value={subject} onChange={({ detail }) => setSubject(detail.value)} />
                </FormField>
                <FormField label="Body" description="Use {recipient_name} for the recipient's first name.">
                  <Textarea value={body} onChange={({ detail }) => setBody(detail.value)} rows={15} />
                </FormField>
              </SpaceBetween>
            </ExpandableSection>
          </Container>

          <Container header={<Header variant="h2" counter={`(${registrants.length})`}>Registrants</Header>}>
            <SpaceBetween size="m">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <MetricCard label="Total Registrants" value={registrants.length} color="blue" />
                <MetricCard label="Reminders Sent" value={state.pre.reminderEmailsSent} color="green" />
              </div>

              <Table
                columnDefinitions={[
                  { id: 'name', header: 'Name', cell: (r: Registrant) => r.Name, sortingField: 'Name' },
                  { id: 'email', header: 'Email', cell: (r: Registrant) => r.Email, sortingField: 'Email' },
                ]}
                items={tableState.paged}
                selectionType="multi"
                selectedItems={selected}
                onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
                trackBy="Email"
                sortingColumn={tableState.sortField ? { sortingField: tableState.sortField } : undefined}
                sortingDescending={!tableState.sortAsc}
                onSortingChange={({ detail }) => tableState.onSort(detail.sortingColumn.sortingField!)}
                filter={<TextFilter filteringText={tableState.filterText} filteringPlaceholder="Filter registrants..." onChange={({ detail }) => tableState.setFilterText(detail.filteringText)} />}
                pagination={<Pagination currentPageIndex={tableState.currentPage} pagesCount={tableState.totalPages} onChange={({ detail }) => tableState.setCurrentPage(detail.currentPageIndex)} />}
                empty={<Box textAlign="center" color="inherit"><b>No registrants</b></Box>}
                variant="embedded"
                stripedRows
                stickyHeader
              />

              <SpaceBetween size="s" direction="horizontal">
                <Button
                  variant="primary"
                  loading={sending}
                  onClick={() => processEmails(selected, 'draft')}
                  disabled={selected.length === 0 || sending}
                >
                  {sending ? 'Saving...' : `Save Selected (${selected.length}) as Drafts`}
                </Button>
                <Button
                  loading={sending}
                  onClick={() => processEmails(registrants, 'draft')}
                  disabled={registrants.length === 0 || sending}
                >
                  {sending ? 'Saving...' : `Save All (${registrants.length}) as Drafts`}
                </Button>
                <Button
                  loading={sending}
                  onClick={() => processEmails(selected, 'send')}
                  disabled={selected.length === 0 || sending}
                >
                  {sending ? 'Sending...' : `Send Selected (${selected.length})`}
                </Button>
                <Button
                  loading={sending}
                  onClick={() => processEmails(registrants, 'send')}
                  disabled={registrants.length === 0 || sending}
                >
                  {sending ? 'Sending...' : `Send All (${registrants.length})`}
                </Button>
              </SpaceBetween>

              {sending && <ProgressBar value={progress} label={statusMsg} />}
              {!sending && statusMsg && <StatusIndicator type={statusMsg.includes('failed') ? 'warning' : 'success'}>{statusMsg}</StatusIndicator>}
            </SpaceBetween>
          </Container>
        </>
      )}
    </SpaceBetween>
  )
}
