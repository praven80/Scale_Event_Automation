/**
 * Email body template for AM notification emails.
 *
 * Available placeholders:
 *   {recipient_name}    - AM's first name
 *   {sender_name}       - Email sender's name
 *   {sender_team}       - Email sender's team name
 *   {sender_title}      - Email sender's title
 *   {event_name}        - Name of the event
 *   {event_date}        - Date of the event
 *   {wiki_link}         - Wiki / event calendar link
 *   {campaign_code}     - SFDC campaign code
 *   {account_name}      - Account name(s), comma-separated
 *   {attendee_list}     - List of attendees ("- Name (email)")
 *   {opportunity_list}  - List of GenAI opportunities (alias: {opp_list})
 *   {kiro_credit_code}  - Kiro credit code block (injected at send/draft time; empty if disabled/excluded)
 *   {event_url}         - Event registration/landing page URL (maps to registration_url in config)
 *   {account_details}   - Legacy combined format (still supported)
 */

export const AM_EMAIL_SUBJECT_DEFAULT = `AWS Event Update: Your Customer Joined Our Agent AI Event - Phoenix`

export const AM_EMAIL_BODY_TEMPLATE = `Hi {recipient_name},

We recently hosted a session on {event_name} and a representative from Account: {account_name} attended on {event_date}.

Event link: {event_url}

Attendees:
{attendee_list}

GenAI opportunities associated with this account:
{opportunity_list}

{kiro_credit_code}

Additionally, please tag the campaign code {campaign_code} to the opportunities listed above. If no opportunities currently exist for this account, kindly create one in the CRM and associate it with the campaign code at the time of creation.

Please let us know if you need any further information. You can also refer to our event calendar here: https://w.amazon.com/bin/view/AGS_NAMER_AI

We look forward to having them join us again at upcoming events!

Best regards,
{sender_name}
{sender_title}
{sender_team}`
