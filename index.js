import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { run } from './core/runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR  = path.join(__dirname, 'sites');

const app  = express();
const jobs = new Map(); // jobId → { status, entries[], total, log[], zipPath, error }

app.use(express.json({ limit: '2mb' })); // config overrides can be large-ish
app.use(express.static(path.join(__dirname, 'ui')));

// ---------------------------------------------------------------------------
// API: list available sites
// ---------------------------------------------------------------------------

app.get('/api/sites', (_req, res) => {
  if (!fs.existsSync(SITES_DIR)) return res.json([]);

  const sites = fs
    .readdirSync(SITES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dir  = path.join(SITES_DIR, d.name);
      let   name = d.name;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
        name = meta.siteName || name;
      } catch {
        // fall back to directory name
      }
      return { id: d.name, name };
    });

  res.json(sites);
});

// ---------------------------------------------------------------------------
// API: return a site's config (used by run.html to build the UI)
// ---------------------------------------------------------------------------

app.get('/api/config/:siteId', (req, res) => {
  const configPath = path.join(SITES_DIR, req.params.siteId, 'config.json');
  if (!fs.existsSync(configPath)) {
    return res.status(404).json({ error: 'Site config not found.' });
  }
  res.json(JSON.parse(fs.readFileSync(configPath, 'utf8')));
});

// ---------------------------------------------------------------------------
// API: start a screenshot run
// ---------------------------------------------------------------------------

app.post('/api/run', (req, res) => {
  const { siteId, username, password, config: configOverride } = req.body;

  if (!siteId || !username || !password) {
    return res.status(400).json({ error: 'siteId, username, and password are required.' });
  }

  const siteDir = path.join(SITES_DIR, siteId);
  if (!fs.existsSync(path.join(siteDir, 'config.json'))) {
    return res.status(404).json({ error: 'Site not found.' });
  }

  const jobId = randomUUID();
  const job   = { status: 'running', entries: [], total: 0, log: [], zipPath: null, error: null };
  jobs.set(jobId, job);

  const onProgress = msg => {
    if (msg && typeof msg === 'object') {
      if (msg.type === 'total')   { job.total = msg.total; }
      else if (msg.type === 'capture') { job.entries.push({ label: msg.label, filepath: msg.filepath }); }
    } else {
      job.log.push(msg);
    }
  };

  // Fire-and-forget — credentials are passed directly and never stored
  run(siteDir, { username, password }, configOverride ?? null, onProgress)
    .then(zipPath => Object.assign(job, { status: 'done',  zipPath }))
    .catch(err   => Object.assign(job, { status: 'error', error: err.message }));

  res.json({ jobId });
});

// ---------------------------------------------------------------------------
// API: poll job status
// ---------------------------------------------------------------------------

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({
    status:  job.status,
    entries: job.entries.map((e, i) => ({ label: e.label, index: i })),
    total:   job.total,
    lastLog: job.log[job.log.length - 1] ?? null,
    zipPath: job.zipPath,
    error:   job.error,
  });
});

// ---------------------------------------------------------------------------
// API: serve capture thumbnail (raw PNG, browser scales via CSS)
// ---------------------------------------------------------------------------

app.get('/api/thumbnail/:jobId/:index', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();
  const idx   = Number(req.params.index);
  const entry = job.entries[idx];
  if (!entry) return res.status(404).end();
  if (!fs.existsSync(entry.filepath)) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=600');
  fs.createReadStream(entry.filepath).pipe(res);
});

// ---------------------------------------------------------------------------
// API: download completed ZIP
// ---------------------------------------------------------------------------

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.zipPath) {
    return res.status(404).json({ error: 'Not ready or job not found.' });
  }
  res.download(job.zipPath, path.basename(job.zipPath));
});

// ---------------------------------------------------------------------------
// SPA route: serve run.html at /run
// ---------------------------------------------------------------------------

app.get('/run', (_req, res) => {
  res.sendFile(path.join(__dirname, 'ui', 'run.html'));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function startServer(port) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`SiteSnap → ${url}`);
    const cmd = process.platform === 'win32' ? `start ${url}`
      : process.platform === 'darwin'        ? `open ${url}`
      : `xdg-open ${url}`;
    exec(cmd);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      startServer(port + 1);
    } else {
      throw err;
    }
  });
}

startServer(Number(process.env.PORT) || 3000);
