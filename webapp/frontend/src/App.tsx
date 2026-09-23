import { useEffect, useRef, useState } from 'react'
import TopNavigation from '@cloudscape-design/components/top-navigation'
import AppLayout from '@cloudscape-design/components/app-layout'
import Wizard from '@cloudscape-design/components/wizard'
import { AppState, AppMode, EventConfig, ChecklistStatus, PreEventState } from './types'
import { apiPost } from './utils/api'
import { ACTIVITY_DESCRIPTION_TEMPLATE } from './templates/activityDescription'
import { generateEventId } from './utils/eventId'
import ModeSelectPage from './pages/ModeSelectPage'
import DashboardPage from './pages/DashboardPage'
import ExcludeListPage from './pages/ExcludeListPage'
import AccountExclusionsPage from './pages/AccountExclusionsPage'
import UploadStep from './steps/UploadStep'
import ConfigStep from './steps/ConfigStep'
import FilterStep from './steps/FilterStep'
import EnrichStep from './steps/EnrichStep'
import MatchOppsStep from './steps/MatchOppsStep'
import CreateActivitiesStep from './steps/CreateActivitiesStep'
import CustomerEmailStep from './steps/CustomerEmailStep'
import EmailDraftsStep from './steps/EmailDraftsStep'
import ReportStep from './steps/ReportStep'
import EventSetupStep from './steps/EventSetupStep'
import EventChecklistStep from './steps/EventChecklistStep'
import OutreachStep from './steps/OutreachStep'
import MerfStep from './steps/MerfStep'
import RoomBookingStep from './steps/RoomBookingStep'
import ReminderEmailStep from './steps/ReminderEmailStep'
import PreEventStatusStep from './steps/PreEventStatusStep'

const defaultChecklist: ChecklistStatus = {
  sfdcCampaignCreated: false,
  zoomScheduled: false,
  splashPageCreated: false,
  roomBooked: false,
  merfSubmitted: false,
  outreachSent: false,
  slackChannelCreated: false,
  foodOrdered: false,
  reminderEmailSent: false,
}

const defaultPreState: PreEventState = {
  eventType: 'in-person',
  venue: '',
  zoomLink: '',
  splashPageUrl: '',
  slackChannel: '',
  merfText: '',
  checklist: { ...defaultChecklist },
  outreachEmailsSent: 0,
  reminderEmailsSent: 0,
  registrationFile: null,
  registrants: [],
  registrationCount: 0,
  savedToDynamo: false,
  primaryHost: '',
  supportingPeople: [],
  roomLocation: '',
  roomNumber: '',
  merfTicketUrl: '',
  campaignId: '',
  outreachSubject: '',
  outreachBody: '',
  reminderSubject: '',
  reminderBody: '',
}

const initialState: AppState = {
  mode: null,
  eventId: '',
  currentStep: 0,
  attendanceFile: null,
  oppsFile: null,
  attendanceCsvText: '',
  oppsCsvText: '',
  config: null,
  attendees: [],
  filtered: { searchable: [], internal: [], generic: [] },
  enriched: [],
  matchResults: { plan: [], skipped: [] },
  noOppsByTerritory: [],
  activityResults: { created: 0, failed: 0, details: [] },
  createdOppIds: new Set<string>(),
  emailPayloads: [],
  sentAMAliases: [],
  savedAMAliases: [],
  photos: [],
  divisionSummary: [],
  totalRegistrations: 0,
  notableCustomers: [],
  primaryHost: '',
  customerEmailPayloads: [],
  savedCustomerEmails: [],
  sentCustomerEmails: [],
  customerEmailSubjectOverride: '',
  customerEmailBodyOverride: '',
  amEmailSubjectOverride: '',
  amEmailBodyOverride: '',
  kiroExcludeDomains: [],
  kiroCodesEnabled: false,
  kiroCodesPerEmail: 1,
  tripReport: '',
  reportFields: { csat: '4.8', location: '', format: '', customerFeedback: '', actionItems: '' },
  pre: { ...defaultPreState },
}

export default function App() {
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [state, setState] = useState<AppState>(initialState)
  const postSavingRef = useRef(false)
  const update = (u: Partial<AppState>) => setState(prev => ({ ...prev, ...u }))
  const updatePre = (u: Partial<PreEventState>) => setState(prev => ({ ...prev, pre: { ...prev.pre, ...u } }))

  const savePreEvent = () => {
    // Use setState callback to always read the latest state (avoids stale closures)
    setState(prev => {
      if (prev.mode !== 'pre') {
        console.warn('[auto-save] Skipped: not in pre mode', { mode: prev.mode })
        return prev
      }
      const config = prev.config
      // Generate eventId if missing but config has the needed fields
      let eventId = prev.eventId
      if (!eventId && config?.activity_date && config?.event_name) {
        eventId = generateEventId(config.activity_date, config.event_name)
      }
      if (!eventId) {
        console.warn('[auto-save] Skipped: no eventId and cannot generate one (missing event name or date)')
        return prev
      }
      apiPost('/events/save-pre', {
        eventId,
        eventName: config?.event_name || '',
        eventDate: config?.activity_date || '',
        eventType: prev.pre.eventType,
        campaignCode: config?.campaign_code || '',
        registrationUrl: config?.registration_url || '',
        eventSummary: config?.event_summary || '',
        saActivity: config?.sa_activity || '',
        timeSpentHours: config?.time_spent_hours || 2,
        domains: config?.domains || [],
        services: config?.services || [],
        amEmailSenderName: config?.am_email_sender_name || '',
        amEmailSenderTitle: config?.am_email_sender_title || '',
        amEmailSenderTeam: config?.am_email_sender_team || '',
        amEmailWikiLink: config?.am_email_wiki_link || '',
        checklistStatus: prev.pre.checklist,
        outreachEmailsSent: prev.pre.outreachEmailsSent,
        reminderEmailsSent: prev.pre.reminderEmailsSent,
        merfText: prev.pre.merfText,
        registrations: prev.pre.registrants.length || prev.pre.registrationCount,
        zoomLink: prev.pre.zoomLink,
        splashPageUrl: prev.pre.splashPageUrl,
        slackChannel: prev.pre.slackChannel,
        primaryHost: prev.pre.primaryHost,
        supportingPeople: prev.pre.supportingPeople,
        venue: prev.pre.venue,
        roomLocation: prev.pre.roomLocation,
        roomNumber: prev.pre.roomNumber,
        merfTicketUrl: prev.pre.merfTicketUrl,
        campaignId: prev.pre.campaignId,
        outreachSubject: prev.pre.outreachSubject,
        outreachBody: prev.pre.outreachBody,
        reminderSubject: prev.pre.reminderSubject,
        reminderBody: prev.pre.reminderBody,
      }).then(() => {
        console.log('[auto-save] Pre-event data saved')
        setState(p => ({ ...p, pre: { ...p.pre, savedToDynamo: true } }))
      }).catch(err => {
        console.error('[auto-save] Failed:', err)
        alert(`Failed to save event: ${err.message}`)
      })
      // Persist generated eventId back to state if it was missing
      return prev.eventId ? prev : { ...prev, eventId }
    })
  }

  const savePostEvent = (retries = 0) => {
    if (postSavingRef.current) {
      if (retries < 3) {
        setTimeout(() => savePostEvent(retries + 1), 1000)
      } else {
        console.warn('[auto-save] Skipped: save still in progress after retries')
      }
      return
    }
    setState(prev => {
      if (prev.mode !== 'post') {
        console.warn('[auto-save] Skipped: not in post mode', { mode: prev.mode })
        return prev
      }
      if (!prev.attendees.length && !prev.tripReport) {
        console.warn('[auto-save] Skipped: no data to save yet')
        return prev
      }
      const config = prev.config
      const eventId = prev.eventId || (config ? generateEventId(config.activity_date, config.event_name) : `draft_${Date.now()}`)
      const matched = prev.enriched.filter(e => e.Status === 'Matched')
      const uniqueAccounts = new Set(matched.map(m => m['Account ID'])).size
      const uniqueCompanies = new Set(prev.attendees.map(a => a.Company).filter(c => c)).size
      const totalARR = prev.matchResults.plan.reduce((s, p) => s + (parseFloat((p['ARR($)'] || '0').replace(/[^0-9.-]/g, '')) || 0), 0)
      const pipelineARR = prev.divisionSummary.reduce((s, d) => s + d.pipelineARR, 0)
      const launchedARR = prev.divisionSummary.reduce((s, d) => s + d.launchedARR, 0)

      postSavingRef.current = true
      console.log('[auto-save] Saving post-event...', { eventId, tripReport: prev.tripReport ? `${prev.tripReport.length} chars` : 'empty' })
      apiPost('/events/save-post', {
        eventId,
        eventName: config?.event_name || '',
        eventDate: config?.activity_date || '',
        config,
        registrations: prev.totalRegistrations || 0,
        attendees: prev.attendees.length,
        attendanceRate: prev.totalRegistrations ? Math.round((prev.attendees.length / prev.totalRegistrations) * 100) : 0,
        uniqueCompanies,
        accountsMatched: uniqueAccounts,
        activitiesCreated: prev.activityResults.created,
        amNotificationsSent: prev.emailPayloads.filter(p => p.am_alias !== 'Not Found' && p.am_name !== 'Not Found').length,
        totalArrInfluenced: totalARR,
        pipelineArr: pipelineARR,
        launchedArr: launchedARR,
        divisionSummary: prev.divisionSummary,
        noOppsByTerritory: prev.noOppsByTerritory,
        notableCustomers: prev.notableCustomers,
        primaryHost: prev.primaryHost || '',
        services: config?.services || [],
        // Full data arrays stored in S3
        attendeesData: prev.attendees,
        filteredData: prev.filtered,
        enrichedData: prev.enriched,
        matchResultsData: prev.matchResults,
        activityResultsData: prev.activityResults,
        emailPayloadsData: prev.emailPayloads,
        sentAMAliases: prev.sentAMAliases,
        savedAMAliases: prev.savedAMAliases,
        createdOppIds: [...prev.createdOppIds],
        tripReport: prev.tripReport,
        reportFields: prev.reportFields,
        amEmailSubjectOverride: prev.amEmailSubjectOverride || '',
        amEmailBodyOverride: prev.amEmailBodyOverride || '',
      }).then(() => {
        console.log('[auto-save] Post-event data saved')
        postSavingRef.current = false
      }).catch(err => {
        console.error('[auto-save] Failed:', err)
        postSavingRef.current = false
      })
      // Set eventId synchronously to prevent duplicate IDs on subsequent saves
      return prev.eventId ? prev : { ...prev, eventId }
    })
  }

  // Auto-save on page refresh/close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (state.mode === 'pre') savePreEvent()
      else if (state.mode === 'post') savePostEvent()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [state.mode])

  const setMode = (mode: AppMode) => {
    setState(prev => ({ ...prev, mode }))
    setActiveStepIndex(0)
  }

  const loadEvent = async (eventId: string, mode: AppMode) => {
    try {
      const data = await apiPost('/events/get', { eventId })
      const record = mode === 'pre' ? data.pre : data.post
      if (!record) {
        alert(`No ${mode}-event record found for ${eventId}`)
        return
      }
      if (mode === 'pre') {
        const config: EventConfig = {
          sa_activity: record.saActivity || 'Demo [Architecture]',
          activity_date: record.eventDate || '',
          domains: record.domains || ['GenAI'],
          services: record.services || ['Amazon Bedrock', 'Amazon Bedrock AgentCore', 'Kiro', 'Strands SDK'],
          time_spent_hours: record.timeSpentHours || 2,
          campaign_code: record.campaignCode || '',
          campaign_id: record.campaignId || '',
          event_name: record.eventName || '',
          event_date: record.eventDate || '',
          registration_url: record.registrationUrl || '',
          event_summary: record.eventSummary || '',
          subject_template: '{event_name} | {campaign_code}',
          description_template: ACTIVITY_DESCRIPTION_TEMPLATE,
          am_email_subject: '',
          am_email_wiki_link: record.amEmailWikiLink || 'https://w.amazon.com/bin/view/AGS_NAMER_AI',
          am_email_sender_name: record.amEmailSenderName || record.primaryHost || 'Prasanna Sridharan',
          am_email_sender_title: record.amEmailSenderTitle || 'Principal Architect - GenAI/ML',
          am_email_sender_team: record.amEmailSenderTeam || 'AGS Gen AI Scale Solutions Architect team',
        }
        setState({
          ...initialState,
          mode: 'pre',
          eventId,
          config,
          pre: {
            ...defaultPreState,
            eventType: record.eventType || 'virtual',
            venue: record.venue || '',
            zoomLink: record.zoomLink || '',
            splashPageUrl: record.splashPageUrl || '',
            slackChannel: record.slackChannel || '',
            merfText: record.merfText || '',
            checklist: record.checklistStatus || { ...defaultChecklist },
            outreachEmailsSent: record.outreachEmailsSent || 0,
            reminderEmailsSent: record.reminderEmailsSent || 0,
            registrationCount: record.registrations || 0,
            primaryHost: record.primaryHost || '',
            supportingPeople: record.supportingPeople || [],
            roomLocation: record.roomLocation || '',
            roomNumber: record.roomNumber || '',
            merfTicketUrl: record.merfTicketUrl || '',
            campaignId: record.campaignId || '',
            outreachSubject: record.outreachSubject || '',
            outreachBody: record.outreachBody || '',
            reminderSubject: record.reminderSubject || '',
            reminderBody: record.reminderBody || '',
            savedToDynamo: true,
          },
        })
      } else {
        // Restore config: use saved config as base, but always refresh fields from latest pre-event
        const pre = data.pre
        const savedConfig = record.config
        const config: EventConfig = {
          sa_activity: pre?.saActivity || savedConfig?.sa_activity || 'Demo [Architecture]',
          activity_date: pre?.eventDate || savedConfig?.activity_date || record.eventDate || '',
          domains: pre?.domains || savedConfig?.domains || ['GenAI'],
          services: pre?.services || savedConfig?.services || record.services || ['Amazon Bedrock', 'Amazon Bedrock AgentCore', 'Kiro', 'Strands SDK'],
          time_spent_hours: pre?.timeSpentHours ?? savedConfig?.time_spent_hours ?? 2,
          campaign_code: pre?.campaignCode || savedConfig?.campaign_code || '',
          campaign_id: pre?.campaignId || savedConfig?.campaign_id || '',
          event_name: pre?.eventName || savedConfig?.event_name || record.eventName || '',
          event_date: pre?.eventDate || savedConfig?.event_date || record.eventDate || '',
          registration_url: pre?.registrationUrl || savedConfig?.registration_url || '',
          event_summary: pre?.eventSummary || savedConfig?.event_summary || '',
          subject_template: savedConfig?.subject_template || '{event_name} | {campaign_code}',
          description_template: savedConfig?.description_template || ACTIVITY_DESCRIPTION_TEMPLATE,
          am_email_subject: savedConfig?.am_email_subject || `AWS Event Update: Your Customer Joined Our ${record.eventName || 'Event'}`,
          am_email_wiki_link: pre?.amEmailWikiLink || savedConfig?.am_email_wiki_link || 'https://w.amazon.com/bin/view/AGS_NAMER_AI',
          am_email_sender_name: pre?.amEmailSenderName || pre?.primaryHost || savedConfig?.am_email_sender_name || 'Prasanna Sridharan',
          am_email_sender_title: pre?.amEmailSenderTitle || savedConfig?.am_email_sender_title || 'Principal Architect - GenAI/ML',
          am_email_sender_team: pre?.amEmailSenderTeam || savedConfig?.am_email_sender_team || 'AGS Gen AI Scale Solutions Architect team',
        }

        setState({
          ...initialState,
          mode: 'post',
          eventId,
          config,
          totalRegistrations: record.registrations || 0,
          attendanceCsvText: record.attendanceCsvText || '',
          oppsCsvText: record.oppsCsvText || '',
          attendees: record.attendeesData || [],
          filtered: record.filteredData || { searchable: [], internal: [], generic: [] },
          enriched: record.enrichedData || [],
          matchResults: record.matchResultsData || { plan: [], skipped: [] },
          activityResults: record.activityResultsData || { created: record.activitiesCreated || 0, failed: 0, details: [] },
          emailPayloads: record.emailPayloadsData || [],
          sentAMAliases: record.sentAMAliases || [],
          savedAMAliases: record.savedAMAliases || [],
          createdOppIds: new Set(record.createdOppIds || []),
          divisionSummary: record.divisionSummary || [],
          noOppsByTerritory: record.noOppsByTerritory || [],
          notableCustomers: record.notableCustomers || [],
          primaryHost: record.primaryHost || pre?.primaryHost || '',
          customerEmailPayloads: record.customerEmailPayloads || [],
          savedCustomerEmails: record.savedCustomerEmails || [],
          sentCustomerEmails: record.sentCustomerEmails || [],
          customerEmailSubjectOverride: record.customerEmailSubjectOverride || '',
          customerEmailBodyOverride: record.customerEmailBodyOverride || '',
          amEmailSubjectOverride: record.amEmailSubjectOverride || '',
          amEmailBodyOverride: record.amEmailBodyOverride || '',
          kiroExcludeDomains: record.kiroExcludeDomains || [],
          kiroCodesEnabled: record.kiroCodesEnabled || false,
          kiroCodesPerEmail: record.kiroCodesPerEmail || 1,
          tripReport: record.tripReport || '',
          reportFields: record.reportFields || { csat: '4.8', location: '', format: '', customerFeedback: '', actionItems: '' },
        })
      }
      setActiveStepIndex(0)
    } catch (err: any) {
      console.error('[load-event] Failed:', err)
      alert(`Failed to load event: ${err.message}`)
    }
  }

  const startPostFromPre = async (eventId: string) => {
    try {
      const data = await apiPost('/events/get', { eventId })
      const pre = data.pre
      if (!pre) {
        alert(`No pre-event record found for ${eventId}`)
        return
      }
      const config: EventConfig = {
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
        am_email_subject: `AWS Event Update: Your Customer Joined Our ${pre.eventName || 'Event'}`,
        am_email_wiki_link: pre.amEmailWikiLink || 'https://w.amazon.com/bin/view/AGS_NAMER_AI',
        am_email_sender_name: pre.amEmailSenderName || pre.primaryHost || 'Prasanna Sridharan',
        am_email_sender_title: pre.amEmailSenderTitle || 'Principal Architect - GenAI/ML',
        am_email_sender_team: pre.amEmailSenderTeam || 'AGS Gen AI Scale Solutions Architect team',
      }
      setState({
        ...initialState,
        mode: 'post',
        eventId,
        config,
        primaryHost: pre.primaryHost || '',
        totalRegistrations: pre.registrations || 0,
      })
      setActiveStepIndex(0)
    } catch (err: any) {
      console.error('[start-post-from-pre] Failed:', err)
      alert(`Failed to load pre-event data: ${err.message}`)
    }
  }

  const goHome = () => {
    setState({ ...initialState })
    setActiveStepIndex(0)
    postSavingRef.current = false
  }

  const modeLabel = state.mode === 'pre' ? 'AGS Scale Events Toolkit - Pre-Event Planning' : state.mode === 'post' ? 'AGS Scale Events Toolkit - Post-Event Processing' : state.mode === 'dashboard' ? 'AGS Scale Events Toolkit - Dashboard' : state.mode === 'exclude' ? 'AGS Scale Events Toolkit - Email Exclusion Lists' : state.mode === 'account-exclude' ? 'AGS Scale Events Toolkit - Account Exclusions' : 'AGS Scale Events Toolkit'

  return (
    <>
      <div className="no-print">
        <TopNavigation
          identity={{ href: '#', title: modeLabel, onFollow: (e) => { e.preventDefault(); if (state.mode) goHome() } }}
          utilities={state.mode ? [
            { type: 'button', text: 'Switch Mode', onClick: goHome },
          ] : []}
          i18nStrings={{ overflowMenuTriggerText: 'More', overflowMenuTitleText: 'All' }}
        />
      </div>
      {state.mode === 'dashboard' && (
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 40px 40px' }}>
          <DashboardPage onGoHome={goHome} />
        </div>
      )}
      {state.mode === 'exclude' && (
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 40px 40px' }}>
          <ExcludeListPage onGoHome={goHome} />
        </div>
      )}
      {state.mode === 'account-exclude' && (
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 40px 40px' }}>
          <AccountExclusionsPage onGoHome={goHome} />
        </div>
      )}
      {state.mode !== 'dashboard' && state.mode !== 'exclude' && state.mode !== 'account-exclude' && <AppLayout
        navigationHide
        toolsHide
        content={
          state.mode === null ? (
            <ModeSelectPage onSelectMode={setMode} onLoadEvent={loadEvent} onStartPostFromPre={startPostFromPre} />
          ) : state.mode === 'pre' ? (
            <Wizard
              i18nStrings={{
                stepNumberLabel: (n) => `Step ${n}`,
                collapsedStepsLabel: (n, t) => `Step ${n} of ${t}`,
                cancelButton: 'Back to Home',
                previousButton: 'Previous',
                nextButton: 'Next',
                submitButton: '',
                optional: 'optional',
                skipToButtonLabel: (step) => `Skip to ${step.title}`,
              }}
              activeStepIndex={activeStepIndex}
              onNavigate={({ detail }) => {
                setActiveStepIndex(detail.requestedStepIndex)
                savePreEvent()
              }}
              onCancel={goHome}
              allowSkipTo
              steps={[
                {
                  title: 'Event Setup',
                  description: 'Configure event name, date, type, and campaign details',
                  isOptional: true,
                  content: <EventSetupStep state={state} update={update} updatePre={updatePre} />,
                },
                ...(state.pre.eventType === 'in-person' ? [{
                  title: 'Room Booking',
                  description: 'Book a meeting room for your in-person event',
                  isOptional: true,
                  content: <RoomBookingStep state={state} update={update} updatePre={updatePre} />,
                }] : []),
                {
                  title: 'SA/AM Outreach',
                  description: 'Send outreach email to SAs and AMs with recipients in BCC',
                  isOptional: true,
                  content: <OutreachStep state={state} update={update} updatePre={updatePre} />,
                },
                ...(state.pre.eventType === 'in-person' ? [{
                  title: 'MERF Ticket',
                  description: 'Sample MERF values and link to submit the form',
                  isOptional: true,
                  content: <MerfStep state={state} update={update} updatePre={updatePre} />,
                }] : []),
                {
                  title: 'Event Checklist',
                  description: 'Track event setup tasks and their completion status',
                  isOptional: true,
                  content: <EventChecklistStep state={state} update={update} updatePre={updatePre} />,
                },
                {
                  title: 'Customer Reminders',
                  description: 'Upload registrations and send reminder emails',
                  isOptional: true,
                  content: <ReminderEmailStep state={state} update={update} updatePre={updatePre} />,
                },
                {
                  title: 'Pre-Event Summary',
                  description: 'Review checklist status and save event data',
                  isOptional: true,
                  content: <PreEventStatusStep state={state} update={update} updatePre={updatePre} />,
                },
              ]}
            />
          ) : (
            <Wizard
              i18nStrings={{
                stepNumberLabel: (n) => `Step ${n}`,
                collapsedStepsLabel: (n, t) => `Step ${n} of ${t}`,
                cancelButton: 'Back to Home',
                previousButton: 'Previous',
                nextButton: 'Next',
                submitButton: '',
                optional: 'optional',
                skipToButtonLabel: (step) => `Skip to ${step.title}`,
              }}
              activeStepIndex={activeStepIndex}
              onNavigate={({ detail }) => {
                if (activeStepIndex === 0 && detail.requestedStepIndex > 0 && !state.eventId && (!state.attendanceFile || !state.oppsFile)) return
                // Require a pre-event to be linked before leaving the Config step
                if (activeStepIndex === 1 && detail.requestedStepIndex > 1 && (!state.eventId || state.eventId.startsWith('draft_'))) return
                setActiveStepIndex(detail.requestedStepIndex)
                // Auto-save when navigating away from Config step (index 1) or later
                if (activeStepIndex >= 1) savePostEvent()
              }}
              onCancel={goHome}
              allowSkipTo
              steps={[
                {
                  title: 'Upload Files',
                  description: 'Upload your attendance CSV and opps export CSV',
                  isOptional: true,
                  content: <UploadStep state={state} update={update} />,
                },
                {
                  title: 'Event Configuration',
                  description: 'Select a pre-event and review event details for SFDC activities',
                  content: <ConfigStep state={state} update={update} />,
                },
                {
                  title: 'Filter & Classify',
                  description: 'Filter out internal and generic emails, classify by domain',
                  isOptional: true,
                  content: <FilterStep state={state} update={update} />,
                },
                {
                  title: 'SFDC Account Lookup',
                  description: 'Search SFDC for account details by email domain',
                  isOptional: true,
                  content: <EnrichStep state={state} update={update} />,
                },
                {
                  title: 'Match Opportunities',
                  description: 'Match attendee accounts to GenAI/ML opportunities',
                  isOptional: true,
                  content: <MatchOppsStep state={state} update={update} />,
                },
                {
                  title: 'Tag Campaign Code',
                  description: 'Tag the SFDC campaign code on each matched opportunity',
                  isOptional: true,
                  content: <CreateActivitiesStep state={state} update={update} onSave={savePostEvent} />,
                },
                {
                  title: 'Customer Emails',
                  description: 'Send thank-you emails to attendees with event materials and upcoming workshop info',
                  isOptional: true,
                  content: <CustomerEmailStep state={state} update={update} onSave={savePostEvent} />,
                },
                {
                  title: 'AM Email Drafts',
                  description: 'Generate AM notification emails as .eml files',
                  isOptional: true,
                  content: <EmailDraftsStep state={state} update={update} onSave={savePostEvent} />,
                },
                {
                  title: 'Trip Report',
                  description: 'Generate the post-event trip report',
                  isOptional: true,
                  content: <ReportStep state={state} update={update} onSave={savePostEvent} />,
                },
              ]}
            />
          )
        }
      />}
    </>
  )
}
