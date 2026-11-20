import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const mediaDir = resolve(process.env.DATA_DIR || './data', 'videos');
mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
export const mediaPath = (id) => resolve(mediaDir, id + '.mp4');
