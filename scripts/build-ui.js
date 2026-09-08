import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(rootDir, 'ui');
const outputDir = path.join(rootDir, 'public');

if (!fs.existsSync(path.join(sourceDir, 'index.html'))) {
  throw new Error('UI source is incomplete: ui/index.html is missing.');
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
// Vercel serves public/ before Express: never put protected pages or scripts here.
for (const directory of ['styles', 'assets']) {
  fs.cpSync(path.join(sourceDir, directory), path.join(outputDir, directory), { recursive: true });
}
console.log('Public styles and branding built → public/; pages remain behind Express login');
