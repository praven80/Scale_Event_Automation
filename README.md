# AGS Scale Events Toolkit

A full-stack React webapp for end-to-end event management — covering pre-event planning, post-event processing (attendance parsing, SFDC enrichment, activity logging, AM notifications), and trip report generation.

---

## Architecture

```
Browser (React + Cloudscape UI)
    |
    | HTTP (port 5173)
    v
Vite Dev Server ──proxy /api/*──> dev-server.mjs (port 3001)
                                      |
                          ┌───────────┼───────────────┬──────────────────┐
                          v           v               v                  v
                   DynamoDB (us-east-1)    S3 (us-east-1)    aws-sentral-mcp    aws-outlook-mcp
                   (summary metrics)   (full event data)        |                    |
                                                                | Midway auth        | Midway auth
                                                                v                    v
                                                           SUDS (SFDC)       Outlook (HTML email)
```

- **Frontend**: React + TypeScript with [Cloudscape Design System](https://cloudscape.design/) and Recharts
- **Backend**: Node.js dev server bridging REST API calls to AWS services and MCP
- **Storage**: DynamoDB for summary metrics + S3 for full event data (attendees, enrichment, activities, emails)
- **SFDC Access**: All Salesforce operations via `aws-sentral-mcp` MCP server (search contacts, fetch accounts, create activities)
- **LLM**: Amazon Bedrock (Claude Sonnet) for trip report and MERF generation
- **Email**: `aws-outlook-mcp` for HTML emails (primary), with AppleScript (macOS) / PowerShell (Windows) fallback

---

## Quick Start

### Prerequisites

- **Node.js** (v18+)
- **aws-sentral-mcp** installed (`toolbox install aws-sentral-mcp`)
- **aws-outlook-mcp** installed (`aim mcp install aws-outlook-mcp`) — for HTML email drafts/sends
- **Midway authentication** (valid session for SFDC and Outlook access)
- **AWS profile** `prod-events-toolkit` configured with DynamoDB, S3, and Bedrock permissions
- **Microsoft Outlook** (fallback for email drafts if aws-outlook-mcp is unavailable)

### Run

```bash
# 1. Install dependencies (first time only)
cd webapp && npm install
cd webapp/frontend && npm install

# 2. Authenticate with Midway (required before starting the backend)
mwinit
# Re-run mwinit whenever SFDC/MCP calls start returning empty results

# 3. Set the AWS profile, then start the backend (Terminal 1)
cd webapp
export AWS_PROFILE=prod-events-toolkit   # MUST be set before running the backend
node dev-server.mjs
# Backend runs on http://localhost:3001

# 4. Start the frontend (Terminal 2)
cd webapp/frontend && npm run dev
# Opens on http://localhost:5173
```

The backend uses the `prod-events-toolkit` AWS profile. You must set it before
launching `dev-server.mjs` (either export it as shown above or inline it):
```bash
AWS_PROFILE=prod-events-toolkit node dev-server.mjs

# Override with a different profile if needed:
AWS_PROFILE=other-profile node dev-server.mjs
```

---

## Modes

### Pre-Event
Plan and manage events before they happen:
- Event setup (name, date, type, campaign, services)
- Checklist tracking (SFDC campaign, Zoom, Splash page, room booking, MERF)
- Registration management and outreach/reminder emails
- MERF generation via Bedrock

### Post-Event
Process event results after the event:
- Upload attendance CSV and SFDC opps export
- SFDC account enrichment (parallel, 5 concurrent lookups with retry)
- Opportunity matching and activity logging
- AM notification emails (save as drafts or send directly)
- Trip report generation with charts and XWiki output

---

## Post-Event Workflow (8-Step Wizard)

| Step | Name | Description |
|------|------|-------------|
| 1 | **Upload Files** | Upload attendance CSV and SFDC opps export CSV |
| 2 | **Event Configuration** | Edit event config (activity details, email settings) |
| 3 | **Filter & Classify** | Auto-filter internal (Amazon/AWS) and generic (gmail, etc.) emails |
| 4 | **SFDC Account Lookup** | Enrich attendees with SFDC account, AM, territory (5 parallel) |
| 5 | **Match Opportunities** | Match attendee accounts to opportunities from the opps CSV |
| 6 | **Create Activities** | Log tech activities on matched SFDC opportunities |
| 7 | **AM Email Drafts** | Generate, preview, save/send AM notification emails |
| 8 | **Trip Report** | Generate XWiki report via Bedrock with charts and analytics |

---

## Project Structure

```
ags-scale-events-toolkit/
├── README.md
├── .gitignore
└── webapp/
    ├── dev-server.mjs              # Backend: REST API, MCP bridge, Bedrock, email
    ├── dynamodb.mjs                # DynamoDB client (summary metrics)
    ├── graph-auth.mjs              # Microsoft Graph API OAuth2 (optional fallback)
    ├── package.json                # Backend dependencies
    └── frontend/
        ├── package.json            # Frontend dependencies
        ├── vite.config.ts          # Vite config with /api proxy
        ├── index.html
        └── src/
            ├── main.tsx            # Entry point
            ├── App.tsx             # Main app: mode select, wizards, auto-save
            ├── types.ts            # TypeScript interfaces
            ├── pages/
            │   └── ModeSelectPage.tsx    # Landing page: pre/post event selection
            ├── components/
            │   └── MetricCard.tsx        # Reusable metric display card
            ├── steps/
            │   ├── UploadStep.tsx        # Step 1: File upload & CSV parsing
            │   ├── ConfigStep.tsx        # Step 2: Event config editor
            │   ├── FilterStep.tsx        # Step 3: Email classification
            │   ├── EnrichStep.tsx        # Step 4: SFDC lookup (parallel + retry)
            │   ├── MatchOppsStep.tsx     # Step 5: Opportunity matching
            │   ├── CreateActivitiesStep.tsx  # Step 6: Activity creation
            │   ├── EmailDraftsStep.tsx   # Step 7: AM email drafts/send
            │   ├── ReportStep.tsx        # Step 8: Trip report + analytics
            │   ├── EventSetupStep.tsx    # Pre: Event setup
            │   ├── EventChecklistStep.tsx # Pre: Checklist
            │   ├── OutreachStep.tsx      # Pre: Outreach emails
            │   ├── ReminderEmailStep.tsx # Pre: Reminder emails
            │   ├── RoomBookingStep.tsx   # Pre: Room booking
            │   ├── MerfStep.tsx          # Pre: MERF generation
            │   └── PreEventStatusStep.tsx # Pre: Status dashboard
            ├── templates/
            │   ├── activityDescription.ts    # SFDC activity description template
            │   ├── emailBody.ts              # AM notification email templates
            │   ├── outreachEmailBody.ts      # Pre-event outreach template
            │   ├── reminderEmailBody.ts      # Pre-event reminder template
            │   └── tripReportPrompt.ts       # Bedrock prompt for trip reports
            └── utils/
                ├── api.ts                # API helper (POST to /api/*)
                ├── csvParser.ts          # CSV parsing with PapaParse
                ├── emailGenerator.ts     # AM email payload generation
                ├── eventId.ts            # Event ID generation from date+name
                ├── useTableState.ts      # Reusable table sort/filter/pagination
                └── xwikiRenderer.ts      # XWiki markup to HTML renderer
```

---

## API Endpoints (dev-server.mjs)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/enrich` | SFDC account lookup by email domain |
| POST | `/api/create-activities` | Create tech activities on SFDC opportunities |
| POST | `/api/create-drafts` | Save email drafts (HTML via aws-outlook-mcp, fallback to AppleScript) |
| POST | `/api/send-emails` | Send emails (HTML via aws-outlook-mcp, fallback to AppleScript) |
| POST | `/api/generate-report` | Generate trip report via Bedrock Claude |
| POST | `/api/generate-merf` | Generate MERF content via Bedrock Claude |
| POST | `/api/events/save-pre` | Save pre-event data to DynamoDB + S3 |
| POST | `/api/events/save-post` | Save post-event data to DynamoDB + S3 |
| POST | `/api/events/get` | Load event records from DynamoDB + S3 |
| POST | `/api/events/list` | List recent events |
| POST | `/api/events/delete` | Soft-delete an event |
| GET | `/api/health` | Health check |

---

## Data Persistence

### DynamoDB (`ags-scale-events` table)
Stores summary metrics for quick listing and dashboards:
- Event name, date, type
- Registrations, attendees, attendance rate
- Activities created, AM notifications sent
- ARR influenced (total, pipeline, launched)
- CSAT score, notable customers, division summary

### S3 (events data bucket)
Stores full event data arrays:
- Config, attendees, filtered/enriched data
- Match results, activity results
- Email payloads, sent/saved AM aliases
- Trip report text, report fields (CSAT, location, feedback)

Auto-save triggers on wizard step navigation, activity creation, and report field edits (debounced 2s).

---

## AWS IAM Setup

The `ags-scale-events-toolkit` IAM user requires:
- **DynamoDB**: PutItem, GetItem, Query, UpdateItem, DeleteItem on `ags-scale-events` table
- **S3**: GetObject, PutObject on the events data bucket
- **Bedrock**: InvokeModel on `anthropic.claude-sonnet-*` (all US regions for cross-region inference)

---

## Key Features

- **Parallel SFDC Enrichment**: 5 concurrent domain lookups with retry-failed support
- **Duplicate Activity Prevention**: Created opp IDs tracked in S3, skipped on re-run
- **Persistent State**: All data auto-saved to DynamoDB/S3, survives browser refresh and sessions
- **AM Email Management**: Track sent/saved status per AM, batch processing with progress
- **Trip Report Generation**: Bedrock-powered XWiki reports with pipeline charts, customer analysis
- **Pre/Post Event Linking**: Post-event auto-loads config from pre-event record
- **HTML Email via MCP**: `aws-outlook-mcp` creates HTML emails with clickable links, falling back to AppleScript (macOS) / PowerShell (Windows)

---

## MCP Tools

### aws-sentral-mcp (SFDC)

| Tool | Used In | Purpose |
|------|---------|---------|
| `search_contacts` | Enrich (Step 4) | Find SFDC account from email domain |
| `fetch_account_details` | Enrich (Step 4) | Get AM info and territory from account ID |
| `create_tech_activity` | Activities (Step 6) | Log tech activity on an opportunity |
| `search_campaigns` | Campaign Lookup | Find SFDC campaign ID by code |

### aws-outlook-mcp (Email)

| Tool | Used In | Purpose |
|------|---------|---------|
| `email_draft` | Drafts (Steps 3, 4, 7) | Create HTML email drafts in Outlook |
| `email_send` | Send (Steps 3, 4, 7) | Send HTML emails via Outlook |

Email fallback chain: aws-outlook-mcp → Microsoft Graph API → AppleScript/PowerShell

---

## Service Name Mapping

The backend maps friendly names to SUDS-valid enum values:
- `Amazon Bedrock` → `Amazon Bedrock (Machine Learning)`
- `Amazon Bedrock AgentCore` → `Amazon Bedrock AgentCore (Machine Learning)`
- `Kiro` → `Kiro (Developer Tools)`
- `Strands SDK` → `Strands SDK (Machine Learning)`

Unmapped services are filtered out to prevent SUDS validation errors.
