import { DynamoDBClient, ScanCommand, UpdateItemCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { fromIni } from '@aws-sdk/credential-provider-ini'

const TABLE = 'kiro-credit-codes'
const REGION = 'us-east-1'

let client = null
function getClient() {
  if (!client) {
    const profile = process.env.AWS_PROFILE || 'prod-events-toolkit'
    client = new DynamoDBClient({ region: REGION, credentials: fromIni({ profile }) })
  }
  return client
}

/**
 * Return all available (unused) code strings. Pure read — no writes.
 */
export async function getAllAvailableCodes() {
  const db = getClient()
  const items = []
  let lastKey = undefined

  do {
    const resp = await db.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'attribute_not_exists(#ua)',
      ProjectionExpression: '#c',
      ExpressionAttributeNames: { '#c': 'code', '#ua': 'usedAt' },
      ExclusiveStartKey: lastKey,
    }))
    for (const item of (resp.Items || [])) items.push(item.code.S)
    lastKey = resp.LastEvaluatedKey
  } while (lastKey)

  // Shuffle to spread codes across AMs randomly
  items.sort(() => Math.random() - 0.5)
  return items
}

/**
 * Mark a specific code as used. Called at send time with pre-peeked code values.
 */
export async function claimSpecificCode(code, alias, amEmail, eventId) {
  const db = getClient()
  await db.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: { code: { S: code } },
    UpdateExpression: 'SET #ua = :ts, assignedToAlias = :alias, assignedToEmail = :email, eventId = :eventId',
    ExpressionAttributeNames: { '#ua': 'usedAt' },
    ExpressionAttributeValues: {
      ':ts': { S: new Date().toISOString() },
      ':alias': { S: alias },
      ':email': { S: amEmail },
      ':eventId': { S: eventId },
    },
  }))
}

/**
 * Claim one unused code for an AM atomically. Used when no pre-assignment exists.
 * excludeCodes: already claimed this session — skipped to avoid duplicates.
 */
export async function claimCode(alias, amEmail, eventId, excludeCodes = []) {
  const db = getClient()
  const excludeSet = new Set(excludeCodes)

  const scan = await db.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'attribute_not_exists(#ua)',
    ProjectionExpression: '#c',
    ExpressionAttributeNames: { '#c': 'code', '#ua': 'usedAt' },
    Limit: 40,
  }))

  const candidates = (scan.Items || []).filter(i => !excludeSet.has(i.code.S))
  if (candidates.length === 0) return null
  candidates.sort(() => Math.random() - 0.5)

  for (const item of candidates) {
    const code = item.code.S
    try {
      await db.send(new UpdateItemCommand({
        TableName: TABLE,
        Key: { code: { S: code } },
        UpdateExpression: 'SET #ua = :ts, assignedToAlias = :alias, assignedToEmail = :email, eventId = :eventId',
        ConditionExpression: 'attribute_not_exists(#ua)',
        ExpressionAttributeNames: { '#ua': 'usedAt' },
        ExpressionAttributeValues: {
          ':ts': { S: new Date().toISOString() },
          ':alias': { S: alias },
          ':email': { S: amEmail },
          ':eventId': { S: eventId },
        },
      }))
      return code
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') continue
      throw err
    }
  }

  return null
}

/**
 * Bulk upload an array of code strings. Skips duplicates (puts only if not exists).
 */
export async function bulkUploadCodes(codes) {
  const db = getClient()
  const unique = [...new Set(codes.map(c => c.trim()).filter(Boolean))]
  const batchSize = 25
  let uploaded = 0
  let skipped = 0

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize)
    const requests = batch.map(code => ({
      PutRequest: { Item: { code: { S: code } } },
    }))
    try {
      const resp = await db.send(new BatchWriteItemCommand({
        RequestItems: { [TABLE]: requests },
      }))
      const unprocessed = resp.UnprocessedItems?.[TABLE]?.length || 0
      uploaded += batch.length - unprocessed
      skipped += unprocessed
    } catch (err) {
      console.error(`[kiro-codes] Batch upload error: ${err.message}`)
      skipped += batch.length
    }
  }

  return { uploaded, skipped, total: unique.length }
}

/**
 * Return counts of available and used codes.
 */
export async function getCodeStats() {
  const db = getClient()
  const names = { '#ua': 'usedAt' }

  const [availScan, usedScan] = await Promise.all([
    db.send(new ScanCommand({ TableName: TABLE, FilterExpression: 'attribute_not_exists(#ua)', ExpressionAttributeNames: names, Select: 'COUNT' })),
    db.send(new ScanCommand({ TableName: TABLE, FilterExpression: 'attribute_exists(#ua)', ExpressionAttributeNames: names, Select: 'COUNT' })),
  ])

  return {
    available: availScan.Count || 0,
    used: usedScan.Count || 0,
    total: (availScan.Count || 0) + (usedScan.Count || 0),
  }
}

/**
 * Reset all codes: remove usedAt and assignment fields from every item.
 * Makes all codes available again.
 */
export async function resetAllCodes() {
  const db = getClient()

  const scan = await db.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'attribute_exists(#ua) OR attribute_exists(#ra)',
    ProjectionExpression: '#c',
    ExpressionAttributeNames: { '#c': 'code', '#ua': 'usedAt', '#ra': 'reservedAt' },
  }))

  const items = scan.Items || []
  for (const item of items) {
    await db.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { code: { S: item.code.S } },
      UpdateExpression: 'REMOVE #ua, #ra, assignedToAlias, assignedToEmail, eventId',
      ExpressionAttributeNames: { '#ua': 'usedAt', '#ra': 'reservedAt' },
    }))
  }

  return { reset: items.length }
}
