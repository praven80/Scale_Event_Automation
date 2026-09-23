import { useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Textarea from '@cloudscape-design/components/textarea'
import Button from '@cloudscape-design/components/button'
import Alert from '@cloudscape-design/components/alert'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import { AppState, PreEventState } from '../types'
import { apiPost } from '../utils/api'
import { OUTREACH_EMAIL_TEMPLATE } from '../templates/outreachEmailBody'

interface Props {
  state: AppState
  update: (u: Partial<AppState>) => void
  updatePre: (u: Partial<PreEventState>) => void
}

export default function OutreachStep({ state, update, updatePre }: Props) {
  const config = state.config!
  const [toAddress, setToAddress] = useState('')
  const [recipients, setRecipients] = useState('')
  const [sending, setSending] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  // Initialize from persisted state or generate default
  const defaultSubject = `Upcoming AWS Event: ${config?.event_name || ''} - ${config?.event_date || ''}`
  const defaultBody = config
    ? OUTREACH_EMAIL_TEMPLATE
        .replace(/{event_name}/g, config.event_name)
        .replace(/{event_date}/g, config.event_date)
        .replace(/{registration_url}/g, config.registration_url)
        .replace(/{event_summary}/g, config.event_summary)
        .replace(/{sender_name}/g, config.am_email_sender_name)
        .replace(/{sender_title}/g, config.am_email_sender_title)
        .replace(/{sender_team}/g, config.am_email_sender_team)
    : OUTREACH_EMAIL_TEMPLATE

  const subject = state.pre.outreachSubject || defaultSubject
  const body = state.pre.outreachBody || defaultBody
  const setSubject = (v: string) => updatePre({ outreachSubject: v })
  const setBody = (v: string) => updatePre({ outreachBody: v })

  const recipientList = recipients.split(/[\n,;]+/).map(r => r.trim()).filter(r => r.includes('@'))

  const handleSend = async (mode: 'draft' | 'send') => {
    if (!toAddress.includes('@')) {
      setStatusMsg('Enter a valid "To" email address (e.g. your own email).')
      return
    }
    if (recipientList.length === 0) {
      setStatusMsg('No valid BCC email addresses found.')
      return
    }
    if (!window.confirm(`${mode === 'draft' ? 'Save as draft' : 'Send'} one email to ${toAddress} with ${recipientList.length} recipients in BCC?`)) return

    setSending(true)
    setStatusMsg('Processing...')
    const endpoint = mode === 'draft' ? '/create-drafts' : '/send-emails'

    try {
      const data = await apiPost(endpoint, {
        emails: [{ to: toAddress, bcc: recipientList, subject, body }],
      })
      const result = data.results?.[0]
      if (result?.status === 'SUCCESS') {
        updatePre({
          outreachEmailsSent: state.pre.outreachEmailsSent + recipientList.length,
          checklist: { ...state.pre.checklist, outreachSent: true },
        })
        const label = mode === 'draft' ? 'Draft saved' : 'Email sent'
        setStatusMsg(`${label} with ${recipientList.length} recipients in BCC.`)
      } else {
        setStatusMsg(`Failed: ${result?.error || 'Unknown error'}`)
      }
    } catch (err) {
      setStatusMsg(`Failed: ${err}`)
    }
    setSending(false)
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">SA/AM Outreach Email</Header>}>
        <Alert type="info">
          Send a single outreach email with all SAs and AMs in BCC to drive customer registrations. Enter recipient email addresses below.
        </Alert>
      </Container>

      <Container header={<Header variant="h2">Recipients</Header>}>
        <SpaceBetween size="m">
          <FormField label="To (your email)" description="Your own email address — you'll appear as the sender and recipient">
            <Input value={toAddress} onChange={({ detail }) => setToAddress(detail.value)} placeholder="your-alias@amazon.com" />
          </FormField>
          <FormField label="BCC" description="SA/TAM/AM email addresses — one per line, or comma/semicolon separated">
            <Textarea
              value={recipients}
              onChange={({ detail }) => setRecipients(detail.value)}
              rows={5}
              placeholder={"alice@amazon.com\nbob@amazon.com\ncharlie@amazon.com"}
            />
          </FormField>
          {recipientList.length > 0 && (
            <StatusIndicator type="info">{recipientList.length} recipients will be added to BCC</StatusIndicator>
          )}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Email Template</Header>}>
        <ExpandableSection headerText="View / Edit Email" defaultExpanded>
          <SpaceBetween size="m">
            <FormField label="Subject">
              <Input value={subject} onChange={({ detail }) => setSubject(detail.value)} />
            </FormField>
            <FormField label="Body">
              <Textarea value={body} onChange={({ detail }) => setBody(detail.value)} rows={15} />
            </FormField>
          </SpaceBetween>
        </ExpandableSection>
      </Container>

      <Container header={<Header variant="h2">Send</Header>}>
        <SpaceBetween size="m">
          <SpaceBetween size="s" direction="horizontal">
            <Button variant="primary" loading={sending} disabled={!toAddress.includes('@') || recipientList.length === 0 || sending} onClick={() => handleSend('draft')}>
              {sending ? 'Saving...' : 'Save as Draft'}
            </Button>
            <Button loading={sending} disabled={!toAddress.includes('@') || recipientList.length === 0 || sending} onClick={() => handleSend('send')}>
              {sending ? 'Sending...' : 'Send Email'}
            </Button>
          </SpaceBetween>

          {statusMsg && <StatusIndicator type={statusMsg.includes('Failed') ? 'error' : 'success'}>{statusMsg}</StatusIndicator>}

          {state.pre.outreachEmailsSent > 0 && !statusMsg && (
            <StatusIndicator type="success">{state.pre.outreachEmailsSent} recipients reached via outreach this session</StatusIndicator>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  )
}
