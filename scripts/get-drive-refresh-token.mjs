#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * get-drive-refresh-token.mjs — ONE-TIME OAuth setup helper (NOT prod).
 *
 * Generates a long-lived Google Drive refresh token for a personal Gmail
 * account, so the archival system (api/_archive.ts) can upload files owned
 * by that account. Run it once locally; copy the printed values into Vercel.
 *
 * This script is standalone and is NEVER imported by the application.
 *
 * PREREQUISITES (Google Cloud Console, https://console.cloud.google.com):
 *   1. Create/select a project. Enable the "Google Drive API".
 *   2. Configure the OAuth consent screen (External). Add your Gmail as a
 *      Test user. Add the scope .../auth/drive (or leave scopes to the flow).
 *   3. Create an OAuth client ID of type "Desktop app". Download its JSON.
 *      (A "Desktop app" client permits the http://localhost loopback redirect
 *      this script uses. For a "Web application" client you must add
 *      http://localhost:<PORT> as an authorized redirect URI.)
 *
 * USAGE:
 *   node apps/evalscore/scripts/get-drive-refresh-token.mjs <client_secret.json>
 *   # optional: PORT=4571 node ... <client_secret.json>
 *
 * It opens your browser, you sign in with the Gmail account that owns the
 * archive folder, approve Drive access, and it prints:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * ───────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { OAuth2Client } from 'google-auth-library'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const PORT = Number(process.env.PORT || 4571)

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function openBrowser(url) {
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* fall back to manual copy/paste below */
  }
}

// 1. Read the OAuth client JSON downloaded from Google Cloud Console.
const jsonPath = process.argv[2]
if (!jsonPath) {
  fail(
    'Missing client secret JSON path.\n' +
      '  Usage: node apps/evalscore/scripts/get-drive-refresh-token.mjs <client_secret.json>',
  )
}

let creds
try {
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
  creds = parsed.installed || parsed.web
  if (!creds?.client_id || !creds?.client_secret) throw new Error('no client_id/client_secret')
} catch (err) {
  fail(`Could not read a valid OAuth client JSON from "${jsonPath}": ${err.message}`)
}

const redirectUri = `http://localhost:${PORT}`
const oauth2 = new OAuth2Client({
  clientId: creds.client_id,
  clientSecret: creds.client_secret,
  redirectUri,
})

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline', // request a refresh token
  prompt: 'consent', // force a refresh token even on re-consent
  scope: [DRIVE_SCOPE],
})

// 2/3/4. Spin up a loopback server, open the browser, wait for the callback.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri)
  if (url.pathname !== '/') {
    res.writeHead(404).end()
    return
  }

  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<h2>Authorization failed: ${error}</h2>`)
    server.close()
    fail(`Authorization was denied or failed: ${error}`)
    return
  }
  if (!code) {
    res.writeHead(400).end('Missing authorization code')
    return
  }

  try {
    const { tokens } = await oauth2.getToken(code)
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<h2>✓ Success! Refresh token generated. You can close this tab and return to the terminal.</h2>')
    server.close()

    if (!tokens.refresh_token) {
      fail(
        'No refresh token was returned. Revoke prior access at ' +
          'https://myaccount.google.com/permissions and run this again (it forces prompt=consent).',
      )
    }

    console.log('\n─────────────────────────────────────────────────────────')
    console.log(' Copy these into Vercel → Project → Settings → Environment')
    console.log('─────────────────────────────────────────────────────────\n')
    console.log(`GOOGLE_CLIENT_ID=${creds.client_id}`)
    console.log(`GOOGLE_CLIENT_SECRET=${creds.client_secret}`)
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('\n(Also set GDRIVE_ARCHIVE_FOLDER_ID to your archive folder id.)\n')
    process.exit(0)
  } catch (err) {
    res.writeHead(500).end('Token exchange failed')
    server.close()
    fail(`Token exchange failed: ${err.message}`)
  }
})

server.listen(PORT, () => {
  console.log('\nOpening your browser to authorize Google Drive access…')
  console.log(`If it does not open automatically, visit:\n\n${authUrl}\n`)
  openBrowser(authUrl)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') fail(`Port ${PORT} is in use. Retry with e.g. PORT=4599 node ... <client.json>`)
  else fail(`Local server error: ${err.message}`)
})
