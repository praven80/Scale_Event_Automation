/**
 * Microsoft Graph API authentication via OAuth2 device code flow.
 * Tokens are cached locally in ~/.ags-events-graph-token.json.
 *
 * Required env vars:
 *   GRAPH_CLIENT_ID  - Azure AD app registration client ID
 *   GRAPH_TENANT_ID  - Azure AD tenant ID (default: "common")
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const TOKEN_FILE = join(homedir(), '.ags-events-graph-token.json')
const SCOPES = 'Mail.ReadWrite Mail.Send offline_access'

function getConfig() {
  const clientId = process.env.GRAPH_CLIENT_ID
  const tenantId = process.env.GRAPH_TENANT_ID || 'common'
  return { clientId, tenantId }
}

function loadCachedToken() {
  try {
    if (existsSync(TOKEN_FILE)) {
      return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
    }
  } catch { /* ignore */ }
  return null
}

function saveCachedToken(tokenData) {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), 'utf8')
}

/** Check if Graph API is configured and authenticated */
export function getGraphStatus() {
  const { clientId } = getConfig()
  if (!clientId) {
    return { configured: false, authenticated: false, message: 'GRAPH_CLIENT_ID not set' }
  }
  const token = loadCachedToken()
  if (!token) {
    return { configured: true, authenticated: false, message: 'Not authenticated — login required' }
  }
  const expiresAt = token.obtained_at + token.expires_in * 1000
  const hasRefresh = !!token.refresh_token
  if (Date.now() < expiresAt) {
    return { configured: true, authenticated: true, message: 'Authenticated', email: token.email }
  }
  if (hasRefresh) {
    return { configured: true, authenticated: true, message: 'Token expired — will auto-refresh', email: token.email }
  }
  return { configured: true, authenticated: false, message: 'Token expired — login required' }
}

/** Start device code flow. Returns { user_code, verification_uri, message } */
export async function startDeviceCodeFlow() {
  const { clientId, tenantId } = getConfig()
  if (!clientId) throw new Error('GRAPH_CLIENT_ID not set')

  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Device code request failed: ${err}`)
  }
  const data = await resp.json()
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: data.expires_in,
    interval: data.interval || 5,
    message: data.message,
  }
}

/** Poll for token after device code flow initiated */
export async function pollForToken(deviceCode) {
  const { clientId, tenantId } = getConfig()
  if (!clientId) throw new Error('GRAPH_CLIENT_ID not set')

  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    }),
  })

  const data = await resp.json()
  if (data.error === 'authorization_pending') {
    return { pending: true }
  }
  if (data.error === 'slow_down') {
    return { pending: true, slow_down: true }
  }
  if (data.error) {
    throw new Error(data.error_description || data.error)
  }

  // Decode email from id_token (JWT)
  let email = ''
  try {
    const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64').toString())
    email = payload.preferred_username || payload.email || payload.upn || ''
  } catch { /* ignore */ }

  const tokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    obtained_at: Date.now(),
    email,
  }
  saveCachedToken(tokenData)
  return { pending: false, authenticated: true, email }
}

/** Get a valid access token, refreshing if needed */
export async function getAccessToken() {
  const { clientId, tenantId } = getConfig()
  if (!clientId) throw new Error('GRAPH_CLIENT_ID not set')

  const token = loadCachedToken()
  if (!token) throw new Error('Not authenticated — run device code flow first')

  const expiresAt = token.obtained_at + token.expires_in * 1000
  // Return cached token if still valid (with 5-min buffer)
  if (Date.now() < expiresAt - 300000) {
    return token.access_token
  }

  // Refresh the token
  if (!token.refresh_token) throw new Error('Token expired and no refresh token available')

  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      scope: SCOPES,
    }),
  })
  const data = await resp.json()
  if (data.error) throw new Error(data.error_description || data.error)

  const refreshed = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_in: data.expires_in,
    obtained_at: Date.now(),
    email: token.email,
  }
  saveCachedToken(refreshed)
  return refreshed.access_token
}

/** Create a draft email via Microsoft Graph API */
export async function createDraftGraph(email) {
  const accessToken = await getAccessToken()
  const message = {
    subject: email.subject || '',
    body: { contentType: email.html ? 'HTML' : 'Text', content: email.body || '' },
    toRecipients: email.to ? [{ emailAddress: { address: email.to } }] : [],
    bccRecipients: (email.bcc || []).filter(a => a && a.includes('@')).map(a => ({ emailAddress: { address: a.trim() } })),
  }

  const resp = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Graph API draft failed (${resp.status}): ${err}`)
  }
  return { status: 'OK' }
}

/** Send an email via Microsoft Graph API */
export async function sendEmailGraph(email) {
  const accessToken = await getAccessToken()
  const payload = {
    message: {
      subject: email.subject || '',
      body: { contentType: email.html ? 'HTML' : 'Text', content: email.body || '' },
      toRecipients: email.to ? [{ emailAddress: { address: email.to } }] : [],
      bccRecipients: (email.bcc || []).filter(a => a && a.includes('@')).map(a => ({ emailAddress: { address: a.trim() } })),
    },
  }

  const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Graph API send failed (${resp.status}): ${err}`)
  }
  return { status: 'OK' }
}

/** Clear cached token (logout) */
export function clearGraphToken() {
  try {
    if (existsSync(TOKEN_FILE)) {
      writeFileSync(TOKEN_FILE, '{}', 'utf8')
    }
  } catch { /* ignore */ }
}
