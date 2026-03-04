import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const REPO = 'weeglooapi/weegloo-mcp-plugin';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;

export const SKILL_FILES = ['SKILL.md', 'metadata.json'];

/**
 * 사용할 GitHub ref(브랜치 또는 태그)를 결정합니다.
 *
 * 우선순위:
 *   1. CLI 인자  --ref <ref>
 *   2. 환경변수  WEEGLOO_REF
 *   3. package.json 의 pluginRef 필드
 *
 * npm dist-tag 과 GitHub 브랜치를 1:1 대응시키는 규칙:
 *   npx create-weegloo@latest  →  pluginRef: "latest"  → GitHub branch: latest
 *   npx create-weegloo@beta    →  pluginRef: "beta"    → GitHub branch: beta
 *   npx create-weegloo@0.1.0   →  pluginRef: "v0.1.0"  → GitHub tag:   v0.1.0
 */
export function getPluginRef() {
  const argIdx = process.argv.indexOf('--ref');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1];
  }
  if (process.env.WEEGLOO_REF) {
    return process.env.WEEGLOO_REF;
  }
  return pkg.pluginRef ?? 'latest';
}

/**
 * GitHub raw URL에서 파일을 내려받아 localPath에 씁니다.
 */
export async function downloadFile(ref, remotePath, localPath) {
  const url = `${RAW_BASE}/${ref}/${remotePath}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`네트워크 오류 — ${url}\n  ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n  ${url}`);
  }

  const text = await res.text();
  const dir = path.dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, text, 'utf-8');
}
