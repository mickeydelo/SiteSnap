import path from 'path';
import fs from 'fs';

const SITES_DIR = process.env.LAMBDA_TASK_ROOT
  ? path.join(process.env.LAMBDA_TASK_ROOT, 'sites')
  : new URL('../../sites', import.meta.url).pathname;

export const handler = async (event) => {
  // Path: /api/config/<siteId>  →  last segment is the siteId
  const siteId = event.queryStringParameters?.siteId
    || event.path?.split('/').filter(Boolean).pop();

  if (!siteId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'siteId required' }) };
  }

  const configPath = path.join(SITES_DIR, siteId, 'config.json');
  if (!fs.existsSync(configPath)) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Site config not found.' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: fs.readFileSync(configPath, 'utf8'),
  };
};
