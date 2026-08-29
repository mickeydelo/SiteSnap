import archiver from 'archiver';
import fs from 'fs';

/**
 * Compress the contents of sourceDir into a ZIP archive at outputPath.
 * Device directories and the run manifest are preserved at the archive root.
 *
 * @param {string} sourceDir   Directory whose contents should be archived
 * @param {string} outputPath  Destination .zip file path
 * @returns {Promise<void>}
 */
export function zipDirectory(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(outputPath);
    // PNGs are already compressed; level 1 keeps packaging fast with negligible
    // impact on archive size, especially for large full-page captures.
    const archive = archiver('zip', { zlib: { level: 1 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', error => {
      if (error.code !== 'ENOENT') reject(error);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
