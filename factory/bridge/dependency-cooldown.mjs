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

/** name -> Map(version -> entry) for every installed package in a v2/v3 package-lock.json. */
function lockPackages(lock) {
  const out = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === "" || !key.includes("node_modules/")) continue; // the root project, or a workspace
    const name = entry.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!out.has(name)) out.set(name, new Map());
    out.get(name).set(entry.version, entry);
  }
  return out;
}

const major = (version) => Number(String(version).split(".")[0]);

/**
 * The package versions in `head` that are not in `base`, each with the window it must clear:
 * 14 days when the package existed in base at a different major, else 7. Entries that do not come
 * from the npm registry (git, tarball, file links) cannot be dated and are returned as unverifiable.
 */
export function addedVersions(baseLock, headLock) {
  const base = lockPackages(baseLock);
  const head = lockPackages(headLock);
  const added = [];
  const unverifiable = [];
  for (const [name, versions] of head) {
    for (const [version, entry] of versions) {
      if (base.get(name)?.has(version)) continue;
      if (entry.link || !version) continue; // a symlinked local package carries no published release
      if (typeof entry.resolved === "string" && !entry.resolved.startsWith(REGISTRY)) {
        unverifiable.push({ name, version, reason: `not from the npm registry (${entry.resolved.split("#")[0]})` });
        continue;
      }
      const before = [...(base.get(name)?.keys() ?? [])];
      const majorBump = before.length > 0 && !before.some((v) => major(v) === major(version));
      added.push({ name, version, requiredDays: majorBump ? MAJOR_DAYS : MIN_DAYS });
    }
  }
  return { added, unverifiable };
}

/**
 * Check every added version against its publish time. `publishedAt(name, version)` resolves to an
 * ISO time or undefined. Returns `{ ok, checked, violations }`; `ok` only when every added version
 * was dated and old enough, and nothing was unverifiable.
 */
export async function cooldownVerdict(baseLock, headLock, publishedAt, now = Date.now()) {
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
