import archiver from 'archiver';
import fs from 'fs';

/**
 * Compress the contents of sourceDir into a ZIP archive at outputPath.
 * Files are stored flat inside the archive root (no parent directory prefix).
 *
 * @param {string} sourceDir   Directory whose contents should be archived
 * @param {string} outputPath  Destination .zip file path
 * @returns {Promise<void>}
 */
export function zipDirectory(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false); // false = no leading directory in the archive
    archive.finalize();
  });
}
