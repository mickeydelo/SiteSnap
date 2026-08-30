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
fs.cpSync(sourceDir, outputDir, { recursive: true });
console.log('UI assets built → public/');
