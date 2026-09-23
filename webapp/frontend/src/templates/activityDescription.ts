/**
 * Template for SFDC tech activity description.
 *
 * Available placeholders:
 *   {campaign_code}    - SFDC campaign code
 *   {event_name}       - Name of the event
 *   {event_date}       - Date of the event
 *   {registration_url} - Registration page URL
 *   {attendee_list}    - Formatted list of attendees (one per line, "- Name (email)")
 *   {event_summary}    - Brief event summary
 */
export const ACTIVITY_DESCRIPTION_TEMPLATE = `Campaign Code: {campaign_code}
Event: Customer attended "{event_name}" on {event_date}
Registration URL: {registration_url}
Attendees from this account:
{attendee_list}
Event Summary: {event_summary}`
