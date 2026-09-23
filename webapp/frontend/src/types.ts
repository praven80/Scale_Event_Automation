export interface EventConfig {
  sa_activity: string
  activity_date: string
  domains: string[]
  services: string[]
  time_spent_hours: number
  campaign_code: string
  campaign_id: string
  event_name: string
  event_date: string
  registration_url: string
  event_summary: string
  /** Who the event was for — surfaced in the per-event detail CSV header. */
  target_audience?: string
  /** Concise list of takeaways — surfaced in the per-event detail CSV header. */
  audience_learnings?: string
  subject_template: string
  description_template: string
  am_email_subject: string
  am_email_wiki_link: string
  am_email_sender_name: string
  am_email_sender_title: string
  am_email_sender_team: string
}

export interface Attendee {
  Visitor: string
  Company: string
  Email: string
  Setting?: string
}

export interface FilteredAttendee extends Attendee {
  Domain: string
  Category: 'searchable' | 'internal' | 'generic'
}

export interface AccountCandidate {
  account_id: string
  account_name: string
  website: string
  billing_country: string
  t_shirt_size: string
  am_alias: string
  am_name: string
  territory: string
  source: 'account-search' | 'contact-search'
}

export interface EnrichedAttendee extends FilteredAttendee {
  'SFDC Account Name': string
  'Account ID': string
  'AM Name': string
  'AM Alias': string
  'AM Email': string
  'AM ID'?: string
  Territory: string
  Region?: string
  Division?: string
  Status: 'Matched' | 'Not Found'
  Confidence?: 'HIGH' | 'LOW' | 'MANUAL' | 'NONE'
  Candidates?: AccountCandidate[]
  IsManualOverride?: boolean
}

export interface OppRecord {
  'Opp Name': string
  'Opp ID': string
  'Customer ID': string
  Stage: string
  'ARR($)': string
  'Customer Name': string
  Domain: string
  Division?: string
  [key: string]: string | undefined
}

export interface ActivityPlan {
  'Account ID': string
  'SFDC Account Name': string
  Domain: string
  'Opp ID': string
  'Opp Name': string
  Stage: string
  Description: string
  Attendees: string
  'ARR($)'?: string
  Division?: string
}

export interface EmailPayload {
  am_alias: string
  am_name: string
  am_email: string
  subject: string
  body: string
  account_count: number
  attendee_count: number
  opp_count: number
  am_domains: string[]       // all account domains managed by this AM
  account_names: string[]    // account names in order (used for per-account credit code labeling)
  kiro_code?: string | null        // first assigned credit code (legacy/single-code compat)
  kiro_codes?: string[] | null     // all assigned credit codes (used when kiroCodesPerEmail > 1)
}

export interface CustomerEmailPayload {
  email: string
  name: string
  company: string
  subject: string
  body: string
}

export interface DivisionSummary {
  division: string
  accounts: number
  pipelineARR: number
  launchedARR: number
  totalARR: number
}

export type AppMode = 'pre' | 'post' | 'dashboard' | 'exclude' | 'account-exclude' | null

export interface EventRecord {
  eventId: string
  eventName: string
  eventDate: string
  type: 'PRE' | 'POST'
  eventType?: string
  venue?: string
  createdAt: string
  attendees?: number
  registrations?: number
  activitiesCreated?: number
  totalArrInfluenced?: number
  checklistStatus?: Record<string, boolean>
  primaryHost?: string
  isDeleted?: boolean
}

export interface ChecklistStatus {
  sfdcCampaignCreated: boolean
  zoomScheduled: boolean
  splashPageCreated: boolean
  roomBooked: boolean
  merfSubmitted: boolean
  outreachSent: boolean
  slackChannelCreated: boolean
  foodOrdered: boolean
  reminderEmailSent: boolean
}

export interface PreEventState {
  eventType: 'virtual' | 'in-person'
  venue: string
  zoomLink: string
  splashPageUrl: string
  slackChannel: string
  merfText: string
  checklist: ChecklistStatus
  outreachEmailsSent: number
  reminderEmailsSent: number
  registrationFile: File | null
  registrants: { Name: string; Email: string }[]
  registrationCount: number
  savedToDynamo: boolean
  primaryHost: string
  supportingPeople: string[]
  roomLocation: string
  roomNumber: string
  merfTicketUrl: string
  campaignId: string
  outreachSubject: string
  outreachBody: string
  reminderSubject: string
  reminderBody: string
}

export interface AppState {
  mode: AppMode
  eventId: string
  currentStep: number
  attendanceFile: File | null
  oppsFile: null | File
  attendanceCsvText: string
  oppsCsvText: string
  config: EventConfig | null
  attendees: Attendee[]
  filtered: { searchable: FilteredAttendee[]; internal: FilteredAttendee[]; generic: FilteredAttendee[] }
  enriched: EnrichedAttendee[]
  matchResults: { plan: ActivityPlan[]; skipped: any[] }
  noOppsByTerritory: { territory: string; accounts: number }[]
  activityResults: { created: number; failed: number; details: any[] }
  createdOppIds: Set<string>
  emailPayloads: EmailPayload[]
  sentAMAliases: string[]
  savedAMAliases: string[]
  photos: File[]
  divisionSummary: DivisionSummary[]
  totalRegistrations: number
  notableCustomers: string[]
  primaryHost: string
  amEmailSubjectOverride: string
  amEmailBodyOverride: string
  customerEmailPayloads: CustomerEmailPayload[]
  savedCustomerEmails: string[]
  sentCustomerEmails: string[]
  customerEmailSubjectOverride: string
  customerEmailBodyOverride: string
  kiroExcludeDomains: string[]   // domains/customers excluded from Kiro credit codes
  kiroCodesEnabled: boolean      // whether to claim & include credit codes
  kiroCodesPerEmail: number      // how many codes to include per AM email (1 or 2)
  tripReport: string
  reportFields: {
    csat: string
    location: string
    format: string
    customerFeedback: string
    actionItems: string
  }
  pre: PreEventState
}
