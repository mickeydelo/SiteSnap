import path from 'path';
import fs from 'fs';
import { getStore } from '@netlify/blobs';
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
  if (!jobId || !siteId || !username || !password) return;

  const jobsStore        = getStore('sitesnap-jobs');
  const screenshotsStore = getStore('sitesnap-screenshots');
  const zipsStore        = getStore('sitesnap-zips');

  // Write initial state immediately — poll may already be running
  const jobState = { status: 'running', total: 0, entries: [], lastLog: 'Starting…', error: null };
  await jobsStore.setJSON(jobId, { ...jobState }).catch(e => console.error('[bg] initial setJob failed:', e));

  const setJob = (patch) =>
    jobsStore.setJSON(jobId, patch).catch(e => console.error('[bg] setJob failed:', e));

  try {
    const siteDir = path.join(SITES_DIR, siteId);
    if (!fs.existsSync(path.join(siteDir, 'config.json'))) {
      await setJob({ status: 'error', error: `Site not found: ${siteId}`, entries: [], total: 0, lastLog: null });
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
            await screenshotsStore.set(`${jobId}/${idx}`, buffer, {
              metadata: { contentType: 'image/png' },
            });
            jobState.entries.push({ label: msg.label, index: idx });
          }
        } else if (typeof msg === 'string') {
          jobState.lastLog = msg.trim();
        }
        await jobsStore.setJSON(jobId, { ...jobState });
      } catch (e) {
        console.error('[bg] onProgress error:', e);
      }
    };

    const zipPath = await run(
      siteDir,
      { username, password },
      configOverride ?? null,
      onProgress,
      '/tmp',
    );

    const zipBuffer = fs.readFileSync(zipPath);
    await zipsStore.set(jobId, zipBuffer, { metadata: { contentType: 'application/zip' } });
    fs.unlinkSync(zipPath);

    jobState.status = 'done';
    await jobsStore.setJSON(jobId, { ...jobState });

  } catch (err) {
    console.error('[bg] Run failed:', err);
    await setJob({ status: 'error', error: err.message, entries: [], total: 0, lastLog: null });
  }
};
