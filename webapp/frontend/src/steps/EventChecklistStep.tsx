import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Toggle from '@cloudscape-design/components/toggle'
import Box from '@cloudscape-design/components/box'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { AppState, PreEventState, ChecklistStatus, EventConfig } from '../types'

interface Props {
  state: AppState
  update: (u: Partial<AppState>) => void
  updatePre: (u: Partial<PreEventState>) => void
}

interface ChecklistItem {
  key: keyof ChecklistStatus
  label: string
  description: string
  hasInput?: boolean
  inputKey?: keyof PreEventState
  inputPlaceholder?: string
  configKey?: keyof EventConfig
  preDisplayKeys?: (keyof PreEventState)[]
  color: string
}

const VIRTUAL_ITEMS: ChecklistItem[] = [
  { key: 'sfdcCampaignCreated', label: 'SFDC Campaign Created', description: 'Campaign created in Salesforce CRM', configKey: 'campaign_code', color: '#0972d3' },
  { key: 'splashPageCreated', label: 'Splash / Registration Page Created', description: 'External registration page is live', configKey: 'registration_url', color: '#9469d6' },
  { key: 'zoomScheduled', label: 'Zoom Webinar Scheduled', description: 'Zoom webinar created and configured', preDisplayKeys: ['zoomLink'], color: '#e07941' },
  { key: 'outreachSent', label: 'Outreach Emails Sent', description: 'AM/SA outreach emails sent (Step 2)', color: '#ce3311' },
  { key: 'reminderEmailSent', label: 'Customer Reminder Emails Sent', description: 'Know-before-you-go emails sent (Step 5)', color: '#067f68' },
]

const IN_PERSON_ITEMS: ChecklistItem[] = [
  { key: 'sfdcCampaignCreated', label: 'SFDC Campaign Created', description: 'Campaign created in Salesforce CRM', configKey: 'campaign_code', color: '#0972d3' },
  { key: 'splashPageCreated', label: 'Splash / Registration Page Created', description: 'External registration page is live', configKey: 'registration_url', color: '#9469d6' },
  { key: 'slackChannelCreated', label: 'Slack Channel Created', description: 'Internal Slack channel for event coordination', preDisplayKeys: ['slackChannel'], color: '#e07941' },
  { key: 'roomBooked', label: 'Room / Venue Booked', description: 'Physical venue reserved and confirmed', preDisplayKeys: ['roomLocation', 'roomNumber'], color: '#ce3311' },
  { key: 'merfSubmitted', label: 'MERF Ticket Submitted', description: 'Marketing Event Request Form submitted (Step 3)', preDisplayKeys: ['merfTicketUrl'], color: '#067f68' },
  { key: 'foodOrdered', label: 'Food & Beverages Ordered', description: 'Catering arranged for the event', color: '#d91515' },
  { key: 'outreachSent', label: 'Outreach Emails Sent', description: 'AM/SA outreach emails sent (Step 2)', color: '#0073bb' },
  { key: 'reminderEmailSent', label: 'Customer Reminder Emails Sent', description: 'Know-before-you-go emails sent (Step 5)', color: '#8b6914' },
]

export default function EventChecklistStep({ state, update, updatePre }: Props) {
  const checklist = state.pre.checklist
  const items = state.pre.eventType === 'in-person' ? IN_PERSON_ITEMS : VIRTUAL_ITEMS

  const toggleItem = (key: keyof ChecklistStatus) => {
    updatePre({ checklist: { ...checklist, [key]: !checklist[key] } })
  }

  const setInput = (key: keyof PreEventState, value: string) => {
    updatePre({ [key]: value } as Partial<PreEventState>)
  }

  const completedCount = items.filter(i => checklist[i.key]).length

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description={`${state.pre.eventType === 'in-person' ? 'In-Person' : 'Virtual'} Event`}>Event Checklist</Header>}>
        <SpaceBetween size="s">
          <ColumnLayout columns={3}>
            <Box><Box variant="awsui-key-label">Completed</Box><Box variant="awsui-value-large"><span style={{ color: '#037f0c' }}>{completedCount}</span></Box></Box>
            <Box><Box variant="awsui-key-label">Remaining</Box><Box variant="awsui-value-large"><span style={{ color: items.length - completedCount > 0 ? '#d91515' : '#037f0c' }}>{items.length - completedCount}</span></Box></Box>
            <Box><Box variant="awsui-key-label">Progress</Box><Box variant="awsui-value-large"><span style={{ color: completedCount === items.length ? '#037f0c' : '#0972d3' }}>{Math.round((completedCount / items.length) * 100)}%</span></Box></Box>
          </ColumnLayout>
        </SpaceBetween>
      </Container>

      {items.map(item => (
        <div key={item.key} style={{ borderLeft: `4px solid ${checklist[item.key] ? '#037f0c' : item.color}`, borderRadius: 4 }}>
        <Container>
          <SpaceBetween size="s">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Toggle
                checked={checklist[item.key]}
                onChange={() => toggleItem(item.key)}
              />
              <div>
                {checklist[item.key] ? (
                  <StatusIndicator type="success">
                    <span style={{ fontWeight: 600 }}>{item.label}</span>
                    <span style={{ color: '#5f6b7a' }}> - {item.description}</span>
                  </StatusIndicator>
                ) : (
                  <StatusIndicator type="pending">
                    <span style={{ fontWeight: 600, color: item.color }}>{item.label}</span>
                    <span style={{ color: '#5f6b7a' }}> - {item.description}</span>
                  </StatusIndicator>
                )}
              </div>
            </div>
            {item.hasInput && item.inputKey && (
              <FormField>
                <Input
                  value={String(state.pre[item.inputKey] || '')}
                  onChange={({ detail }) => setInput(item.inputKey!, detail.value)}
                  placeholder={item.inputPlaceholder}
                />
              </FormField>
            )}
            {item.configKey && state.config?.[item.configKey] && (() => {
              const val = String(state.config[item.configKey])
              const isUrl = val.startsWith('http://') || val.startsWith('https://')
              // For SFDC Campaign: show clickable CRM link when campaignId is resolved
              if (item.key === 'sfdcCampaignCreated' && state.pre.campaignId) {
                const crmUrl = `https://aws-crm.lightning.force.com/lightning/r/Campaign/${state.pre.campaignId}/view`
                return <Box variant="small" color="text-body-secondary">{val} — <a href={crmUrl} target="_blank" rel="noopener noreferrer">{crmUrl}</a></Box>
              }
              return <Box variant="small" color="text-body-secondary">{isUrl ? <a href={val} target="_blank" rel="noopener noreferrer">{val}</a> : val}</Box>
            })()}
            {item.preDisplayKeys && (() => {
              const vals = item.preDisplayKeys.map(k => String(state.pre[k] || '')).filter(Boolean)
              if (!vals.length) return null
              return <Box variant="small" color="text-body-secondary">{vals.map((v, i) => {
                const isUrl = v.startsWith('http://') || v.startsWith('https://')
                return <span key={i}>{i > 0 && ' / '}{isUrl ? <a href={v} target="_blank" rel="noopener noreferrer">{v}</a> : v}</span>
              })}</Box>
            })()}
          </SpaceBetween>
        </Container>
        </div>
      ))}
    </SpaceBetween>
  )
}
