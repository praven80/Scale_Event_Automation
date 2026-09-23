/**
 * Bedrock LLM prompt template for generating XWiki trip reports.
 *
 * Available placeholders:
 *   {event_name}, {event_date}, {format}, {location}, {services}
 *   {registration_url}, {campaign_code}
 *   {registrations}, {attendees}, {attendance_rate}
 *   {unique_companies}, {unique_accounts}, {accounts_with_opps}, {accounts_skipped}
 *   {activities_created}, {am_notifications}, {csat}
 *   {total_arr}, {pipeline_arr}, {launched_arr}
 *   {notable_customers}, {customer_feedback}, {action_items}
 *   {sender_name}, {sender_team}
 *   {division_table_rows}
 *   {photo_section}
 */
export const TRIP_REPORT_PROMPT = `You are an expert technical writer at AWS. Generate a polished XWiki-formatted trip report for an AWS event.

Use the exact data below — do not fabricate any numbers. Output ONLY the XWiki markup, no explanation or markdown fences.

EVENT DATA:
- Event Name: {event_name}
- Event Date: {event_date}
- Format: {format}
- Location: {location}
- Services: {services}
- Registration URL: {registration_url}
- Campaign Code: {campaign_code}
- Total Registrations: {registrations}
- Total Attendees (Checked-in): {attendees}
- Attendance Rate: {attendance_rate}
- Unique Companies: {unique_companies}
- SFDC Accounts Matched: {unique_accounts}
- Accounts with Opps: {accounts_with_opps}
- Accounts Skipped (No Opps): {accounts_skipped}
- Activities Created: {activities_created}
- AM Notifications Sent: {am_notifications}
- CSAT Score: {csat} / 5.0
- Total ARR Influenced: {total_arr}
- Pipeline ARR: {pipeline_arr}
- Launched ARR: {launched_arr}
- Notable Customers: {notable_customers}
- Customer Feedback: {customer_feedback}
- Additional Action Items: {action_items}
- Sender Name: {sender_name}
- Sender Team: {sender_team}

DIVISION BREAKDOWN:
|=Division|=Accounts|=Pipeline ARR|=Launched ARR|=Total ARR
{division_table_rows}

REQUIRED STRUCTURE (follow this exactly):

1. A {{html}} styled hero banner with:
   - Dark gradient background (linear-gradient #0f1b2d to #1a3a5c to #232f3e)
   - Event name as h1 in white
   - Services line at 16px, 0.85 opacity
   - Format and date line at 14px, 0.7 opacity
   - Stat cards in a flex row with rgba(255,255,255,0.12) background, each showing:
     - Registrations, Attendees, Companies, Activities Logged, ARR Influenced, CSAT, AM Notifications
     - Numbers in 26px bold #ff9900, labels in 11px uppercase
   Close with {{/html}}

2. An executive summary paragraph mentioning registrations, attendees, companies, accounts with opps, total ARR ($X.XM pipeline, $X.XM launched), and CSAT score

3. = Event Details = section with a wiki table (styled headers: background-color:#0f1b2d;color:#ffffff) containing:
   Format, Date, Location, Registration Page (as [[Link>>url]]), Target Services, Registrations, Event Attendance (with attendance rate %), Unique Companies, SFDC Campaign, SFDC Campaign Influence (total ARR), Event CSAT, Notable Customers

4. = Pipeline Analysis = section with:
   - Narrative about account coverage and AM outreach
   - {{html}} block with two inline SVG pie charts side by side in flex layout:
     a) Account Coverage pie (accounts with opps vs without opps)
     b) ARR Breakdown pie (pipeline vs launched)
   - Close with {{/html}}

5. = Customer and Revenue Analysis = section with:
   - Narrative about ARR influenced, number of opportunities, division spread
   - {{html}} block with horizontal bar chart SVG showing ARR by Division (sorted descending)
   - Close with {{/html}}
   - Wiki table with Division breakdown (styled headers), including a bold Total row at the bottom

6. = Customer Feedback = section (if feedback provided) with:
   - {{html}} styled blockquotes with left border #ff9900, italic text, attribution

7. = Action Items = section (MUST ALWAYS INCLUDE):
   - {{html}} styled badges (green "Completed" pills) for:
     - "{activities_created} SFDC Activities Logged" (green badge)
     - "{am_notifications} AM Notification Emails Sent" (green badge)
   - If additional action items provided: {action_items}
   - Close with {{/html}}

8. = Event Photos = section (MUST ALWAYS INCLUDE):
   {photo_section}

9. = Special Thanks = section (MUST ALWAYS INCLUDE):
   - Thank {sender_name} from {sender_team} for organizing and delivering the event
   - Keep it brief but appreciative

CRITICAL: Sections 7, 8, and 9 are MANDATORY — you must include ALL of them in the output even if some data is minimal.

IMPORTANT STYLE RULES:
- All {{html}} blocks must close with {{/html}}
- Use XWiki syntax outside HTML blocks: = for h1 headers, |= for table headers
- Table header style: (% style="background-color:#0f1b2d;color:#ffffff;padding:8px;" %)
- SVG charts should use viewBox for responsive sizing, #ff9900 as primary color, #1a73e8 as secondary
- Format all dollar amounts with commas and $ prefix
- Keep the tone professional but engaging, suitable for an internal AWS wiki`
