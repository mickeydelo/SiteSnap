import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR = path.join(ROOT_DIR, 'sites');
const MAX_JOBS = 20;
const IS_VERCEL = process.env.VERCEL === '1';
const RUNTIME_MODE = IS_VERCEL ? 'vercel-preview' : 'local';
const CAPTURE_ENABLED = !IS_VERCEL;
const LOCAL_RUNNER_PATH = ['.', 'core', 'runner.js'].join('/');

const app = express();
const jobs = new Map();
let localRunnerPromise = null;

app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
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

app.post('/api/run', (request, response) => {
  if (!CAPTURE_ENABLED) {
    return response.status(503).json({
      code: 'LOCAL_CAPTURE_ONLY',
      error: 'Hosted preview is read-only. Run SiteSnap locally for deterministic Chromium captures.',
    });
  }

  const { jobId: requestedJobId, siteId, config: configOverride } = request.body ?? {};
  const siteDir = resolveSiteDir(siteId);
  if (!siteDir) return response.status(404).json({ error: 'Site not found.' });
  if (configOverride && (!Array.isArray(configOverride.pages) || !configOverride.baseUrl)) {
    return response.status(400).json({ error: 'Invalid capture configuration.' });
  }

  evictOldJobs();
  const jobId = typeof requestedJobId === 'string' && requestedJobId.length <= 100
    ? requestedJobId
    : randomUUID();
  const job = {
    status: 'running',
    entries: [],
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
      return;
    }
    job.log.push(String(message));
    if (job.log.length > 200) job.log.shift();
  };

  loadLocalRunner()
    .then(run => run(siteDir, null, configOverride ?? null, onProgress))
    .then(zipPath => Object.assign(job, { status: 'done', zipPath }))
    .catch(error => Object.assign(job, { status: 'error', error: error.message }));

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
  if (!job || job.status !== 'done' || !job.zipPath || !fs.existsSync(job.zipPath)) {
    return response.status(404).json({ error: 'Capture archive is not ready.' });
  }
  return response.download(job.zipPath, path.basename(job.zipPath));
});

app.get('/run', (_request, response) => {
  response.sendFile(path.join(ROOT_DIR, 'ui', 'run.html'));
});

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

function loadLocalRunner() {
  localRunnerPromise ??= import(LOCAL_RUNNER_PATH).then(module => module.run);
  return localRunnerPromise;
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

if (!IS_VERCEL) startServer(Number(process.env.PORT) || 3000);
