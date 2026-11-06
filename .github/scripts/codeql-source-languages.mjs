// Keep this function standalone: the trusted workflow embeds the same policy
// without checking out or executing helpers from the analyzed PR's tree.
export function actionsRequiredForSource(commit, tree, expectedSha, symlinkTargets = new Map()) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const sha = (value) => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
  if (!sha(expectedSha) || !object(commit) || commit.sha !== expectedSha
      || !object(commit.tree) || !sha(commit.tree.sha)
      || commit.tree.sha.length !== expectedSha.length
      || !object(tree) || tree.sha !== commit.tree.sha
      || tree.truncated !== false || !Array.isArray(tree.tree)) return true;

  const entries = new Map();
  for (const entry of tree.tree) {
    if (!object(entry) || typeof entry.path !== "string" || !entry.path
        || /[\\\u0000-\u001f\u007f]/u.test(entry.path)
        || entry.path.split("/").some((part) => !part || part === "." || part === "..")
        || entries.has(entry.path) || !sha(entry.sha)
        || entry.sha.length !== expectedSha.length) return true;
    const regular = entry.type === "blob" && ["100644", "100755"].includes(entry.mode);
    const directory = entry.type === "tree" && entry.mode === "040000";
    const symlink = entry.type === "blob" && entry.mode === "120000";
    // Submodules and unfamiliar entry shapes cannot prove absence. Symlink
    // targets are checked only after the complete tree passes these guards.
    if (!regular && !directory && !symlink) return true;
    if (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 0)) return true;
    entries.set(entry.path, entry);
    const path = entry.path.toLowerCase();
    if (path === ".github/workflows" || path.startsWith(".github/workflows/")
        || /(?:^|\/)action\.ya?ml$/u.test(path)) return true;
  }

  // A non-truncated recursive response includes its parent directory entries.
  // Missing parents or a blob used as a directory make the evidence ambiguous.
  for (const path of entries.keys()) {
    let slash = path.lastIndexOf("/");
    while (slash !== -1) {
      const parent = entries.get(path.slice(0, slash));
      if (!parent || parent.type !== "tree" || parent.mode !== "040000") return true;
      slash = path.lastIndexOf("/", slash - 1);
    }
  }

  let unresolved = false;
  for (const entry of entries.values()) {
    if (entry.mode !== "120000") continue;
    if (!symlinkTargets || typeof symlinkTargets.get !== "function") return true;
    const target = symlinkTargets.get(entry.sha);
    // Prove only the same-directory regular-file links present in the
    // affected snapshots. Paths, chains and unfamiliar targets stay required.
    if (typeof target !== "string" || !target || target.length > 4096
        || /[\/\\\u0000-\u001f\u007f]/u.test(target)
        || target === "." || target === ".." || /^[A-Za-z]:/u.test(target)) {
      unresolved = true;
      continue;
    }
    const slash = entry.path.lastIndexOf("/");
    const targetPath = `${slash === -1 ? "" : entry.path.slice(0, slash + 1)}${target}`;
    const resolved = entries.get(targetPath);
    if (!resolved || resolved.type !== "blob"
        || !["100644", "100755"].includes(resolved.mode)) unresolved = true;
  }
  if (unresolved) return true;
  return false;
}

// Recording missing lookups lets the policy itself validate every other
// condition before a caller spends API reads on symlink contents. No invented
// target is supplied, and an unresolved link can never become an absence proof.
export function symlinkBlobShasForSource(commit, tree, expectedSha) {
  const needed = new Set();
  const missingTargets = new Map();
  missingTargets.get = (sha) => { needed.add(sha); return undefined; };
  actionsRequiredForSource(commit, tree, expectedSha, missingTargets);
  return needed.size <= 32 ? [...needed] : [];
}

export function symlinkTargetForBlob(blob, expectedSha) {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)
      || typeof expectedSha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(expectedSha)
      || blob.sha !== expectedSha || blob.encoding !== "base64"
      || typeof blob.content !== "string" || blob.content.length > 8192 || !Number.isSafeInteger(blob.size)
      || blob.size < 1 || blob.size > 4096) return undefined;
  const encoded = blob.content.replace(/\r?\n/gu, "");
  if (encoded.length > 5464 || encoded.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) return undefined;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== blob.size || bytes.toString("base64") !== encoded) return undefined;
  const target = bytes.toString("utf8");
  return Buffer.from(target, "utf8").equals(bytes) ? target : undefined;
}
