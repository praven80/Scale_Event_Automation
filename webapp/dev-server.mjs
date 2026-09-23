#!/usr/bin/env node
/**
 * Local dev server that bridges REST API → aws-sentral-mcp via stdio.
 * Runs the MCP server locally with Midway auth (no AgentCore/SUDS_Cognito needed).
 *
 * Usage:
 *   node dev-server.mjs
 *
 * The frontend Vite dev server proxies /api/* here (port 3001).
 */
import { spawn, execFile } from 'child_process'
import { createServer } from 'http'
import { platform } from 'os'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { fromIni } from '@aws-sdk/credential-provider-ini'
import { putEventRecord, getEventRecords, listRecentEvents, getMonthlyAggregate, softDeleteEvent } from './dynamodb.mjs'

import { listExclusions, addExclusion, removeExclusion, getExclusionSet, invalidateCache as invalidateExcludeCache } from './exclude-list.mjs'

import {
  listAccountExclusions,
  addAccountExclusion,
  removeAccountExclusion,
  bulkAddAccountExclusions,
  getAccountExclusionSet,
  invalidateAccountExclusionCache,
} from './account-exclusions.mjs'
import { getGraphStatus, startDeviceCodeFlow, pollForToken, getAccessToken, createDraftGraph, sendEmailGraph, clearGraphToken } from './graph-auth.mjs'
import { claimCode, claimSpecificCode, getAllAvailableCodes, bulkUploadCodes, getCodeStats, resetAllCodes } from './kiro-codes.mjs'
const PORT = 3001

// --- S3 client for large event data ---
const S3_BUCKET = process.env.S3_EVENTS_BUCKET || '231066938074-us-east-1-ags-scale-events-data'
const S3_REGION = 'us-east-1'
const S3_PROFILE = process.env.AWS_PROFILE || 'prod-events-toolkit'

let s3Client = null
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: S3_REGION,
      credentials: fromIni({ profile: S3_PROFILE }),
    })
    console.log(`[s3] Using profile: ${S3_PROFILE}, region: ${S3_REGION}, bucket: ${S3_BUCKET}`)
  }
  return s3Client
}

async function uploadEventData(eventId, type, data) {
  const key = `events/${eventId}/${type}-data.json`
  const client = getS3Client()
  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }))
  console.log(`[s3] Uploaded ${key} (${JSON.stringify(data).length} bytes)`)
  return key
}

async function downloadEventData(s3Key) {
  const client = getS3Client()
  try {
    const resp = await client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    }))
    const body = await resp.Body.transformToString()
    return JSON.parse(body)
  } catch (err) {
    if (err.name === 'NoSuchKey') return null
    throw err
  }
}

// --- MCP stdio client ---
class McpStdioClient {
  constructor(command, args = [], opts = {}) {
    this.name = opts.name || command
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
    this.ready = false

    // Request queue: serialize MCP requests to avoid overloading the SFDC connection.
    // Concurrent calls cause each other to timeout. Sequential is more reliable.
    this._queue = []
    this._inflight = 0
    this._maxConcurrency = opts.maxConcurrency || 1

    console.log(`[${this.name}] Spawning: ${command} ${args.join(' ')}`)
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...(opts.env || {}) },
    })

    this.child.stdout.on('data', (data) => {
      this.buffer += data.toString()
      this._processLines()
    })

    this.child.on('error', (err) => {
      console.error(`[${this.name}] Process error: ${err.message}`)
      if (!opts.optional) process.exit(1)
    })

    this.child.on('exit', (code) => {
      console.error(`[${this.name}] Process exited with code ${code}`)
      this.ready = false
      if (!opts.optional) process.exit(1)
    })
  }

  _processLines() {
    while (true) {
      const newlineIdx = this.buffer.indexOf('\n')
      if (newlineIdx === -1) break

      const line = this.buffer.substring(0, newlineIdx).trim()
      this.buffer = this.buffer.substring(newlineIdx + 1)

      if (!line) continue

      try {
        const msg = JSON.parse(line)
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id).resolve(msg)
          this.pending.delete(msg.id)
        }
      } catch (e) {
        // Not JSON — might be log output, ignore
      }
    }
  }

  _sendRaw(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timeout)
          resolve(msg)
        },
      })

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      this.child.stdin.write(msg + '\n')
    })
  }

  _send(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      this._queue.push({ method, params, timeoutMs, resolve, reject })
      this._drainQueue()
    })
  }

  _drainQueue() {
    while (this._queue.length > 0 && this._inflight < this._maxConcurrency) {
      const { method, params, timeoutMs, resolve, reject } = this._queue.shift()
      this._inflight++
      this._sendRaw(method, params, timeoutMs)
        .then(resolve, reject)
        .finally(() => {
          this._inflight--
          this._drainQueue()
        })
    }
  }

  _notify(method, params = {}) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params })
    this.child.stdin.write(msg + '\n')
  }

  async initialize({ warmup = false } = {}) {
    console.log(`[${this.name}] Initializing MCP session...`)
    const resp = await this._sendRaw('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'post-event-toolkit-dev', version: '1.0' },
    })
    this._notify('notifications/initialized')
    this.ready = true
    console.log(`[${this.name}] Initialized. Server: ${resp.result?.serverInfo?.name} v${resp.result?.serverInfo?.version}`)

    if (warmup) {
      // Warmup: the first SFDC call after MCP init always times out (cold start).
      // Fire a throwaway search to establish the SFDC connection before real work.
      console.log(`[${this.name}] Warming up SFDC connection...`)
      try {
        await this.callTool('search_contacts', { queryTerm: 'warmup-probe.example', limit: 1 })
        console.log(`[${this.name}] Warmup complete`)
      } catch (err) {
        console.log(`[${this.name}] Warmup call failed (${err.message}) — retrying...`)
        try {
          await this.callTool('search_contacts', { queryTerm: 'warmup-probe.example', limit: 1 })
          console.log(`[${this.name}] Warmup complete (retry)`)
        } catch {
          console.log(`[${this.name}] Warmup retry also failed — proceeding anyway`)
        }
      }
    }

    return resp.result
  }

  async callTool(name, args, timeoutMs = 60000) {
    if (!this.ready) throw new Error('MCP client not initialized')
    const resp = await this._send('tools/call', { name, arguments: args }, timeoutMs)
    if (resp.error) {
      throw new Error(`MCP error ${resp.error.code}: ${resp.error.message}`)
    }
    const content = resp.result?.content || []
    for (const item of content) {
      if (item.type === 'text') {
        try {
          return JSON.parse(item.text)
        } catch {
          return { raw: item.text }
        }
      }
    }
    return resp.result
  }

  close() {
    this.child.kill()
  }
}

// --- Parse tool result helpers ---

function parseContactResult(result) {
  const data = result?.data || result
  const records = data?.resultRecords || data?.nodes || []
  return records
}

// --- API Handlers ---

// Cache resolved AM user names by alias so we only hit search_users once per unique AM per process.
// Prevents N×domains extra MCP calls when multiple attendees share the same AM.
const userCache = new Map()   // alias -> { name, email }

async function resolveAmUser(mcp, alias) {
  if (!alias || alias === 'Not Found') return { name: 'Not Found', email: '', id: '' }
  if (userCache.has(alias)) return userCache.get(alias)
  try {
    const r = await mcp.callTool('search_users', { alias }, 20000)
    const u = r?.data?.users?.[0]
    const entry = u
      ? { name: u.name || alias, email: u.email || `${alias}@amazon.com`, id: u.id || '' }
      : { name: alias, email: `${alias}@amazon.com`, id: '' }
    userCache.set(alias, entry)
    return entry
  } catch (err) {
    console.log(`[enrich] resolveAmUser(${alias}) failed: ${err.message} — falling back to alias`)
    const entry = { name: alias, email: `${alias}@amazon.com`, id: '' }
    userCache.set(alias, entry)
    return entry
  }
}

// Derive a coarse "division" label from a Sales Hierarchy territory string.
// Format is roughly: NAMED-<BU>-<GEO>-<COUNTRY>-<DIVISION>-<...>
// e.g. "NAMED-AGS-NAMER-UNITED STATES-RCG STO-CPG-A-04" -> "RCG STO"
function deriveDivisionFromTerritory(territory) {
  if (!territory || typeof territory !== 'string') return ''
  const parts = territory.split('-').map(s => s.trim())
  // Index 0=NAMED, 1=BU(AGS), 2=GEO(NAMER), 3=COUNTRY(UNITED STATES), 4=DIVISION
  if (parts.length >= 5) return parts[4]
  return ''
}

async function enrichSingleDomain(mcp, domain) {
  const t0 = Date.now()
  const NOT_FOUND = {
    domain,
    account_name: 'Not Found',
    account_id: '',
    am_name: 'Not Found',
    am_alias: 'Not Found',
    am_email: '',
    territory: 'Not Found',
    confidence: 'NONE',
    candidates: [],
  }

  // Domain → company-name token. We strip the TLD because SFDC's account search ranks
  // company names higher than full domain strings.
  const company = (domain || '').split('.')[0].trim()
  if (!company) return NOT_FOUND

  // Helper: normalize an SFDC account.website value to a bare domain string for comparison.
  // Strips protocol, www., paths, query strings.
  const normalizeWebsite = (w) => {
    if (!w) return ''
    return String(w)
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0]
  }
  const targetDomain = (domain || '').toLowerCase().trim()
  // Confidence: HIGH if the account's website matches the email domain (exact or
  // subdomain in either direction). LOW for any other algorithmic match.
  const websiteMatchesTarget = (siteVal) => {
    const w = normalizeWebsite(siteVal)
    if (!w || !targetDomain) return false
    if (w === targetDomain) return true
    if (w.endsWith('.' + targetDomain)) return true
    if (targetDomain.endsWith('.' + w)) return true
    return false
  }

  // Step 1: search_accounts(company, US billing). This is more precise than search_contacts
  // because we get the actual account record (with its owner/AM) rather than following a
  // contact that may be assigned to the wrong regional/parent account.
  let acctResult
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[enrich] ${domain} — search_accounts company="${company}" US (attempt ${attempt})...`)
      const t1 = Date.now()
      acctResult = await mcp.callTool('search_accounts', {
        queryTerm: company,
        condition: { field: 'billingCountry', operator: 'EXACT_MATCH', value: 'US' },
        limit: 10,
      }, 60000)
      console.log(`[enrich] ${domain} — search_accounts took ${Date.now() - t1}ms`)
      break
    } catch (err) {
      console.error(`[enrich] ${domain} — search_accounts attempt ${attempt} ERROR after ${Date.now() - t0}ms: ${err.message}`)
      if (attempt === 3) {
        // fall through to contact-based fallback
        acctResult = null
      }
    }
  }

  // Pick the best US account by ranking: exact website match > highest T-shirt size > first.
  // (Ranking is unchanged from the prior behavior to keep results stable; we only
  // additionally compute confidence and surface alternatives.)
  const accountCandidates = (acctResult?.data?.resultRecords) || (acctResult?.resultRecords) || []
  const tShirtRank = { 'XXL': 6, 'XL': 5, 'L': 4, 'M': 3, 'S': 2, 'XS': 1 }
  const score = (a) => {
    let s = 0
    if (websiteMatchesTarget(a?.website)) s += 1000
    s += (tShirtRank[(a?.awsci_customer?.customerRevenue?.tShirtSize) || ''] || 0)
    return s
  }
  const ranked = [...accountCandidates].sort((a, b) => score(b) - score(a))
  const best = ranked[0]

  let accountId = best?.id || ''
  let accountName = best?.name || ''

  // Fallback: if no US account match, try search_contacts (legacy behavior) so we still
  // catch international-only accounts that wouldn't show up in the US filter.
  let usedContactFallback = false
  let contactRanked = []
  if (!accountId) {
    console.log(`[enrich] ${domain} — no US account match, falling back to search_contacts`)
    let contactResult
    try {
      // Bump from 1 → 5 so we can surface alternatives.
      contactResult = await mcp.callTool('search_contacts', { queryTerm: domain, limit: 5 }, 60000)
    } catch (err) {
      return { ...NOT_FOUND, error: err.message }
    }
    const records = parseContactResult(contactResult)
    if (!records.length) {
      console.log(`[enrich] ${domain} — no contacts found (${Date.now() - t0}ms total)`)
      return NOT_FOUND
    }
    usedContactFallback = true
    // Prefer contacts whose account's website matches the domain.
    contactRanked = [...records].sort((a, b) =>
      (websiteMatchesTarget(b?.account?.website) ? 1 : 0) -
      (websiteMatchesTarget(a?.account?.website) ? 1 : 0)
    )
    const top = contactRanked[0]
    accountId = top.accountId || ''
    accountName = top.account?.name || ''
    if (!accountId) {
      return { ...NOT_FOUND, account_name: accountName || 'Not Found' }
    }
  }

  console.log(`[enrich] ${domain} — picked account ${accountName} (${accountId})`)

  // Build the alternatives list from the same search results we already have.
  // We resolve AM details lazily later, so for now we only carry AM alias from
  // the search results (which include owner.alias). Detailed AM info is filled
  // in by the user when they pick an alternative (via the same fetch path).
  const buildCandidate = (a, src) => ({
    account_id: a?.id || '',
    account_name: a?.name || '',
    website: a?.website || '',
    billing_country: a?.billingCountry || '',
    t_shirt_size: a?.awsci_customer?.customerRevenue?.tShirtSize || '',
    am_alias: a?.owner?.alias || '',
    am_name: a?.owner?.name || a?.owner?.alias || '',
    territory: a?.territory_Lookup__r?.name || '',
    source: src,
  })
  const candidates = []
  const seenCandidateIds = new Set([accountId])
  // Up to 4 alternatives: top-ranked from account search, excluding the chosen one
  for (const a of ranked) {
    if (!a?.id || seenCandidateIds.has(a.id)) continue
    seenCandidateIds.add(a.id)
    candidates.push(buildCandidate(a, 'account-search'))
    if (candidates.length >= 4) break
  }
  // If we used contact fallback, also surface alternative contacts' accounts
  if (usedContactFallback) {
    for (const c of contactRanked) {
      if (!c?.accountId || seenCandidateIds.has(c.accountId)) continue
      seenCandidateIds.add(c.accountId)
      const accObj = c.account || {}
      candidates.push(buildCandidate({
        id: c.accountId,
        name: accObj.name,
        website: accObj.website,
        billingCountry: accObj.billingCountry,
        owner: c.owner || accObj.owner,
        territory_Lookup__r: accObj.territory_Lookup__r,
      }, 'contact-search'))
      if (candidates.length >= 4) break
    }
  }

  const confidence = websiteMatchesTarget(best?.website) ? 'HIGH' : 'LOW'

  // Step 2: fetch_account_details — retry up to 2 times on timeout
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[enrich] ${domain} — fetching account ${accountId} (attempt ${attempt})...`)
      const t1 = Date.now()
      const acctDetails = await mcp.callTool('fetch_account_details', { accountId }, 60000)
      console.log(`[enrich] ${domain} — fetch_account_details took ${Date.now() - t1}ms (attempt ${attempt}, ${Date.now() - t0}ms total)`)
      const acctData = acctDetails?.data || acctDetails || {}
      const amAlias = acctData.owner?.alias || 'Not Found'
      const amUser = await resolveAmUser(mcp, amAlias)
      const territory =
        acctData.territory ||
        acctData.territory_Lookup__r?.name ||
        acctData.territory_Name_Formula__c ||
        'Not Found'
      const region = acctData.geo_Text__c || ''
      const division = deriveDivisionFromTerritory(territory) || acctData.gtm_Sector_New__c || ''
      const amId = acctData.owner?.id || amUser.id || ''
      return {
        domain,
        account_name: acctData.name || accountName,
        account_id: accountId,
        am_name: amUser.name,
        am_alias: amAlias,
        am_email: amUser.email,
        am_id: amId,
        territory,
        region,
        division,
        confidence,
        candidates,
      }
    } catch (err) {
      console.error(`[enrich] ${domain} — fetch attempt ${attempt} ERROR after ${Date.now() - t0}ms: ${err.message}`)
      if (attempt === 3) {
        return {
          domain,
          account_name: accountName,
          account_id: accountId,
          am_name: 'Not Found',
          am_alias: 'Not Found',
          am_email: '',
          am_id: '',
          territory: 'Not Found',
          region: '',
          division: '',
          confidence,
          candidates,
          error: `fetch failed after 3 attempts: ${err.message}`,
        }
      }
    }
  }
}

async function handleEnrich(mcp, body) {
  const domains = body.domains || []
  const results = await Promise.all(domains.map(d => enrichSingleDomain(mcp, d)))
  return { results }
}

// Resolve a single account by ID — used when the user manually picks an alternative
// candidate from the LOW-confidence picker. Returns the same shape as a single
// enrich result so the frontend can drop it straight into the EnrichedAttendee row.
async function handleResolveAccount(mcp, body) {
  const accountId = (body.accountId || '').trim()
  const domain = body.domain || ''
  if (!accountId) {
    return { error: 'accountId is required' }
  }
  try {
    const acctDetails = await mcp.callTool('fetch_account_details', { accountId }, 60000)
    const acctData = acctDetails?.data || acctDetails || {}
    const amAlias = acctData.owner?.alias || 'Not Found'
    const amUser = await resolveAmUser(mcp, amAlias)
    const territory =
      acctData.territory ||
      acctData.territory_Lookup__r?.name ||
      acctData.territory_Name_Formula__c ||
      'Not Found'
    const region = acctData.geo_Text__c || ''
    const division = deriveDivisionFromTerritory(territory) || acctData.gtm_Sector_New__c || ''
    const amId = acctData.owner?.id || amUser.id || ''
    return {
      result: {
        domain,
        account_name: acctData.name || '',
        account_id: accountId,
        am_name: amUser.name,
        am_alias: amAlias,
        am_email: amUser.email,
        am_id: amId,
        territory,
        region,
        division,
        confidence: 'MANUAL', // user-confirmed override
      },
    }
  } catch (err) {
    return { error: `fetch_account_details failed: ${err.message}` }
  }
}

async function handleTagOppCampaigns(mcp, body) {
  const opportunities = body.opportunities || []
  const campaignId = body.campaignId || ''
  const results = []

  if (!campaignId) {
    return { results: opportunities.map(o => ({
      opp_id: o.opp_id || '',
      account_name: o.account_name || '',
      opp_name: o.opp_name || '',
      status: 'FAILED',
      error: 'Missing campaignId — set the campaign code on the event config first.',
    })) }
  }

  // Strategy: read → set new → restore original
  // 1. Read current campaignId (the "Primary Campaign Source")
  // 2. If already == target, skip (already in influence list)
  // 3. Set campaignId = target (this adds target to Campaign Influence list AND sets it as Primary)
  // 4. If original was non-empty AND != target, set campaignId = original (restores Primary, keeps target in influence list)
  // Net result: target is added to Campaign Influence, Primary Campaign Source is unchanged.

  const isSuccessShape = (result) => {
    const hasError = result?.error || result?.success === false || result?.data?.success === false || result?.status?.code === 'BadRequest'
    if (hasError) return false
    return Boolean(result?.success === true || result?.data?.success === true || result?.data?.id || result?.id || result?.status?.code === 'OK')
  }

  const errorMessage = (result) =>
    result?.status?.message || result?.error || result?.message || result?.raw || JSON.stringify(result)

  // Build update args with closeInfo/primaryCompetitor if needed for Launched/Closed Lost opps
  const buildUpdateArgs = (oppId, newCampaignId, metadata) => {
    const args = { id: oppId, campaignId: newCampaignId }
    if (metadata && (metadata.stageName === 'Launched' || metadata.stageName === 'Closed Lost')) {
      if (metadata.closeCategory && metadata.closeSubCategory) {
        args.closeInfo = {
          closeCategory: metadata.closeCategory,
          closeSubCategory: metadata.closeSubCategory,
          closeNotes: metadata.closeNotes || 'Campaign influence tagging via post-event toolkit',
        }
      }
      args.primaryCompetitor = metadata.primaryCompetitor || 'No Competitor'
      if (metadata.detailsWhenCompetitorIsOther) {
        args.detailsWhenCompetitorIsOther = metadata.detailsWhenCompetitorIsOther
      }
    }
    return args
  }

  for (const o of opportunities) {
    const oppId = o.opp_id || ''
    if (!oppId) {
      results.push({ opp_id: '', account_name: o.account_name || '', opp_name: o.opp_name || '', status: 'FAILED', error: 'Missing opp_id' })
      continue
    }

    try {
      // Step 1: Read current state
      console.log(`[tag-opp-campaign] opp=${oppId} — reading current state...`)
      const detailsResult = await mcp.callTool('get_opportunity_details', { opportunityId: oppId })
      const d = detailsResult?.data || detailsResult || {}
      const originalCampaignId = d.campaignId || ''
      const metadata = {
        stageName: d.stageName || '',
        closeCategory: d.close_Category__c || '',
        closeSubCategory: d.close_Sub_Category__c || '',
        closeNotes: d.close_Notes__c || '',
        primaryCompetitor: d.primary_Competitor__c || '',
        detailsWhenCompetitorIsOther: d.details_if_Other_or_No_Competition__c || '',
      }

      console.log(`[tag-opp-campaign] opp=${oppId} — original campaignId: ${originalCampaignId}, stage: ${metadata.stageName}`)

      // Step 2: If already has our campaign as Primary, skip (influence already exists)
      if (originalCampaignId === campaignId) {
        console.log(`[tag-opp-campaign] opp=${oppId} — already has target campaign, skipping`)
        results.push({
          opp_id: oppId,
          account_name: o.account_name || '',
          opp_name: o.opp_name || '',
          campaign_id: campaignId,
          original_campaign_id: originalCampaignId,
          status: 'SUCCESS',
          note: 'Already had target campaign',
        })
        continue
      }

      // Step 3: Set campaignId = target (adds to influence list)
      const setArgs = buildUpdateArgs(oppId, campaignId, metadata)
      console.log(`[tag-opp-campaign] opp=${oppId} — setting campaignId to ${campaignId}`)
      const setResult = await mcp.callTool('update_opportunity', setArgs)
      console.log(`[tag-opp-campaign] opp=${oppId} — set result:`, JSON.stringify(setResult))

      if (!isSuccessShape(setResult)) {
        results.push({
          opp_id: oppId,
          account_name: o.account_name || '',
          opp_name: o.opp_name || '',
          campaign_id: campaignId,
          original_campaign_id: originalCampaignId,
          status: 'FAILED',
          error: `Failed to set target campaign: ${errorMessage(setResult)}`,
        })
        continue
      }

      // Step 4: Restore original Primary Campaign Source (if it had one)
      if (originalCampaignId && originalCampaignId !== campaignId) {
        console.log(`[tag-opp-campaign] opp=${oppId} — restoring original campaignId ${originalCampaignId}`)
        const restoreArgs = buildUpdateArgs(oppId, originalCampaignId, metadata)
        const restoreResult = await mcp.callTool('update_opportunity', restoreArgs)
        console.log(`[tag-opp-campaign] opp=${oppId} — restore result:`, JSON.stringify(restoreResult))

        if (!isSuccessShape(restoreResult)) {
          results.push({
            opp_id: oppId,
            account_name: o.account_name || '',
            opp_name: o.opp_name || '',
            campaign_id: campaignId,
            original_campaign_id: originalCampaignId,
            status: 'PARTIAL',
            error: `Campaign added to influence but failed to restore original Primary: ${errorMessage(restoreResult)}`,
          })
          continue
        }
      }

      // Success: influence added, Primary restored (or was blank so target stays as Primary)
      results.push({
        opp_id: oppId,
        account_name: o.account_name || '',
        opp_name: o.opp_name || '',
        campaign_id: campaignId,
        original_campaign_id: originalCampaignId,
        status: 'SUCCESS',
        note: originalCampaignId ? `Primary restored to ${originalCampaignId}` : 'No prior Primary — target is now Primary',
      })
    } catch (err) {
      results.push({
        opp_id: oppId,
        account_name: o.account_name || '',
        opp_name: o.opp_name || '',
        status: 'FAILED',
        error: err.message,
      })
    }
  }

  return { results }
}

async function handleCreateActivities(mcp, body) {
  const activities = body.activities || []
  const config = body.config || {}
  const results = []

  const serviceMap = {
    'Amazon Bedrock': 'Amazon Bedrock (Machine Learning)',
    'Amazon Bedrock AgentCore': 'Amazon Bedrock AgentCore (Machine Learning)',
    'Kiro': 'Kiro (Developer Tools)',
  }
  const services = (config.services || []).map((s) => serviceMap[s]).filter(Boolean)
  console.log(`[create_tech_activity] mapped services:`, services, `(from ${JSON.stringify(config.services)})`)

  for (const act of activities) {
    try {
      const result = await mcp.callTool('create_tech_activity', {
        subject: config.subject || '',
        description: act.description || '',
        activityDate: config.activity_date || '',
        parentRecord: act.opp_id || '',
        saActivity: config.sa_activity || '',
        domains: config.domains || [],
        services,
        timeSpentHours: config.time_spent_hours || 0,
        isVirtual: false,
        status: 'Completed',
      })

      console.log(`[create_tech_activity] opp=${act.opp_id} result:`, JSON.stringify(result, null, 2))

      const taskId = result?.id || result?.taskId || result?.data?.id || ''
      const hasError = result?.error || result?.success === false || result?.data?.success === false
      const isSuccess = !hasError && (taskId || result?.success === true || result?.data?.success === true)

      results.push({
        opp_id: act.opp_id,
        account_name: act.account_name || '',
        opp_name: act.opp_name || '',
        task_id: taskId,
        status: isSuccess ? 'SUCCESS' : 'FAILED',
        error: !isSuccess ? (result?.error || result?.message || result?.raw || JSON.stringify(result)) : undefined,
      })
    } catch (err) {
      results.push({
        opp_id: act.opp_id || '',
        account_name: act.account_name || '',
        status: 'FAILED',
        error: err.message,
      })
    }
  }

  return { results }
}

// --- Plain text to HTML converter ---

function looksLikeHtml(text) {
  if (!text) return false
  // Trigger HTML mode if body contains common block-level tags
  return /<(p|ul|ol|li|h[1-6]|br|div|table|a\s|b>|i>|strong|em|span)/i.test(text)
}

function wrapHtml(body) {
  // If already a full HTML doc, leave it. Otherwise wrap in a basic shell.
  if (/<html[\s>]/i.test(body)) return body
  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 14px;">${body}</body></html>`
}

function textToHtml(text) {
  if (!text) return '<html><body></body></html>'
  // Escape HTML entities
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Convert URLs to clickable links
  const withLinks = esc.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1">$1</a>'
  )
  // Convert newlines to <br>
  const html = withLinks.replace(/\n/g, '<br>\n')
  return `<html><body style="font-family: Calibri, Arial, sans-serif; font-size: 14px;">${html}</body></html>`
}

// --- aws-outlook-mcp email functions ---

let outlookMcp = null

async function createDraftViaMcp(email) {
  if (!outlookMcp?.ready) throw new Error('outlook MCP not ready')
  const toList = email.to ? [email.to.trim()] : []
  const bccList = (email.bcc || []).filter(a => a && a.includes('@')).map(a => a.trim())
  const isHtml = email.html || looksLikeHtml(email.body || '')
  const htmlBody = isHtml ? wrapHtml(email.body || '') : textToHtml(email.body || '')
  const result = await outlookMcp.callTool('email_draft', {
    operation: 'create',
    to: toList,
    subject: email.subject || '',
    body: htmlBody,
    bcc: bccList,
  }, 30000)
  // The MCP tool wraps responses in <untrusted_content> markers — unwrap and parse
  let parsed = result
  if (result?.raw) {
    const m = result.raw.match(/<untrusted_content[^>]*>([\s\S]*?)<\/untrusted_content[^>]*>/)
    const jsonStr = m ? m[1].trim() : result.raw
    try { parsed = JSON.parse(jsonStr) } catch { /* keep raw */ }
  }
  console.log(`[outlook-mcp] email_draft parsed result for ${email.to}:`, JSON.stringify(parsed))
  if (parsed?.success === false || parsed?.error) {
    throw new Error(`email_draft tool failed: ${parsed?.error?.message || parsed?.error || JSON.stringify(parsed)}`)
  }
  return { status: 'OK', result }
}

async function sendViaMcp(email) {
  if (!outlookMcp?.ready) throw new Error('outlook MCP not ready')
  const toList = email.to ? [email.to.trim()] : []
  const bccList = (email.bcc || []).filter(a => a && a.includes('@')).map(a => a.trim())
  const isHtml = email.html || looksLikeHtml(email.body || '')
  const htmlBody = isHtml ? wrapHtml(email.body || '') : textToHtml(email.body || '')
  const result = await outlookMcp.callTool('email_send', {
    to: toList,
    subject: email.subject || '',
    body: htmlBody,
    bcc: bccList,
  }, 30000)
  return { status: 'OK', result }
}

// --- OS-Agnostic Email (Draft + Send) ---

function buildOutlookMacRecipientLines(email) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const lines = []
  if (email.to) {
    lines.push(`  make new to recipient at newMsg with properties {email address:{address:"${esc(email.to.trim())}"}}`)
  }
  const bccList = (email.bcc || []).filter(a => a && a.includes('@'))
  for (const addr of bccList) {
    lines.push(`  make new bcc recipient at newMsg with properties {email address:{address:"${esc(addr.trim())}"}}`)
  }
  return lines.join('\n')
}

function createOutlookDraftMac(email) {
  return new Promise((resolve, reject) => {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const subject = esc(email.subject || '')
    const body = esc(email.body || '')
    const recipientLines = buildOutlookMacRecipientLines(email)

    const script = `
tell application "Microsoft Outlook"
  set newMsg to make new outgoing message with properties {subject:"${subject}", plain text content:"${body}"}
${recipientLines}
end tell
return "OK"
`
    execFile('osascript', ['-e', script], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve({ status: 'OK' })
    })
  })
}

function sendOutlookEmailMac(email) {
  return new Promise((resolve, reject) => {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const subject = esc(email.subject || '')
    const body = esc(email.body || '')
    const recipientLines = buildOutlookMacRecipientLines(email)

    const script = `
tell application "Microsoft Outlook"
  set newMsg to make new outgoing message with properties {subject:"${subject}", plain text content:"${body}"}
${recipientLines}
  send newMsg
end tell
return "OK"
`
    execFile('osascript', ['-e', script], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve({ status: 'OK' })
    })
  })
}

function createOutlookDraftWindows(email) {
  return new Promise((resolve, reject) => {
    const esc = (s) => s.replace(/'/g, "''").replace(/`/g, '``')
    const bccList = email.bcc || []
    const bccStr = bccList.map(a => esc(a)).join(';')
    const script = `
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.Subject = '${esc(email.subject || '')}'
$mail.Body = '${esc(email.body || '')}'
${email.to ? `$mail.To = '${esc(email.to)}'` : ''}
${bccStr ? `$mail.BCC = '${bccStr}'` : ''}
$mail.Save()
Write-Output "OK"
`
    execFile('powershell', ['-Command', script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve({ status: 'OK' })
    })
  })
}

function sendOutlookEmailWindows(email) {
  return new Promise((resolve, reject) => {
    const esc = (s) => s.replace(/'/g, "''").replace(/`/g, '``')
    const bccList = email.bcc || []
    const bccStr = bccList.map(a => esc(a)).join(';')
    const script = `
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.Subject = '${esc(email.subject || '')}'
$mail.Body = '${esc(email.body || '')}'
${email.to ? `$mail.To = '${esc(email.to)}'` : ''}
${bccStr ? `$mail.BCC = '${bccStr}'` : ''}
$mail.Send()
Write-Output "OK"
`
    execFile('powershell', ['-Command', script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve({ status: 'OK' })
    })
  })
}

const IS_MAC = platform() === 'darwin'

async function createOutlookDraft(email) {
  // 1. Prefer aws-outlook-mcp (supports HTML, works with new Outlook)
  // Skip MCP for external recipients — MCP blocks non-Amazon addresses
  if (!email.skipMcp && outlookMcp?.ready) {
    try {
      const result = await createDraftViaMcp(email)
      console.log(`[outlook] method=mcp draft created for ${email.to}`)
      return result
    } catch (err) {
      console.warn(`[outlook-mcp] Draft failed, trying fallbacks: ${err.message}`)
    }
  }
  // 2. Try Graph API if authenticated
  const status = getGraphStatus()
  if (status.configured && status.authenticated) {
    try {
      const result = await createDraftGraph(email)
      console.log(`[outlook] method=graph draft created for ${email.to}`)
      return result
    } catch (err) {
      console.warn(`[graph] Draft failed, falling back to AppleScript: ${err.message}`)
    }
  }
  // 3. Fall back to AppleScript/PowerShell
  console.log(`[outlook] method=applescript draft for ${email.to}`)
  return IS_MAC ? createOutlookDraftMac(email) : createOutlookDraftWindows(email)
}

async function sendOutlookEmail(email) {
  // 1. Prefer aws-outlook-mcp
  if (outlookMcp?.ready) {
    try {
      return await sendViaMcp(email)
    } catch (err) {
      console.warn(`[outlook-mcp] Send failed, trying fallbacks: ${err.message}`)
    }
  }
  // 2. Try Graph API
  const status = getGraphStatus()
  if (status.configured && status.authenticated) {
    try {
      return await sendEmailGraph(email)
    } catch (err) {
      console.warn(`[graph] Send failed, falling back to AppleScript: ${err.message}`)
    }
  }
  // 3. Fall back to AppleScript/PowerShell
  return IS_MAC ? sendOutlookEmailMac(email) : sendOutlookEmailWindows(email)
}

async function handleCreateDrafts(body) {
  const emails = body.emails || []
  const excludeList = String(body.excludeList || '').toUpperCase()  // 'CUSTOMER' | 'AM' | ''
  const results = []

  // Filter out emails on the exclude list.
  const customerSet = await getExclusionSet('CUSTOMER')
  const amSet = await getExclusionSet('AM')
  const checkSets = excludeList === 'CUSTOMER' ? [customerSet]
                  : excludeList === 'AM' ? [amSet]
                  : [customerSet, amSet]
  const isExcluded = (addr) => {
    const norm = String(addr || '').trim().toLowerCase()
    return checkSets.some(s => s.has(norm))
  }

  for (const email of emails) {
    if (isExcluded(email.to)) {
      console.log(`[outlook] SKIPPED draft for ${email.to} — on exclude list`)
      results.push({ am_email: email.to, status: 'SKIPPED', reason: 'On exclude list' })
      continue
    }
    try {
      await createOutlookDraft(email)
      results.push({ am_email: email.to, status: 'SUCCESS' })
      console.log(`[outlook] Draft created for ${email.to}`)
    } catch (err) {
      results.push({ am_email: email.to, status: 'FAILED', error: err.message })
      console.error(`[outlook] Failed for ${email.to}: ${err.message}`)
    }
  }

  return {
    results,
    created: results.filter(r => r.status === 'SUCCESS').length,
    failed: results.filter(r => r.status === 'FAILED').length,
    skipped: results.filter(r => r.status === 'SKIPPED').length,
  }
}

async function handleSendEmails(body) {
  const emails = body.emails || []
  const excludeList = String(body.excludeList || '').toUpperCase()
  const results = []

  const customerSet = await getExclusionSet('CUSTOMER')
  const amSet = await getExclusionSet('AM')
  const checkSets = excludeList === 'CUSTOMER' ? [customerSet]
                  : excludeList === 'AM' ? [amSet]
                  : [customerSet, amSet]
  const isExcluded = (addr) => {
    const norm = String(addr || '').trim().toLowerCase()
    return checkSets.some(s => s.has(norm))
  }

  for (const email of emails) {
    if (isExcluded(email.to)) {
      console.log(`[outlook] SKIPPED send for ${email.to} — on exclude list`)
      results.push({ am_email: email.to, status: 'SKIPPED', reason: 'On exclude list' })
      continue
    }
    try {
      await sendOutlookEmail(email)
      results.push({ am_email: email.to, status: 'SUCCESS' })
      console.log(`[outlook] Email sent to ${email.to}`)
    } catch (err) {
      results.push({ am_email: email.to, status: 'FAILED', error: err.message })
      console.error(`[outlook] Send failed for ${email.to}: ${err.message}`)
    }
  }

  return {
    results,
    sent: results.filter(r => r.status === 'SUCCESS').length,
    failed: results.filter(r => r.status === 'FAILED').length,
    skipped: results.filter(r => r.status === 'SKIPPED').length,
  }
}

// --- Bedrock LLM for Trip Report ---

async function handleGenerateReport(body) {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const client = new BedrockRuntimeClient({ region: 'us-east-1', credentials: fromIni({ profile: S3_PROFILE }) })

  const prompt = body.prompt || ''
  console.log(`[bedrock] Generating trip report (prompt length: ${prompt.length})`)

  const command = new InvokeModelCommand({
    modelId: 'us.anthropic.claude-sonnet-4-6',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 32768,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const response = await client.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))
  const text = responseBody.content?.[0]?.text || ''
  console.log(`[bedrock] Report generated (${text.length} chars)`)
  return { report: text }
}

// --- MERF Generation via Bedrock ---

async function handleGenerateMerf(body) {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const client = new BedrockRuntimeClient({ region: 'us-east-1', credentials: fromIni({ profile: S3_PROFILE }) })

  const prompt = `You are an expert at writing Marketing Event Request Form (MERF) tickets for AWS internal events. Generate a complete MERF ticket based on these details:

Event Title: ${body.event_title || ''}
Event Date: ${body.event_date || ''}
Event Type: ${body.event_type || 'virtual'}
Venue: ${body.venue || 'N/A'}
Expected Attendees: ${body.expected_attendees || '50'}
Estimated Budget: ${body.budget || 'N/A'}
Campaign Code: ${body.campaign_code || ''}
Event Summary: ${body.event_summary || ''}
Business Justification: ${body.justification || ''}

Generate a professional MERF ticket with these sections:
1. Event Overview
2. Target Audience
3. Expected Outcomes & Success Metrics
4. Budget Breakdown (if in-person)
5. Logistics & Requirements
6. Business Justification

Keep it concise and professional. Use plain text formatting.`

  console.log(`[bedrock] Generating MERF content`)
  const command = new InvokeModelCommand({
    modelId: 'us.anthropic.claude-sonnet-4-6',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const response = await client.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))
  const text = responseBody.content?.[0]?.text || ''
  console.log(`[bedrock] MERF generated (${text.length} chars)`)
  return { merf_text: text }
}

// --- Campaign Lookup ---

async function handleLookupCampaign(mcp, body) {
  const campaignCode = body.campaignCode || ''
  if (!campaignCode) return { campaignId: '', error: 'No campaign code provided' }

  try {
    const result = await mcp.callTool('search_campaigns', { queryTerm: campaignCode, limit: 5 })
    const records = result?.data?.resultRecords || result?.resultRecords || result?.data?.nodes || []
    // Find exact match by campaign code/name
    const match = records.find(r => r.name === campaignCode) || records[0]
    if (match && match.id) {
      console.log(`[campaign-lookup] Found campaign: ${match.name} -> ${match.id}`)
      return { campaignId: match.id, campaignName: match.name || '' }
    }
    console.log(`[campaign-lookup] No campaign found for: ${campaignCode}`)
    return { campaignId: '', error: 'Campaign not found' }
  } catch (err) {
    console.error(`[campaign-lookup] Error: ${err.message}`)
    return { campaignId: '', error: err.message }
  }
}

// --- DynamoDB Event Handlers ---

async function handleSavePre(body) {
  const now = new Date().toISOString()
  const eventDate = body.eventDate || now.substring(0, 10)
  const yearMonth = eventDate.substring(0, 7)
  const item = {
    PK: `EVENT#${body.eventId}`,
    SK: `PRE#latest`,
    yearMonth,
    eventId: body.eventId,
    eventName: body.eventName || '',
    eventDate,
    eventType: body.eventType,
    campaignCode: body.campaignCode,
    registrationUrl: body.registrationUrl,
    eventSummary: body.eventSummary || '',
    saActivity: body.saActivity || '',
    timeSpentHours: body.timeSpentHours || 2,
    domains: body.domains || [],
    services: body.services || [],
    amEmailSenderName: body.amEmailSenderName || '',
    amEmailSenderTitle: body.amEmailSenderTitle || '',
    amEmailSenderTeam: body.amEmailSenderTeam || '',
    amEmailWikiLink: body.amEmailWikiLink || '',
    checklistStatus: body.checklistStatus,
    outreachEmailsSent: body.outreachEmailsSent || 0,
    reminderEmailsSent: body.reminderEmailsSent || 0,
    merfText: body.merfText || '',
    registrations: body.registrations || 0,
    zoomLink: body.zoomLink || '',
    splashPageUrl: body.splashPageUrl || '',
    slackChannel: body.slackChannel || '',
    primaryHost: body.primaryHost || '',
    supportingPeople: body.supportingPeople || [],
    venue: body.venue || '',
    roomLocation: body.roomLocation || '',
    roomNumber: body.roomNumber || '',
    merfTicketUrl: body.merfTicketUrl || '',
    campaignId: body.campaignId || '',
    outreachSubject: body.outreachSubject || '',
    outreachBody: body.outreachBody || '',
    reminderSubject: body.reminderSubject || '',
    reminderBody: body.reminderBody || '',
    createdAt: now,
    type: 'PRE',
  }
  return await putEventRecord(item)
}

async function handleSavePost(body) {
  const now = new Date().toISOString()
  const eventDate = body.eventDate || now.substring(0, 10)
  const yearMonth = eventDate.substring(0, 7)

  // Upload large data arrays to S3
  const s3Data = {
    config: body.config || null,
    attendeesData: body.attendeesData || [],
    filteredData: body.filteredData || { searchable: [], internal: [], generic: [] },
    enrichedData: body.enrichedData || [],
    matchResultsData: body.matchResultsData || { plan: [], skipped: [] },
    activityResultsData: body.activityResultsData || { created: 0, failed: 0, details: [] },
    emailPayloadsData: body.emailPayloadsData || [],
    sentAMAliases: body.sentAMAliases || [],
    savedAMAliases: body.savedAMAliases || [],
    createdOppIds: body.createdOppIds || [],
    tripReport: body.tripReport || '',
    reportFields: body.reportFields || {},
    amEmailSubjectOverride: body.amEmailSubjectOverride || '',
    amEmailBodyOverride: body.amEmailBodyOverride || '',
  }
  const s3Key = await uploadEventData(body.eventId, 'post', s3Data)

  // DynamoDB: only summary metrics + S3 reference
  const item = {
    PK: `EVENT#${body.eventId}`,
    SK: `POST#latest`,
    yearMonth,
    eventId: body.eventId,
    eventName: body.eventName || '',
    eventDate,
    s3DataKey: s3Key,
    registrations: body.registrations || 0,
    attendees: body.attendees || 0,
    attendanceRate: body.attendanceRate || 0,
    uniqueCompanies: body.uniqueCompanies || 0,
    accountsMatched: body.accountsMatched || 0,
    activitiesCreated: body.activitiesCreated || 0,
    amNotificationsSent: body.amNotificationsSent || 0,
    totalArrInfluenced: body.totalArrInfluenced || 0,
    pipelineArr: body.pipelineArr || 0,
    launchedArr: body.launchedArr || 0,
    divisionSummary: body.divisionSummary || [],
    noOppsByTerritory: body.noOppsByTerritory || [],
    notableCustomers: body.notableCustomers || [],
    primaryHost: body.primaryHost || '',
    csat: body.reportFields?.csat || '',
    services: body.services || [],
    createdAt: now,
    type: 'POST',
  }
  return await putEventRecord(item)
}

async function handleGetEvent(body) {
  const records = await getEventRecords(body.eventId)
  // If post record has S3 data, fetch and merge it
  if (records.post?.s3DataKey) {
    try {
      const s3Data = await downloadEventData(records.post.s3DataKey)
      if (s3Data) {
        records.post = { ...records.post, ...s3Data }
        console.log(`[s3] Loaded post-event data from ${records.post.s3DataKey}`)
      }
    } catch (err) {
      console.error(`[s3] Failed to load post-event data: ${err.message}`)
    }
  }
  return records
}

async function handleListEvents(body) {
  const events = await listRecentEvents(body.limit || 20)
  // Flatten for the frontend table, exclude soft-deleted
  const flat = []
  for (const e of events) {
    if (e.pre && !e.pre.isDeleted) flat.push({ ...e.pre, type: 'PRE', eventId: e.eventId, eventName: e.eventName, eventDate: e.eventDate })
    if (e.post && !e.post.isDeleted) flat.push({ ...e.post, type: 'POST', eventId: e.eventId, eventName: e.eventName, eventDate: e.eventDate })
  }
  return { events: flat }
}

async function handleDeleteEvent(body) {
  const sk = body.type === 'POST' ? 'POST#latest' : 'PRE#latest'
  return await softDeleteEvent(body.eventId, sk)
}

async function handleMonthlyReport(body) {
  return await getMonthlyAggregate(body.yearMonth)
}

// --- Kiro Credit Code Handlers ---

// Peek: read-only — returns available code assignments without writing to DynamoDB
async function handleKiroPeekBatch(body) {
  const { ams = [], excludeDomains = [] } = body
  const excludeSet = new Set(excludeDomains.map(d => d.toLowerCase().trim()))

  // Single read of all available codes; distribute in-memory (no writes)
  const available = await getAllAvailableCodes()
  const pool = [...available]
  const assignments = {}

  for (const am of ams) {
    const { alias, domains = [], accountCount = 1 } = am
    const count = Math.max(parseInt(accountCount) || 1, 1)

    const hasExcluded = domains.some(d => excludeSet.has(d.toLowerCase().trim()))
    if (hasExcluded) {
      assignments[alias] = []
      continue
    }

    const codes = []
    for (let i = 0; i < count; i++) {
      const code = pool.shift()
      if (code) {
        codes.push(code)
      } else {
        console.warn(`[kiro] Pool exhausted — no code for ${alias} slot ${i + 1}`)
        break
      }
    }
    console.log(`[kiro] Peeked ${codes.length} code(s) for ${alias}: ${codes.join(', ')}`)
    assignments[alias] = codes
  }

  return { assignments }
}

// Claim: write to DynamoDB — called only at send time
// Accepts preAssignments { alias: [code1, code2] } to claim specific pre-peeked codes,
// or falls back to claiming from the pool if no pre-assignment exists.
async function handleKiroClaimBatch(body) {
  const { ams = [], eventId = '', excludeDomains = [], preAssignments = {} } = body
  const excludeSet = new Set(excludeDomains.map(d => d.toLowerCase().trim()))
  const assignments = {}

  for (const am of ams) {
    const { alias, email, domains = [], accountCount = 1 } = am
    const count = Math.max(parseInt(accountCount) || 1, 1)

    const hasExcluded = domains.some(d => excludeSet.has(d.toLowerCase().trim()))
    if (hasExcluded) {
      console.log(`[kiro] Skipping codes for ${alias} — domain in exclude list`)
      assignments[alias] = []
      continue
    }

    const preCodes = preAssignments[alias] || []
    const codes = []

    if (preCodes.length > 0) {
      // Claim the specific pre-peeked codes
      for (const code of preCodes) {
        await claimSpecificCode(code, alias, email, eventId)
        console.log(`[kiro] Claimed pre-assigned code for ${alias}: ${code}`)
        codes.push(code)
      }
    } else {
      // No pre-assignment — claim from pool directly
      for (let i = 0; i < count; i++) {
        const code = await claimCode(alias, email, eventId, codes)
        if (code) {
          console.log(`[kiro] Claimed code slot ${i + 1}/${count} for ${alias}: ${code}`)
          codes.push(code)
        } else {
          console.warn(`[kiro] No available codes for ${alias} (slot ${i + 1})`)
          break
        }
      }
    }

    assignments[alias] = codes
  }

  return { assignments }
}

async function handleKiroUpload(body) {
  const codes = body.codes || []
  console.log(`[kiro] Uploading ${codes.length} credit codes`)
  const result = await bulkUploadCodes(codes)
  console.log(`[kiro] Upload done: ${result.uploaded} uploaded, ${result.skipped} skipped`)
  return result
}

async function handleKiroStats() {
  return await getCodeStats()
}

// --- HTTP Server ---

async function main() {
  const mcp = new McpStdioClient('aws-sentral-mcp', [], {
    name: 'sentral-mcp',
    env: { AWS_SENTRAL_MCP_IS_AGENTCORE: 'false' },
  })

  // Spawn aws-outlook-mcp for HTML email drafts/sends (optional — falls back to AppleScript)
  try {
    outlookMcp = new McpStdioClient('aws-outlook-mcp', [], {
      name: 'outlook-mcp',
      optional: true,
      maxConcurrency: 3,
      env: {
        OUTLOOK_MCP_ENABLE_WRITES: 'true',
        // Allow all common TLDs so external customer emails pass through MCP.
        // The check is domain.endsWith('.'+d), so 'com' matches any *.com address.
        OUTLOOK_MCP_ALLOWED_EMAIL_DOMAINS: [
          // Default Amazon domains
          'amazon.com','a2z.com','aboutamazon.com','twitch.tv','audible.com','goodreads.com',
          'amazon.co.uk','amazon.de','amazon.co.jp','amazon.fr','amazon.it','amazon.es',
          'amazon.ca','amazon.com.au','amazon.com.br','amazon.in','amazon.sg','amazon.nl',
          'amazon.sa','amazon.ae','amazon.eg','amazon.pl','amazon.se','amazon.com.mx',
          'amazon.com.tr','amazon.lu','aws.internal',
          // Common TLDs — covers virtually all external recipients
          'com','net','org','io','co','gov','edu','ai','app','dev','tech','biz','info',
          'us','uk','de','fr','ca','jp','au','in','sg','nl','br','mx','it','es',
        ].join(','),
      },
    })
  } catch (err) {
    console.warn(`[outlook-mcp] Failed to spawn: ${err.message} — will use AppleScript fallback`)
  }

  await new Promise((r) => setTimeout(r, 1000))

  // Initialize both MCP clients in parallel
  const initPromises = [mcp.initialize({ warmup: true })]
  if (outlookMcp) {
    initPromises.push(
      outlookMcp.initialize().then(() => {
        console.log('[outlook-mcp] Ready — emails will use HTML via MCP')
      }).catch(err => {
        console.warn(`[outlook-mcp] Init failed: ${err.message} — will use AppleScript fallback`)
        outlookMcp = null
      })
    )
  }
  await Promise.all(initPromises)

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Midway-Token')
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end('')
      return
    }

    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {}
        const url = req.url || ''

        if (url.includes('/enrich')) {
          console.log(`[api] POST /enrich — ${(data.domains || []).length} domains`)
          const result = await handleEnrich(mcp, data)
          const matched = result.results.filter((r) => r.account_id).length
          console.log(`[api] Enrich done: ${matched} matched, ${result.results.length - matched} not found`)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/resolve-account')) {
          console.log(`[api] POST /resolve-account — ${data.accountId}`)
          const result = await handleResolveAccount(mcp, data)
          if (result.error) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: result.error }))
          } else {
            res.writeHead(200)
            res.end(JSON.stringify(result))
          }
        } else if (url.includes('/create-activities')) {
          console.log(`[api] POST /create-activities — ${(data.activities || []).length} activities`)
          const result = await handleCreateActivities(mcp, data)
          const ok = result.results.filter((r) => r.status === 'SUCCESS').length
          console.log(`[api] Activities done: ${ok} created, ${result.results.length - ok} failed`)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/tag-opp-campaigns')) {
          console.log(`[api] POST /tag-opp-campaigns — ${(data.opportunities || []).length} opps, campaignId=${data.campaignId}`)
          const result = await handleTagOppCampaigns(mcp, data)
          const ok = result.results.filter((r) => r.status === 'SUCCESS').length
          console.log(`[api] Tag-opp-campaigns done: ${ok} tagged, ${result.results.length - ok} failed`)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/send-emails')) {
          console.log(`[api] POST /send-emails — ${(data.emails || []).length} emails`)
          const result = await handleSendEmails(data)
          console.log(`[api] Send done: ${result.sent} sent, ${result.failed} failed`)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/create-drafts')) {
          console.log(`[api] POST /create-drafts — ${(data.emails || []).length} emails`)
          const result = await handleCreateDrafts(data)
          console.log(`[api] Drafts done: ${result.created} created, ${result.failed} failed`)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/generate-report')) {
          console.log(`[api] POST /generate-report`)
          const result = await handleGenerateReport(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/generate-merf')) {
          console.log(`[api] POST /generate-merf`)
          const result = await handleGenerateMerf(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/exclude-list/list')) {
          const listType = String(data.list || '').toUpperCase()
          console.log(`[api] POST /exclude-list/list — ${listType}`)
          try {
            const items = await listExclusions(listType)
            res.writeHead(200)
            res.end(JSON.stringify({ items }))
          } catch (err) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: err.message }))
          }
        } else if (url.includes('/exclude-list/add')) {
          console.log(`[api] POST /exclude-list/add — ${data.list} ${data.email}`)
          try {
            const item = await addExclusion(data)
            invalidateExcludeCache(data.list)
            res.writeHead(200)
            res.end(JSON.stringify({ item }))
          } catch (err) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: err.message }))
          }
        } else if (url.includes('/exclude-list/remove')) {
          console.log(`[api] POST /exclude-list/remove — ${data.list} ${data.email}`)
          try {
            const result = await removeExclusion(data)
            invalidateExcludeCache(data.list)
            res.writeHead(200)
            res.end(JSON.stringify(result))
          } catch (err) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: err.message }))
          }
        } else if (url.includes('/account-exclusions/list')) {
          console.log(`[api] POST /account-exclusions/list`)
          try {
            const items = await listAccountExclusions()
            res.writeHead(200)
            res.end(JSON.stringify({ items }))
          } catch (err) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: err.message }))
          }
        } else if (url.includes('/account-exclusions/add')) {
          console.log(`[api] POST /account-exclusions/add — ${data.accountId || (data.rows || []).length + ' rows'}`)
          try {
            if (Array.isArray(data.rows) && data.rows.length > 0) {
              const result = await bulkAddAccountExclusions(data.rows)
              invalidateAccountExclusionCache()
              res.writeHead(200)
              res.end(JSON.stringify(result))
            } else {
              const item = await addAccountExclusion(data)
              invalidateAccountExclusionCache()
              res.writeHead(200)
              res.end(JSON.stringify({ item }))
            }
          } catch (err) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: err.message }))
          }
        } else if (url.includes('/account-exclusions/remove')) {
          console.log(`[api] POST /account-exclusions/remove — ${data.accountId}`)
          try {
            const result = await removeAccountExclusion(data.accountId)
            invalidateAccountExclusionCache()
            res.writeHead(200)
            res.end(JSON.stringify(result))
          } catch (err) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: err.message }))
          }
        } else if (url.includes('/lookup-campaign')) {
          console.log(`[api] POST /lookup-campaign — ${data.campaignCode}`)
          const result = await handleLookupCampaign(mcp, data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/events/save-pre')) {
          console.log(`[api] POST /events/save-pre — ${data.eventId}`)
          const result = await handleSavePre(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/events/save-post')) {
          console.log(`[api] POST /events/save-post — ${data.eventId}`)
          const result = await handleSavePost(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/events/delete')) {
          console.log(`[api] POST /events/delete — ${data.eventId}`)
          const result = await handleDeleteEvent(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/events/get')) {
          console.log(`[api] POST /events/get — ${data.eventId}`)
          const result = await handleGetEvent(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/events/list')) {
          console.log(`[api] POST /events/list`)
          const result = await handleListEvents(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/events/monthly-report')) {
          console.log(`[api] POST /events/monthly-report — ${data.yearMonth}`)
          const result = await handleMonthlyReport(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/kiro/peek-batch')) {
          console.log(`[api] POST /kiro/peek-batch — ${(data.ams || []).length} AMs (read-only)`)
          const result = await handleKiroPeekBatch(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/kiro/claim-batch')) {
          console.log(`[api] POST /kiro/claim-batch — ${(data.ams || []).length} AMs`)
          const result = await handleKiroClaimBatch(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/kiro/upload')) {
          console.log(`[api] POST /kiro/upload — ${(data.codes || []).length} codes`)
          const result = await handleKiroUpload(data)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/kiro/stats')) {
          const result = await handleKiroStats()
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/kiro/reset')) {
          console.log('[api] POST /kiro/reset — resetting all codes')
          const result = await resetAllCodes()
          console.log(`[kiro] Reset ${result.reset} codes`)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/auth/graph-status')) {
          const status = getGraphStatus()
          res.writeHead(200)
          res.end(JSON.stringify(status))
        } else if (url.includes('/auth/graph-login')) {
          console.log('[api] POST /auth/graph-login — starting device code flow')
          const flowData = await startDeviceCodeFlow()
          res.writeHead(200)
          res.end(JSON.stringify(flowData))
        } else if (url.includes('/auth/graph-poll')) {
          const result = await pollForToken(data.device_code)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } else if (url.includes('/auth/graph-logout')) {
          clearGraphToken()
          console.log('[api] Graph API token cleared')
          res.writeHead(200)
          res.end(JSON.stringify({ cleared: true }))
        } else if (url.includes('/health')) {
          const graphStatus = getGraphStatus()
          res.writeHead(200)
          res.end(JSON.stringify({ status: 'ok', mode: 'local-dev', mcp_ready: mcp.ready, outlook_mcp_ready: !!outlookMcp?.ready, platform: platform(), graph: graphStatus }))
        } else {
          res.writeHead(404)
          res.end(JSON.stringify({ error: `Not found: ${url}` }))
        }
      } catch (err) {
        console.error(`[api] Error:`, err.message)
        res.writeHead(500)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  })

  server.listen(PORT, () => {
    console.log(`\n[dev-server] Ready on http://localhost:${PORT}`)
    console.log(`[dev-server] Platform: ${platform()}`)
    console.log('[dev-server] Endpoints:')
    console.log('  POST /api/enrich              — SFDC account lookup')
    console.log('  POST /api/resolve-account     — Resolve a single account by ID (used for manual override)')
    console.log('  POST /api/create-activities   — Create tech activities')
    console.log('  POST /api/tag-opp-campaigns   — Tag campaign code to opportunities')
    console.log('  POST /api/create-drafts       — Save email drafts to Outlook')
    console.log('  POST /api/send-emails         — Send emails via Outlook')
    console.log('  POST /api/generate-report     — Generate trip report via Bedrock')
    console.log('  POST /api/generate-merf       — Generate MERF content via Bedrock')
    console.log('  POST /api/lookup-campaign     — Lookup SFDC campaign ID by code')
    console.log('  POST /api/exclude-list/list   — List exclusion entries (CUSTOMER or AM)')
    console.log('  POST /api/exclude-list/add    — Add an email to the exclusion list')
    console.log('  POST /api/exclude-list/remove — Remove an email from the exclusion list')
    console.log('  POST /api/account-exclusions/list   — List AM-email account exclusions')
    console.log('  POST /api/account-exclusions/add    — Add account(s) to AM-email exclusion list')
    console.log('  POST /api/account-exclusions/remove — Remove an account from AM-email exclusion list')
    console.log('  POST /api/events/save-pre     — Save pre-event data to DynamoDB')
    console.log('  POST /api/events/save-post    — Save post-event data to DynamoDB')
    console.log('  POST /api/events/delete        — Soft-delete an event record')
    console.log('  POST /api/events/get          — Get event records from DynamoDB')
    console.log('  POST /api/events/list         — List recent events from DynamoDB')
    console.log('  POST /api/events/monthly-report — Monthly aggregate from DynamoDB')
    console.log('  POST /api/auth/graph-status   — Check Graph API auth status')
    console.log('  POST /api/auth/graph-login    — Start device code auth flow')
    console.log('  POST /api/auth/graph-poll     — Poll for auth completion')
    console.log('  POST /api/auth/graph-logout   — Clear cached Graph API token')
    console.log('  GET  /api/health              — Health check')
    const gs = getGraphStatus()
    console.log(`  [graph] ${gs.configured ? `Configured (${gs.authenticated ? 'authenticated' : 'not authenticated'})` : 'Not configured — set GRAPH_CLIENT_ID to enable'}`)
    console.log(`  [outlook-mcp] ${outlookMcp?.ready ? 'Ready — HTML emails via aws-outlook-mcp' : 'Not available — using AppleScript fallback'}\n`)
  })

  process.on('SIGINT', () => {
    console.log('\n[dev-server] Shutting down...')
    mcp.close()
    if (outlookMcp) outlookMcp.close()
    server.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[dev-server] Fatal:', err.message)
  process.exit(1)
})
