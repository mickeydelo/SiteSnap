import path from 'path';
import fs from 'fs';
import { jobsStore, screenshotsStore, zipsStore } from './_blobs.mjs';
import { run } from '../../core/runner.js';

const SITES_DIR = process.env.LAMBDA_TASK_ROOT
  ? path.join(process.env.LAMBDA_TASK_ROOT, 'sites')
  : path.join(process.cwd(), 'sites');

export const handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return;
  }

  const { jobId, siteId, username, password, config: configOverride } = body;
  if (!jobId || !siteId) return;

  const jobs        = jobsStore();
  const screenshots = screenshotsStore();
  const zips        = zipsStore();

  const jobState = { status: 'running', total: 0, entries: [], lastLog: 'Starting…', error: null };
  await jobs.setJSON(jobId, { ...jobState }).catch(e => console.error('[bg] initial setJob failed:', e));

  const setJob = (patch) =>
    jobs.setJSON(jobId, patch).catch(e => console.error('[bg] setJob failed:', e));

  try {
    const siteDir = path.join(SITES_DIR, siteId);
    if (!fs.existsSync(path.join(siteDir, 'config.json'))) {
      await setJob({ status: 'error', error: `Site not found: ${siteId}`, entries: [], total: 0, lastLog: null });
      return;
    }

    let requiresCredentials = true;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(siteDir, 'metadata.json'), 'utf8'));
      requiresCredentials = meta.requiresCredentials !== false;
    } catch { /* fall back to requiring credentials */ }

    if (requiresCredentials && (!username || !password)) {
      await setJob({ status: 'error', error: 'Credentials required but not provided.', entries: [], total: 0, lastLog: null });
      return;
    }

    const onProgress = async (msg) => {
      if (!msg) return;
      try {
        if (typeof msg === 'object') {
          if (msg.type === 'total') {
            jobState.total = msg.total;
          } else if (msg.type === 'capture') {
            const idx    = jobState.entries.length;
            const buffer = fs.readFileSync(msg.filepath);
            await screenshots.set(`${jobId}/${idx}`, buffer, {
              metadata: { contentType: 'image/png' },
            });
            jobState.entries.push({ label: msg.label, index: idx });
          }
        } else if (typeof msg === 'string') {
          jobState.lastLog = msg.trim();
        }
        await jobs.setJSON(jobId, { ...jobState });
      } catch (e) {
        console.error('[bg] onProgress error:', e);
      }
    };

    const credentials = requiresCredentials ? { username, password } : null;
    const zipPath = await run(
      siteDir,
      credentials,
      configOverride ?? null,
      onProgress,
      '/tmp',
    );

    const zipBuffer = fs.readFileSync(zipPath);
    console.log(`[bg] ZIP size: ${zipBuffer.length} bytes`);
    await zips.set(jobId, zipBuffer, { metadata: { contentType: 'application/zip' } });
    console.log('[bg] ZIP uploaded to Blobs');
    fs.unlinkSync(zipPath);
    try { fs.rmSync(zipPath.replace(/\.zip$/, ''), { recursive: true, force: true }); } catch { /* best effort */ }

    jobState.status = 'done';
    await jobs.setJSON(jobId, { ...jobState });

  } catch (err) {
    console.error('[bg] Run failed:', err);
    await setJob({ status: 'error', error: err.message, entries: [], total: 0, lastLog: null });
  }
};
