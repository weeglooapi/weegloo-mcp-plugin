import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Writes file content to localPath, creating parent directories as needed. */
export function writeContentFile(localPath, content) {
  const dir = path.dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, content, 'utf-8');
}
