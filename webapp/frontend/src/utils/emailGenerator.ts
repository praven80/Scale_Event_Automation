import { EnrichedAttendee, ActivityPlan, EventConfig, EmailPayload } from '../types'
import { AM_EMAIL_BODY_TEMPLATE } from '../templates/emailBody'

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}

/** Build individual placeholder values for a given AM's accounts.
 *  If `excludedAccountIds` contains an account's ID, that account's opp section
 *  is suppressed (attendees + account name are still included). */
function buildAccountPlaceholders(
  accounts: { id: string; name: string; attendees: EnrichedAttendee[]; opps: ActivityPlan[] }[],
  excludedAccountIds: Set<string>
): {
  account_name: string
  attendee_list: string
  opportunity_list: string
  account_details: string   // legacy combined format
} {
  const multiAccount = accounts.length > 1

  const attendeeSections: string[] = []
  const oppSections: string[] = []
  const combinedSections: string[] = []

  for (const acct of accounts) {
    const attList = acct.attendees.map(a => `- ${a.Visitor} (${a.Email})`).join('\n')
    const isExcluded = excludedAccountIds.has(acct.id)
    const oppLines = isExcluded
      ? '(Opportunity details intentionally omitted for this account.)'
      : (acct.opps.length > 0
          ? acct.opps.map(o => `• ${o['Opp Name']} (${o['Opp ID']})`).join('\n')
          : 'None')

    if (multiAccount) {
      attendeeSections.push(`**${acct.name}**\n${attList}`)
      oppSections.push(`**${acct.name}**\n${oppLines}`)
    } else {
      attendeeSections.push(attList)
      oppSections.push(oppLines)
    }

    // Legacy combined format
    let section = multiAccount ? `**${acct.name}**\nAttendees:\n${attList}` : attList
    if (isExcluded) {
      section += `\n\n(Opportunity details intentionally omitted for this account.)`
    } else if (acct.opps.length > 0) {
      section += `\n\nGenAI Opportunities:\n${acct.opps.map(o => `• ${o['Opp Name']} (${o['Opp ID']})`).join('\n')}`
    }
    combinedSections.push(section)
  }

  // Plain comma-separated names for subject line / intro sentence
  const accountNamesPlain = accounts.map(a => a.name).join(', ')

  return {
    account_name: accountNamesPlain,
    attendee_list: attendeeSections.join('\n\n'),
    opportunity_list: oppSections.join('\n\n'),
    account_details: combinedSections.join('\n\n'),
  }
}

export function generateEmailPayloads(
  enriched: EnrichedAttendee[],
  plan: ActivityPlan[],
  config: EventConfig,
  bodyTemplate?: string,
  subjectOverride?: string,
  excludedAccountIds: Set<string> = new Set()
): EmailPayload[] {
  const template = bodyTemplate || AM_EMAIL_BODY_TEMPLATE

  // Group attendees by AM
  const amMap = new Map<string, { am_name: string; am_email: string; accounts: Map<string, { id: string; name: string; attendees: EnrichedAttendee[]; opps: ActivityPlan[] }> }>()

  for (const att of enriched) {
    if (att.Status !== 'Matched' || att['AM Alias'] === 'aws-ua' || att['AM Alias'] === 'Not Found' || att['AM Alias'].startsWith('001')) continue
    const alias = att['AM Alias']
    if (!amMap.has(alias)) {
      amMap.set(alias, { am_name: att['AM Name'], am_email: att['AM Email'], accounts: new Map() })
    }
    const am = amMap.get(alias)!
    const aid = att['Account ID']
    if (!am.accounts.has(aid)) {
      am.accounts.set(aid, { id: aid, name: att['SFDC Account Name'], attendees: [], opps: [] })
    }
    am.accounts.get(aid)!.attendees.push(att)
  }

  // Map opps to accounts
  const oppsByAccount = new Map<string, ActivityPlan[]>()
  const seenOpps = new Set<string>()
  for (const p of plan) {
    if (seenOpps.has(p['Opp ID'])) continue
    seenOpps.add(p['Opp ID'])
    if (!oppsByAccount.has(p['Account ID'])) oppsByAccount.set(p['Account ID'], [])
    oppsByAccount.get(p['Account ID'])!.push(p)
  }

  for (const [, am] of amMap) {
    for (const [aid, acct] of am.accounts) {
      acct.opps = oppsByAccount.get(aid) || []
    }
  }

  // Build payloads
  const subjectTemplate = subjectOverride || config.am_email_subject
  const payloads: EmailPayload[] = []
  for (const [alias, am] of amMap) {
    const accounts = Array.from(am.accounts.values())
    const placeholders = buildAccountPlaceholders(accounts, excludedAccountIds)

    const templateVars = {
      recipient_name: am.am_name.split(' ')[0] || alias,
      sender_name: config.am_email_sender_name,
      sender_team: config.am_email_sender_team,
      sender_title: config.am_email_sender_title,
      event_name: config.event_name,
      event_date: config.event_date,
      campaign_code: config.campaign_code,
      wiki_link: config.am_email_wiki_link,
      event_url: config.registration_url || '',
      account_name: placeholders.account_name,
      attendee_list: placeholders.attendee_list,
      opportunity_list: placeholders.opportunity_list,
      opp_list: placeholders.opportunity_list,
      account_details: placeholders.account_details,
    }

    // {kiro_credit_code} is left unresolved — injected at send/draft time
    const bodyRaw = fillTemplate(template, templateVars)
    const body = bodyRaw.replace(/\n\n\n+/g, '\n\n').trim()
    const resolvedSubject = fillTemplate(subjectTemplate, {
      ...templateVars,
      kiro_credit_code: '',
    })

    const amDomains = [...new Set(
      Array.from(am.accounts.values()).flatMap(a => a.attendees.map(att => att.Domain)).filter(Boolean)
    )]

    payloads.push({
      am_alias: alias,
      am_name: am.am_name,
      am_email: am.am_email,
      subject: resolvedSubject,
      body,
      account_count: accounts.length,
      attendee_count: accounts.reduce((s, a) => s + a.attendees.length, 0),
      opp_count: accounts.reduce((s, a) => s + (excludedAccountIds.has(a.id) ? 0 : a.opps.length), 0),
      am_domains: amDomains,
      account_names: accounts.map(a => a.name),
    })
  }

  return payloads.sort((a, b) => a.am_name.localeCompare(b.am_name))
}
