import { useEffect, useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Select from '@cloudscape-design/components/select'
import Box from '@cloudscape-design/components/box'
import Alert from '@cloudscape-design/components/alert'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import { AppState, EventConfig, EventRecord } from '../types'
import { ACTIVITY_DESCRIPTION_TEMPLATE } from '../templates/activityDescription'
import { apiPost } from '../utils/api'

const EMPTY_CONFIG: EventConfig = {
  sa_activity: '',
  activity_date: '',
  domains: [],
  services: [],
  time_spent_hours: 0,
  campaign_code: '',
  campaign_id: '',
  event_name: '',
  event_date: '',
  registration_url: '',
  event_summary: '',
  subject_template: '{event_name} | {campaign_code}',
  description_template: ACTIVITY_DESCRIPTION_TEMPLATE,
  am_email_subject: '',
  am_email_wiki_link: '',
  am_email_sender_name: '',
  am_email_sender_title: '',
  am_email_sender_team: '',
}

interface Props { state: AppState; update: (u: Partial<AppState>) => void }

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <Box variant="p">{value || <span style={{ color: '#aab7b8' }}>—</span>}</Box>
    </div>
  )
}

export default function ConfigStep({ state, update }: Props) {
  const config = state.config || EMPTY_CONFIG
  const [preEvents, setPreEvents] = useState<EventRecord[]>([])
  const [loadingPreEvents, setLoadingPreEvents] = useState(false)
  const [selectedPreEvent, setSelectedPreEvent] = useState<string | null>(state.eventId || null)

  const isLinkedToPreEvent = !!(state.eventId && !state.eventId.startsWith('draft_'))

  useEffect(() => {
    if (!state.config) update({ config: EMPTY_CONFIG })
    if (!isLinkedToPreEvent) {
      setLoadingPreEvents(true)
      fetch('/api/events/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 50 }) })
        .then(r => r.ok ? r.json() : { events: [] })
        .then(data => setPreEvents((data.events || []).filter((e: EventRecord) => e.type === 'PRE')))
        .catch(() => setPreEvents([]))
        .finally(() => setLoadingPreEvents(false))
    }
  }, [])

  const handleSelectPreEvent = async (eventId: string) => {
    setSelectedPreEvent(eventId)
    try {
      const data = await apiPost('/events/get', { eventId })
      const pre = data.pre
      if (!pre) {
        alert(`No pre-event record found for ${eventId}`)
        return
      }
      const newConfig: EventConfig = {
        ...EMPTY_CONFIG,
        sa_activity: pre.saActivity || 'Demo [Architecture]',
        activity_date: pre.eventDate || '',
        domains: pre.domains || ['GenAI'],
        services: pre.services || ['Amazon Bedrock', 'Amazon Bedrock AgentCore', 'Kiro', 'Strands SDK'],
        time_spent_hours: pre.timeSpentHours || 2,
        campaign_code: pre.campaignCode || '',
        campaign_id: pre.campaignId || '',
        event_name: pre.eventName || '',
        event_date: pre.eventDate || '',
        registration_url: pre.registrationUrl || '',
        event_summary: pre.eventSummary || '',
        subject_template: '{event_name} | {campaign_code}',
        description_template: ACTIVITY_DESCRIPTION_TEMPLATE,
        am_email_subject: `AWS Event Update: Your Customer Joined Our GenAI Playbook Session`,
        am_email_wiki_link: pre.amEmailWikiLink || 'https://w.amazon.com/bin/view/AGS_NAMER_AI',
        am_email_sender_name: pre.amEmailSenderName || pre.primaryHost || 'Prasanna Sridharan',
        am_email_sender_title: pre.amEmailSenderTitle || 'Principal Architect - GenAI/ML',
        am_email_sender_team: pre.amEmailSenderTeam || 'AGS Gen AI Scale Solutions Architect team',
      }
      update({ config: newConfig, eventId, totalRegistrations: pre.registrations || 0 })
    } catch (err: any) {
      alert(`Failed to load pre-event: ${err.message}`)
    }
  }

  const preEventOptions = preEvents.map(e => ({
    label: `${e.eventName} (${e.eventDate})`,
    value: e.eventId,
    description: e.eventId,
  }))

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Link to Pre-Event</Header>}>
        {isLinkedToPreEvent ? (
          <Alert type="success">
            Linked to pre-event record: <Box variant="code" display="inline">{state.eventId}</Box>
            {' '}&mdash; configuration has been pre-populated from your pre-event setup.
          </Alert>
        ) : (
          <SpaceBetween size="s">
            <Alert type="warning">You must select a pre-event before proceeding to the next step.</Alert>
            <FormField label="Select Pre-Event" description="Choose from your recent pre-event records">
              <Select
                placeholder="Choose a pre-event..."
                selectedOption={selectedPreEvent ? preEventOptions.find(o => o.value === selectedPreEvent) || null : null}
                onChange={({ detail }) => {
                  if (detail.selectedOption.value) handleSelectPreEvent(detail.selectedOption.value)
                }}
                options={preEventOptions}
                loadingText="Loading pre-events..."
                statusType={loadingPreEvents ? 'loading' : 'finished'}
                empty="No pre-events found"
                filteringType="auto"
              />
            </FormField>
          </SpaceBetween>
        )}
      </Container>

      {isLinkedToPreEvent && (
        <>
          <Container header={<Header variant="h2">Event Details</Header>}>
            <ColumnLayout columns={2}>
              <DetailRow label="Event Name" value={config.event_name} />
              <DetailRow label="Event Date" value={config.event_date} />
              <DetailRow label="Activity Date" value={config.activity_date} />
              <DetailRow label="SA Activity" value={config.sa_activity} />
              <div>
                <Box variant="awsui-key-label">Campaign Code</Box>
                <Box variant="p">{config.campaign_code ? <a href={`https://aws-crm.lightning.force.com/lightning/r/Campaign/${config.campaign_id || config.campaign_code}/view`} target="_blank" rel="noopener noreferrer">{config.campaign_code}</a> : <span style={{ color: '#aab7b8' }}>—</span>}</Box>
              </div>
              <DetailRow label="Time Spent (hours)" value={String(config.time_spent_hours)} />
              <div>
                <Box variant="awsui-key-label">Registration URL</Box>
                <Box variant="p">{config.registration_url ? <a href={config.registration_url} target="_blank" rel="noopener noreferrer">{config.registration_url}</a> : <span style={{ color: '#aab7b8' }}>—</span>}</Box>
              </div>
            </ColumnLayout>
            <Box margin={{ top: 'm' }}>
              <Box variant="awsui-key-label">Event Summary</Box>
              <Box variant="p">{config.event_summary || <span style={{ color: '#aab7b8' }}>—</span>}</Box>
            </Box>
          </Container>

          <Container header={<Header variant="h2">AM Email Settings</Header>}>
            <ColumnLayout columns={2}>
              <DetailRow label="Sender Name" value={config.am_email_sender_name} />
              <DetailRow label="Sender Title" value={config.am_email_sender_title} />
              <DetailRow label="Sender Team" value={config.am_email_sender_team} />
              <DetailRow label="Wiki Link" value={config.am_email_wiki_link} />
            </ColumnLayout>
          </Container>
        </>
      )}
    </SpaceBetween>
  )
}
