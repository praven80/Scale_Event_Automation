import { useEffect, useRef, useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Button from '@cloudscape-design/components/button'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Box from '@cloudscape-design/components/box'
import { apiPost } from '../utils/api'

interface GraphStatus {
  configured: boolean
  authenticated: boolean
  message: string
  email?: string
}

export default function GraphAuthBanner() {
  const [status, setStatus] = useState<GraphStatus | null>(null)
  const [flowData, setFlowData] = useState<{ device_code: string; user_code: string; verification_uri: string; message: string } | null>(null)
  const [polling, setPolling] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    apiPost('/auth/graph-status', {}).then(setStatus).catch(() => setStatus(null))
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const startLogin = async () => {
    try {
      const data = await apiPost('/auth/graph-login', {})
      setFlowData(data)
      setPolling(true)
      pollRef.current = setInterval(async () => {
        try {
          const result = await apiPost('/auth/graph-poll', { device_code: data.device_code })
          if (!result.pending) {
            clearInterval(pollRef.current!)
            setPolling(false)
            setFlowData(null)
            setStatus({ configured: true, authenticated: true, message: 'Authenticated', email: result.email })
          }
        } catch {
          clearInterval(pollRef.current!)
          setPolling(false)
          setFlowData(null)
        }
      }, 5000)
    } catch (err: any) {
      setStatus({ configured: false, authenticated: false, message: err.message })
    }
  }

  const logout = async () => {
    await apiPost('/auth/graph-logout', {})
    setStatus({ configured: true, authenticated: false, message: 'Logged out' })
  }

  if (!status) return null
  if (!status.configured) return null

  if (status.authenticated) {
    return (
      <Alert type="success" dismissible action={<Button variant="inline-link" onClick={logout}>Disconnect</Button>}>
        <SpaceBetween size="xs" direction="horizontal">
          <StatusIndicator type="success">Microsoft Graph API connected</StatusIndicator>
          {status.email && <Box variant="small">({status.email})</Box>}
          <Box variant="small">— Drafts will be created in your Outlook (new + classic)</Box>
        </SpaceBetween>
      </Alert>
    )
  }

  if (flowData) {
    return (
      <Alert type="info">
        <SpaceBetween size="s">
          <Box variant="p"><strong>Sign in to Microsoft:</strong> {flowData.message}</Box>
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="primary" href={flowData.verification_uri} target="_blank" iconName="external">
              Open Sign-in Page
            </Button>
            <Box variant="code" fontSize="heading-l">{flowData.user_code}</Box>
          </SpaceBetween>
          {polling && <StatusIndicator type="loading">Waiting for authentication...</StatusIndicator>}
        </SpaceBetween>
      </Alert>
    )
  }

  return (
    <Alert type="warning" action={<Button onClick={startLogin}>Connect Microsoft Account</Button>}>
      Connect your Microsoft account to create drafts in the new Outlook. Without this, drafts are only created in classic/legacy Outlook via AppleScript.
    </Alert>
  )
}
