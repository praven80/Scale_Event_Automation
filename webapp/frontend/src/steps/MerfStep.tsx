import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Button from '@cloudscape-design/components/button'
import Alert from '@cloudscape-design/components/alert'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Box from '@cloudscape-design/components/box'
import Link from '@cloudscape-design/components/link'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import { AppState, PreEventState } from '../types'

interface Props {
  state: AppState
  update: (u: Partial<AppState>) => void
  updatePre: (u: Partial<PreEventState>) => void
}

const MERF_URL = 'https://amazon.forms.events/forms/event_request/global-form-v2'

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}

function MerfField({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{value || '-'}</Box>
    </Box>
  )
}

export default function MerfStep({ state, update, updatePre }: Props) {
  const config = state.config!
  const eventDate = formatDate(config?.activity_date || '')
  const eventName = config?.event_name || ''
  const supportingAliases = state.pre.supportingPeople.join(', ')

  const merfFields = [
    { label: 'Meeting or event name', value: eventName },
    { label: 'Meeting or event format', value: 'In-person' },
    { label: 'Meeting or event town or city (onsite)', value: 'Boston BOS' },
    { label: 'Event start date', value: eventDate },
    { label: 'Event start time', value: '8:00 AM' },
    { label: 'Event end date', value: eventDate },
    { label: 'Event end time', value: '5:00 PM' },
    { label: 'What is the type of your meeting or event?', value: 'External business focused' },
    { label: 'Please rate the business impact for this meeting or event', value: 'High' },
    { label: 'Does your onsite event have a social component?', value: 'Yes' },
    { label: 'Will you be serving alcohol?', value: 'No' },
    { label: 'Expected number of internal attendees', value: '10' },
    { label: 'Are any of the following internal groups attending? (may require further approval)', value: 'None of the Above' },
    { label: 'Expected number of external attendees', value: '120' },
    { label: 'Will event be external by invitation, or open to the general public?', value: 'Open to the general public' },
    { label: 'Is event hosted and organized by Amazon or by an external 3rd party organization?', value: 'Amazon' },
    { label: 'Will you have any external 3rd party (non-Amazon badged) speakers presenting at your meeting or event?', value: 'No' },
    { label: 'Visitor Photograph Requirement Waiver', value: 'Yes' },
    { label: 'Security Verification Risk', value: 'Check the box' },
    { label: 'Workspace Access Risk', value: 'Check the box' },
    { label: 'Are any of the following external groups attending? (may require further approval)', value: 'Customers' },
    { label: 'Are you requesting this meeting on behalf of someone else?', value: 'No' },
    { label: 'Do you want to designate a secondary organizer?', value: supportingAliases ? `Yes (${supportingAliases})` : 'No' },
    { label: 'Have you moved this event from an offsite venue or hotel to onsite (Amazon office)?', value: 'No' },
    { label: 'Does your event include any of the following?', value: 'None of the above' },
    { label: 'Check here if your booking involves activities beyond meetings and lectures', value: 'Check the box' },
    { label: 'Have you ALREADY BOOKED a meeting or event space?', value: 'Yes' },
    { label: 'Building', value: 'BOS21' },
    { label: 'Room', value: 'BOS21.04.100' },
    { label: 'Room booking start time', value: '8:00 AM' },
    { label: 'Room booking end time', value: '5:00 PM' },
    { label: 'Is this room on a restricted floor?', value: 'Unknown' },
    { label: 'Do you require a room reconfiguration?', value: 'Yes (PODS style)' },
    { label: 'Are you serving food and beverage (Space already booked)?', value: 'Yes' },
    { label: 'Are you utilizing a caterer?', value: 'Yes' },
    { label: 'Is your catering provider internal or external?', value: 'External Catering' },
    { label: 'Please select your catering type', value: 'External delivery/drop off - before turnstiles' },
    { label: 'Additional rooms / details', value: 'Mention any additional rooms' },
    { label: 'Do you NEED TO BOOK meeting or event space (or additional meeting or event space)?', value: 'No' },
    { label: 'Do you require services for your meeting or event?', value: 'Yes' },
    { label: 'What services do you require? (onsite AMER)', value: 'Amazon corporate security support, Meeting equipment add-ons (tables, easels, power etc.), Onsite audio visual' },
  ]

  const isSubmitted = state.pre.checklist.merfSubmitted
  const canSubmit = state.pre.merfTicketUrl.trim().length > 0

  const markSubmitted = () => {
    if (!canSubmit) {
      alert('Please enter the MERF ticket URL before confirming.')
      return
    }
    updatePre({ checklist: { ...state.pre.checklist, merfSubmitted: true } })
  }

  const undoSubmitted = () => {
    updatePre({ checklist: { ...state.pre.checklist, merfSubmitted: false } })
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Meeting & Event Request Form (MERF)</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Use the sample values below as a reference when filling out the MERF form. Copy the values and submit the form at the link below.
          </Alert>
          <Box>
            <Link href={MERF_URL} external fontSize="heading-m">
              Open MERF Form
            </Link>
          </Box>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Sample MERF Values</Header>}>
        <SpaceBetween size="xs">
          {merfFields.map((f, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}>
              <ColumnLayout columns={2}>
                <Box fontWeight="bold" color="text-body-secondary">{f.label}</Box>
                <Box>{f.value}</Box>
              </ColumnLayout>
            </div>
          ))}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">MERF Submission</Header>}>
        <SpaceBetween size="m">
          <FormField label="MERF Ticket URL">
            <Input
              value={state.pre.merfTicketUrl}
              onChange={({ detail }) => updatePre({ merfTicketUrl: detail.value })}
              placeholder="https://amazon.forms.events/forms/..."
              disabled={isSubmitted}
            />
          </FormField>
          {isSubmitted ? (
            <>
              <StatusIndicator type="success">MERF marked as submitted</StatusIndicator>
              <Button onClick={undoSubmitted}>Undo Confirmation</Button>
            </>
          ) : (
            <Button variant="primary" onClick={markSubmitted} disabled={!canSubmit}>
              Mark MERF as Submitted
            </Button>
          )}
          {!isSubmitted && !canSubmit && (
            <Box variant="small" color="text-status-error">Enter the MERF ticket URL to confirm submission.</Box>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  )
}
