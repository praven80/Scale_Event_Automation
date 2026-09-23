// Account-level exclusion list — persists in the dedicated
// `ags-scale-account-exclusions` DynamoDB table. When sending AM post-event
// emails, accounts in this list still get an email (with attendee + account info)
// but the opportunity list is omitted from the body.
//
// Storage layout:
//   PK = "ACCOUNT"               (single logical list; reserved for future expansion)
//   SK = "<accountId>"           (18-char SFDC Account ID)

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import { fromIni } from '@aws-sdk/credential-provider-ini'

const TABLE_NAME = process.env.DYNAMO_ACCOUNT_EXCLUSIONS_TABLE || 'ags-scale-account-exclusions'
const REGION = 'us-east-1'
const PROFILE = process.env.AWS_PROFILE || 'prod-events-toolkit'
const PK_VALUE = 'ACCOUNT'

let docClient = null

function getClient() {
  if (!docClient) {
    const raw = new DynamoDBClient({ region: REGION, credentials: fromIni({ profile: PROFILE }) })
    docClient = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } })
    console.log(`[account-exclusions] Using profile: ${PROFILE}, region: ${REGION}, table: ${TABLE_NAME}`)
  }
  return docClient
}

function normalizeAccountId(accountId) {
  return String(accountId || '').trim()
}

export async function listAccountExclusions() {
  const client = getClient()
  const items = []
  let last
  do {
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': PK_VALUE },
      ExclusiveStartKey: last,
    }))
    items.push(...(result.Items || []))
    last = result.LastEvaluatedKey
  } while (last)
  return items.map(i => ({
    accountId: i.SK || i.accountId,
    accountName: i.accountName || '',
    accountOwner: i.accountOwner || '',
    ownerAlias: i.ownerAlias || '',
    territory: i.territory || '',
    bizUnit: i.bizUnit || '',
    geo: i.geo || '',
    namedTerritory: i.namedTerritory || '',
    segment: i.segment || '',
    subSegment: i.subSegment || '',
    addedAt: i.addedAt || '',
    addedBy: i.addedBy || '',
  }))
}

export async function addAccountExclusion(input) {
  const accountId = normalizeAccountId(input.accountId)
  if (!accountId) throw new Error('accountId is required')
  const item = {
    PK: PK_VALUE,
    SK: accountId,
    accountId,
    accountName: input.accountName || '',
    accountOwner: input.accountOwner || '',
    ownerAlias: input.ownerAlias || '',
    territory: input.territory || '',
    bizUnit: input.bizUnit || '',
    geo: input.geo || '',
    namedTerritory: input.namedTerritory || '',
    segment: input.segment || '',
    subSegment: input.subSegment || '',
    addedAt: new Date().toISOString(),
    addedBy: input.addedBy || '',
  }
  const client = getClient()
  await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
  return item
}

export async function removeAccountExclusion(accountId) {
  const id = normalizeAccountId(accountId)
  if (!id) throw new Error('accountId is required')
  const client = getClient()
  await client.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: PK_VALUE, SK: id },
  }))
  return { removed: true, accountId: id }
}

export async function bulkAddAccountExclusions(rows) {
  const now = new Date().toISOString()
  const items = rows
    .map(r => {
      const accountId = normalizeAccountId(r.accountId)
      if (!accountId) return null
      return {
        PK: PK_VALUE,
        SK: accountId,
        accountId,
        accountName: r.accountName || '',
        accountOwner: r.accountOwner || '',
        ownerAlias: r.ownerAlias || '',
        territory: r.territory || '',
        bizUnit: r.bizUnit || '',
        geo: r.geo || '',
        namedTerritory: r.namedTerritory || '',
        segment: r.segment || '',
        subSegment: r.subSegment || '',
        addedAt: now,
        addedBy: r.addedBy || 'bulk',
      }
    })
    .filter(Boolean)

  // BatchWrite supports up to 25 items per request
  const client = getClient()
  let written = 0
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25)
    await client.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: batch.map(Item => ({ PutRequest: { Item } })),
      },
    }))
    written += batch.length
  }
  return { added: written }
}

// In-memory cache + invalidation (mirrors exclude-list.mjs)
let cache = { ts: 0, set: new Set() }
const CACHE_TTL_MS = 60_000

async function loadCache() {
  const items = await listAccountExclusions()
  cache = { ts: Date.now(), set: new Set(items.map(i => i.accountId)) }
  return cache.set
}

export async function getAccountExclusionSet() {
  if (Date.now() - cache.ts > CACHE_TTL_MS) {
    return loadCache()
  }
  return cache.set
}

export function invalidateAccountExclusionCache() {
  cache = { ts: 0, set: new Set() }
}
