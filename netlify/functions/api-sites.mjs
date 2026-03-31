import path from 'path';
import fs from 'fs';

// On Lambda, included_files land at LAMBDA_TASK_ROOT; locally at project root.
const SITES_DIR = process.env.LAMBDA_TASK_ROOT
  ? path.join(process.env.LAMBDA_TASK_ROOT, 'sites')
  : path.join(process.cwd(), 'sites');

export const handler = async () => {
  if (!fs.existsSync(SITES_DIR)) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' };
  }

  const sites = fs.readdirSync(SITES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      let name = d.name;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(SITES_DIR, d.name, 'metadata.json'), 'utf8'));
        name = meta.siteName || name;
      } catch { /* fall back to dir name */ }
      return { id: d.name, name };
    });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sites),
  };
};
