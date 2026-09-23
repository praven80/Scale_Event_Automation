import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Box from '@cloudscape-design/components/box'
import { AppState, PreEventState, ChecklistStatus } from '../types'
import MetricCard from '../components/MetricCard'

interface Props {
  state: AppState
  update: (u: Partial<AppState>) => void
  updatePre: (u: Partial<PreEventState>) => void
}

const CHECKLIST_LABELS: Record<keyof ChecklistStatus, string> = {
  sfdcCampaignCreated: 'SFDC Campaign Created',
  zoomScheduled: 'Zoom Webinar Scheduled',
  splashPageCreated: 'Splash / Registration Page Created',
  roomBooked: 'Room / Venue Booked',
  merfSubmitted: 'MERF Ticket Submitted',
  outreachSent: 'Outreach Emails Sent',
  slackChannelCreated: 'Slack Channel Created',
  foodOrdered: 'Food & Beverages Ordered',
  reminderEmailSent: 'Customer Reminder Emails Sent',
}

export default function PreEventStatusStep({ state, update, updatePre }: Props) {
  const config = state.config
  const checklist = state.pre.checklist
  const allItems = Object.entries(CHECKLIST_LABELS) as [keyof ChecklistStatus, string][]
  const relevantItems = state.pre.eventType === 'virtual'
    ? allItems.filter(([k]) => k !== 'roomBooked' && k !== 'merfSubmitted' && k !== 'foodOrdered' && k !== 'slackChannelCreated')
    : allItems.filter(([k]) => k !== 'zoomScheduled')
  const completedCount = relevantItems.filter(([k]) => checklist[k]).length

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Pre-Event Summary</Header>}>
        <SpaceBetween size="m">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <MetricCard label="Tasks Completed" value={`${completedCount}/${relevantItems.length}`} color="green" />
            <MetricCard label="Outreach Sent" value={state.pre.outreachEmailsSent} color="blue" />
            <MetricCard label="Reminders Sent" value={state.pre.reminderEmailsSent} color="purple" />
            <MetricCard label="Registrants" value={state.pre.registrants.length || state.pre.registrationCount} color="orange" />
          </div>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Checklist Status</Header>}>
        <SpaceBetween size="xs">
          {relevantItems.map(([key, label]) => (
            <div
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eee', cursor: 'pointer' }}
              onClick={() => updatePre({ checklist: { ...checklist, [key]: !checklist[key] } })}
            >
              {checklist[key] ? (
                <StatusIndicator type="success">{label}</StatusIndicator>
              ) : (
                <StatusIndicator type="stopped">{label}</StatusIndicator>
              )}
            </div>
          ))}
          <Box variant="small" color="text-body-secondary">Click any item to toggle its status</Box>
        </SpaceBetween>
      </Container>

      {state.eventId && (
        <Container header={<Header variant="h2">Event Details</Header>}>
          <ColumnLayout columns={2}>
            <Box><Box variant="awsui-key-label">Event ID</Box>{state.eventId}</Box>
            <Box><Box variant="awsui-key-label">Event Name</Box>{config?.event_name || '-'}</Box>
            <Box><Box variant="awsui-key-label">Event Date</Box>{config?.activity_date || '-'}</Box>
            <Box><Box variant="awsui-key-label">Event Type</Box>{state.pre.eventType}</Box>
            <Box><Box variant="awsui-key-label">Campaign Code</Box>{config?.campaign_code || '-'}</Box>
            <Box><Box variant="awsui-key-label">Primary Host</Box>{state.pre.primaryHost || '-'}</Box>
            <Box><Box variant="awsui-key-label">Supporting People</Box>{state.pre.supportingPeople.length > 0 ? state.pre.supportingPeople.join(', ') : '-'}</Box>
          </ColumnLayout>
        </Container>
      )}

      <Container header={<Header variant="h2">Event Data</Header>}>
        <Alert type={completedCount < relevantItems.length ? 'warning' : 'info'}>
          {completedCount < relevantItems.length
            ? `${relevantItems.length - completedCount} tasks still incomplete. Your progress is saved automatically as you move between steps.`
            : 'All tasks completed! Your event data has been saved automatically.'}
        </Alert>
      </Container>
    </SpaceBetween>
  )
}
