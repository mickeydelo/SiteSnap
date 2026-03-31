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
const jobs = new Map(); // jobId → { status, zipPath, error }

app.use(express.json());
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
// API: start a screenshot run
// ---------------------------------------------------------------------------

app.post('/api/run', (req, res) => {
  const { siteId, username, password } = req.body;

  if (!siteId || !username || !password) {
    return res.status(400).json({ error: 'siteId, username, and password are required.' });
  }

  const siteDir = path.join(SITES_DIR, siteId);
  if (!fs.existsSync(path.join(siteDir, 'config.json'))) {
    return res.status(404).json({ error: 'Site not found.' });
  }

  const jobId = randomUUID();
  jobs.set(jobId, { status: 'running', zipPath: null, error: null });

  // Fire-and-forget — credentials are passed directly and never stored
  run(siteDir, { username, password })
    .then(zipPath => jobs.set(jobId, { status: 'done',  zipPath, error: null }))
    .catch(err   => jobs.set(jobId, { status: 'error', zipPath: null, error: err.message }));

  res.json({ jobId });
});

// ---------------------------------------------------------------------------
// API: poll job status
// ---------------------------------------------------------------------------

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
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
