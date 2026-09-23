import { useEffect, useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Table from '@cloudscape-design/components/table'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Spinner from '@cloudscape-design/components/spinner'
import Tabs from '@cloudscape-design/components/tabs'
import MetricCard from '../components/MetricCard'
import { AppMode, EventRecord } from '../types'

interface Props {
  onSelectMode: (mode: AppMode) => void
  onLoadEvent: (eventId: string, mode: AppMode) => void
  onStartPostFromPre: (eventId: string) => void
}

export default function ModeSelectPage({ onSelectMode, onLoadEvent, onStartPostFromPre }: Props) {
  const [recentEvents, setRecentEvents] = useState<EventRecord[]>([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchEvents = () => {
    setLoadingEvents(true)
    fetch('/api/events/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 100 }) })
      .then(r => r.ok ? r.json() : { events: [] })
      .then(data => setRecentEvents(data.events || []))
      .catch(() => setRecentEvents([]))
      .finally(() => setLoadingEvents(false))
  }

  useEffect(() => { fetchEvents() }, [])

  const handleDelete = async (e: EventRecord) => {
    if (!confirm(`Confirm delete?`)) return
    const key = `${e.eventId}-${e.type}`
    setDeletingId(key)
    try {
      const resp = await fetch('/api/events/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: e.eventId, type: e.type }) })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }
      setRecentEvents(prev => prev.filter(ev => !(ev.eventId === e.eventId && ev.type === e.type)))
    } catch (err: any) {
      alert(`Failed to delete: ${err.message}`)
    } finally {
      setDeletingId(null)
    }
  }

  const preEvents = recentEvents.filter(e => e.type === 'PRE')
  const postEvents = recentEvents.filter(e => e.type === 'POST')
  const totalAttendees = postEvents.reduce((s, e) => s + (e.attendees || 0), 0)
  const totalActivities = postEvents.reduce((s, e) => s + (e.activitiesCreated || 0), 0)
  const totalArr = postEvents.reduce((s, e) => s + (e.totalArrInfluenced || 0), 0)
  const totalRegistrations = preEvents.reduce((s, e) => s + (e.registrations || 0), 0)

  const linkStyle: React.CSSProperties = { cursor: 'pointer', color: '#0972d3', whiteSpace: 'nowrap' }
  const dividerStyle: React.CSSProperties = { color: '#aab7b8', margin: '0 6px' }

  const renderDeleteAction = (e: EventRecord) => (
    deletingId === `${e.eventId}-${e.type}` ? (
      <Spinner size="normal" />
    ) : (
      <span title="Delete this event" style={{ ...linkStyle, color: '#d91515' }} onClick={() => handleDelete(e)}>
        🗑️ Delete
      </span>
    )
  )

  const preEventTable = (
    <SpaceBetween size="m">
      {preEvents.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <MetricCard label="Pre-Events" value={preEvents.length} color="blue" />
          <MetricCard label="Total Registrations" value={totalRegistrations} color="green" />
          <MetricCard label="Avg Registrations" value={preEvents.length > 0 ? Math.round(totalRegistrations / preEvents.length) : 0} color="purple" />
          <MetricCard label="Outreach Sent" value={preEvents.reduce((s, e) => s + ((e as any).outreachEmailsSent || 0), 0)} color="orange" />
        </div>
      )}
      <Table
        columnDefinitions={[
          { id: 'host', header: 'Primary Host', cell: (e: EventRecord) => e.primaryHost || '-' },
          { id: 'name', header: 'Event', cell: (e: EventRecord) => e.eventName },
          { id: 'date', header: 'Date', cell: (e: EventRecord) => e.eventDate },
          { id: 'eventType', header: 'Type', cell: (e: EventRecord) => {
            const t = e.eventType || 'virtual'
            return t === 'in-person'
              ? <StatusIndicator type="info">In-Person</StatusIndicator>
              : <StatusIndicator type="pending">Virtual</StatusIndicator>
          }},
          { id: 'venue', header: 'Venue', cell: (e: EventRecord) => e.venue || '-' },
          { id: 'progress', header: 'Checklist Progress', cell: (e: EventRecord) => {
            if (!e.checklistStatus) return <span style={{ color: '#d91515', fontWeight: 600 }}>0/0 tasks</span>
            const virtualExclude = ['roomBooked', 'merfSubmitted', 'foodOrdered', 'slackChannelCreated']
            const inPersonExclude = ['zoomScheduled']
            const isVirtual = (e.eventType || 'virtual') !== 'in-person'
            const exclude = isVirtual ? virtualExclude : inPersonExclude
            const entries = Object.entries(e.checklistStatus).filter(([k]) => !exclude.includes(k))
            const total = entries.length
            const done = entries.filter(([, v]) => v).length
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const color = pct === 100 ? '#037f0c' : pct >= 50 ? '#0972d3' : '#d91515'
            return <span style={{ color, fontWeight: 600 }}>{done}/{total} tasks</span>
          }},
          { id: 'registrations', header: 'Registrations', cell: (e: EventRecord) => e.registrations ?? '-' },
          { id: 'actions', header: 'Actions', cell: (e: EventRecord) => (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span title="Edit this event" style={linkStyle} onClick={() => onLoadEvent(e.eventId, 'pre')}>
                ✏️ Edit
              </span>
              <span style={dividerStyle}>|</span>
              <span title="Start post-event processing from this pre-event" style={linkStyle} onClick={() => {
                const existingPost = postEvents.find(p => p.eventId === e.eventId)
                if (existingPost) {
                  onLoadEvent(e.eventId, 'post')
                } else {
                  onStartPostFromPre(e.eventId)
                }
              }}>
                ➡️ Post-Event
              </span>
              <span style={dividerStyle}>|</span>
              {renderDeleteAction(e)}
            </div>
          )},
        ]}
        items={preEvents}
        variant="embedded"
        stripedRows
        empty={<Box textAlign="center" color="inherit"><b>No pre-events yet</b><Box variant="p" color="inherit">Start a Pre-Event Wizard to create your first pre-event record.</Box></Box>}
      />
    </SpaceBetween>
  )

  const postEventTable = (
    <SpaceBetween size="m">
      {postEvents.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <MetricCard label="Post-Events" value={postEvents.length} color="blue" />
          <MetricCard label="Total Attendees" value={totalAttendees} color="green" />
          <MetricCard label="Activities Created" value={totalActivities} color="purple" />
          <MetricCard label="ARR Influenced" value={`$${(totalArr / 1000000).toFixed(1)}M`} color="orange" />
        </div>
      )}
      <Table
        columnDefinitions={[
          { id: 'host', header: 'Primary Host', cell: (e: EventRecord) => e.primaryHost || '-' },
          { id: 'name', header: 'Event', cell: (e: EventRecord) => e.eventName },
          { id: 'date', header: 'Date', cell: (e: EventRecord) => e.eventDate },
          { id: 'attendees', header: 'Attendees', cell: (e: EventRecord) => e.attendees ?? '-' },
          { id: 'activities', header: 'Activities Created', cell: (e: EventRecord) => e.activitiesCreated ?? '-' },
          { id: 'arr', header: 'ARR Influenced', cell: (e: EventRecord) => {
            const arr = e.totalArrInfluenced || 0
            return arr > 0 ? `$${arr.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'
          }},
          { id: 'actions', header: 'Actions', cell: (e: EventRecord) => (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span title="Edit this event" style={linkStyle} onClick={() => onLoadEvent(e.eventId, 'post')}>
                ✏️ Edit
              </span>
              <span style={dividerStyle}>|</span>
              <span title="Go to pre-event for this event" style={linkStyle} onClick={() => onLoadEvent(e.eventId, 'pre')}>
                ⬅️ Pre-Event
              </span>
              <span style={dividerStyle}>|</span>
              {renderDeleteAction(e)}
            </div>
          )},
        ]}
        items={postEvents}
        variant="embedded"
        stripedRows
        empty={<Box textAlign="center" color="inherit"><b>No post-events yet</b><Box variant="p" color="inherit">Start a Post-Event Wizard to process your first event.</Box></Box>}
      />
    </SpaceBetween>
  )

  return (
    <SpaceBetween size="l">
      <Box padding={{ top: 'l' }}>
        <Header
          variant="h1"
          description="Automate pre-event planning and post-event processing for AGS Scale workshops and events."
          actions={
            <SpaceBetween size="xs" direction="horizontal">
              <Button iconName="bar-chart" onClick={() => onSelectMode('dashboard')}>View Dashboard</Button>
              <Button iconName="settings" onClick={() => onSelectMode('exclude')}>Email Exclusions</Button>
              <Button iconName="settings" onClick={() => onSelectMode('account-exclude')}>Account Exclusions</Button>
            </SpaceBetween>
          }
        >
          AGS Scale Events Toolkit
        </Header>
      </Box>

      <ColumnLayout columns={2}>
        <Container
          header={<Header variant="h2" description="MERF tickets, AM outreach, event checklists, customer reminders">Pre-Event Planning</Header>}
          footer={<Button variant="primary" onClick={() => onSelectMode('pre')} fullWidth>Start Pre-Event Wizard</Button>}
        >
          <SpaceBetween size="s">
            <Box variant="p">Automate your pre-event workflow:</Box>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>Configure event details and generate event ID</li>
              <li>Generate and send SA / Spl SA / TAM outreach emails</li>
              <li>Pre-fill MERF ticket content with AI</li>
              <li>Track event checklist (Zoom, Splash, Slack, etc.)</li>
              <li>Upload registrations and send reminder emails</li>
              <li>Save pre-event data for analytics</li>
            </ul>
          </SpaceBetween>
        </Container>

        <Container
          header={<Header variant="h2" description="Attendance processing, SFDC activities, AM notifications, trip reports">Post-Event Processing</Header>}
          footer={<Button variant="primary" onClick={() => onSelectMode('post')} fullWidth>Start Post-Event Wizard</Button>}
        >
          <SpaceBetween size="s">
            <Box variant="p">Process event results end-to-end:</Box>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>Upload attendance and opportunities CSVs</li>
              <li>Filter, classify, and enrich attendees via SFDC</li>
              <li>Match attendees to GenAI/ML opportunities</li>
              <li>Create SFDC tech activities in bulk</li>
              <li>Generate and send AM notification emails</li>
              <li>AI-generated trip report with metrics</li>
            </ul>
          </SpaceBetween>
        </Container>
      </ColumnLayout>

      <Container header={<Header variant="h2" counter={`(${recentEvents.length})`}>Recent Events</Header>}>
        {loadingEvents ? (
          <Box textAlign="center" padding="l"><Spinner size="large" /></Box>
        ) : recentEvents.length === 0 ? (
          <Box textAlign="center" color="inherit" padding="l">
            <b>No events recorded yet</b>
            <Box variant="p" color="inherit">Start a pre-event or post-event wizard to create your first event record.</Box>
          </Box>
        ) : (
          <Tabs tabs={[
            {
              label: `Pre-Event (${preEvents.length})`,
              id: 'pre',
              content: preEventTable,
            },
            {
              label: `Post-Event (${postEvents.length})`,
              id: 'post',
              content: postEventTable,
            },
          ]} />
        )}
      </Container>
    </SpaceBetween>
  )
}
