/**
 * Resource source abstraction for installing skill/rule file CONTENT.
 *
 * Two modes, chosen automatically per ref:
 *   - 'bundle': download weegloo-bundle.zip once from the Release asset CDN and
 *     extract it in memory (fflate). Serving files is then a local map lookup —
 *     no git client, and no GitHub request at all beyond the single zip GET.
 *   - 'remote': fall back to per-file raw.githubusercontent.com fetches when no
 *     release bundle exists for the ref (e.g. a feature branch). This preserves
 *     the previous behavior so the installer keeps working before any release.
 *
 * Both expose the same async API so installers don't branch on the mode:
 *   getSkillFile(skillId, fileName) -> Promise<string>
 *   getRuleText(ruleId)            -> Promise<string>   // the .mdc source
 */
import { unzipSync } from 'fflate';
import { fetchBundleZip, fetchTextFromRepo, repoContentPath } from './github.js';

const decoder = new TextDecoder();

/** Normalizes a zip entry key (strip a leading "./" some zip tools add). */
function normalizeKey(key) {
  return key.replace(/^\.\//, '');
}

function makeBundleSource(zipBytes) {
  const raw = unzipSync(zipBytes);
  const files = new Map();
  for (const [key, data] of Object.entries(raw)) {
    if (key.endsWith('/')) continue; // directory entry
    files.set(normalizeKey(key), data);
  }

  const read = (key) => {
    const data = files.get(key);
    if (!data) throw new Error(`release bundle is missing "${key}"`);
    return decoder.decode(data);
  };

  return {
    mode: 'bundle',
    getSkillFile: async (skillId, fileName) => read(`skills/${skillId}/${fileName}`),
    getRuleText: async (ruleId) => read(`rules/${ruleId}.mdc`),
  };
}

function makeRemoteSource(ref, repoContentPrefix) {
  return {
    mode: 'remote',
    getSkillFile: (skillId, fileName) =>
      fetchTextFromRepo(ref, repoContentPath(repoContentPrefix, `skills/${skillId}/${fileName}`)),
    getRuleText: (ruleId) =>
      fetchTextFromRepo(ref, repoContentPath(repoContentPrefix, `rules/${ruleId}.mdc`)),
  };
}

/**
 * Resolves the resource source for a ref: tries the Release bundle first, then
 * falls back to per-file raw downloads. The returned object's `mode` tells the
 * caller which path was taken (useful for UI/logging).
 *
 * @param {{ ref: string, repoContentPrefix: string }} opts
 * @returns {Promise<{ mode: 'bundle'|'remote', getSkillFile: Function, getRuleText: Function }>}
 */
export async function prepareResourceSource({ ref, repoContentPrefix }) {
  const zip = await fetchBundleZip(ref);
  if (zip) {
    try {
      return makeBundleSource(zip);
    } catch {
      // Corrupt/unexpected zip — degrade to remote rather than failing the install.
    }
  }
  return makeRemoteSource(ref, repoContentPrefix);
}
