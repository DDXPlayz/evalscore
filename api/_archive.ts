/* ── Google Drive archival — best-effort, non-blocking, isolated ─────
 *
 * INTERNAL ARCHIVAL ONLY. Quietly files a copy of a tool's results into a
 * dated Google Drive folder hierarchy for internal record-keeping. It is a
 * completely isolated side channel and is NEVER a dependency of the
 * user-facing product.
 *
 * GOLDEN RULE: nothing in here may ever affect the application. Every path
 * is wrapped so archiving can NEVER throw. On any failure — invalid /
 * expired / missing credentials, permission denied, missing folder, quota
 * exceeded, rate limiting, network timeout, network unavailable, Drive API
 * outage, unexpected API response, internal exception — it logs on the
 * server and returns a plain result object. Callers ignore the result.
 *
 * Folder layout (created automatically, idempotently):
 *
 *   <GDRIVE_ARCHIVE_FOLDER_ID>/       ← e.g. "Anantam Engineering", shared w/ SA
 *     └── <Tool>/                     ← AeroVision | EvalScore | Tech Verify
 *           └── <YYYY>/               ← ISO year
 *                 └── <MM-DD>/        ← ISO month-day
 *                       └── <UploadId>/   ← one UUID folder per result
 *                             ├── metadata.json   (server-authored)
 *                             ├── analysis.json   (results)
 *                             ├── thumbnail.webp   (3D tools)
 *                             └── … any other artifacts the client sends
 *
 * The Vercel router does not route files whose name starts with "_", so
 * this is a shared helper, not an HTTP endpoint.
 *
 * Configuration (ALL optional — if unset, archival silently no-ops and the
 * application is completely unaffected):
 *   GOOGLE_SERVICE_ACCOUNT_JSON     full service-account JSON (prod / Vercel)
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the JSON key file (local dev)
 *   GDRIVE_CREDENTIALS_PATH         alternate path to the JSON key file
 *   GDRIVE_ARCHIVE_FOLDER_ID        destination root folder shared with the SA
 */

import { JWT } from "google-auth-library";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/* Full Drive scope: required so the service account can list/create inside a
   folder that was *shared* with it (drive.file only covers app-created files
   opened via the picker, which does not include a pre-shared folder). */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files" +
  "?uploadType=multipart&supportsAllDrives=true&fields=id";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const HTTP_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2; // one retry on transient failures (429 / 5xx / network)
const RETRY_DELAY_MS = 1_500;

/** Last-resort local-dev credential path (git-ignored key file). Tried only
 *  if no env config is present. */
const DEFAULT_LOCAL_KEY = "anantam-engineering-b55a52678d5c.json";

export interface ArchiveFile {
  name: string;
  mimeType?: string;
  /** UTF-8 text payload (e.g. JSON). */
  content?: string;
  /** Base64 payload for binary artifacts (data-URL prefix is tolerated). */
  contentBase64?: string;
}

export interface ArchiveBundle {
  tool: string;
  /** Client-supplied id; a UUID is generated if absent/invalid. */
  uploadId?: string;
  /** Client-supplied ISO timestamp; `now` is used if absent/invalid. */
  timestamp?: string;
  /** Arbitrary client metadata, merged into the server-authored metadata.json. */
  meta?: Record<string, unknown>;
  files?: ArchiveFile[];
}

export interface ArchiveResult {
  ok: boolean;
  uploadId: string;
  timestamp: string;
  reason?: string;
  folderId?: string;
  folderPath?: string;
  uploaded?: string[];
  failed?: string[];
}

/* ── caches (persist across warm serverless invocations) ── */
let cachedClient: JWT | null | undefined; // undefined = not yet attempted
let warnedNotConfigured = false;
const folderCache = new Map<string, string>(); // `${parentId}/${name}` -> folderId

/* ── credential loading (never throws) ── */
function loadServiceAccount(): { client_email: string; private_key: string } | null {
  try {
    let raw: string | null = null;

    const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (inline && inline.trim()) {
      raw = inline.trim();
    } else {
      const path =
        process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
        process.env.GDRIVE_CREDENTIALS_PATH?.trim() ||
        null;
      try {
        raw = readFileSync(path || DEFAULT_LOCAL_KEY, "utf8");
      } catch {
        raw = null; // no file — perfectly fine, archival just no-ops
      }
    }

    if (!raw) return null;
    const json = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!json.client_email || !json.private_key) return null;
    return { client_email: json.client_email, private_key: json.private_key };
  } catch {
    return null;
  }
}

function getClient(): JWT | null {
  if (cachedClient !== undefined) return cachedClient;
  const creds = loadServiceAccount();
  if (!creds) {
    cachedClient = null;
    return null;
  }
  try {
    cachedClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [DRIVE_SCOPE],
    });
  } catch {
    cachedClient = null;
  }
  return cachedClient;
}

/* ── structured, server-only failure log (never shown to the user) ── */
function logFailure(tool: string, uploadId: string, reason: string): void {
  console.warn(
    "\n[Google Drive Upload Failed]\n" +
      `Tool: ${tool}\n` +
      `Upload ID: ${uploadId}\n` +
      `Reason: ${reason}\n` +
      `Timestamp: ${new Date().toISOString()}\n`,
  );
}

function short(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyStatus(status: number): { reason: string; retryable: boolean } {
  if (status === 401) return { reason: "Invalid or expired credentials", retryable: false };
  if (status === 403) return { reason: "Permission denied or quota exceeded", retryable: false };
  if (status === 404) return { reason: "Folder or resource not found", retryable: false };
  if (status === 408) return { reason: "Request timeout", retryable: true };
  if (status === 429) return { reason: "Rate limited", retryable: true };
  if (status >= 500) return { reason: "Google Drive API outage", retryable: true };
  return { reason: `Unexpected API response (HTTP ${status})`, retryable: false };
}

/* ── input sanitizers (folder/file names, ids, timestamps) ── */
const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;

function safeUploadId(id: unknown): string {
  return typeof id === "string" && SAFE_ID.test(id) ? id : randomUUID();
}

function safeTimestamp(ts: unknown): string {
  if (typeof ts === "string" && /^\d{4}-\d{2}-\d{2}T/.test(ts) && !Number.isNaN(Date.parse(ts))) {
    return new Date(ts).toISOString();
  }
  return new Date().toISOString();
}

function cleanFolderName(name: unknown): string {
  const s = typeof name === "string" ? name : "";
  return s.replace(/[\r\n/\\]/g, "_").trim().slice(0, 120) || "Unknown";
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return "application/json";
  if (ext === "webp") return "image/webp";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "txt" || ext === "log") return "text/plain";
  return "application/octet-stream";
}

/* ── HTTP helper: fetch + timeout + one retry on transient errors ──
   Returns a plain result and NEVER throws. */
interface HttpResult {
  ok: boolean;
  status: number;
  json: any;
  text: string;
  reason?: string;
}

async function driveRequest(
  url: string,
  init: RequestInit,
  token: string,
): Promise<HttpResult> {
  let last: HttpResult = { ok: false, status: 0, json: null, text: "", reason: "Upload failed" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);

      let json: any = null;
      let text = "";
      try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) json = await res.json();
        else text = (await res.text()).slice(0, 300);
      } catch {
        /* body parsing is non-essential */
      }

      if (res.ok) return { ok: true, status: res.status, json, text };

      const { reason, retryable } = classifyStatus(res.status);
      last = { ok: false, status: res.status, json, text, reason };
      if (retryable && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return last;
    } catch (err) {
      clearTimeout(timer);
      const aborted = controller.signal.aborted;
      last = {
        ok: false,
        status: 0,
        json: null,
        text: short(err),
        reason: aborted ? "Network timeout" : "Network error",
      };
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return last;
    }
  }
  return last;
}

async function getToken(client: JWT): Promise<string | null> {
  try {
    const at = await client.getAccessToken();
    return at?.token ?? null;
  } catch {
    return null;
  }
}

/* Find-or-create a folder by name under a parent. Cached across warm
   invocations so the stable Tool/Year/Date levels aren't re-resolved. */
async function ensureFolder(name: string, parentId: string, token: string): Promise<string> {
  const key = `${parentId}/${name}`;
  const cached = folderCache.get(key);
  if (cached) return cached;

  const q =
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents ` +
    `and mimeType='${FOLDER_MIME}' and trashed=false`;
  const listUrl =
    `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)` +
    "&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1";

  const found = await driveRequest(listUrl, { method: "GET" }, token);
  const existingId: string | undefined = found.ok ? found.json?.files?.[0]?.id : undefined;
  if (existingId) {
    folderCache.set(key, existingId);
    return existingId;
  }

  const created = await driveRequest(
    `${FILES_URL}?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    },
    token,
  );
  const createdId: string | undefined = created.ok ? created.json?.id : undefined;
  if (createdId) {
    folderCache.set(key, createdId);
    return createdId;
  }

  throw new Error(`folder "${name}": ${created.reason || found.reason || "unresolved"}`);
}

function toBuffer(part: string | Uint8Array): Uint8Array {
  return typeof part === "string" ? new TextEncoder().encode(part) : part;
}

/* Upload a single artifact (text or binary) into the target folder. */
async function uploadFile(file: ArchiveFile, folderId: string, token: string): Promise<HttpResult> {
  const name = cleanFolderName(file.name);
  const mimeType = file.mimeType || guessMime(name);
  const metadata = { name, parents: [folderId], mimeType };

  let payload: Uint8Array;
  if (typeof file.contentBase64 === "string" && file.contentBase64.length) {
    const b64 = file.contentBase64.includes(",")
      ? file.contentBase64.slice(file.contentBase64.indexOf(",") + 1)
      : file.contentBase64;
    payload = Buffer.from(b64, "base64");
  } else {
    payload = new TextEncoder().encode(typeof file.content === "string" ? file.content : "");
  }

  const boundary = `anantam_${randomUUID()}`;
  const head =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;

  const headBuf = toBuffer(head);
  const tailBuf = toBuffer(tail);
  const body = new Uint8Array(headBuf.length + payload.length + tailBuf.length);
  body.set(headBuf, 0);
  body.set(payload, headBuf.length);
  body.set(tailBuf, headBuf.length + payload.length);

  return driveRequest(
    UPLOAD_URL,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
    token,
  );
}

function normalizeFiles(files: ArchiveFile[] | undefined): ArchiveFile[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter(
      (f): f is ArchiveFile =>
        !!f &&
        typeof f.name === "string" &&
        (typeof f.content === "string" || typeof f.contentBase64 === "string"),
    )
    .slice(0, 12);
}

/**
 * Archive a bundle of artifacts into the dated Drive hierarchy. Best-effort:
 * resolves with a result object on any failure and NEVER throws.
 */
export async function archiveBundle(input: ArchiveBundle): Promise<ArchiveResult> {
  const uploadId = safeUploadId(input?.uploadId);
  const timestamp = safeTimestamp(input?.timestamp);
  const tool = cleanFolderName((input && input.tool) || "Unknown");

  try {
    const client = getClient();
    const root = process.env.GDRIVE_ARCHIVE_FOLDER_ID?.trim();

    if (!client || !root) {
      if (!warnedNotConfigured) {
        warnedNotConfigured = true;
        console.info(
          "[Google Drive Archive] Not configured " +
            `(${!client ? "no service-account credentials" : "no GDRIVE_ARCHIVE_FOLDER_ID"}); ` +
            "archival is disabled. This does not affect the application.",
        );
      }
      return { ok: false, uploadId, timestamp, reason: "Not configured" };
    }

    const token = await getToken(client);
    if (!token) {
      logFailure(tool, uploadId, "Authentication failed: no access token");
      return { ok: false, uploadId, timestamp, reason: "Authentication failed" };
    }

    // Build the dated folder chain: <root>/<Tool>/<YYYY>/<MM-DD>/<uploadId>
    const day = timestamp.slice(0, 10); // YYYY-MM-DD (ISO)
    const year = day.slice(0, 4);
    const monthDay = day.slice(5); // MM-DD
    let folderId: string;
    try {
      const toolFolder = await ensureFolder(tool, root, token);
      const yearFolder = await ensureFolder(year, toolFolder, token);
      const dayFolder = await ensureFolder(monthDay, yearFolder, token);
      folderId = await ensureFolder(uploadId, dayFolder, token);
    } catch (err) {
      logFailure(tool, uploadId, `Could not prepare archive folder: ${short(err)}`);
      return { ok: false, uploadId, timestamp, reason: "Folder unavailable" };
    }

    const folderPath = `${tool}/${year}/${monthDay}/${uploadId}`;
    const clientFiles = normalizeFiles(input?.files);

    // Server always writes an authoritative metadata.json for debugging.
    const serverMeta = {
      tool,
      uploadId,
      timestamp,
      date: day,
      folderPath,
      rootFolderId: root,
      artifacts: clientFiles.map((f) => cleanFolderName(f.name)),
      client: input?.meta ?? null,
    };
    const allFiles: ArchiveFile[] = [
      { name: "metadata.json", mimeType: "application/json", content: JSON.stringify(serverMeta, null, 2) },
      ...clientFiles,
    ];

    const uploaded: string[] = [];
    const failed: string[] = [];
    for (const f of allFiles) {
      const r = await uploadFile(f, folderId, token);
      if (r.ok) uploaded.push(cleanFolderName(f.name));
      else {
        failed.push(cleanFolderName(f.name));
        logFailure(tool, uploadId, `Upload of "${f.name}" failed: ${r.reason || "unknown"}`);
      }
    }

    const ok = uploaded.length > 0 && failed.length === 0;
    if (ok) {
      console.info(
        `[Google Drive Archive] ${tool} archived ${uploaded.length} file(s) → ${folderPath}`,
      );
    }
    return {
      ok,
      uploadId,
      timestamp,
      folderId,
      folderPath,
      uploaded,
      failed: failed.length ? failed : undefined,
      reason: ok ? undefined : "Partial or failed upload",
    };
  } catch (err) {
    // Absolute backstop — archiveBundle must NEVER throw.
    logFailure(tool, uploadId, `Unexpected internal error: ${short(err)}`);
    return { ok: false, uploadId, timestamp, reason: "Unexpected error" };
  }
}
