import { useState, useRef, useEffect, useCallback } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Button from '@cloudscape-design/components/button'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Textarea from '@cloudscape-design/components/textarea'
import Alert from '@cloudscape-design/components/alert'
import Table from '@cloudscape-design/components/table'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import Tabs from '@cloudscape-design/components/tabs'
import { AppState, DivisionSummary } from '../types'
import MetricCard from '../components/MetricCard'
import { apiPost } from '../utils/api'
import { TRIP_REPORT_PROMPT } from '../templates/tripReportPrompt'
import { xwikiToHtml } from '../utils/xwikiRenderer'
import { generateEventId } from '../utils/eventId'
import Box from '@cloudscape-design/components/box'
import { downloadEventDetailCsv } from '../utils/eventDetailCsv'

interface Props { state: AppState; update: (u: Partial<AppState>) => void; onSave?: () => void }

const COLORS = ['#0073bb', '#ff9900', '#1a8754', '#d13212', '#7b61ff', '#00a1c9', '#eb5f07', '#037f0c']

export default function ReportStep({ state, update, onSave }: Props) {
  const { enriched, matchResults, activityResults, config, attendees, photos, divisionSummary } = state
  const emailPayloads = state.emailPayloads.filter(p => p.am_alias !== 'Not Found' && p.am_name !== 'Not Found')
  const matched = enriched.filter(e => e.Status === 'Matched')
  const uniqueAccounts = new Set(matched.map(m => m['Account ID'])).size
  const accountsWithOpps = new Set(matchResults.plan.map(p => p['Account ID'])).size
  const accountsSkipped = matchResults.skipped.length
  const uniqueCompanies = new Set(attendees.map(a => a.Company).filter(c => c)).size
  const totalARR = matchResults.plan.reduce((s, p) => s + (parseFloat((p['ARR($)'] || '0').replace(/[^0-9.-]/g, '')) || 0), 0)

  // Auto-derive fields from uploaded data
  const derivedFormat = attendees.length > 0 && attendees[0].Setting ? attendees[0].Setting : 'Virtual Webinar'
  const derivedRegistrations = state.totalRegistrations || attendees.length
  const derivedNotable = state.notableCustomers.join(', ')

  const rf = state.reportFields
  const [csat, setCsatLocal] = useState(rf.csat || '4.8')
  const [totalAttendees, setTotalAttendees] = useState(String(attendees.length))
  const [registrations, setRegistrations] = useState(String(derivedRegistrations))
  const [location, setLocationLocal] = useState(rf.location || '')
  const [format, setFormatLocal] = useState(rf.format || derivedFormat)
  const [customerFeedback, setCustomerFeedbackLocal] = useState(rf.customerFeedback || '')
  const [actionItems, setActionItemsLocal] = useState(rf.actionItems || '')
  const [notableCustomers, setNotableCustomersLocal] = useState(derivedNotable)

  const [copied, setCopied] = useState(false)
  const [wikiOutput, setWikiOutput] = useState(state.tripReport || '')
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Event Detail CSV — audience + learnings text and exclusion-set state
  const [targetAudience, setTargetAudience] = useState((config as any)?.target_audience || 'Software engineers, developers, and architects building AI agents on AWS')
  const [audienceLearnings, setAudienceLearnings] = useState((config as any)?.audience_learnings || '')
  const [excludedAccountIds, setExcludedAccountIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // Lazy-load the AM-account exclusion set so the Non-AGS column can be filled
  // when the user clicks Export. Loaded once per visit to the Report step.
  useEffect(() => {
    apiPost('/account-exclusions/list', {})
      .then((d: any) => {
        const ids = (d.items || []).map((i: any) => i.accountId).filter(Boolean)
        setExcludedAccountIds(new Set(ids))
      })
      .catch(() => { /* non-fatal — export still works without exclusion flags */ })
  }, [])

  const handleExportEventDetail = () => {
    setExporting(true)
    setExportError('')
    try {
      // Inject the latest audience/learnings into config so the CSV picks them up.
      const enrichedConfig = config
        ? { ...config, target_audience: targetAudience, audience_learnings: audienceLearnings }
        : null
      if (!enrichedConfig) {
        setExportError('Event config is missing — finish the Config step first.')
        setExporting(false)
        return
      }
      // Persist the audience/learnings on the AppState config so the next save
      // round-trips them into S3.
      update({ config: enrichedConfig as any })
      downloadEventDetailCsv({
        state: { ...state, config: enrichedConfig as any },
        excludedAccountIds,
        eventType: state.pre?.eventType ? (state.pre.eventType === 'in-person' ? 'In-Person' : 'Virtual') : 'Virtual',
        primaryHost: state.primaryHost || enrichedConfig.am_email_sender_name || '',
      })
    } catch (err: any) {
      setExportError(err.message || String(err))
    } finally {
      setExporting(false)
    }
  }

  // Debounced save: waits 2s after last change before saving
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      console.log('[report] Debounced save triggered')
      onSave?.()
    }, 2000)
  }, [onSave])

  const updateReportField = (field: string, value: string) => {
    update({ reportFields: { ...state.reportFields, [field]: value } })
    debouncedSave()
  }
  const setCsat = (v: string) => { setCsatLocal(v); updateReportField('csat', v) }
  const setLocation = (v: string) => { setLocationLocal(v); updateReportField('location', v) }
  const setFormat = (v: string) => { setFormatLocal(v); updateReportField('format', v) }
  const setCustomerFeedback = (v: string) => { setCustomerFeedbackLocal(v); updateReportField('customerFeedback', v) }
  const setActionItems = (v: string) => { setActionItemsLocal(v); updateReportField('actionItems', v) }
  const setNotableCustomers = (v: string) => { setNotableCustomersLocal(v); update({ notableCustomers: v.split(',').map(s => s.trim()).filter(Boolean), reportFields: { ...state.reportFields } }); debouncedSave() }

  // Auto-save when tripReport changes in state (covers both generation and edits)
  const prevTripReportRef = useRef(state.tripReport || '')
  useEffect(() => {
    if (state.tripReport && state.tripReport !== prevTripReportRef.current) {
      prevTripReportRef.current = state.tripReport
      console.log('[trip-report] tripReport changed in state, scheduling save...')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        console.log('[trip-report] Auto-save firing')
        onSave?.()
      }, 1000)
    }
  }, [state.tripReport, onSave])

  // Update derived values when data loads (local only, no AppState sync)
  useEffect(() => {
    if (state.totalRegistrations > 0) setRegistrations(String(state.totalRegistrations))
    if (attendees.length > 0) setTotalAttendees(String(attendees.length))
    if (state.notableCustomers.length > 0) setNotableCustomersLocal(state.notableCustomers.join(', '))
    if (attendees.length > 0 && attendees[0].Setting && !rf.format) setFormatLocal(attendees[0].Setting)
  }, [state.totalRegistrations, state.notableCustomers.length, attendees.length])

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) update({ photos: [...photos, ...files] })
    e.target.value = ''
  }

  const removePhoto = (index: number) => {
    update({ photos: photos.filter((_, i) => i !== index) })
  }

  // Pipeline analysis chart data
  const pipelineChartData = divisionSummary.map(d => ({
    name: d.division || 'Unknown',
    'Pipeline ARR': Math.round(d.pipelineARR),
    'Launched ARR': Math.round(d.launchedARR),
  }))

  // Customer analysis - companies by attendee count
  const companyCounts = new Map<string, number>()
  for (const att of attendees) {
    const c = att.Company?.trim()
    if (c) companyCounts.set(c, (companyCounts.get(c) || 0) + 1)
  }
  const topCompanyData = [...companyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  // Division pie chart data
  const divisionPieData = divisionSummary.filter(d => d.totalARR > 0).map(d => ({
    name: d.division || 'Unknown',
    value: Math.round(d.totalARR),
  }))

  const generateWithBedrock = async () => {
    if (!config) return
    setGenerating(true)
    setGenStatus('Generating trip report with Bedrock Claude...')

    const attendeeCount = parseInt(totalAttendees) || attendees.length
    const attendanceRate = registrations ? `${Math.round((attendeeCount / parseInt(registrations)) * 100)}%` : 'N/A'
    const photoSection = photos.length > 0
      ? photos.map(p => `[[image:${p.name}||style="border-radius:8px" width="320"]]`).join(' ')
      : '//Upload photos in the Trip Report step to include them here.//'

    const pipelineARR = divisionSummary.reduce((s, d) => s + d.pipelineARR, 0)
    const launchedARR = divisionSummary.reduce((s, d) => s + d.launchedARR, 0)

    const divTableRows = divisionSummary.map(d =>
      `|${d.division || 'Unknown'}|${d.accounts}|$${d.pipelineARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}|$${d.launchedARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}|$${d.totalARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    ).join('\n')

    const prompt = TRIP_REPORT_PROMPT
      .replaceAll('{event_name}', config.event_name)
      .replaceAll('{event_date}', config.event_date)
      .replaceAll('{format}', format)
      .replaceAll('{location}', location || 'Virtual')
      .replaceAll('{services}', config.services.join(', '))
      .replaceAll('{registration_url}', config.registration_url)
      .replaceAll('{campaign_code}', config.campaign_code)
      .replaceAll('{registrations}', registrations || 'N/A')
      .replaceAll('{attendees}', String(attendeeCount))
      .replaceAll('{attendance_rate}', attendanceRate)
      .replaceAll('{unique_companies}', String(uniqueCompanies))
      .replaceAll('{unique_accounts}', String(uniqueAccounts))
      .replaceAll('{accounts_with_opps}', String(accountsWithOpps))
      .replaceAll('{accounts_skipped}', String(accountsSkipped))
      .replaceAll('{activities_created}', String(activityResults.created))
      .replaceAll('{am_notifications}', String(emailPayloads.length))
      .replaceAll('{csat}', csat)
      .replaceAll('{total_arr}', `$${totalARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
      .replaceAll('{pipeline_arr}', `$${pipelineARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
      .replaceAll('{launched_arr}', `$${launchedARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
      .replaceAll('{notable_customers}', notableCustomers || 'N/A')
      .replaceAll('{customer_feedback}', customerFeedback || 'N/A')
      .replaceAll('{action_items}', actionItems || 'None')
      .replaceAll('{sender_name}', config.am_email_sender_name)
      .replaceAll('{sender_team}', config.am_email_sender_team)
      .replaceAll('{division_table_rows}', divTableRows)
      .replaceAll('{photo_section}', photoSection)

    try {
      const data = await apiPost('/generate-report', { prompt })
      const report = data.report || ''
      setWikiOutput(report)
      update({ tripReport: report })
      setGenStatus('Trip report generated successfully!')
    } catch (err) {
      setGenStatus(`Error: ${err}`)
    }
    setGenerating(false)
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(wikiOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Post-Event Summary</Header>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <MetricCard label="Total Registrations" value={state.totalRegistrations || '—'} color="blue" />
          <MetricCard label="Checked-in Attendees" value={attendees.length} color="green" />
          <MetricCard label="Unique Companies (Checked-in)" value={uniqueCompanies} color="purple" />
          <MetricCard label="SFDC Accounts Matched" value={uniqueAccounts} color="teal" />
          <MetricCard label="Accounts with Opps" value={accountsWithOpps} color="orange" />
        </div>
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            description="Single-file CSV with event header + per-attendee detail (account, AM, opp IDs, Non-AGS flag). Useful for distribution to leadership or per-event sharing."
          >
            Event Detail Export
          </Header>
        }
      >
        <SpaceBetween size="m">
          <FormField
            label="Target audience"
            description="Who the event is aimed at. Appears in the CSV header."
            stretch
          >
            <Input
              value={targetAudience}
              onChange={({ detail }) => setTargetAudience(detail.value)}
              placeholder="Software engineers, developers, and architects building AI agents on AWS"
            />
          </FormField>
          <FormField
            label="What did the audience learn?"
            description="Concise list of takeaways from the session (1-3 sentences). Appears in the CSV header."
            stretch
          >
            <Textarea
              value={audienceLearnings}
              onChange={({ detail }) => setAudienceLearnings(detail.value)}
              placeholder="How to use Kiro to scaffold an agent project; how to define agents and tools with the Strands Agents SDK; how to deploy on Bedrock AgentCore..."
              rows={3}
            />
          </FormField>
          <SpaceBetween size="xs" direction="horizontal">
            <Button
              iconName="download"
              variant="primary"
              loading={exporting}
              disabled={!config || enriched.length === 0}
              onClick={handleExportEventDetail}
            >
              Download Event Detail CSV
            </Button>
            <Box variant="small" color="text-status-inactive">
              {`${matched.length} matched attendees · ${uniqueAccounts} accounts · ${excludedAccountIds.size.toLocaleString()} accounts in Non-AGS list`}
            </Box>
          </SpaceBetween>
          {exportError && <Alert type="error">{exportError}</Alert>}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Campaign Tagging & Outreach Results</Header>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <MetricCard label="Opps Tagged" value={activityResults.created} color="green" />
          <MetricCard label="Tag Failures" value={activityResults.failed} color="red" />
          <MetricCard label="AM Drafts Generated" value={emailPayloads.length} color="blue" />
          <MetricCard label="Accounts Skipped" value={accountsSkipped} color="orange" />
          <MetricCard label="ARR Influenced" value={`$${totalARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="orange" />
        </div>
      </Container>

      {divisionSummary.length > 0 && (
        <Container header={<Header variant="h2">Pipeline Analysis</Header>}>
          <SpaceBetween size="l">
            <Table
              columnDefinitions={[
                { id: 'div', header: 'Division', cell: (e: DivisionSummary) => e.division || 'Unknown' },
                { id: 'accts', header: 'Accounts', cell: (e: DivisionSummary) => e.accounts },
                { id: 'pipeline', header: 'Pipeline ARR', cell: (e: DivisionSummary) => `$${e.pipelineARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                { id: 'launched', header: 'Launched ARR', cell: (e: DivisionSummary) => `$${e.launchedARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                { id: 'total', header: 'Total ARR', cell: (e: DivisionSummary) => `$${e.totalARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
              ]}
              items={divisionSummary}
              variant="embedded"
              stripedRows
            />

            {pipelineChartData.length > 0 && (
              <div style={{ width: '100%', height: 350 }}>
                <ResponsiveContainer>
                  <BarChart data={pipelineChartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-30} textAnchor="end" height={80} />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
                    <Legend />
                    <Bar dataKey="Pipeline ARR" fill="#0073bb" />
                    <Bar dataKey="Launched ARR" fill="#1a8754" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SpaceBetween>
        </Container>
      )}

      <Container header={<Header variant="h2">Customer & Revenue Analysis</Header>}>
        <SpaceBetween size="l">
          {topCompanyData.length > 0 && (
            <div style={{ width: '100%', height: 350 }}>
              <ResponsiveContainer>
                <BarChart data={topCompanyData} layout="vertical" margin={{ top: 20, right: 30, left: 150, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ff9900" name="Attendees" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {divisionPieData.length > 0 && (
            <div style={{ width: '100%', height: 350 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={divisionPieData} cx="50%" cy="50%" outerRadius={120} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {divisionPieData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Trip Report Details</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Fields are auto-populated from uploaded data. Edit as needed, then click "Generate with Bedrock" to create the XWiki report using Claude.
          </Alert>

          <ColumnLayout columns={2}>
            <FormField label="Event Format">
              <Input value={format} onChange={({ detail }) => setFormat(detail.value)} placeholder="e.g., In-Person Hands-On Workshop" />
            </FormField>
            <FormField label="Location (optional)">
              <Input value={location} onChange={({ detail }) => setLocation(detail.value)} placeholder="e.g., Boston, MA" />
            </FormField>
            <FormField label="Total Registrations">
              <Input type="number" value={registrations} onChange={({ detail }) => setRegistrations(detail.value)} placeholder="e.g., 191" />
            </FormField>
            <FormField label="Total Attendees (Checked-in)">
              <Input type="number" value={totalAttendees} onChange={({ detail }) => setTotalAttendees(detail.value)} />
            </FormField>
            <FormField label="CSAT Score">
              <Input value={csat} onChange={({ detail }) => setCsat(detail.value)} placeholder="e.g., 4.8" />
            </FormField>
          </ColumnLayout>

          <FormField label="Notable Customers (comma-separated)">
            <Input value={notableCustomers} onChange={({ detail }) => setNotableCustomers(detail.value)} placeholder="e.g., Capital One, Liberty Mutual, Wells Fargo" />
          </FormField>

          <FormField label="Customer Feedback / Quote (optional)">
            <Textarea value={customerFeedback} onChange={({ detail }) => setCustomerFeedback(detail.value)} rows={3} placeholder="Paste a customer quote or feedback here..." />
          </FormField>

          <FormField label="Additional Action Items (optional)">
            <Textarea value={actionItems} onChange={({ detail }) => setActionItems(detail.value)} rows={3} placeholder="Add any extra action items..." />
          </FormField>

          <FormField label="Event Photos">
            <SpaceBetween size="s">
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} style={{ display: 'none' }} />
              <Button onClick={() => fileRef.current?.click()}>Upload Photos</Button>
              {photos.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {photos.map((p, i) => (
                    <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={URL.createObjectURL(p)} alt={p.name} style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 8 }} />
                      <button
                        onClick={() => removePhoto(i)}
                        style={{ position: 'absolute', top: -6, right: -6, background: '#d13212', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 12, lineHeight: '20px', padding: 0 }}
                      >x</button>
                      <div style={{ fontSize: 11, color: '#666', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    </div>
                  ))}
                </div>
              )}
              {photos.length > 0 && <StatusIndicator type="info">{photos.length} photo(s) selected. Upload these to your wiki page separately.</StatusIndicator>}
            </SpaceBetween>
          </FormField>
          <SpaceBetween size="s" direction="horizontal">
            <Button variant="primary" onClick={generateWithBedrock} loading={generating} disabled={!config || generating}>
              {generating ? 'Generating...' : 'Generate Trip Report'}
            </Button>
            {wikiOutput && (
              <Button onClick={copyToClipboard}>
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </Button>
            )}
          </SpaceBetween>

          {generating && <ProgressBar value={50} label={genStatus} variant="flash" />}
          {!generating && genStatus && <StatusIndicator type={genStatus.startsWith('Error') ? 'error' : 'success'}>{genStatus}</StatusIndicator>}

          {wikiOutput && (
            <Tabs tabs={[
              {
                label: 'Rendered Preview',
                id: 'preview',
                content: (
                  <div
                    style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: 8,
                      padding: 24,
                      background: '#fff',
                      maxHeight: 800,
                      overflow: 'auto',
                      fontFamily: 'Amazon Ember, Helvetica Neue, Arial, sans-serif',
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                    dangerouslySetInnerHTML={{ __html: xwikiToHtml(wikiOutput) }}
                  />
                ),
              },
              {
                label: 'XWiki Source',
                id: 'source',
                content: (
                  <FormField label="Edit the XWiki markup below">
                    <Textarea
                      value={wikiOutput}
                      onChange={({ detail }) => { setWikiOutput(detail.value); update({ tripReport: detail.value }); debouncedSave() }}
                      rows={30}
                    />
                  </FormField>
                ),
              },
            ]} />
          )}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Status</Header>}>
        <SpaceBetween size="s">
          <StatusIndicator type={attendees.length > 0 ? 'success' : 'pending'}>
            Upload & Parse: {attendees.length} attendees
          </StatusIndicator>
          <StatusIndicator type={enriched.length > 0 ? 'success' : 'pending'}>
            SFDC Enrichment: {matched.length} matched
          </StatusIndicator>
          <StatusIndicator type={matchResults.plan.length > 0 ? 'success' : 'pending'}>
            Opp Matching: {matchResults.plan.length} opportunities matched
          </StatusIndicator>
          <StatusIndicator type={activityResults.created > 0 ? 'success' : 'pending'}>
            Campaign Tagging: {activityResults.created} opps tagged
          </StatusIndicator>
          <StatusIndicator type={emailPayloads.length > 0 ? 'success' : 'pending'}>
            AM Emails: {emailPayloads.length} drafts generated
          </StatusIndicator>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Event Data</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Post-event data is saved automatically as you move between steps. The event ID is generated from the event name and date.
          </Alert>
          {config && (
            <ColumnLayout columns={2}>
              <Box><Box variant="awsui-key-label">Event ID</Box>{state.eventId || generateEventId(config.activity_date, config.event_name)}</Box>
              <Box><Box variant="awsui-key-label">Event Name</Box>{config.event_name}</Box>
              <Box><Box variant="awsui-key-label">Event Date</Box>{config.event_date || config.activity_date}</Box>
              <Box><Box variant="awsui-key-label">Campaign Code</Box>{config.campaign_code ? <a href={`https://aws-crm.lightning.force.com/lightning/r/Campaign/${config.campaign_id || config.campaign_code}/view`} target="_blank" rel="noopener noreferrer">{config.campaign_code}</a> : '—'}</Box>
              <Box><Box variant="awsui-key-label">Registration URL</Box>{config.registration_url ? <a href={config.registration_url} target="_blank" rel="noopener noreferrer">{config.registration_url}</a> : '—'}</Box>
              <Box><Box variant="awsui-key-label">Services</Box>{config.services.join(', ')}</Box>
              <Box><Box variant="awsui-key-label">Sender</Box>{config.am_email_sender_name}</Box>
            </ColumnLayout>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  )
}
