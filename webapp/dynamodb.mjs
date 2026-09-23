import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { fromIni } from '@aws-sdk/credential-provider-ini'

const TABLE_NAME = process.env.DYNAMO_TABLE || 'ags-scale-events'
const REGION = 'us-east-1'
const PROFILE = process.env.AWS_PROFILE || 'prod-events-toolkit'

let docClient = null

function getClient() {
  if (!docClient) {
    const raw = new DynamoDBClient({
      region: REGION,
      credentials: fromIni({ profile: PROFILE }),
    })
    docClient = DynamoDBDocumentClient.from(raw, {
      marshallOptions: { removeUndefinedValues: true },
    })
    console.log(`[dynamodb] Using profile: ${PROFILE}, region: ${REGION}, table: ${TABLE_NAME}`)
  }
  return docClient
}

export async function putEventRecord(item) {
  const client = getClient()
  await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
  return { saved: true, PK: item.PK, SK: item.SK }
}

export async function getEventRecords(eventId) {
  const client = getClient()
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `EVENT#${eventId}` },
  }))
  const items = result.Items || []
  const pre = items.find(i => i.SK?.startsWith('PRE#')) || null
  const post = items.find(i => i.SK?.startsWith('POST#')) || null
  return { pre, post }
}

export async function listEventsByMonth(yearMonth, limit = 50) {
  const client = getClient()
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'YearMonth-index',
    KeyConditionExpression: 'yearMonth = :ym',
    ExpressionAttributeValues: { ':ym': yearMonth },
    Limit: limit,
    ScanIndexForward: false,
  }
  const result = await client.send(new QueryCommand(params))
  return result.Items || []
}

export async function listRecentEvents(limit = 20) {
  const client = getClient()
  // Query last 12 months + next 6 months (pre-events are often scheduled ahead)
  const now = new Date()
  const months = []
  for (let i = -12; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const allItems = []
  for (const ym of months) {
    const items = await listEventsByMonth(ym, limit)
    allItems.push(...items)
  }

  // Deduplicate by eventId, merge pre+post
  const eventMap = new Map()
  for (const item of allItems) {
    const eid = item.eventId
    if (!eventMap.has(eid)) eventMap.set(eid, { eventId: eid })
    const entry = eventMap.get(eid)
    if (item.SK?.startsWith('PRE#')) entry.pre = item
    if (item.SK?.startsWith('POST#')) entry.post = item
    entry.eventName = item.eventName || entry.eventName
    entry.eventDate = item.eventDate || entry.eventDate
    entry.eventType = item.eventType || entry.eventType
  }

  return [...eventMap.values()]
    .sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || ''))
    .slice(0, limit)
}

export async function getMonthlyAggregate(yearMonth) {
  const items = await listEventsByMonth(yearMonth, 200)
  const postItems = items.filter(i => i.SK?.startsWith('POST#'))

  return {
    yearMonth,
    totalEvents: postItems.length,
    totalRegistrations: postItems.reduce((s, i) => s + (i.registrations || 0), 0),
    totalAttendees: postItems.reduce((s, i) => s + (i.attendees || 0), 0),
    avgAttendanceRate: postItems.length > 0
      ? postItems.reduce((s, i) => s + (i.attendanceRate || 0), 0) / postItems.length
      : 0,
    totalArrInfluenced: postItems.reduce((s, i) => s + (i.totalArrInfluenced || 0), 0),
    totalPipelineArr: postItems.reduce((s, i) => s + (i.pipelineArr || 0), 0),
    totalLaunchedArr: postItems.reduce((s, i) => s + (i.launchedArr || 0), 0),
    totalActivitiesCreated: postItems.reduce((s, i) => s + (i.activitiesCreated || 0), 0),
    events: postItems.map(i => ({ eventId: i.eventId, eventName: i.eventName, eventDate: i.eventDate, attendees: i.attendees, totalArrInfluenced: i.totalArrInfluenced })),
  }
}

export async function softDeleteEvent(eventId, sk) {
  const client = getClient()
  await client.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { PK: `EVENT#${eventId}`, SK: sk },
    UpdateExpression: 'SET isDeleted = :d, deletedAt = :t',
    ExpressionAttributeValues: { ':d': true, ':t': new Date().toISOString() },
  }))
  return { deleted: true, eventId, SK: sk }
}
