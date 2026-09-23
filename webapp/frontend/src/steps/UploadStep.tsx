import { useRef } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Button from '@cloudscape-design/components/button'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Link from '@cloudscape-design/components/link'
import { AppState, Attendee } from '../types'
import MetricCard from '../components/MetricCard'
import { parseCsv, deduplicateByField } from '../utils/csvParser'

interface Props { state: AppState; update: (u: Partial<AppState>) => void }

export default function UploadStep({ state, update }: Props) {
  const attRef = useRef<HTMLInputElement>(null)
  const oppsRef = useRef<HTMLInputElement>(null)

  const handleAttendance = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const csvText = await file.text()
    const rawRows = await parseCsv<Record<string, string>>(file)
    // Normalize column names — handle various CSV formats
    const parsed: Attendee[] = []
    for (const row of rawRows) {
      const keys = Object.keys(row)
      const findCol = (names: string[]) => {
        for (const n of names) {
          const found = keys.find(k => k.toLowerCase().trim() === n.toLowerCase())
          if (found) return row[found] || ''
        }
        return ''
      }
      // Filter: only include rows where "Checked-in at" is not empty (if column exists)
      const checkedIn = findCol(['checked-in at', 'checked in at', 'checkedin at', 'checked_in_at'])
      const hasCheckedInCol = keys.some(k => k.toLowerCase().trim().includes('checked'))
      if (hasCheckedInCol && !checkedIn.trim()) continue

      const firstName = findCol(['first name', 'firstname', 'first_name'])
      const lastName = findCol(['last name', 'lastname', 'last_name'])
      const visitor = findCol(['visitor', 'name', 'attendee', 'full name', 'fullname'])
      const email = findCol(['email', 'email address', 'e-mail', 'attendee email'])
      if (!email) continue

      parsed.push({
        Visitor: visitor || `${firstName} ${lastName}`.trim(),
        Company: findCol(['company', 'company name', 'organization', 'org']),
        Email: email,
        Setting: findCol(['setting chosen', 'setting', 'format', 'event format']) || undefined,
      })
    }
    const deduped = deduplicateByField(parsed, 'Email')

    // Derive totalRegistrations = all rows (before checked-in filter), notable customers = top companies by count
    const totalRegs = rawRows.length
    const companyCounts = new Map<string, number>()
    for (const att of deduped) {
      const c = att.Company?.trim()
      if (c) companyCounts.set(c, (companyCounts.get(c) || 0) + 1)
    }
    const topCompanies = [...companyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name]) => name)

    update({ attendanceFile: file, attendanceCsvText: csvText, attendees: deduped, totalRegistrations: totalRegs, notableCustomers: topCompanies })
  }

  const handleOpps = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const csvText = await file.text()
      update({ oppsFile: file, oppsCsvText: csvText })
    }
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Attendance CSV</Header>}>
        <FormField label="Upload your attendance CSV file" description="Accepts various formats: Visitor/Company/Email, First name/Last name/Email/Company Name, etc.">
          <input ref={attRef} type="file" accept=".csv" onChange={handleAttendance} style={{ display: 'none' }} />
          <SpaceBetween size="s" direction="horizontal">
            <Button onClick={() => attRef.current?.click()}>Choose file</Button>
            {state.attendanceFile ? (
              <StatusIndicator type="success">
                {state.attendanceFile.name} — {state.attendees.length} attendees loaded
              </StatusIndicator>
            ) : state.attendees.length > 0 && (
              <StatusIndicator type="success">
                Restored from saved data — {state.attendees.length} attendees
              </StatusIndicator>
            )}
          </SpaceBetween>
        </FormField>
      </Container>

      <Container header={<Header variant="h2">Opportunities Export CSV</Header>}>
        <FormField label="Upload your SFDC opps export CSV" description={<>GenAI/ML domain opps export with Opp Name, Opp ID, Customer ID, Stage, ARR($).<br/>You can download the SFDC reports as CSV from <Link href="https://us-east-1.quicksight.aws.amazon.com/sn/account/amazonbi/dashboards/06649baa-21ab-4624-894d-65bebf2a3852" external>this QuickSight dashboard</Link>.</>}>
          <input ref={oppsRef} type="file" accept=".csv,.CSV,.txt" onChange={handleOpps} style={{ display: 'none' }} />
          <SpaceBetween size="s" direction="horizontal">
            <Button onClick={() => oppsRef.current?.click()}>Choose file</Button>
            {state.oppsFile ? (
              <StatusIndicator type="success">
                {state.oppsFile.name} ({(state.oppsFile.size / (1024 * 1024)).toFixed(1)} MB)
              </StatusIndicator>
            ) : state.oppsCsvText && (
              <StatusIndicator type="success">
                Restored from saved data ({(state.oppsCsvText.length / 1024).toFixed(0)} KB)
              </StatusIndicator>
            )}
          </SpaceBetween>
        </FormField>
      </Container>

      {state.attendees.length > 0 && (
        <Container header={<Header variant="h2">Upload Summary</Header>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <MetricCard label="Total Registrations" value={state.totalRegistrations || state.attendees.length} color="blue" />
            <MetricCard label="Checked-in Attendees" value={state.attendees.length} color="green" />
            <MetricCard label="Attendance Rate" value={`${Math.round((state.attendees.length / (state.totalRegistrations || state.attendees.length)) * 100)}%`} color="orange" />
            <MetricCard label="Opps File" value={state.oppsFile || state.oppsCsvText ? '✓' : '—'} color={state.oppsFile || state.oppsCsvText ? 'green' : 'red'} />
          </div>
        </Container>
      )}
    </SpaceBetween>
  )
}
