// Email exclusion list — persists in the dedicated `ags-scale-exclusions` DynamoDB
// table. Two logical lists: customer (attendees) and AM (account managers). Used to
// suppress draft creation and email sending so we never reach out to people on the
// exclusion list.
//
// Storage layout:
//   PK = "<list>"   where <list> is "CUSTOMER" or "AM"
//   SK = "<lowercased-email>"

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { fromIni } from '@aws-sdk/credential-provider-ini'

const TABLE_NAME = process.env.DYNAMO_EXCLUSIONS_TABLE || 'ags-scale-exclusions'
const REGION = 'us-east-1'
const PROFILE = process.env.AWS_PROFILE || 'prod-events-toolkit'

let docClient = null

function getClient() {
  if (!docClient) {
    const raw = new DynamoDBClient({ region: REGION, credentials: fromIni({ profile: PROFILE }) })
    docClient = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } })
    console.log(`[exclude-list] Using profile: ${PROFILE}, region: ${REGION}, table: ${TABLE_NAME}`)
  }
  return docClient
}

const VALID_LISTS = new Set(['CUSTOMER', 'AM'])

function normalizeList(list) {
  const v = String(list || '').toUpperCase()
  if (!VALID_LISTS.has(v)) throw new Error(`Invalid list type: ${list}. Must be CUSTOMER or AM.`)
  return v
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export async function listExclusions(list) {
  const listType = normalizeList(list)
  const client = getClient()
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': listType },
  }))
  return (result.Items || []).map(i => ({
    email: i.SK || i.email,
    list: listType,
    name: i.name || '',
    reason: i.reason || '',
    addedAt: i.addedAt || '',
    addedBy: i.addedBy || '',
  }))
}

export async function addExclusion({ list, email, name, reason, addedBy }) {
  const listType = normalizeList(list)
  const normEmail = normalizeEmail(email)
  if (!normEmail) throw new Error('Email is required')
  if (!normEmail.includes('@')) throw new Error(`Invalid email: ${email}`)

  const item = {
    PK: listType,
    SK: normEmail,
    list: listType,
    email: normEmail,
    name: name || '',
    reason: reason || '',
    addedAt: new Date().toISOString(),
    addedBy: addedBy || '',
  }
  const client = getClient()
  await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
  return item
}

export async function removeExclusion({ list, email }) {
  const listType = normalizeList(list)
  const normEmail = normalizeEmail(email)
  const client = getClient()
  await client.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: listType, SK: normEmail },
  }))
  return { removed: true }
}

// In-memory cache (keyed by list) so we don't hit DynamoDB on every email send.
// Refreshed lazily after writes (writers invalidate). 60s TTL as a safety net in
// case multiple processes ever update the list.
const cache = { CUSTOMER: { ts: 0, set: new Set() }, AM: { ts: 0, set: new Set() } }
const CACHE_TTL_MS = 60_000

async function loadCache(listType) {
  const items = await listExclusions(listType)
  cache[listType] = { ts: Date.now(), set: new Set(items.map(i => i.email)) }
  return cache[listType].set
}

export async function getExclusionSet(list) {
  const listType = normalizeList(list)
  const c = cache[listType]
  if (Date.now() - c.ts > CACHE_TTL_MS) {
    return loadCache(listType)
  }
  return c.set
}

export function invalidateCache(list) {
  const listType = normalizeList(list)
  cache[listType] = { ts: 0, set: new Set() }
}

// Convenience: filter a list of emails by the exclude list. Returns { kept, dropped }.
export async function filterExcluded(list, emails) {
  const set = await getExclusionSet(list)
  const kept = []
  const dropped = []
  for (const e of emails) {
    if (set.has(normalizeEmail(e))) dropped.push(normalizeEmail(e))
    else kept.push(e)
  }
  return { kept, dropped }
}
