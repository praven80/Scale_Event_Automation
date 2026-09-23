import { useEffect, useState, useRef } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import DatePicker from '@cloudscape-design/components/date-picker'
import Textarea from '@cloudscape-design/components/textarea'
import Select from '@cloudscape-design/components/select'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { AppState, EventConfig, PreEventState } from '../types'
import { generateEventId } from '../utils/eventId'
import { apiPost } from '../utils/api'
import { ACTIVITY_DESCRIPTION_TEMPLATE } from '../templates/activityDescription'

interface Props {
  state: AppState
  update: (u: Partial<AppState>) => void
  updatePre: (u: Partial<PreEventState>) => void
}

const DEFAULT_PRE_CONFIG: EventConfig = {
  sa_activity: 'Demo [Architecture]',
  activity_date: '',
  domains: ['GenAI'],
  services: ['Amazon Bedrock', 'Amazon Bedrock AgentCore', 'Kiro', 'Strands SDK'],
  time_spent_hours: 2,
  campaign_code: '',
  campaign_id: '',
  event_name: '',
  event_date: '',
  registration_url: '',
  event_summary: '',
  subject_template: '{event_name} | {campaign_code}',
  description_template: ACTIVITY_DESCRIPTION_TEMPLATE,
  am_email_subject: '',
  am_email_wiki_link: 'https://w.amazon.com/bin/view/AGS_NAMER_AI',
  am_email_sender_name: 'Prasanna Sridharan',
  am_email_sender_title: 'Principal Architect - GenAI/ML',
  am_email_sender_team: 'AGS Gen AI Scale Solutions Architect team',
}

export default function EventSetupStep({ state, update, updatePre }: Props) {
  const config = state.config || DEFAULT_PRE_CONFIG
  const [campaignLookupLoading, setCampaignLookupLoading] = useState(false)
  const [campaignLookupError, setCampaignLookupError] = useState('')
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!state.config) update({ config: DEFAULT_PRE_CONFIG })
    // Auto-lookup campaign if code exists but ID hasn't been resolved yet
    if (config.campaign_code && !state.pre.campaignId) {
      lookupCampaign(config.campaign_code)
    }
  }, [])

  const lookupCampaign = (code: string) => {
    if (!code.trim()) return
    setCampaignLookupLoading(true)
    setCampaignLookupError('')
    apiPost('/lookup-campaign', { campaignCode: code.trim() })
      .then((res: { campaignId?: string; error?: string }) => {
        if (res.campaignId) {
          updatePre({ campaignId: res.campaignId })
          setCampaignLookupError('')
        } else {
          updatePre({ campaignId: '' })
          setCampaignLookupError(res.error || 'Campaign not found')
        }
      })
      .catch((err: Error) => {
        updatePre({ campaignId: '' })
        setCampaignLookupError(err.message)
      })
      .finally(() => setCampaignLookupLoading(false))
  }

  const onCampaignCodeChange = (value: string) => {
    setField('campaign_code', value)
    updatePre({ checklist: { ...state.pre.checklist, sfdcCampaignCreated: !!value }, campaignId: '' })
    setCampaignLookupError('')
    // Debounce: auto-lookup 1s after user stops typing
    if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current)
    if (value.trim()) {
      lookupTimerRef.current = setTimeout(() => lookupCampaign(value), 1000)
    }
  }

  const setField = (field: keyof EventConfig, value: string | number) => {
    const updated = { ...config, [field]: value } as EventConfig
    update({ config: updated })
    // Auto-generate eventId when name and date change
    if (field === 'event_name' || field === 'activity_date') {
      const name = field === 'event_name' ? String(value) : config.event_name
      const date = field === 'activity_date' ? String(value) : config.activity_date
      if (name && date) {
        update({ config: updated, eventId: generateEventId(date, name) })
      }
    }
  }

  const eventTypeOptions = [
    { label: 'Virtual', value: 'virtual' },
    { label: 'In-Person', value: 'in-person' },
  ]

  const saActivityOptions = [
    'Activation Day [Workshops]',
    'Architecture Review [Architecture]',
    'Demo [Architecture]',
    'EBA (Experience Based Acceleration) [Program Execution]',
    'EBC (Executive Briefing Centre) [Program Execution]',
    'GameDay [Workshops]',
    'General Tech Content [Thought Leadership]',
    'Hackathon [Workshops]',
    'Immersion Day [Workshops]',
    'Other Workshops [Workshops]',
  ].map(v => ({ label: v, value: v }))

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Event Details</Header>}>
        <SpaceBetween size="m">
          <FormField label="Event Name" description="Full name of the event/workshop">
            <Input value={config.event_name} onChange={({ detail }) => setField('event_name', detail.value)} placeholder="Building Secure AI Customer Support Agent with Amazon Bedrock AgentCore" />
          </FormField>
          <FormField label="Event Date" description="Used for campaign tracking and event ID generation">
            <DatePicker value={config.activity_date} onChange={({ detail }) => {
              const updated = { ...config, activity_date: detail.value, event_date: detail.value }
              update({ config: updated })
              if (config.event_name && detail.value) {
                update({ config: updated, eventId: generateEventId(detail.value, config.event_name) })
              }
            }} placeholder="YYYY-MM-DD" isDateEnabled={() => true} />
          </FormField>
          <FormField label="Event Type">
            <Select
              selectedOption={eventTypeOptions.find(o => o.value === state.pre.eventType) || eventTypeOptions[0]}
              onChange={({ detail }) => updatePre({ eventType: detail.selectedOption.value as 'virtual' | 'in-person' })}
              options={eventTypeOptions}
            />
          </FormField>
          <FormField label="SA Activity" description="Type of SA activity for SFDC logging">
            <Select
              selectedOption={saActivityOptions.find(o => o.value === config.sa_activity) || null}
              onChange={({ detail }) => { if (detail.selectedOption.value) setField('sa_activity', detail.selectedOption.value) }}
              options={saActivityOptions}
              filteringType="auto"
              placeholder="Select SA activity type..."
            />
          </FormField>
          {state.pre.eventType === 'in-person' && (
            <FormField label="Venue" description="Venue name and address for the in-person event">
              <Input value={state.pre.venue} onChange={({ detail }) => updatePre({ venue: detail.value })} placeholder="AWS NYC Loft, 350 W 40th St, New York, NY" />
            </FormField>
          )}
          {state.pre.eventType === 'in-person' && (
            <FormField label="Slack Channel" description="Internal Slack channel for event coordination">
              <Input value={state.pre.slackChannel} onChange={({ detail }) => {
                updatePre({ slackChannel: detail.value, checklist: { ...state.pre.checklist, slackChannelCreated: !!detail.value } })
              }} placeholder="#ags-scale-event-name" />
            </FormField>
          )}
          {state.pre.eventType === 'virtual' && (
            <FormField label="Zoom Webinar Link" description="Zoom webinar URL for the virtual event">
              <Input value={state.pre.zoomLink} onChange={({ detail }) => {
                updatePre({ zoomLink: detail.value, checklist: { ...state.pre.checklist, zoomScheduled: !!detail.value } })
              }} placeholder="https://amazon.zoom.us/..." />
            </FormField>
          )}
          <FormField label="Campaign Code" description="SFDC campaign code — campaign ID is auto-resolved from SFDC">
            <SpaceBetween size="xs">
              <Input value={config.campaign_code} onChange={({ detail }) => onCampaignCodeChange(detail.value)} placeholder="NAMER_AGS_2026_SCALE_USE_CASE__Customer_Support" />
              {campaignLookupLoading && <StatusIndicator type="loading">Looking up campaign in SFDC...</StatusIndicator>}
              {state.pre.campaignId && (
                <StatusIndicator type="success">
                  Campaign found — <a href={`https://aws-crm.lightning.force.com/lightning/r/Campaign/${state.pre.campaignId}/view`} target="_blank" rel="noopener noreferrer">Open in SFDC</a>
                </StatusIndicator>
              )}
              {campaignLookupError && !campaignLookupLoading && <StatusIndicator type="error">{campaignLookupError}</StatusIndicator>}
              {!campaignLookupLoading && !state.pre.campaignId && !campaignLookupError && config.campaign_code && (
                <Button variant="inline-link" onClick={() => lookupCampaign(config.campaign_code)}>Lookup campaign in SFDC</Button>
              )}
            </SpaceBetween>
          </FormField>
          <FormField label="Registration URL">
            <Input value={config.registration_url} onChange={({ detail }) => {
              setField('registration_url', detail.value)
              updatePre({ checklist: { ...state.pre.checklist, splashPageCreated: !!detail.value }, splashPageUrl: detail.value })
            }} placeholder="https://aws-experience.com/..." />
          </FormField>
          <FormField label="Event Duration (hours)" description="How long the event lasts — used for SFDC activity logging">
            <Input type="number" value={String(config.time_spent_hours)} onChange={({ detail }) => setField('time_spent_hours', Number(detail.value))} placeholder="2" />
          </FormField>
          <FormField label="Event Summary" description="Brief description of what the event covers">
            <Textarea value={config.event_summary} onChange={({ detail }) => setField('event_summary', detail.value)} rows={3} placeholder="Customers will attend a 2-hour virtual webinar..." />
          </FormField>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Event Team</Header>}>
        <SpaceBetween size="m">
          <FormField label="Primary Host" description="Person leading the event">
            <Input value={state.pre.primaryHost} onChange={({ detail }) => updatePre({ primaryHost: detail.value })} placeholder="Jane Doe" />
          </FormField>
          <FormField label="Supporting People" description="One person per line (name or alias)">
            <Textarea
              value={state.pre.supportingPeople.join('\n')}
              onChange={({ detail }) => updatePre({ supportingPeople: detail.value.split('\n').filter(s => s.trim()) })}
              rows={3}
              placeholder={"John Smith\nAlice Johnson"}
            />
          </FormField>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Sender Details</Header>}>
        <SpaceBetween size="m">
          <FormField label="Sender Name"><Input value={config.am_email_sender_name} onChange={({ detail }) => setField('am_email_sender_name', detail.value)} /></FormField>
          <FormField label="Sender Title"><Input value={config.am_email_sender_title} onChange={({ detail }) => setField('am_email_sender_title', detail.value)} /></FormField>
          <FormField label="Sender Team"><Input value={config.am_email_sender_team} onChange={({ detail }) => setField('am_email_sender_team', detail.value)} /></FormField>
          <FormField label="Wiki Link"><Input value={config.am_email_wiki_link} onChange={({ detail }) => setField('am_email_wiki_link', detail.value)} /></FormField>
        </SpaceBetween>
      </Container>

      {state.eventId && (
        <Container header={<Header variant="h2">Generated Event ID</Header>}>
          <SpaceBetween size="s">
            <StatusIndicator type="success">Event ID generated</StatusIndicator>
            <Box variant="code" fontSize="body-m">{state.eventId}</Box>
            <Box variant="small" color="text-body-secondary">This ID links your pre-event and post-event records.</Box>
          </SpaceBetween>
        </Container>
      )}
    </SpaceBetween>
  )
}
