import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, timingSafeEqual } from 'crypto';
import { exec } from 'child_process';
import { rm } from 'fs/promises';
import { run as runCaptures } from './core/runner.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR = path.join(ROOT_DIR, 'sites');
const APP_VERSION = '1.1.0';
const MAX_JOBS = 20;
const JOB_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_HOSTED_CAPTURES = 60;
const IS_VERCEL = process.env.VERCEL === '1';
const HOSTED_STORAGE_READY = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const HOSTED_KEY_READY = Boolean(process.env.SITESNAP_CAPTURE_KEY);
const HOSTED_CAPTURE_READY = HOSTED_STORAGE_READY && HOSTED_KEY_READY;
const RUNTIME_MODE = IS_VERCEL
  ? (HOSTED_CAPTURE_READY ? 'vercel-capture' : 'vercel-setup')
  : 'local';
const CAPTURE_ENABLED = !IS_VERCEL || HOSTED_CAPTURE_READY;
const CAPTURE_KEY_REQUIRED = IS_VERCEL && HOSTED_KEY_READY;

const app = express();
const jobs = new Map();
let hostedCaptureActive = false;
let localCaptureActive = false;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb', strict: true }));
app.use(express.static(path.join(ROOT_DIR, 'ui'), {
  etag: true,
  maxAge: IS_VERCEL ? '1h' : 0,
  lastModified: true,
}));

app.get('/api/health', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({
    ok: true,
    mode: RUNTIME_MODE,
    captureEnabled: CAPTURE_ENABLED,
    captureKeyRequired: CAPTURE_KEY_REQUIRED,
    message: hostedRuntimeMessage(),
    version: APP_VERSION,
    limits: IS_VERCEL ? { maxCaptures: MAX_HOSTED_CAPTURES, maxDeviceScale: 1 } : null,
  });
});

app.get('/api/sites', (_request, response) => {
  setHostedCache(response, 300);
  response.json(listSites());
});

app.get('/api/config/:siteId', (request, response) => {
  const siteDir = resolveSiteDir(request.params.siteId);
  if (!siteDir) return response.status(404).json({ error: 'Site not found.' });
  try {
    setHostedCache(response, 300);
    return response.json(readJson(path.join(siteDir, 'config.json')));
  } catch (error) {
    return response.status(500).json({ error: `Invalid site config: ${error.message}` });
  }
});

app.get('/site-image/:siteId', (request, response) => {
  const siteDir = resolveSiteDir(request.params.siteId);
  if (!siteDir) return response.sendStatus(404);
  const metadata = safeReadJson(path.join(siteDir, 'metadata.json')) ?? {};
  const imageName = metadata.image || `${request.params.siteId}.png`;
  const imagePath = path.join(siteDir, 'images', path.basename(imageName));
  if (!fs.existsSync(imagePath)) return response.sendStatus(404);
  setHostedCache(response, 86400);
  return response.sendFile(imagePath);
});

app.post('/api/run', async (request, response) => {
  if (!CAPTURE_ENABLED) {
    return response.status(503).json({
      code: HOSTED_STORAGE_READY ? 'HOSTED_CAPTURE_KEY_REQUIRED' : 'HOSTED_STORAGE_REQUIRED',
      error: HOSTED_STORAGE_READY
        ? 'Hosted capture needs SITESNAP_CAPTURE_KEY configured for this environment.'
        : 'Hosted capture needs a public Vercel Blob store connected to this project.',
    });
  }

  const { jobId: requestedJobId, siteId, config: configOverride } = request.body ?? {};
  const siteDir = resolveSiteDir(siteId);
  if (!siteDir) return response.status(404).json({ error: 'Site not found.' });
  if (configOverride && (!Array.isArray(configOverride.pages) || !configOverride.baseUrl)) {
    return response.status(400).json({ error: 'Invalid capture configuration.' });
  }

  if (IS_VERCEL) {
    if (!isHostedRequestAuthorized(request)) {
      return response.status(401).json({
        code: 'CAPTURE_KEY_REQUIRED',
        error: 'The server capture key is missing or incorrect.',
      });
    }
    return runHostedCapture(request, response, siteDir, siteId, requestedJobId, configOverride);
  }

  if (localCaptureActive) {
    return response.status(409).json({
      code: 'CAPTURE_ALREADY_RUNNING',
      error: 'A local capture is already running. Wait for it to finish before starting another.',
    });
  }
  evictOldJobs();
  const jobId = normalizeJobId(requestedJobId);
  if (jobs.has(jobId)) {
    return response.status(409).json({
      code: 'JOB_ID_IN_USE',
      error: 'That capture job already exists. Start a new run with a fresh job id.',
    });
  }
  const job = {
    status: 'running',
    entries: [],
    failures: [],
    total: 0,
    log: [],
    zipPath: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  const onProgress = message => {
    if (message && typeof message === 'object') {
      if (message.type === 'total') job.total = Number(message.total) || 0;
      if (message.type === 'capture') {
        job.entries.push({
          label: message.label,
          filename: message.filename,
          filepath: message.filepath,
        });
      }
      if (message.type === 'failure') {
        job.failures.push({
          device: message.device,
          pageId: message.pageId,
          stepId: message.stepId,
          label: message.label,
          message: message.message,
          debugFilename: message.debugFilename,
        });
      }
      return;
    }
    job.log.push(String(message));
    if (job.log.length > 200) job.log.shift();
  };

  localCaptureActive = true;
  Promise.resolve()
    .then(() => runCaptures(siteDir, null, configOverride ?? null, onProgress))
    .then(result => Object.assign(job, {
      status: result.status,
      zipPath: result.zipPath,
      failures: result.failures,
    }))
    .catch(error => Object.assign(job, { status: 'error', error: error.message }))
    .finally(() => {
      localCaptureActive = false;
      const timer = setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
      timer.unref?.();
    });

  return response.json({ jobId });
});

app.get('/api/status/:jobId', (request, response) => {
  const job = jobs.get(request.params.jobId);
  if (!job) return response.status(404).json({ error: 'Job not found.' });
  return response.json({
    status: job.status,
    entries: job.entries.map((entry, index) => ({
      label: entry.label,
      filename: entry.filename,
      index,
    })),
    total: job.total,
    lastLog: job.log.at(-1) ?? null,
    error: job.error,
    failures: job.failures,
    failureCount: job.failures.length,
    archiveReady: Boolean(job.zipPath && fs.existsSync(job.zipPath)),
  });
});

app.get('/api/thumbnail/:jobId/:index', (request, response) => {
  const entry = jobs.get(request.params.jobId)?.entries[Number(request.params.index)];
  if (!entry || !fs.existsSync(entry.filepath)) return response.sendStatus(404);
  response.setHeader('Content-Type', 'image/png');
  response.setHeader('Cache-Control', 'private, max-age=600');
  return fs.createReadStream(entry.filepath).pipe(response);
});

app.get('/api/download/:jobId', (request, response) => {
  const job = jobs.get(request.params.jobId);
  if (!job || !job.zipPath || !fs.existsSync(job.zipPath)) {
    return response.status(404).json({ error: 'Capture archive is not ready.' });
  }
  return response.download(job.zipPath, path.basename(job.zipPath));
});

app.get('/run', (_request, response) => {
  response.sendFile(path.join(ROOT_DIR, 'ui', 'run.html'));
});

app.use('/api', (_request, response) => {
  response.status(404).json({ code: 'API_NOT_FOUND', error: 'API route not found.' });
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  const isPayloadTooLarge = error?.type === 'entity.too.large';
  const isInvalidJson = error instanceof SyntaxError && error?.type === 'entity.parse.failed';
  const status = isPayloadTooLarge ? 413 : (isInvalidJson ? 400 : 500);
  const message = isPayloadTooLarge
    ? 'Capture configuration exceeds the 256 KB request limit.'
    : (isInvalidJson ? 'Request body must contain valid JSON.' : 'Unexpected server error.');
  if (status === 500) console.error(`[${request.method} ${request.path}]`, error);
  return response.status(status).json({
    code: isPayloadTooLarge ? 'PAYLOAD_TOO_LARGE' : (isInvalidJson ? 'INVALID_JSON' : 'INTERNAL_ERROR'),
    error: message,
  });
});

async function runHostedCapture(
  _request,
  response,
  siteDir,
  siteId,
  requestedJobId,
  configOverride,
) {
  if (hostedCaptureActive) {
    return response.status(409).json({
      code: 'CAPTURE_ALREADY_RUNNING',
      error: 'This server instance is already running a capture. Try again shortly.',
    });
  }

  hostedCaptureActive = true;
  response.setHeader('Cache-Control', 'no-store');
  const jobId = normalizeJobId(requestedJobId);
  const outputBaseDir = path.join(os.tmpdir(), `sitesnap-${jobId}`);

  try {
    const defaultConfig = readJson(path.join(siteDir, 'config.json'));
    const hostedConfig = sanitizeHostedConfig(defaultConfig, configOverride);
    enforceHostedLimits(hostedConfig);

    const progress = { total: 0, entries: [], lastLog: null };
    const onProgress = message => {
      if (message && typeof message === 'object') {
        if (message.type === 'total') progress.total = Number(message.total) || 0;
        if (message.type === 'capture') {
          progress.entries.push({
            label: message.label,
            filename: message.filename,
            index: progress.entries.length,
          });
        }
      } else {
        progress.lastLog = String(message);
      }
    };

    const result = await runCaptures(siteDir, null, hostedConfig, onProgress, outputBaseDir);
    const downloadUrl = await uploadHostedArchive(result.zipPath, siteId, jobId);

    return response.json({
      jobId,
      status: result.status,
      entries: progress.entries,
      total: progress.total,
      failures: result.failures,
      failureCount: result.failures.length,
      lastLog: result.status === 'done'
        ? 'Capture complete. ZIP archive uploaded.'
        : `Capture finished with ${result.failures.length} failed state${result.failures.length === 1 ? '' : 's'}.`,
      downloadUrl,
    });
  } catch (error) {
    const status = error.code === 'HOSTED_LIMIT' ? 400 : 500;
    return response.status(status).json({
      code: error.code || 'HOSTED_CAPTURE_FAILED',
      error: error.message || 'Hosted capture failed.',
    });
  } finally {
    hostedCaptureActive = false;
    await rm(outputBaseDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function uploadHostedArchive(zipPath, siteId, jobId) {
  const { put } = await import('@vercel/blob');
  const pathname = `sitesnap/${siteId}/${jobId}/${path.basename(zipPath)}`;
  const blob = await put(pathname, fs.createReadStream(zipPath), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/zip',
    multipart: true,
  });
  return blob.downloadUrl || blob.url;
}

export function sanitizeHostedConfig(defaultConfig, requestedConfig) {
  const sanitized = structuredClone(defaultConfig);
  if (!requestedConfig) return sanitized;

  for (const deviceName of ['desktop', 'mobile']) {
    const target = sanitized.devices?.[deviceName];
    const requested = requestedConfig.devices?.[deviceName];
    if (!target) continue;
    if (!requested) {
      target.enabled = false;
      continue;
    }
    target.enabled = requested.enabled !== false;
    target.viewport = sanitizeDimensions(requested.viewport, target.viewport);
    target.deviceScaleFactor = Number(requested.deviceScaleFactor) === 2 ? 2 : 1;
  }

  const requestedPages = new Map(
    (requestedConfig.pages ?? []).map(page => [page?.id, page]),
  );
  for (const page of sanitized.pages) {
    const requestedPage = requestedPages.get(page.id);
    if (!requestedPage) {
      page.enabled = false;
      page.steps.forEach(step => { step.enabled = false; });
      continue;
    }
    page.enabled = requestedPage.enabled !== false;
    const requestedSteps = new Map(
      (requestedPage.steps ?? []).map(step => [step?.id, step]),
    );
    for (const step of page.steps ?? []) {
      const requestedStep = requestedSteps.get(step.id);
      if (!requestedStep) {
        step.enabled = false;
        continue;
      }
      step.enabled = requestedStep.enabled === true;
      step.includeMobile = requestedStep.includeMobile !== false;
      step.captureMode = sanitizeCaptureMode(requestedStep.captureMode, step);
      step.desktop = sanitizeDimensions(requestedStep.desktop, step.desktop);
      step.mobile = sanitizeDimensions(requestedStep.mobile, step.mobile);
      copyEditableActionValues(step.actions, requestedStep.actions);
    }
  }

  return sanitized;
}

function sanitizeCaptureMode(requestedMode, defaultStep) {
  const allowed = new Set(['viewport', 'fullPage']);
  if (defaultStep.selector || defaultStep.focusSelector) allowed.add('element');
  return allowed.has(requestedMode) ? requestedMode : (defaultStep.captureMode || 'viewport');
}

function sanitizeDimensions(requested, fallback = {}) {
  return {
    width: clampInteger(requested?.width, fallback?.width ?? 1440, 320, 1920),
    height: clampInteger(requested?.height, fallback?.height ?? 900, 320, 1600),
  };
}

function copyEditableActionValues(defaultActions = [], requestedActions = []) {
  defaultActions.forEach((action, index) => {
    if (action.editable !== true) return;
    const requested = requestedActions[index];
    if (!requested || requested.type !== action.type) return;
    const value = String(requested.value ?? '').slice(0, 200);
    if (Array.isArray(action.options) && !action.options.includes(value)) return;
    action.value = value;
  });
}

export function enforceHostedLimits(config) {
  const enabled = countConfiguredCaptures(config);
  if (!enabled) throw hostedLimitError('Enable at least one capture before starting a server run.');
  if (enabled > MAX_HOSTED_CAPTURES) {
    throw hostedLimitError(`Hosted runs support up to ${MAX_HOSTED_CAPTURES} captures at a time.`);
  }
  for (const [name, device] of Object.entries(config.devices ?? {})) {
    if (device.enabled !== false && Number(device.deviceScaleFactor) > 1) {
      throw hostedLimitError(`Hosted ${name} capture supports 1× output. Use local mode for 2× output.`);
    }
  }
}

export function countConfiguredCaptures(config) {
  return Object.entries(config.devices ?? {}).reduce((total, [deviceName, device]) => {
    if (device.enabled === false) return total;
    return total + config.pages.reduce((pageTotal, page) => {
      if (page.enabled === false) return pageTotal;
      return pageTotal + (page.steps ?? []).filter(step => {
        if (step.enabled !== true) return false;
        if (deviceName === 'mobile' && (step.desktopOnly || step.includeMobile === false)) return false;
        if (deviceName === 'desktop' && step.mobileOnly) return false;
        return true;
      }).length;
    }, 0);
  }, 0);
}

function hostedLimitError(message) {
  const error = new Error(message);
  error.code = 'HOSTED_LIMIT';
  return error;
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeJobId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : randomUUID();
}

function isHostedRequestAuthorized(request) {
  const expected = process.env.SITESNAP_CAPTURE_KEY;
  if (!expected) return false;
  const authorization = request.get('authorization') || '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

function hostedRuntimeMessage() {
  if (!IS_VERCEL) return null;
  if (!HOSTED_STORAGE_READY) {
    return 'Hosted setup required · Connect a public Vercel Blob store, then redeploy to enable server capture.';
  }
  if (!HOSTED_KEY_READY) {
    return 'Hosted setup required · Add SITESNAP_CAPTURE_KEY to this environment, then redeploy.';
  }
  return 'Hosted capture · Chromium runs on Vercel and uploads the ZIP to Blob. Local mode remains the reference runtime.';
}

function listSites() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs.readdirSync(SITES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const siteDir = path.join(SITES_DIR, entry.name);
      if (!fs.existsSync(path.join(siteDir, 'config.json'))) return null;
      const metadata = safeReadJson(path.join(siteDir, 'metadata.json')) ?? {};
      const imageName = metadata.image || `${entry.name}.png`;
      const hasImage = fs.existsSync(path.join(siteDir, 'images', path.basename(imageName)));
      return {
        id: entry.name,
        name: metadata.siteName || entry.name,
        description: metadata.description || '',
        primaryUrl: metadata.primaryUrl || '',
        requiresCredentials: false,
        imageUrl: hasImage ? `/site-image/${entry.name}` : null,
      };
    })
    .filter(Boolean);
}

function resolveSiteDir(siteId) {
  if (typeof siteId !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(siteId)) return null;
  const siteDir = path.join(SITES_DIR, siteId);
  if (!fs.existsSync(path.join(siteDir, 'config.json'))) return null;
  return siteDir;
}

function readJson(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function safeReadJson(filepath) {
  try { return readJson(filepath); } catch { return null; }
}

function evictOldJobs() {
  while (jobs.size >= MAX_JOBS) {
    const oldest = [...jobs.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt)[0];
    if (!oldest) break;
    jobs.delete(oldest[0]);
  }
}

function setHostedCache(response, seconds) {
  if (!IS_VERCEL) return;
  response.setHeader(
    'Cache-Control',
    `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 12}`,
  );
}

function startServer(port) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`SiteSnap → ${url}`);
    if (process.env.SITESNAP_NO_OPEN === '1') return;
    const command = process.platform === 'win32'
      ? `start ${url}`
      : process.platform === 'darwin'
        ? `open ${url}`
        : `xdg-open ${url}`;
    exec(command);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') return startServer(port + 1);
    throw error;
  });
}

export default app;

const IS_DIRECT_ENTRY = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!IS_VERCEL && IS_DIRECT_ENTRY) startServer(Number(process.env.PORT) || 3000);
