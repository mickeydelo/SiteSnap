import path from 'path';
import fs from 'fs';
import { getStore } from '@netlify/blobs';
import { run } from '../../core/runner.js';

const SITES_DIR = process.env.LAMBDA_TASK_ROOT
  ? path.join(process.env.LAMBDA_TASK_ROOT, 'sites')
  : new URL('../../sites', import.meta.url).pathname;

export const handler = async (event) => {
  const { jobId, siteId, username, password, config: configOverride } =
    JSON.parse(event.body || '{}');

  if (!jobId || !siteId || !username || !password) return;

  const siteDir = path.join(SITES_DIR, siteId);
  if (!fs.existsSync(path.join(siteDir, 'config.json'))) return;

  const jobsStore         = getStore('sitesnap-jobs');
  const screenshotsStore  = getStore('sitesnap-screenshots');
  const zipsStore         = getStore('sitesnap-zips');

  // Write initial state so the status poll finds the job immediately.
  const jobState = {
    status: 'running', total: 0, entries: [], lastLog: null, error: null,
  };
  await jobsStore.setJSON(jobId, jobState);

  const onProgress = async (msg) => {
    if (!msg) return;
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
  };

  try {
    const zipPath = await run(
      siteDir,
      { username, password },
      configOverride ?? null,
      onProgress,
      '/tmp',
    );

    const zipBuffer = fs.readFileSync(zipPath);
    await zipsStore.set(jobId, zipBuffer, {
      metadata: { contentType: 'application/zip' },
    });
    fs.unlinkSync(zipPath);

    jobState.status = 'done';
    await jobsStore.setJSON(jobId, { ...jobState });
  } catch (err) {
    jobState.status = 'error';
    jobState.error  = err.message;
    await jobsStore.setJSON(jobId, { ...jobState });
  }
};
