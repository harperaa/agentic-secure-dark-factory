// Dependency cooldown check for a pull request's lockfile.
//
// The product template already holds new package versions back: `.npmrc` sets
// `min-release-age=7` for `npm install`, and Dependabot waits 7 days (14 for a major). Neither is
// proof about a pull request: `npm ci` ignores the setting, `--min-release-age=0` is a documented
// escape hatch, and a lockfile can be edited by hand. What merges is the lockfile, so this checks
// the lockfile: every package version the PR adds or changes must have been public on the npm
// registry for the window. When it holds, the gate stops forcing a human for the dependency
// change (design §4.9); when it fails or cannot be checked, the change stays forced gray with the
// reason.

export const MIN_DAYS = 7;
export const MAJOR_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const REGISTRY = "https://registry.npmjs.org/";

/** Only v2 and v3 lockfiles carry the `packages` map this reads; a v1 lockfile would look empty. */
export const supportedLockfile = (lock) => Number(lock?.lockfileVersion) >= 2 && typeof lock?.packages === "object" && lock.packages !== null;

/** location in node_modules -> entry (with its name) for every installed package in a v2/v3 lockfile. */
function lockEntries(lock) {
  const out = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === "" || !key.includes("node_modules/")) continue; // the root project, or a workspace
    out.set(key, { ...entry, name: entry.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length) });
  }
  return out;
}

const major = (version) => Number(String(version).split(".")[0]);

/**
 * The package versions in `head` that are not in `base`, each with the window it must clear:
 * 14 days when it replaces a different major at the same location, else 7. Entries that do not come
 * from the npm registry (git, tarball, file links) cannot be dated and are returned as unverifiable.
 */
export function addedVersions(baseLock, headLock) {
  const base = lockEntries(baseLock);
  const head = lockEntries(headLock);
  const baseVersions = new Map(); // name -> Set(version), anywhere in the tree
  for (const entry of base.values()) {
    if (!baseVersions.has(entry.name)) baseVersions.set(entry.name, new Set());
    baseVersions.get(entry.name).add(entry.version);
  }
  const added = [];
  const unverifiable = [];
  for (const [key, entry] of head) {
    const { name, version } = entry;
    if (baseVersions.get(name)?.has(version)) continue;
    if (entry.link || !version) continue; // a symlinked local package carries no published release
    if (typeof entry.resolved === "string" && !entry.resolved.startsWith(REGISTRY)) {
      unverifiable.push({ name, version, reason: `not from the npm registry (${entry.resolved.split("#")[0]})` });
      continue;
    }
    // The window is judged against the version this one replaces: the entry at the same location
    // in base. Another major of the same package elsewhere in the tree says nothing about it.
    const replaced = base.get(key);
    const majorBump = replaced !== undefined && replaced.name === name && major(replaced.version) !== major(version);
    added.push({ name, version, requiredDays: majorBump ? MAJOR_DAYS : MIN_DAYS });
  }
  return { added, unverifiable };
}

/**
 * Check every added version against its publish time. `publishedAt(name, version)` resolves to an
 * ISO time or undefined. Returns `{ ok, checked, violations }`; `ok` only when every added version
 * was dated and old enough, and nothing was unverifiable.
 */
export async function cooldownVerdict(baseLock, headLock, publishedAt, now = Date.now()) {
  for (const [side, lock] of [["base", baseLock], ["head", headLock]]) {
    if (!supportedLockfile(lock)) {
      return { ok: false, checked: 0, violations: [`${side} package-lock.json is lockfileVersion ${lock?.lockfileVersion ?? "unknown"}; only v2 and v3 lockfiles can be checked`] };
    }
  }
  const { added, unverifiable } = addedVersions(baseLock, headLock);
  const violations = unverifiable.map((u) => `${u.name}@${u.version}: ${u.reason}`);
  const queue = [...added];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const at = await publishedAt(item.name, item.version);
      const age = at ? (now - Date.parse(at)) / DAY : NaN;
      if (!Number.isFinite(age)) {
        violations.push(`${item.name}@${item.version}: publish date not found on the npm registry`);
      } else if (age < item.requiredDays) {
        violations.push(`${item.name}@${item.version}: published ${Math.max(0, Math.floor(age))} day(s) ago; the cooldown is ${item.requiredDays}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  violations.sort();
  return { ok: violations.length === 0, checked: added.length, violations };
}

/** Publish times from the public npm registry, one packument fetch per package name per process. */
export function registryPublishedAt(fetchImpl = fetch) {
  const cache = new Map();
  return async (name, version) => {
    if (!cache.has(name)) {
      cache.set(
        name,
        fetchImpl(REGISTRY + name.replace("/", "%2f"), { headers: { accept: "application/json" } })
          .then((r) => (r.ok ? r.json() : null))
          .then((doc) => doc?.time ?? null)
          .catch(() => null),
      );
    }
    const time = await cache.get(name);
    return time?.[version];
  };
}
