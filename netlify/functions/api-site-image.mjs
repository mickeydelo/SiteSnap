import path from 'path';
import fs from 'fs';

const SITES_DIR = process.env.LAMBDA_TASK_ROOT
  ? path.join(process.env.LAMBDA_TASK_ROOT, 'sites')
  : path.join(process.cwd(), 'sites');

export const handler = async (event) => {
  const siteId = event.queryStringParameters?.siteId
    || event.path?.split('/').filter(Boolean).pop();
  if (!siteId) return { statusCode: 400, body: 'siteId required' };

  const imgPath = path.join(SITES_DIR, siteId, 'images', `${siteId}.png`);
  if (!fs.existsSync(imgPath)) return { statusCode: 404, body: 'Not found' };

  const buffer = fs.readFileSync(imgPath);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
};
