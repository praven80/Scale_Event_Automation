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
import { AppState, PreEventState } from '../types'

interface Props {
  state: AppState
  update: (u: Partial<AppState>) => void
  updatePre: (u: Partial<PreEventState>) => void
}

const MEETINGS_URL = 'https://meetings.amazon.com'

export default function RoomBookingStep({ state, update, updatePre }: Props) {
  const isBooked = state.pre.checklist.roomBooked
  const canConfirm = state.pre.roomLocation.trim() && state.pre.roomNumber.trim()

  const confirmBooked = () => {
    if (!canConfirm) {
      alert('Please enter the location and room number before confirming.')
      return
    }
    updatePre({ checklist: { ...state.pre.checklist, roomBooked: true } })
  }

  const undoBooked = () => {
    updatePre({ checklist: { ...state.pre.checklist, roomBooked: false } })
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Meeting Room Booking</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Book a meeting room for your in-person event using the Amazon Meetings tool. Once booked, enter the details below and confirm.
          </Alert>
          <Box>
            <Link href={MEETINGS_URL} external fontSize="heading-m">
              Open Amazon Meetings
            </Link>
          </Box>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Room Details</Header>}>
        <SpaceBetween size="m">
          <FormField label="Location / Building">
            <Input
              value={state.pre.roomLocation}
              onChange={({ detail }) => updatePre({ roomLocation: detail.value })}
              placeholder="BOS21"
              disabled={isBooked}
            />
          </FormField>
          <FormField label="Room Number">
            <Input
              value={state.pre.roomNumber}
              onChange={({ detail }) => updatePre({ roomNumber: detail.value })}
              placeholder="BOS21.04.100"
              disabled={isBooked}
            />
          </FormField>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Booking Status</Header>}>
        <SpaceBetween size="m">
          {isBooked ? (
            <>
              <StatusIndicator type="success">Room booked - {state.pre.roomLocation} / {state.pre.roomNumber}</StatusIndicator>
              <Button onClick={undoBooked}>Undo Confirmation</Button>
            </>
          ) : (
            <Button variant="primary" onClick={confirmBooked} disabled={!canConfirm}>
              Confirm Room Booked
            </Button>
          )}
          {!isBooked && !canConfirm && (
            <Box variant="small" color="text-status-error">Enter location and room number to confirm booking.</Box>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  )
}
