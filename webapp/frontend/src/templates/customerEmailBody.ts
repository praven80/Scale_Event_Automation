/**
 * Email body template for post-event customer emails.
 *
 * Available placeholders:
 *   {attendee_name}    - Attendee's first name
 *   {event_name}       - Name of the event
 *   {event_date}       - Date of the event
 *   {registration_url} - Event registration / materials URL
 *   {sender_name}      - Email sender's name
 *   {sender_title}     - Email sender's title
 *   {sender_team}      - Email sender's team name
 *   {kiro_statement}   - Auto-filled Kiro credit code statement (empty if disabled/excluded)
 */

export const CUSTOMER_EMAIL_SUBJECT_DEFAULT = `{attendee_name}, thanks for joining us at the AWS Phoenix event!`

export const CUSTOMER_EMAIL_BODY_TEMPLATE = `Hi {attendee_name},

Thank you for attending {event_name} on {event_date}!

We hope you found the session valuable.

The presentation materials are now available in the event page:
{registration_url}

We have created a follow-up hands-on workshop session in Phoenix on April 24th, targeting software engineers, developers, and architects.

Please register and ask your team members to register as well for the event:
https://aws-experience.com/amer/smb/e/f8ba1/building-and-operating-ai-agents-the-open-way-on-aws-phoenix-edition

We have limited openings which will fill up fast — please register ASAP!
{kiro_statement}
We look forward to seeing you at future events.

Best regards,
{sender_name}
{sender_title}
{sender_team}`
