(() => {
  // remix/app/utils/boundedJson.ts
  function copyBoundedJson(value, budget4, label = "JSON") {
    let nodes = 0;
    let characters = 0;
    const ancestors = /* @__PURE__ */ new WeakSet();
    const countText = (value2) => {
      characters += value2.length;
      if (characters > budget4.maxBytes) throw new Error(`${label} exceeds its byte budget`);
    };
    const visit = (entry, depth) => {
      if (++nodes > budget4.maxNodes || depth > budget4.maxDepth) throw new Error(`${label} exceeds its structural budget`);
      if (typeof entry === "string") {
        countText(entry);
        return entry;
      }
      if (entry === null) return null;
      if (typeof entry === "boolean") return entry;
      if (typeof entry === "number" && Number.isFinite(entry)) return entry;
      if (!entry || typeof entry !== "object") throw new Error(`${label} must contain only JSON values`);
      if (ancestors.has(entry)) throw new Error(`${label} cannot contain cycles`);
      ancestors.add(entry);
      const array = Array.isArray(entry);
      if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) throw new Error(`${label} must contain plain objects`);
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      let entries = Object.entries(descriptors).filter(([key4]) => !(array && key4 === "length"));
      if (Object.getOwnPropertySymbols(entry).length || entries.some(([, descriptor]) => !descriptor.enumerable || !("value" in descriptor)))
        throw new Error(`${label} cannot contain accessors or hidden properties`);
      let copy2;
      if (array) {
        if (entry.length !== entries.length || entries.some(([key4], index) => key4 !== String(index))) throw new Error(`${label} arrays must be dense`);
        copy2 = entries.map(([, descriptor]) => visit(descriptor.value, depth + 1));
      } else {
        if (budget4.sortKeys) entries = entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        copy2 = Object.fromEntries(entries.map(([key4, descriptor]) => {
          countText(key4);
          return [key4, visit(descriptor.value, depth + 1)];
        }));
      }
      ancestors.delete(entry);
      return copy2;
    };
    const copy = visit(value, 0);
    if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > budget4.maxBytes) throw new Error(`${label} exceeds its byte budget`);
    return copy;
  }

  // remix/app/timeline/snapshotParts.ts
  var TIMELINE_SNAPSHOT_PART_KIND = "timeline-snapshot-part";
  var TIMELINE_SNAPSHOT_PARTS_ADAPTER = "thing-content-parts";
  var TIMELINE_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;
  var TIMELINE_SNAPSHOT_PART_CHARS = 64 * 1024;
  var TIMELINE_SNAPSHOT_MAX_PARTS = 2048;
  var identifier = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
  var exact = (value, keys4) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys4.length || keys4.some((key4) => !Object.prototype.hasOwnProperty.call(value, key4))) throw new Error("Invalid Timeline snapshot fields");
  };
  function parseTimelineSnapshotReference(input) {
    const value = copyBoundedJson(input, { maxBytes: 2048, maxDepth: 2, maxNodes: 10, sortKeys: true }, "Timeline snapshot reference");
    exact(value, ["eventId", "side", "partCount", "characters", "bytes", "retainedBytes", "sha256"]);
    if (!identifier(value.eventId) || !["before", "after"].includes(value.side) || !Number.isSafeInteger(value.characters) || value.characters < 1 || value.characters > TIMELINE_SNAPSHOT_MAX_BYTES || !Number.isSafeInteger(value.partCount) || value.partCount !== Math.ceil(value.characters / TIMELINE_SNAPSHOT_PART_CHARS) || value.partCount > TIMELINE_SNAPSHOT_MAX_PARTS || !Number.isSafeInteger(value.bytes) || value.bytes < value.characters || value.bytes > TIMELINE_SNAPSHOT_MAX_BYTES || !Number.isSafeInteger(value.retainedBytes) || value.retainedBytes < 0 || value.retainedBytes > value.bytes || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error("Invalid Timeline snapshot reference");
    return value;
  }

  // remix/app/timeline/contract.ts
  var TIMELINE_FORMAT_VERSION = 1;
  var TIMELINE_EVENT_KIND = "timeline-event";
  var TIMELINE_LINK_KIND = "timeline-link";
  var TIMELINE_EVENT_MAX_BYTES = 4 * 1024 * 1024;
  var TIMELINE_SOURCES = ["client", "api", "action", "ai", "system"];
  var TIMELINE_OPERATIONS = ["create", "update", "delete", "restore", "merge", "effect"];
  var budget = { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 96, maxNodes: 2e5, sortKeys: true };
  var object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  var keys = (value, expected) => {
    if (Object.keys(value).length !== expected.length || expected.some((key4) => !Object.prototype.hasOwnProperty.call(value, key4))) throw new Error("Invalid Timeline fields");
  };
  var id = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
  var timestamp = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  var snapshot = (value) => {
    if (value === null) return;
    if (!object(value)) throw new Error("Invalid Timeline snapshot");
    keys(value, ["adapter", "version", "value"]);
    if (!id(value.adapter) || !Number.isSafeInteger(value.version) || value.version < 1) throw new Error("Invalid Timeline snapshot adapter");
  };
  function parseTimelineEvent(input) {
    const value = copyBoundedJson(input, budget, "Timeline event");
    if (!object(value)) throw new Error("Invalid Timeline event");
    keys(value, ["formatVersion", "id", "ownerId", "thingId", "branchId", "parentIds", "operationId", "actorId", "source", "clientId", "occurredAt", "mode", "operation", "label", "before", "after", "dependencies"]);
    validateTimelineEventFields(value);
    if (!Array.isArray(value.parentIds) || value.parentIds.length > 2 || value.parentIds.some((parent) => !id(parent) || parent === value.id) || new Set(value.parentIds).size !== value.parentIds.length) throw new Error("Invalid Timeline parents");
    if (value.operation === "merge" && value.parentIds.length !== 2) throw new Error("A Timeline merge needs two parents");
    if (!Array.isArray(value.dependencies) || value.dependencies.length > 2048) throw new Error("Invalid Timeline dependencies");
    const dependencies = /* @__PURE__ */ new Set();
    for (const dependency of value.dependencies) {
      if (!object(dependency)) throw new Error("Invalid Timeline dependency");
      keys(dependency, ["thingId", "eventId"]);
      if (!id(dependency.thingId) || !id(dependency.eventId) || dependencies.has(dependency.thingId)) throw new Error("Invalid Timeline dependency");
      dependencies.add(dependency.thingId);
    }
    return value;
  }
  function validateTimelineEventFields(value) {
    if (value.formatVersion !== TIMELINE_FORMAT_VERSION) throw new Error("Unsupported Timeline format");
    for (const key4 of ["id", "ownerId", "thingId", "branchId", "operationId", "actorId"]) if (!id(value[key4])) throw new Error(`Invalid Timeline ${key4}`);
    if (value.clientId !== null && !id(value.clientId)) throw new Error("Invalid Timeline clientId");
    if (!TIMELINE_SOURCES.includes(value.source) || !TIMELINE_OPERATIONS.includes(value.operation) || !["draft", "revision", "effect"].includes(value.mode)) throw new Error("Invalid Timeline operation");
    if (!timestamp(value.occurredAt)) throw new Error("Invalid Timeline timestamp");
    if (typeof value.label !== "string" || !value.label.trim() || value.label.length > 240) throw new Error("Invalid Timeline label");
    snapshot(value.before);
    snapshot(value.after);
    for (const side of ["before", "after"]) if (value[side]?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER) {
      const reference = parseTimelineSnapshotReference(value[side].value);
      if (value[side].version !== 1 || reference.eventId !== value.id || reference.side !== side || value.source === "client" || value.mode !== "revision") throw new Error("Invalid retained Timeline snapshot provenance");
    }
    if (value.mode === "effect" ? value.operation !== "effect" : value.operation === "effect") throw new Error("Invalid Timeline effect mode");
    if (value.operation === "create" && (value.before !== null || value.after === null)) throw new Error("Invalid Timeline creation");
    if (value.operation === "delete" && (value.before === null || value.after !== null)) throw new Error("Invalid Timeline deletion");
    if (["update", "restore", "merge"].includes(value.operation) && (value.before === null || value.after === null)) throw new Error("Invalid Timeline change");
  }
  function parseTimelineReceipt(input) {
    const value = copyBoundedJson(input, { maxBytes: 2048, maxDepth: 2, maxNodes: 10, sortKeys: true }, "Timeline receipt");
    if (!object(value)) throw new Error("Invalid Timeline receipt");
    keys(value, ["formatVersion", "eventId", "ownerId", "position", "acceptedAt"]);
    if (value.formatVersion !== 1 || !id(value.eventId) || !id(value.ownerId) || !Number.isSafeInteger(value.position) || value.position < 1 || !timestamp(value.acceptedAt)) throw new Error("Invalid Timeline receipt");
    return value;
  }
  function parseTimelineEntry(input) {
    const value = copyBoundedJson(input, { ...budget, maxBytes: TIMELINE_EVENT_MAX_BYTES + 2048 }, "Timeline entry");
    if (!object(value)) throw new Error("Invalid Timeline entry");
    keys(value, ["event", "receipt"]);
    const event = parseTimelineEvent(value.event);
    const receipt = parseTimelineReceipt(value.receipt);
    if (receipt.eventId !== event.id || receipt.ownerId !== event.ownerId) throw new Error("Timeline receipt does not match its event");
    return { event, receipt };
  }
  var timelineEventText = (event) => JSON.stringify(parseTimelineEvent(event));
  function timelineScopeKey(scope2) {
    if (!id(scope2.ownerId) || !id(scope2.dataPlane)) throw new Error("Invalid Timeline scope");
    const url = new URL(scope2.apiOrigin);
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== scope2.apiOrigin) throw new Error("Invalid Timeline origin");
    if (scope2.delegatedBy !== void 0 && (!id(scope2.delegatedBy) || scope2.delegatedBy === scope2.ownerId)) throw new Error("Invalid Timeline principal");
    return JSON.stringify([scope2.apiOrigin, scope2.dataPlane, scope2.ownerId, ...scope2.delegatedBy === void 0 ? [] : ["delegated", scope2.delegatedBy]]);
  }

  // remix/app/local-workspace/storage.ts
  var workspaceScopeKey = (scope2) => {
    if (scope2.kind === "anonymous") return JSON.stringify(["anonymous", 1]);
    if (!scope2.ownerId || !scope2.dataPlane || new URL(scope2.origin).origin !== scope2.origin) throw new Error("Invalid local workspace scope");
    if (scope2.delegatedBy !== void 0) {
      if (!scope2.delegatedBy || scope2.delegatedBy === scope2.ownerId) throw new Error("Invalid delegated workspace scope");
      return JSON.stringify(["delegated-account", scope2.origin, scope2.delegatedBy, scope2.ownerId, scope2.dataPlane]);
    }
    return JSON.stringify(["account", scope2.origin, scope2.ownerId, scope2.dataPlane]);
  };
  var WorkspaceError = class extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
      this.ok = false;
      this.name = "WorkspaceError";
    }
    get error() {
      return this.message;
    }
  };
  var BINARY_COLLECTION = "@bytes";
  var request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  var validKey = (value) => {
    if (typeof value !== "string" || !value || value.length > 256) throw new WorkspaceError("INVALID_KEY", "Invalid local record key");
  };
  var WorkspaceDatabase = class {
    constructor(factory, name = "thingtime.local-workspaces.v1", openTimeoutMs = 1e4, keyRanges = globalThis.IDBKeyRange) {
      this.factory = factory;
      this.name = name;
      this.openTimeoutMs = openTimeoutMs;
      this.keyRanges = keyRanges;
      this.opening = null;
      this.cancelOpen = null;
    }
    open() {
      if (this.opening) return this.opening;
      const opening = new Promise((resolve, reject) => {
        const req = this.factory.open(this.name, 1);
        let settled = false;
        const finish = () => {
          settled = true;
          clearTimeout(timer);
          this.cancelOpen = null;
        };
        const fail14 = (code, message) => {
          if (settled) return;
          finish();
          try {
            req.transaction?.abort();
          } catch {
          }
          reject(new WorkspaceError(code, message, 503));
        };
        const timer = setTimeout(
          () => fail14("LOCAL_STORAGE_TIMEOUT", "Opening browser storage timed out. Retry saving when site storage is available."),
          this.openTimeoutMs
        );
        this.cancelOpen = () => fail14("LOCAL_STORAGE_CLOSED", "Browser storage was closed before it finished opening. Retry the operation.");
        req.onupgradeneeded = () => {
          if (settled) {
            try {
              req.transaction?.abort();
            } catch {
            }
            return;
          }
          const records = req.result.createObjectStore("records", { keyPath: ["scope", "collection", "id"] });
          records.createIndex("collection", ["scope", "collection"]);
          req.result.createObjectStore("usage", { keyPath: "scope" });
        };
        req.onerror = () => fail14("LOCAL_STORAGE_UNAVAILABLE", "Browser storage could not be opened. Check site storage permissions and retry.");
        req.onblocked = () => fail14("LOCAL_STORAGE_BLOCKED", "Another Thingtime tab is blocking browser storage. Close that tab and retry.");
        req.onsuccess = () => {
          if (settled) {
            req.result.close();
            return;
          }
          finish();
          req.result.onversionchange = () => {
            req.result.close();
            if (this.opening === opening) this.opening = null;
          };
          resolve(req.result);
        };
      }).catch((error) => {
        if (this.opening === opening) this.opening = null;
        throw error;
      });
      return this.opening = opening;
    }
    async close() {
      const opening = this.opening;
      this.opening = null;
      this.cancelOpen?.();
      try {
        (await opening)?.close();
      } catch {
      }
    }
    transaction(scope2, mode, lease2, run) {
      return this.scopedTransaction([scope2], mode, lease2, (views) => run(views[0]));
    }
    /** The account's selected-plane meter includes its delegated editors. Discover
     * keys and validate every ledger in one snapshot, without reading file bytes
     * or exposing Character content to the settings panel. */
    accountUsage(scope2, lease2) {
      if (scope2.kind !== "account" || scope2.delegatedBy !== void 0)
        return Promise.reject(new WorkspaceError("ACCOUNT_REQUIRED", "Choose the signed-in account to measure its device storage.", 403));
      const rootKey = workspaceScopeKey(scope2);
      const prefix = JSON.stringify(["delegated-account", scope2.origin, scope2.ownerId]).slice(0, -1) + ",";
      return this.scopedTransaction(async (native) => {
        const keys4 = /* @__PURE__ */ new Set([rootKey]);
        const collect = (store, compound) => new Promise((resolve, reject) => {
          const range = compound ? this.keyRanges.bound([prefix], [prefix + "\uFFFF"]) : this.keyRanges.bound(prefix, prefix + "\uFFFF");
          const cursor = store.openKeyCursor(range);
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            try {
              lease2.assertCurrent();
              const row = cursor.result;
              if (!row) return resolve();
              const key4 = compound ? row.key[0] : row.key;
              if (typeof key4 !== "string") throw new WorkspaceError("INVALID_WORKSPACE", "Invalid retained workspace key", 409);
              const parts = JSON.parse(key4), actor = { ...scope2, delegatedBy: scope2.ownerId, ownerId: parts?.[3], dataPlane: parts?.[4] };
              if (!Array.isArray(parts) || parts.length !== 5 || typeof actor.ownerId !== "string" || typeof actor.dataPlane !== "string" || workspaceScopeKey(actor) !== key4)
                throw new WorkspaceError("INVALID_WORKSPACE", "Invalid retained workspace key", 409);
              if (actor.dataPlane === scope2.dataPlane) keys4.add(key4);
              if (compound) row.continue([key4, []]);
              else row.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
        await collect(native.objectStore("records"), true);
        await collect(native.objectStore("usage"), false);
        return [...keys4];
      }, "readonly", lease2, async (views) => {
        const total = { bytes: 0, records: 0 };
        for (const view of views) {
          const usage = await view.usage();
          total.bytes += usage.bytes;
          total.records += usage.records;
          if (!Number.isSafeInteger(total.bytes) || !Number.isSafeInteger(total.records))
            throw new WorkspaceError("LOCAL_ACCOUNTING_UNAVAILABLE", "Device storage usage is unavailable. Your saved content has not been changed.", 503);
        }
        return total;
      });
    }
    /** Discover only this account/origin's existing local partitions. Keys alone
     * are read; no other account content or remote configuration is exposed. */
    async accountScopes(scope2, lease2) {
      if (scope2.kind !== "account") throw new WorkspaceError("ACCOUNT_REQUIRED", "Anonymous workspaces cannot enumerate account storage", 403);
      workspaceScopeKey(scope2);
      lease2.assertCurrent();
      const db = await this.open();
      lease2.assertCurrent();
      const native = db.transaction(["usage"], "readonly");
      const done = new Promise((resolve, reject) => {
        native.oncomplete = () => resolve();
        native.onabort = () => reject(native.error || new WorkspaceError("WORKSPACE_CHANGED", "Local operation was cancelled", 409));
        native.onerror = () => {
        };
      });
      void done.catch(() => {
      });
      const unsubscribe = lease2.onInvalidate(() => {
        try {
          native.abort();
        } catch {
        }
      });
      try {
        const identity5 = scope2.delegatedBy === void 0 ? ["account", scope2.origin, scope2.ownerId] : ["delegated-account", scope2.origin, scope2.delegatedBy, scope2.ownerId];
        const prefix = JSON.stringify(identity5).slice(0, -1) + ",";
        const scopes = [];
        await new Promise((resolve, reject) => {
          const cursor = native.objectStore("usage").openKeyCursor(this.keyRanges.bound(prefix, prefix + "\uFFFF"));
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            try {
              lease2.assertCurrent();
              if (!cursor.result) return resolve();
              const key4 = cursor.result.key;
              if (typeof key4 !== "string") throw new WorkspaceError("INVALID_WORKSPACE", "Invalid retained workspace key", 409);
              const parts = JSON.parse(key4);
              const value = { ...scope2, dataPlane: parts?.[identity5.length] };
              if (!Array.isArray(parts) || parts.length !== identity5.length + 1 || typeof value.dataPlane !== "string" || workspaceScopeKey(value) !== key4)
                throw new WorkspaceError("INVALID_WORKSPACE", "Invalid retained workspace key", 409);
              scopes.push(value);
              cursor.result.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
        lease2.assertCurrent();
        await done;
        lease2.assertCurrent();
        return scopes;
      } catch (error) {
        try {
          native.abort();
        } catch {
        }
        await done.catch(() => {
        });
        throw workspaceStorageError(error);
      } finally {
        unsubscribe();
      }
    }
    /** Home-pinned content and selected-plane content can share one atomic local
     * operation. The caller supplies its current selected-account lease; neither
     * view grants remote authority or opens another account/origin partition. */
    accountHomeTransaction(scope2, mode, lease2, run) {
      if (scope2.kind !== "account")
        return Promise.reject(new WorkspaceError("ACCOUNT_REQUIRED", "Anonymous workspaces cannot access account home storage", 403));
      return this.scopedTransaction([scope2, { ...scope2, dataPlane: "home" }], mode, lease2, (views) => run({ selected: views[0], home: views[1] }));
    }
    async scopedTransaction(scopes, mode, lease2, run) {
      lease2.assertCurrent();
      const scopeKeys = Array.isArray(scopes) ? scopes.map(workspaceScopeKey) : null;
      const db = await this.open();
      lease2.assertCurrent();
      const native = db.transaction(["records", "usage"], mode);
      const records = native.objectStore("records");
      const usageStore = native.objectStore("usage");
      const done = new Promise((resolve, reject) => {
        native.oncomplete = () => resolve();
        native.onabort = () => reject(native.error || new WorkspaceError("WORKSPACE_CHANGED", "Local operation was cancelled", 409));
        native.onerror = () => {
        };
      });
      void done.catch(() => {
      });
      const unsubscribe = lease2.onInvalidate(() => {
        try {
          native.abort();
        } catch {
        }
      });
      let writes = Promise.resolve();
      const makeView = (scopeKey) => {
        const check2 = (collection3, id3, binary = false) => {
          lease2.assertCurrent();
          validKey(collection3);
          if (collection3 === BINARY_COLLECTION && !binary)
            throw new WorkspaceError("BINARY_OPERATION_REQUIRED", "File bytes require the binary storage operation");
          if (id3 !== void 0) validKey(id3);
        };
        const persist = async (collection3, id3, value, bytes, binaryRevision) => {
          const previous = await request(records.get([scopeKey, collection3, id3]));
          const usage = await request(usageStore.get(scopeKey)) || { scope: scopeKey, records: 0, bytes: 0 };
          usage.records += previous ? 0 : 1;
          usage.bytes += bytes - (previous?.bytes || 0);
          if (!Number.isSafeInteger(usage.records) || !Number.isSafeInteger(usage.bytes) || usage.records < 0 || usage.bytes < 0)
            throw new WorkspaceError("LOCAL_ACCOUNTING_UNAVAILABLE", "Device storage usage could not be updated safely. Saved content is unchanged.", 503);
          lease2.assertCurrent();
          await request(records.put({ scope: scopeKey, collection: collection3, id: id3, value, bytes, ...binaryRevision ? { binaryRevision } : {} }));
          await request(usageStore.put(usage));
        };
        const removeRecord = async (collection3, id3, binary = false) => {
          check2(collection3, id3, binary);
          const previous = await request(records.get([scopeKey, collection3, id3]));
          if (!previous) return;
          const usage = await request(usageStore.get(scopeKey)) || { scope: scopeKey, records: 1, bytes: previous.bytes };
          lease2.assertCurrent();
          await request(records.delete([scopeKey, collection3, id3]));
          await request(usageStore.put({ ...usage, records: Math.max(0, usage.records - 1), bytes: Math.max(0, usage.bytes - previous.bytes) }));
        };
        const tx = {
          usage: async () => {
            lease2.assertCurrent();
            const count = await request(records.count(this.keyRanges.bound([scopeKey], [scopeKey, []])));
            const usage = await request(usageStore.get(scopeKey));
            lease2.assertCurrent();
            if (!usage && count === 0) return { records: 0, bytes: 0 };
            if (!usage || usage.scope !== scopeKey || usage.records !== count || !Number.isSafeInteger(usage.records) || usage.records < 0 || !Number.isSafeInteger(usage.bytes) || usage.bytes < 0 || count === 0 && usage.bytes !== 0) {
              throw new WorkspaceError(
                "LOCAL_ACCOUNTING_UNAVAILABLE",
                "Device storage usage is unavailable. Your saved content has not been changed.",
                503
              );
            }
            return { records: usage.records, bytes: usage.bytes };
          },
          get: async (collection3, id3) => {
            check2(collection3, id3);
            const found = await request(records.get([scopeKey, collection3, id3]));
            lease2.assertCurrent();
            return found?.value;
          },
          list: async (collection3) => {
            check2(collection3);
            const found = await request(records.index("collection").getAll([scopeKey, collection3]));
            lease2.assertCurrent();
            return found.map(({ id: id3, value }) => ({ id: id3, value }));
          },
          scan: async (collection3, options = {}) => {
            check2(collection3, options.after);
            const requested = options.limit ?? 64;
            if (!Number.isSafeInteger(requested) || requested < 1)
              throw new WorkspaceError("INVALID_SCAN_LIMIT", "Local scan page size must be a positive safe integer");
            const limit = Math.min(requested, 1024);
            const range = this.keyRanges.bound(
              options.after === void 0 ? [scopeKey, collection3] : [scopeKey, collection3, options.after],
              [scopeKey, collection3, []],
              options.after !== void 0
            );
            return new Promise((resolve, reject) => {
              const page = [];
              const cursor = records.openCursor(range);
              cursor.onerror = () => reject(cursor.error);
              cursor.onsuccess = () => {
                try {
                  lease2.assertCurrent();
                  const row = cursor.result;
                  if (!row) return resolve(page);
                  const { id: id3, value } = row.value;
                  page.push({ id: id3, value });
                  if (page.length === limit) return resolve(page);
                  row.continue();
                } catch (error) {
                  reject(error);
                }
              };
            });
          },
          put: async (collection3, id3, value) => {
            check2(collection3, id3);
            const encoded = JSON.stringify(value);
            if (encoded === void 0) throw new WorkspaceError("INVALID_RECORD", "Local records must contain JSON");
            const bytes = new TextEncoder().encode(encoded).byteLength;
            if (collection3 === "timeline-events" && bytes > TIMELINE_EVENT_MAX_BYTES + 2048)
              throw new WorkspaceError("TIMELINE_EVENT_SIZE", "This Timeline record exceeds the canonical event capacity.", 413);
            await persist(collection3, id3, JSON.parse(encoded), bytes);
          },
          getBinary: async (id3) => {
            check2(BINARY_COLLECTION, id3, true);
            const found = await request(records.get([scopeKey, BINARY_COLLECTION, id3]));
            lease2.assertCurrent();
            if (!found) return void 0;
            const size = found.value instanceof Uint8Array ? found.value.byteLength : found.value instanceof Blob ? found.value.size : -1;
            if (size !== found.bytes || found.binaryRevision !== void 0 && typeof found.binaryRevision !== "string" || found.value instanceof Blob && !found.binaryRevision)
              throw new WorkspaceError("INVALID_LOCAL_FILE", "Stored file bytes are invalid");
            return { value: found.value, revision: found.binaryRevision };
          },
          getBytes: async (id3) => {
            const found = await tx.getBinary(id3);
            if (found?.value instanceof Blob) throw new WorkspaceError("BLOB_READ_REQUIRED", "Read this file outside the storage transaction through its Blob adapter.");
            return found?.value;
          },
          putBlob: async (id3, value) => {
            check2(BINARY_COLLECTION, id3, true);
            if (!(value instanceof Blob)) throw new WorkspaceError("INVALID_LOCAL_FILE", "File content must be a Blob");
            await persist(BINARY_COLLECTION, id3, value, value.size, crypto.randomUUID());
          },
          putBytes: async (id3, value) => {
            check2(BINARY_COLLECTION, id3, true);
            if (!(value instanceof Uint8Array)) throw new WorkspaceError("INVALID_LOCAL_FILE", "File bytes must be a byte array");
            await persist(BINARY_COLLECTION, id3, Uint8Array.from(value), value.byteLength, crypto.randomUUID());
          },
          deleteBytes: async (id3) => removeRecord(BINARY_COLLECTION, id3, true),
          delete: (collection3, id3) => removeRecord(collection3, id3)
        };
        const put = tx.put;
        const remove = tx.delete;
        const putBytes = tx.putBytes;
        const deleteBytes = tx.deleteBytes;
        const putBlob = tx.putBlob;
        tx.put = (...args) => writes = writes.then(() => put(...args));
        tx.delete = (...args) => writes = writes.then(() => remove(...args));
        tx.putBytes = (...args) => {
          const [id3, bytes] = args;
          if (!(bytes instanceof Uint8Array))
            return writes = writes.then(() => putBytes(id3, bytes));
          const copy = Uint8Array.from(bytes);
          return writes = writes.then(() => putBytes(id3, copy));
        };
        tx.putBlob = (...args) => writes = writes.then(() => putBlob(...args));
        tx.deleteBytes = (...args) => writes = writes.then(() => deleteBytes(...args));
        return tx;
      };
      const unique = /* @__PURE__ */ new Map();
      try {
        const keys4 = typeof scopes === "function" ? await scopes(native) : scopeKeys;
        lease2.assertCurrent();
        const views = keys4.map((key4) => {
          if (!unique.has(key4)) unique.set(key4, makeView(key4));
          return unique.get(key4);
        });
        const result = await run(views);
        await writes;
        lease2.assertCurrent();
        await done;
        lease2.assertCurrent();
        return result;
      } catch (error) {
        try {
          native.abort();
        } catch {
        }
        await done.catch(() => {
        });
        throw workspaceStorageError(error);
      } finally {
        unsubscribe();
      }
    }
  };
  function workspaceStorageError(error) {
    if (error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError")
      return new WorkspaceError("LOCAL_QUOTA", "Local workspace is full because the browser could not allocate storage. Free device space or export/remove content, then retry.", 507);
    return error;
  }

  // remix/app/local-workspace/catalogueStaging.ts
  var metas = "catalogue-staging";
  var lifetime = 24 * 60 * 60 * 1e3;
  var changed = () => new WorkspaceError("CATALOGUE_CHANGED", "The catalogue read was superseded. Device changes have been kept.", 409);
  var stageNames = (id3) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id3)) throw changed();
    return { entries: `catalogue-stage-${id3}`, references: `catalogue-references-${id3}` };
  };
  async function* scanWorkspace(tx, collection3) {
    let after;
    for (; ; ) {
      const rows = await tx.scan(collection3, { after });
      if (!rows.length) return;
      for (const row of rows) yield row;
      after = rows[rows.length - 1].id;
    }
  }
  async function discard(tx, id3) {
    const names = stageNames(id3);
    for (const collection3 of [names.entries, names.references])
      for await (const row of scanWorkspace(tx, collection3)) await tx.delete(collection3, row.id);
    await tx.delete(metas, id3);
  }
  async function stageCatalogue(options) {
    const { run, domain, ticket, signal, id: id3 } = options, now = options.now ?? Date.now, names = stageNames(id3);
    let completed = false, admitted = false;
    const current = async (tx) => {
      const catalog = await tx.get("settings", options.catalogKey);
      if (!catalog || catalog.read !== ticket.read || catalog.epoch !== ticket.epoch) throw changed();
    };
    await run("readwrite", async (tx) => {
      await current(tx);
      for await (const row of scanWorkspace(tx, metas)) {
        if (row.value.expiresAt <= now() || row.value.domain === domain && row.value.read !== ticket.read) await discard(tx, row.id);
      }
      if (await tx.get(metas, id3)) throw changed();
      await tx.put(metas, id3, { ...ticket, domain, entries: 0, lastId: "", expiresAt: now() + lifetime });
    }, signal);
    try {
      await options.load({
        entry: async (entryId, value, streamSignal) => {
          if (completed) throw changed();
          const parsed = options.parse(entryId, value);
          await run("readwrite", async (tx) => {
            await current(tx);
            const meta = await tx.get(metas, id3);
            if (!meta || entryId <= meta.lastId || !Number.isSafeInteger(meta.entries + 1)) throw changed();
            await tx.put(names.entries, entryId, parsed);
            await tx.put(metas, id3, { ...meta, entries: meta.entries + 1, lastId: entryId, expiresAt: now() + lifetime });
          }, AbortSignal.any([signal, streamSignal]));
        },
        complete: async (receipt, streamSignal) => {
          if (completed || receipt.domain !== domain) throw changed();
          admitted = await run("readwrite", async (tx) => {
            await current(tx);
            const meta = await tx.get(metas, id3);
            if (!meta || receipt.entries !== meta.entries) throw changed();
            for await (const { value } of scanWorkspace(tx, "things")) {
              for (const reference of [value.folderId, value.targetId])
                if (typeof reference === "string" && reference) await tx.put(names.references, reference, true);
            }
            const result = await options.admit(tx, {
              rows: () => scanWorkspace(tx, names.entries),
              has: async (key4) => await tx.get(names.entries, key4) !== void 0,
              hasDependent: async (key4) => await tx.get(names.references, key4) === true
            });
            await discard(tx, id3);
            return result;
          }, AbortSignal.any([signal, streamSignal]));
          completed = true;
        }
      }, signal);
      if (!completed) throw changed();
      return admitted;
    } finally {
      if (!completed) await run("readwrite", (tx) => discard(tx, id3)).catch(() => {
      });
    }
  }
  async function findCatalogueEntry(load, id3, parse, signal) {
    let found = null, completed = false;
    await load({ entry: async (key4, value) => {
      if (key4 === id3) found = parse(value);
    }, complete: async () => {
      completed = true;
    } }, signal);
    signal.throwIfAborted();
    if (!completed) throw changed();
    return found;
  }

  // remix/app/utils/libraryTitle.ts
  var validOptionalLibraryTitle = (value) => value === null || typeof value === "string" && value.length <= 120;

  // remix/app/timeline/records.ts
  var relations = ["parent", "dependency", "thing", "branch", "operation"];
  var identifier2 = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
  var timelineLinkId = (eventId, relation, ordinal) => `${eventId}/links/${relation}/${ordinal}`;
  var exactKeys = (value, expected) => {
    if (Object.keys(value).length !== expected.length || expected.some((key4) => !Object.prototype.hasOwnProperty.call(value, key4))) throw new Error("Invalid Timeline record fields");
  };
  function parseTimelineEventRecord(input) {
    const value = copyBoundedJson(input, { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 96, maxNodes: 2e5, sortKeys: true }, "Timeline event record");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Timeline event record");
    exactKeys(value, ["formatVersion", "id", "ownerId", "thingId", "branchId", "parentCount", "dependencyCount", "operationId", "actorId", "source", "clientId", "occurredAt", "mode", "operation", "label", "before", "after"]);
    validateTimelineEventFields(value);
    if (!Number.isInteger(value.parentCount) || value.parentCount < 0 || value.parentCount > 2 || !Number.isInteger(value.dependencyCount) || value.dependencyCount < 0 || value.dependencyCount > 2048 || value.operation === "merge" && value.parentCount !== 2) throw new Error("Invalid Timeline link counts");
    return value;
  }
  function parseTimelineLink(input) {
    const value = copyBoundedJson(input, { maxBytes: 2048, maxDepth: 2, maxNodes: 12, sortKeys: true }, "Timeline link");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Timeline link");
    exactKeys(value, ["formatVersion", "id", "ownerId", "eventId", "relation", "targetId", "targetThingId", "ordinal"]);
    if (value.formatVersion !== 1 || !identifier2(value.ownerId) || !identifier2(value.eventId) || !identifier2(value.targetId) || !relations.includes(value.relation) || !Number.isInteger(value.ordinal) || value.ordinal < 0 || value.ordinal >= 2048 || value.id !== timelineLinkId(value.eventId, value.relation, value.ordinal)) throw new Error("Invalid Timeline link");
    if (["parent", "dependency"].includes(value.relation) ? !identifier2(value.targetThingId) || value.eventId === value.targetId : value.targetThingId !== null || value.ordinal !== 0) throw new Error("Invalid Timeline link target");
    if (value.relation === "parent" && value.ordinal > 1) throw new Error("Invalid Timeline parent link");
    return value;
  }
  function splitTimelineEvent(input) {
    const { parentIds, dependencies, ...content } = parseTimelineEvent(input);
    const links = [];
    const add2 = (relation, targetId, ordinal = 0, targetThingId = null) => links.push(parseTimelineLink({ formatVersion: 1, id: timelineLinkId(content.id, relation, ordinal), ownerId: content.ownerId, eventId: content.id, relation, targetId, targetThingId, ordinal }));
    add2("thing", content.thingId);
    add2("branch", content.branchId);
    add2("operation", content.operationId);
    parentIds.forEach((targetId, ordinal) => add2("parent", targetId, ordinal, content.thingId));
    dependencies.forEach((dependency, ordinal) => add2("dependency", dependency.eventId, ordinal, dependency.thingId));
    return { event: parseTimelineEventRecord({ ...content, parentCount: parentIds.length, dependencyCount: dependencies.length }), links };
  }
  function joinTimelineEvent(input, inputs) {
    const { parentCount, dependencyCount, ...content } = parseTimelineEventRecord(input);
    if (inputs.length !== 3 + parentCount + dependencyCount) throw new Error("Timeline links are incomplete");
    const links = inputs.map(parseTimelineLink);
    const select = (relation) => links.filter((link) => link.relation === relation).sort((a, b) => a.ordinal - b.ordinal);
    const event = parseTimelineEvent({ ...content, parentIds: select("parent").map((link) => link.targetId), dependencies: select("dependency").map((link) => ({ thingId: link.targetThingId, eventId: link.targetId })) });
    const expected = new Map(splitTimelineEvent(event).links.map((link) => [link.id, JSON.stringify(link)]));
    for (const link of links) {
      if (expected.get(link.id) !== JSON.stringify(link)) throw new Error("Timeline link identity does not match its event");
      expected.delete(link.id);
    }
    if (expected.size) throw new Error("Timeline links are incomplete");
    return event;
  }

  // remix/app/utils/dataPlane.ts
  var isDataPlane = (value) => typeof value === "string" && /^(?:home|custom-[0-9a-f]{64})$/.test(value);

  // remix/app/timeline/actionOutcome.ts
  var ACTION_OUTCOME_ADAPTER = "action-outcome";
  var keys2 = ["actionName", "runId", "status", "startedAt", "durationMs", "opsUsed", "depthUsed", "childActionsUsed"];
  function actionOutcomeValue(snapshot2) {
    if (snapshot2?.adapter !== ACTION_OUTCOME_ADAPTER || snapshot2.version !== 1) return null;
    const value = snapshot2.value;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys2.length || keys2.some((key4) => !Object.prototype.hasOwnProperty.call(value, key4)))
      return null;
    if (typeof value.actionName !== "string" || !value.actionName.trim() || value.actionName.length > 160) return null;
    if (typeof value.runId !== "string" || !/^action-run-[a-f0-9-]{36}$/.test(value.runId) || !["started", "ok", "error"].includes(value.status))
      return null;
    if (typeof value.startedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt)) || new Date(value.startedAt).toISOString() !== value.startedAt)
      return null;
    for (const key4 of ["durationMs", "opsUsed", "depthUsed", "childActionsUsed"])
      if (value.status === "started" ? value[key4] !== null : !Number.isSafeInteger(value[key4]) || Number(value[key4]) < 0) return null;
    return value;
  }
  function readActionOutcome(event) {
    if (event.mode !== "effect" || event.operation !== "effect" || !["action", "ai"].includes(event.source) || event.clientId !== null || event.actorId !== event.ownerId || event.branchId !== "main" || event.before !== null || event.dependencies.length)
      return null;
    const value = actionOutcomeValue(event.after);
    if (!value || event.parentIds.length !== (value.status === "started" ? 0 : 1)) return null;
    return value;
  }

  // remix/app/timeline/actionRecovery.ts
  function parseActionOutcomeRecovery(input) {
    const value = copyBoundedJson(input, { maxBytes: 16 * 1024, maxDepth: 12, maxNodes: 256 }, "Action history recovery");
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "dataPlane,event,formatVersion,proof" || value.formatVersion !== 1 || !isDataPlane(value.dataPlane) || typeof value.proof !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.proof) || value.proof.length > 4096)
      throw new Error("Invalid Action history recovery");
    const event = parseTimelineEvent(value.event);
    const outcome = readActionOutcome(event);
    if (!outcome || outcome.status === "started") throw new Error("Only a completed server outcome can be recovered");
    return { formatVersion: 1, event, dataPlane: value.dataPlane, proof: value.proof };
  }

  // remix/app/timeline/localStore.ts
  var TIMELINE_CACHE_MAX_BYTES = 24 * 1024 * 1024;
  var TIMELINE_PENDING_MAX_BYTES = 64 * 1024 * 1024;
  function timelineLocalIndex(row) {
    return { scope: row.scope, id: row.event.id, thingId: row.event.thingId, occurredAt: row.event.occurredAt, receipt: row.receipt, status: row.status, accessedAt: row.accessedAt, bytes: row.bytes, draftKey: row.draftKey ?? null };
  }
  function validateTimelineIndex(index, scope2) {
    if (index.scope !== scope2 || !index.id || !index.thingId || !Number.isSafeInteger(index.bytes) || index.bytes < 1 || !Number.isFinite(index.accessedAt) || index.status !== "pending" && index.status !== "accepted" || (index.status === "pending" ? index.receipt !== null : !index.receipt || index.receipt.eventId !== index.id || !Number.isSafeInteger(index.receipt.position)))
      throw new Error("Timeline local index is damaged. Pending changes have been preserved.");
  }
  function validateTimelineRow(row, scope2) {
    validateTimelineIndex(timelineLocalIndex(row), scope2);
    const event = row.receipt ? parseTimelineEntry({ event: row.event, receipt: row.receipt }).event : parseTimelineEvent(row.event);
    if (row.recoveryProof !== void 0) {
      if (row.status !== "pending") throw new Error("Accepted Timeline records cannot retain delivery proofs");
      parseActionOutcomeRecovery({ formatVersion: 1, event, dataPlane: JSON.parse(scope2)[1], proof: row.recoveryProof });
    }
    if (row.bytes !== rowBytes(event, row.receipt, row.recoveryProof)) throw new Error("Timeline local record is damaged. Pending changes have been preserved.");
    return { ...row, event };
  }
  var rowBytes = (event, receipt, recoveryProof) => new TextEncoder().encode(JSON.stringify({ event, receipt, ...recoveryProof === void 0 ? {} : { recoveryProof } })).byteLength;
  var timelineLocalRow = (scope2, event, receipt, now, recoveryProof) => ({
    scope: scope2,
    event,
    receipt,
    status: receipt ? "accepted" : "pending",
    accessedAt: now,
    bytes: rowBytes(event, receipt, recoveryProof),
    ...recoveryProof === void 0 ? {} : { recoveryProof }
  });

  // remix/app/timeline/themeContent.ts
  var THEME_CONTENT_ADAPTER = "theme-content";
  var fields = {
    colors: ["ink", "text", "muted", "faint", "border", "borderLight", "surface", "surfaceAlt", "surfaceHover", "card", "pageBg", "accent", "accentTint", "accentContrast", "link", "positive", "positiveSoft", "danger", "warning", "rainbow", "darkBg", "darkChrome", "darkBorder", "darkText", "darkMuted", "darkAccent"],
    fonts: ["heading", "body", "mono", "display"],
    general: ["radiusScale", "borderWidth", "shadow", "motion", "animSpeed", "iconStyle", "thingsBadgePadding", "thingsBadgeCustomPadding"],
    windows: ["closeColor", "minimiseColor", "maximiseColor", "closeRadius", "minimiseRadius", "maximiseRadius"]
  };
  var numbers = /* @__PURE__ */ new Set(["radiusScale", "borderWidth", "animSpeed", "closeRadius", "minimiseRadius", "maximiseRadius"]);
  var object2 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  var own = (value, key4) => Object.prototype.hasOwnProperty.call(value, key4);
  var text = (value, max) => typeof value === "string" && value.length <= max;
  var budget2 = { maxBytes: 256 * 1024, maxDepth: 8, maxNodes: 4096, sortKeys: true };
  function invalid() {
    throw new Error("Invalid theme content history");
  }
  function themeContentSnapshot(input) {
    if (!object2(input) || !object2(input.crystal) || !text(input.crystal.name, 60) || !object2(input.crystal.theme)) invalid();
    const source = input.crystal.theme;
    const theme = {};
    if (own(source, "name")) {
      if (!text(source.name, 60)) invalid();
      theme.name = source.name;
    }
    for (const [section, keys4] of Object.entries(fields)) {
      if (!own(source, section)) continue;
      if (!object2(source[section])) invalid();
      const tokens = {};
      for (const key4 of keys4) {
        if (!own(source[section], key4)) continue;
        const value = source[section][key4];
        if (key4 === "rainbow") {
          if (!Array.isArray(value) || value.length !== 5 || value.some((item) => !text(item, 4096))) invalid();
        } else if (numbers.has(key4)) {
          if (typeof value !== "number" || !Number.isFinite(value)) invalid();
        } else if (key4 === "motion") {
          if (typeof value !== "boolean") invalid();
        } else if (!text(value, 4096)) invalid();
        tokens[key4] = value;
      }
      theme[section] = tokens;
    }
    const crystal = { name: input.crystal.name, theme };
    if (own(input.crystal, "title")) {
      if (input.crystal.title !== null && !text(input.crystal.title, 120)) invalid();
      crystal.title = input.crystal.title;
    }
    if (!Array.isArray(input.tags) || input.tags.length > 512 || input.tags.some((tag) => !text(tag, 200)) || !["private", "public"].includes(input.visibility) || input.folderId !== null && !text(input.folderId, 200)) invalid();
    return {
      adapter: THEME_CONTENT_ADAPTER,
      version: 1,
      value: copyBoundedJson({ crystal, tags: input.tags, visibility: input.visibility, folderId: input.folderId }, budget2, "Theme history")
    };
  }
  function themeContentValue(snapshot2) {
    if (snapshot2.adapter !== THEME_CONTENT_ADAPTER || snapshot2.version !== 1) invalid();
    const value = copyBoundedJson(snapshot2.value, budget2, "Theme history");
    const projected = themeContentSnapshot(value);
    if (JSON.stringify(projected.value) !== JSON.stringify(value)) invalid();
    return value;
  }

  // remix/app/utils/thingTransfer/theme.ts
  var isTransferTheme = (thing) => thing.thingtime.length === 1 && thing.thingtime[0] === "theme";
  var validateTransferTheme = (thing) => {
    if (!isTransferTheme(thing) || thing.targetId || thing.extended != null || thing.tags?.length || Object.keys(thing.crystal).some((key4) => key4 !== "name" && key4 !== "theme" && key4 !== "title")) {
      throw new Error("Theme transfers contain only a name, theme tokens, optional display title and folder placement");
    }
    if ("title" in thing.crystal && !validOptionalLibraryTitle(thing.crystal.title)) throw new Error("Invalid theme display title");
    if (typeof thing.crystal.name !== "string" || !thing.crystal.name.trim() || thing.crystal.name.length > 60 || !thing.crystal.theme || typeof thing.crystal.theme !== "object" || Array.isArray(thing.crystal.theme)) {
      throw new Error("A theme transfer requires a name and theme token object");
    }
  };

  // remix/app/api/utils/algorithms/algorithmTransferCore.ts
  var record = (value) => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  var parseAlgorithmTransfer = (value) => {
    if (!record(value) || Object.keys(value).some((key4) => !["name", "title", "emoji", "weights", "eventCount", "lastTrainedAt"].includes(key4))) {
      throw new Error("An algorithm transfer contains only name, optional display title, emoji, weights and training statistics");
    }
    const { name, emoji, weights, eventCount, lastTrainedAt } = value;
    const hasTitle = Object.prototype.hasOwnProperty.call(value, "title");
    if (hasTitle && !validOptionalLibraryTitle(value.title)) throw new Error("Invalid algorithm display title");
    if (typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > 60 || typeof emoji !== "string" || !emoji.trim() || emoji !== emoji.trim() || [...emoji].length > 3) {
      throw new Error("Invalid algorithm name or emoji");
    }
    if (!Number.isSafeInteger(eventCount) || eventCount < 0 || lastTrainedAt !== null && (typeof lastTrainedAt !== "string" || !Number.isFinite(Date.parse(lastTrainedAt)) || new Date(lastTrainedAt).toISOString() !== lastTrainedAt)) {
      throw new Error("Invalid algorithm training statistics");
    }
    if (!record(weights) || Object.keys(weights).length !== 3) throw new Error("Invalid algorithm weights");
    const result = { types: {}, tags: {}, authors: {} };
    for (const bucket of ["types", "tags", "authors"]) {
      const values = weights[bucket];
      if (!record(values) || Object.keys(values).length > 1e4) throw new Error("An algorithm weight bucket may contain at most 10000 entries");
      for (const [key4, weight] of Object.entries(values)) {
        if (!key4 || key4.length > 512 || ["__proto__", "prototype", "constructor"].includes(key4) || [...key4].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || typeof weight !== "number" || !Number.isFinite(weight) || Math.abs(weight) > 50) {
          throw new Error("Invalid algorithm weight");
        }
        result[bucket][key4] = weight;
      }
    }
    return { name, ...hasTitle ? { title: value.title } : {}, emoji, weights: result, eventCount, lastTrainedAt };
  };

  // remix/app/utils/thingTransfer/algorithm.ts
  var isTransferAlgorithm = (thing) => thing.thingtime.length === 1 && thing.thingtime[0] === "feed-algorithm";
  var validateTransferAlgorithm = (thing) => {
    if (!isTransferAlgorithm(thing) || thing.targetId || thing.extended != null || thing.tags?.length) throw new Error("Algorithm transfers cannot contain child relationships or extra Thing fields");
    parseAlgorithmTransfer(thing.crystal);
  };
  var algorithmTransferContent = (crystal) => parseAlgorithmTransfer({
    ...Object.prototype.hasOwnProperty.call(crystal, "title") ? { title: crystal.title } : {},
    name: crystal.name,
    emoji: crystal.emoji,
    weights: crystal.weights,
    eventCount: crystal.eventCount,
    lastTrainedAt: crystal.lastTrainedAt
  });

  // remix/app/timeline/algorithmContent.ts
  var ALGORITHM_CONTENT_ADAPTER = "algorithm-content";
  var budget3 = { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 12, maxNodes: 1e5, sortKeys: true };
  var invalid2 = () => {
    throw new Error("Invalid algorithm content history");
  };
  function algorithmContentSnapshot(input) {
    const row = input;
    if (!row || !row.crystal || row.folderId !== null && (typeof row.folderId !== "string" || row.folderId.length > 200)) invalid2();
    const description = row.crystal.description ?? "";
    if (typeof description !== "string" || description.length > 300) invalid2();
    const crystal = { ...algorithmTransferContent(row.crystal), description };
    return {
      adapter: ALGORITHM_CONTENT_ADAPTER,
      version: 1,
      value: copyBoundedJson({ crystal, folderId: row.folderId }, budget3, "Algorithm history")
    };
  }
  function algorithmContentValue(snapshot2) {
    if (snapshot2.adapter !== ALGORITHM_CONTENT_ADAPTER || snapshot2.version !== 1) invalid2();
    const value = copyBoundedJson(snapshot2.value, budget3, "Algorithm history");
    if (JSON.stringify(algorithmContentSnapshot(value).value) !== JSON.stringify(value)) invalid2();
    return value;
  }

  // remix/app/api/utils/webpages/componentResolutionCore.ts
  var selectComponent = (ref, docs, compositionOwnerId) => {
    const exact3 = docs.find((doc) => doc.shareId === ref);
    if (exact3) return exact3;
    const seeded = docs.find((doc) => doc.ownerId === "system" && doc.shareId === `component-${ref}`);
    if (seeded) return seeded;
    return docs.filter((doc) => !!compositionOwnerId && doc.ownerId === compositionOwnerId && doc.crystal?.componentKey === ref).reduce((latest, doc) => {
      const version = Number(doc.crystal?.version) || 0;
      return !latest || version > (Number(latest.crystal?.version) || 0) ? doc : latest;
    }, null);
  };

  // remix/app/webPlatform/mediaPipeline.ts
  var record2 = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  var keys3 = (x, allowed) => {
    if (Object.keys(x).some((k) => !allowed.includes(k))) throw new Error("Unknown media pipeline field");
  };
  var optionKeys = ["format", "maxWidth", "maxHeight", "videoBitrate", "frameRate", "audio", "audioBitrate", "imageFormat", "imageQuality", "imageBackground"];
  function validateMediaPipeline(value) {
    if (!record2(value)) throw new Error("Expected a media pipeline");
    keys3(value, ["file", "start", "cancel", "status", "progress", "preview", "imagePreview", "download", "output"]);
    const used = /* @__PURE__ */ new Set();
    for (const key4 of ["file", "start", "cancel", "status", "progress", "preview", "imagePreview", "download"]) {
      const v = value[key4];
      if (["preview", "imagePreview", "download"].includes(key4) && v === void 0) continue;
      if (typeof v !== "string" || !/^#[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(v) || used.has(v))
        throw new Error("Media controls require distinct element IDs inside their surface");
      used.add(v);
    }
    if (!record2(value.output)) throw new Error("Expected media output settings");
    keys3(value.output, optionKeys);
    for (const key4 of optionKeys) {
      const v = value.output[key4];
      if (key4.startsWith("image") && v === void 0) continue;
      if (record2(v)) {
        keys3(v, ["op", "name"]);
        if (v.op !== "input" || typeof v.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(v.name) || ["__proto__", "constructor", "prototype"].includes(v.name))
          throw new Error("Media settings accept only named inputs or scalar values");
      } else if (!["number", "string", "boolean"].includes(typeof v)) throw new Error("Missing media output setting");
    }
    const defaults = { format: "mp4", maxWidth: 1280, maxHeight: 720, videoBitrate: 15e5, frameRate: 30, audio: "keep", audioBitrate: 96e3, imageFormat: "auto", imageQuality: 80, imageBackground: "none" };
    validateMediaSettings(
      Object.fromEntries(optionKeys.map((k) => [k, record2(value.output[k]) ? defaults[k] : value.output[k]]))
    );
  }
  function validateMediaSettings(raw) {
    if (!record2(raw)) throw new Error("Expected media settings");
    keys3(raw, optionKeys);
    if (raw.imageFormat !== void 0 && (typeof raw.imageFormat !== "string" || !["auto", "webp", "jpeg", "png", "avif", "gif"].includes(raw.imageFormat)))
      throw new Error("Choose auto, webp, jpeg, png, avif or gif for images");
    if (raw.imageQuality !== void 0 && (typeof raw.imageQuality !== "number" || !Number.isInteger(raw.imageQuality) || raw.imageQuality < 1 || raw.imageQuality > 100))
      throw new Error("Image quality must be a number from 1 to 100");
    if (raw.imageBackground !== void 0 && (typeof raw.imageBackground !== "string" || !/^(none|#[a-fA-F0-9]{6})$/.test(raw.imageBackground)))
      throw new Error("Image background must be none or a six-digit hex color");
    if (typeof raw.format !== "string" || !["mp4", "webm"].includes(raw.format) || typeof raw.audio !== "string" || !["keep", "remove"].includes(raw.audio))
      throw new Error("Choose mp4 or webm, and keep or remove audio");
    for (const key4 of ["maxWidth", "maxHeight", "videoBitrate", "frameRate", "audioBitrate"]) {
      const v = raw[key4];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new Error(`${key4} must be a positive finite number`);
      if (["maxWidth", "maxHeight"].includes(key4) && (!Number.isInteger(v) || v < 2 || v > 4294967295))
        throw new Error(`${key4} must be a WebCodecs dimension (integer from 2 to 4294967295)`);
    }
    return raw;
  }

  // remix/app/schemas/liveSources.ts
  var LIVE_SOURCES = [
    { path: "/api/v1/agent-overview", feature: "api.agent-overview", minimumVersion: "2.0.0" }
  ];
  function validateLiveSource(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value;
    const match = LIVE_SOURCES.find((entry) => entry.path === source.path && entry.feature === source.feature && entry.minimumVersion === source.minimumVersion);
    return match ? { ...match } : null;
  }

  // remix/app/fileSync/reconcile.ts
  var syncPathKey = (path2) => path2.normalize("NFC").toLowerCase();
  var validSyncPath = (path2) => {
    if (typeof path2 !== "string" || !path2 || path2.length > 4096 || /[\\\p{Cc}\p{Cf}]/u.test(path2)) return false;
    const parts = path2.split("/");
    return parts.length <= 128 && parts.every((part) => part.length > 0 && part.length <= 255 && part !== "." && part !== "..");
  };

  // remix/app/fileSync/syncIgnore.ts
  var DEFAULT_SYNC_IGNORE_RULES = ["node_modules/", "bower_components/", ".venv/", "venv/", "__pycache__/", ".gradle/", "Pods/", ".dart_tool/", ".pub-cache/", ".pnpm-store/", ".npm/", ".yarn/cache/", ".cargo/registry/", ".cargo/git/", ".m2/repository/", "__pypackages__/", ".tox/", ".nox/", "/go/pkg/mod/", "**/vendor/bundle/"].join("\n");
  function canonicalIgnoreRules(value) {
    if (value === void 0) return "";
    if (typeof value !== "string" || value.includes("\0")) throw Error("Ignore rules must be text without NUL characters.");
    const text2 = value.replace(/\r\n/g, "\n");
    return text2;
  }

  // remix/app/fileSync/configuration.ts
  var FILE_SYNC_KIND = "file-sync";
  var FILE_SYNC_RESOURCE_KEYS = ["uploadBytesPerSecond", "downloadBytesPerSecond", "transferConcurrency", "indexingConcurrency", "cpuPercent"];
  function parseFileSyncResourceLimits(value) {
    if (value === void 0) return void 0;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key4) => !FILE_SYNC_RESOURCE_KEYS.includes(key4))) throw Error("Invalid sync resource limits.");
    const result = {};
    for (const key4 of FILE_SYNC_RESOURCE_KEYS) {
      const n = value[key4];
      if (n === void 0) continue;
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || (key4 === "transferConcurrency" || key4 === "indexingConcurrency") && !Number.isSafeInteger(n) || key4 === "cpuPercent" && (!Number.isInteger(n) || n < 1 || n > 100)) throw Error("Invalid sync resource limit: " + key4);
      result[key4] = n;
    }
    return Object.keys(result).length ? result : void 0;
  }
  var MAX_SYNC_EXCLUSIONS = 100;
  var id2 = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
  function parseFileSyncConfiguration(value) {
    const c = value;
    if (!c || c.configurationVersion !== 1 && c.configurationVersion !== 2 && c.configurationVersion !== 3) throw Error("Unsupported file sync configuration version.");
    const resourceLimits = parseFileSyncResourceLimits(c.resourceLimits);
    if (resourceLimits && c.configurationVersion !== 3) throw Error("Resource limits require file sync configuration version 3.");
    if (c.configurationVersion === 3 && !resourceLimits) throw Error("Version 3 requires nonempty resource limits.");
    const ignoreRules = canonicalIgnoreRules(c.ignoreRules);
    if (ignoreRules && c.configurationVersion === 1) throw Error("Ignore rules require file sync configuration version 2.");
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(c.name)) throw Error("Sync name must contain 1\u2013120 visible characters.");
    if (!id2(c.deviceId) || !id2(c.localRootId) || !id2(c.remoteFolderId)) throw Error("Sync requires a device, a granted local root and a cloud folder.");
    if (c.sourceKind !== void 0 && !["folder", "photos"].includes(c.sourceKind)) throw Error("Invalid sync source kind.");
    if (c.sourceKind === "photos" && (c.mode !== "backup" || c.propagateDeletes)) throw Error("Photo libraries require backup mode with saved cloud copies retained.");
    if (!["two-way", "upload", "download", "backup"].includes(c.mode)) throw Error("Invalid sync direction.");
    if (typeof c.paused !== "boolean" || typeof c.propagateDeletes !== "boolean" || typeof c.chargingOnly !== "boolean") throw Error("Sync pause, deletion and charging choices must be explicit booleans.");
    if (c.mode === "backup" && c.propagateDeletes) throw Error("Backup always retains destination files after source deletion.");
    if (!["wifi", "any"].includes(c.network)) throw Error("Choose Wi-Fi or any network for sync.");
    if (!Array.isArray(c.excludedPaths) || c.excludedPaths.length > MAX_SYNC_EXCLUSIONS || c.excludedPaths.some((path2) => !validSyncPath(path2))) throw Error("Sync exclusions must be at most 100 relative file or folder paths.");
    if (c.excludedPaths.reduce((n, path2) => n + new TextEncoder().encode(path2).length, 0) > 16384) throw Error("Sync exclusions exceed 16 KiB.");
    const keys4 = c.excludedPaths.map(syncPathKey);
    if (new Set(keys4).size !== keys4.length) throw Error("Sync exclusions contain duplicate or ambiguous paths.");
    return {
      configurationVersion: resourceLimits ? 3 : ignoreRules ? 2 : 1,
      name: c.name.trim(),
      deviceId: c.deviceId,
      localRootId: c.localRootId,
      remoteFolderId: c.remoteFolderId,
      ...c.sourceKind !== void 0 ? { sourceKind: c.sourceKind } : {},
      mode: c.mode,
      paused: c.paused,
      propagateDeletes: c.propagateDeletes,
      network: c.network,
      chargingOnly: c.chargingOnly,
      excludedPaths: [...c.excludedPaths],
      ...ignoreRules ? { ignoreRules } : {},
      ...resourceLimits ? { resourceLimits } : {}
    };
  }
  var fileSyncSchema = {
    id: FILE_SYNC_KIND,
    version: 4,
    kind: "crystal",
    collection: null,
    title: "File sync",
    summary: "An editable connection between a selected device folder and a cloud folder.",
    detail: "One ordinary Thing per connection, private by default. Native paths, bookmarks, tree URIs and credentials stay on the device. This configuration grants no access and does not start transfers by itself. Workers require current ownership, private audience, matching device-local approval and fresh folder authorization. Direction, exclusions and network/power choices apply before planning; confirmed transfer history stays in Timeline. Defaults are paused, Wi-Fi and no deletion propagation; folders default to two-way and photo libraries to backup.",
    fields: [
      { name: "configurationVersion", type: "number", required: true, min: 1, max: 3, description: "Configuration format version. Version 2 requires ignore rules; version 3 requires nonempty resourceLimits. Older clients must refuse unsupported policy versions." },
      { name: "name", type: "string", required: true, max: 120, description: "Display name." },
      { name: "deviceId", type: "id", required: true, max: 200, description: "Paired device identity; never a credential." },
      { name: "localRootId", type: "id", required: true, max: 200, description: "Opaque device-local selected-folder grant identity; never a path or URI." },
      { name: "remoteFolderId", type: "id", required: true, max: 200, description: "Cloud folder Thing identity, reauthorized by the worker." },
      { name: "sourceKind", type: "enum", required: false, values: ["folder", "photos"], description: "Optional source intent. Photos require backup mode without deletion propagation. The native source remains the authority." },
      { name: "mode", type: "enum", required: true, values: ["two-way", "upload", "download", "backup"], description: "Two-way, device to cloud, cloud to device, or backup retaining destination deletions." },
      { name: "paused", type: "boolean", required: true, description: "Pause new work; in-flight results still need reconciliation." },
      { name: "propagateDeletes", type: "boolean", required: true, description: "Explicitly propagate confirmed deletions to recoverable Trash. Backup requires false." },
      { name: "network", type: "enum", required: true, values: ["wifi", "any"], description: "Allowed native network connection. Unknown connectivity waits." },
      { name: "chargingOnly", type: "boolean", required: true, description: "Wait unless the native power reading confirms charging." },
      { name: "excludedPaths", type: "string[]", required: true, max: MAX_SYNC_EXCLUSIONS, description: "Relative exact paths and entire descendant subtrees to skip, case/Unicode folded. No glob syntax. At most 16 KiB in total." },
      { name: "resourceLimits", type: "object", required: false, description: "Optional closed positive ceilings: uploadBytesPerSecond, downloadBytesPerSecond, transferConcurrency, indexingConcurrency, cpuPercent (1\u2013100 of total available CPU capacity attributable to this sync). Unset values preserve worker defaults. Requires configurationVersion 3.", children: [
        { name: "uploadBytesPerSecond", type: "number", required: false, description: "Positive aggregate upload bytes per second for this connection." },
        { name: "downloadBytesPerSecond", type: "number", required: false, description: "Positive aggregate download bytes per second for this connection." },
        { name: "transferConcurrency", type: "number", required: false, min: 1, description: "Positive safe integer maximum simultaneous file/folder transfers." },
        { name: "indexingConcurrency", type: "number", required: false, min: 1, description: "Positive safe integer maximum simultaneous indexing workers." },
        { name: "cpuPercent", type: "number", required: false, min: 1, max: 100, description: "Whole percent of total available CPU capacity attributed to this sync." }
      ] },
      { name: "ignoreRules", type: "string", required: false, description: "Optional case-sensitive root-relative Gitignore rules, subject to the selected native bridge request budget. Ordered negation cannot reinclude children of an ignored parent. No nested .gitignore reads. Empty text is omitted." }
    ],
    example: { configurationVersion: 1, name: "Documents", deviceId: "device-id", localRootId: "local-root-id", remoteFolderId: "folder-id", mode: "two-way", paused: true, propagateDeletes: false, network: "wifi", chargingOnly: false, excludedPaths: [] }
  };

  // remix/app/components/Kinds/htmlRenderPolicy.ts
  var HTML_ALLOWED_TAGS = /* @__PURE__ */ new Set([
    "tt-web-platform",
    "tt-media-pipeline",
    "progress",
    "output",
    "tt-service-workspace",
    "tt-style",
    "tt-collection",
    "tt-drag",
    "tt-change",
    "tt-drop",
    "tt-form",
    "tt-select",
    "tt-map",
    "tt-media",
    "tt-attachments",
    "tt-discussion",
    "dl",
    "dt",
    "dd",
    "tt-dialog",
    "tt-countdown",
    "dialog",
    "details",
    "summary",
    "tt-upload",
    "div",
    "span",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "a",
    "img",
    "button",
    "ul",
    "ol",
    "li",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "aside",
    "main",
    "strong",
    "em",
    "small",
    "b",
    "i",
    "u",
    "s",
    "mark",
    "sub",
    "sup",
    "code",
    "pre",
    "blockquote",
    "hr",
    "br",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "figure",
    "figcaption",
    "label",
    "fieldset",
    "legend",
    "input",
    "textarea",
    "select",
    "option",
    "video",
    "audio",
    "svg",
    "path",
    "circle",
    "ellipse",
    "rect",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "g"
  ]);

  // remix/app/passwords/model.ts
  var PASSWORD_TYPES = ["login", "password", "api-key", "secure-note", "passkey-reference", "passkey", "credit-card", "identity", "document", "software-license", "bank-account", "database", "driver-license", "outdoor-license", "membership", "passport", "rewards", "social-security-number", "email-account", "server", "wireless-router", "ssh-key", "api-credential", "medical-record", "other"];
  var FIELD_TYPES = ["text", "password", "url", "email", "notes", "totp", "address", "credit-card-number", "credit-card-type", "date", "gender", "menu", "month-year", "phone", "reference", "ssh-key", "structured"];

  // remix/app/devices/platform.ts
  var DEVICE_PLATFORMS = ["macos", "windows", "linux", "watchos", "ios", "android"];

  // remix/app/timeline/branches.ts
  var TIMELINE_BRANCH_KIND = "timeline-branch";
  var TIMELINE_BRANCH_HEAD_KIND = "timeline-branch-head";

  // remix/app/timeline/notes.ts
  var TIMELINE_NOTE_KIND = "timeline-note";

  // remix/app/timeline/versionNames.ts
  var TIMELINE_VERSION_NAME_KIND = "timeline-version-name";

  // remix/app/schemas/actionJsonInput.ts
  var MAX_ACTION_JSON_BYTES = 64 * 1024;
  var MAX_ACTION_JSON_DEPTH = 64;
  var MAX_ACTION_JSON_NODES = 4e3;
  function copyActionJson(value) {
    return copyBoundedJson(value, { maxBytes: MAX_ACTION_JSON_BYTES, maxDepth: MAX_ACTION_JSON_DEPTH, maxNodes: MAX_ACTION_JSON_NODES }, "JSON input");
  }

  // remix/app/schemas/browserActions.ts
  var BROWSER_ACTION_OPS = ["http.request", "compute", "fail", "return", "actions.invoke", "each"];
  var ACTION_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  var isActionHttpPath = (value) => typeof value === "string" && /^\/api\/v1\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value) && value.length <= 240;
  var actionHttpEndpoint = (method, path2) => typeof method === "string" && ACTION_HTTP_METHODS.includes(method) && isActionHttpPath(path2) ? `${method} ${path2}` : null;
  var isActionHttpEndpoint = (value) => {
    if (typeof value !== "string") return false;
    const [method, path2, extra] = value.split(" ");
    return !extra && actionHttpEndpoint(method, path2) === value;
  };
  var BROWSER_ACTION_EXPANDED_LIMITS = { timeoutMs: 12e4, maxResultBytes: 8 * 1024 * 1024 };
  var BROWSER_ACTION_LEGACY_LIMITS = { timeoutMs: 1e4, maxResultBytes: 256 * 1024 };
  var BROWSER_EXPRESSION_DEFAULTS = { nodes: 2e4, listItems: 1e3 };
  var BROWSER_EXPRESSION_CEILINGS = { nodes: 1e6, listItems: 1e4 };
  function parseBrowserExpressionLimits(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value;
    if (Object.keys(input).some((key4) => !(key4 === "nodes" || key4 === "listItems"))) return null;
    const result = { ...BROWSER_EXPRESSION_DEFAULTS };
    for (const key4 of ["nodes", "listItems"]) {
      const amount = input[key4] ?? result[key4];
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > BROWSER_EXPRESSION_CEILINGS[key4]) return null;
      result[key4] = amount;
    }
    return result;
  }

  // remix/app/schemas/actionRequestPagination.ts
  var path = (value) => typeof value === "string" && value.length <= 160 && value.split(".").length <= 8 && value.split(".").every((key4) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key4) && !["__proto__", "prototype", "constructor"].includes(key4));
  function parseActionRequestPagination(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const spec = raw;
    if (Object.keys(spec).some((key4) => !["cursorParam", "cursorPath", "itemsPath", "itemKey", "maxPages", "maxItems"].includes(key4))) return null;
    if (!path(spec.cursorParam) || spec.cursorParam.includes(".") || !path(spec.cursorPath) || !path(spec.itemsPath) || spec.cursorPath === spec.itemsPath || spec.cursorPath.startsWith(spec.itemsPath + ".") || spec.itemsPath.startsWith(spec.cursorPath + "."))
      return null;
    if (spec.itemKey !== void 0 && !path(spec.itemKey)) return null;
    const maxPages = spec.maxPages ?? 20, maxItems = spec.maxItems ?? 5e3;
    if (typeof maxPages !== "number" || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 || typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 1e4)
      return null;
    return {
      cursorParam: spec.cursorParam,
      cursorPath: spec.cursorPath,
      itemsPath: spec.itemsPath,
      ...spec.itemKey === void 0 ? {} : { itemKey: spec.itemKey },
      maxPages,
      maxItems
    };
  }

  // remix/app/components/Feed/postThingReferences.ts
  var MAX_POST_THINGS = 20;
  function postThingReferences(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const raw = value;
    if (raw.kind !== "thing-collection" || !Array.isArray(raw.items)) return [];
    const seen = /* @__PURE__ */ new Set();
    return raw.items.slice(0, MAX_POST_THINGS).flatMap((item) => {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item.id) || seen.has(item.id)) return [];
      seen.add(item.id);
      return [{ id: item.id, mode: item.mode === "data" ? "data" : "interactive" }];
    });
  }

  // remix/app/schemas/actionLookups.ts
  var ACTION_LOOKUP_PROVIDERS = {
    "google-geocoding": { label: "Google Maps address lookup", attribution: "Google Maps", maxQueryChars: 500 }
  };
  var isActionLookupProvider = (value) => typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_LOOKUP_PROVIDERS, value);

  // remix/app/utils/reactionTokens.ts
  var ALL_EMOJI_CHARS = /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]+$/u;
  var HAS_REAL_EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;
  var MAX_REACTION_EMOJIS = 12;
  var MAX_REACTION_CODEPOINTS = 80;
  var graphemeSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
  var splitEmojis = (token) => {
    if (graphemeSegmenter) {
      return Array.from(graphemeSegmenter.segment(token), (s) => s.segment);
    }
    return Array.from(token);
  };
  var sanitizeReactionToken = (raw) => {
    if (typeof raw !== "string") return null;
    const token = raw.trim();
    if (!token) return null;
    if (Array.from(token).length > MAX_REACTION_CODEPOINTS) return null;
    if (token.includes(".") || token.startsWith("$") || /\s/.test(token)) return null;
    if (!ALL_EMOJI_CHARS.test(token)) return null;
    if (!HAS_REAL_EMOJI.test(token)) return null;
    if (splitEmojis(token).length > MAX_REACTION_EMOJIS) return null;
    return token;
  };

  // remix/app/components/Editor/styleColor.ts
  var clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
  var rgbaToHex = (c) => "#" + [c.r, c.g, c.b, ...c.a < 1 ? [c.a * 255] : []].map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0")).join("");
  var hslToRgba = (h, s, l, a = 1) => {
    h = (h % 360 + 360) % 360 / 360;
    s = clamp(s / 100);
    l = clamp(l / 100);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return { r: f(0), g: f(8), b: f(4), a: clamp(a) };
  };
  var parseColor = (raw) => {
    const value = raw.trim();
    if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
      let hex2 = value.slice(1);
      if (hex2.length <= 4) hex2 = [...hex2].map((c) => c + c).join("");
      return {
        r: parseInt(hex2.slice(0, 2), 16),
        g: parseInt(hex2.slice(2, 4), 16),
        b: parseInt(hex2.slice(4, 6), 16),
        a: hex2.length === 8 ? parseInt(hex2.slice(6), 16) / 255 : 1
      };
    }
    const match = /^(rgba?|hsla?)\(\s*([+\-\d.%\s,/]+)\s*\)$/i.exec(value);
    if (!match) return null;
    const parts = match[2].trim().split(/[\s,/]+/);
    if (parts.length < 3 || parts.length > 4 || parts.some((p) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(p))) return null;
    const n = parts.map(parseFloat);
    if (n.some((v) => !Number.isFinite(v))) return null;
    const a = clamp(parts[3]?.endsWith("%") ? n[3] / 100 : n[3] ?? 1);
    if (match[1].toLowerCase().startsWith("hsl")) {
      if (parts[0].endsWith("%") || !parts[1].endsWith("%") || !parts[2].endsWith("%")) return null;
      return hslToRgba(n[0], n[1], n[2], a);
    }
    return {
      r: clamp(n[0] * (parts[0].endsWith("%") ? 2.55 : 1), 0, 255),
      g: clamp(n[1] * (parts[1].endsWith("%") ? 2.55 : 1), 0, 255),
      b: clamp(n[2] * (parts[2].endsWith("%") ? 2.55 : 1), 0, 255),
      a
    };
  };

  // remix/app/components/Editor/styleTokens.ts
  var HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var THEME_COLOR_VARS = /* @__PURE__ */ new Set([
    "var(--tt-ink, #16161a)",
    "var(--tt-text, #5a5a66)",
    "var(--tt-muted, #9a9aa6)",
    "var(--tt-accent, hotpink)",
    "var(--tt-link, #2f8fd6)",
    "var(--tt-positive, #2f8f4f)",
    "var(--tt-danger, #d6455a)"
  ]);
  var FONT_STACKS = {
    body: "var(--tt-font-body, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif)",
    serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
    mono: "var(--tt-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Comfortaa', system-ui, sans-serif"
  };
  var MIN_FONT_SIZE = 10;
  var MAX_FONT_SIZE = 240;
  var SIZE_LIMITS = { px: [1, 240], em: [0.1, 15], rem: [0.1, 15], pt: [1, 180], "%": [10, 1500] };
  var sanitizeColor = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (HEX_COLOR.test(trimmed)) return trimmed;
    if (THEME_COLOR_VARS.has(trimmed)) return trimmed;
    const parsed = parseColor(trimmed);
    return parsed ? rgbaToHex(parsed) : null;
  };
  var sanitizeSize = (value) => {
    if (typeof value === "string") {
      const match = /^(\d+(?:\.\d+)?)(px|em|rem|pt|%)$/.exec(value.trim());
      if (match) {
        const [min, max] = SIZE_LIMITS[match[2]];
        return `${Math.round(Math.min(max, Math.max(min, Number(match[1]))) * 100) / 100}${match[2]}`;
      }
      if (!value.trim()) return null;
    }
    const parsed = typeof value === "string" ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
    return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(parsed * 2) / 2));
  };
  var sanitizeFont = (value) => typeof value === "string" && Object.prototype.hasOwnProperty.call(FONT_STACKS, value) ? value : null;
  var sanitizeAlign = (value) => value === "left" || value === "center" || value === "right" ? value : null;
  var sanitizeStyleTokens = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const record3 = raw;
    const out = {};
    const color = sanitizeColor(record3.color);
    if (color) out.color = color;
    const size = sanitizeSize(record3.size);
    if (size !== null) out.size = size;
    const font = sanitizeFont(record3.font);
    if (font) out.font = font;
    const align = sanitizeAlign(record3.align);
    if (align) out.align = align;
    const background = sanitizeColor(record3.background);
    if (background) out.background = background;
    if (typeof record3.bold === "boolean") out.bold = record3.bold;
    if (typeof record3.italic === "boolean") out.italic = record3.italic;
    if (typeof record3.decoration === "string" && /^(none|(?:underline|overline|line-through)(?: (?:underline|overline|line-through))*)$/.test(record3.decoration))
      out.decoration = [...new Set(record3.decoration.split(" "))].join(" ");
    return out;
  };
  var styleTokensToCss = (tokens) => {
    const css = {};
    if (tokens.color) css.color = tokens.color;
    if (tokens.size) css.fontSize = typeof tokens.size === "number" ? `${tokens.size}px` : tokens.size;
    if (tokens.background) css.backgroundColor = tokens.background;
    if (tokens.bold !== void 0) css.fontWeight = tokens.bold ? 800 : 400;
    if (tokens.italic !== void 0) css.fontStyle = tokens.italic ? "italic" : "normal";
    if (tokens.decoration) css.textDecoration = tokens.decoration;
    if (tokens.font) css.fontFamily = FONT_STACKS[tokens.font];
    if (tokens.align) css.textAlign = tokens.align;
    return css;
  };
  var inlineStyleToTokens = (style) => {
    const values = {};
    for (const declaration of style.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const key4 = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
      if (key4 === "color") values.color = value;
      if (key4 === "background-color") values.background = value;
      if (key4 === "font-size") values.size = value;
      if (key4 === "text-decoration" || key4 === "text-decoration-line") values.decoration = value;
      if (key4 === "font-weight" && /^(400|800|normal|bold)$/.test(value)) values.bold = value === "800" || value === "bold";
      if (key4 === "font-style" && /^(normal|italic)$/.test(value)) values.italic = value === "italic";
      if (key4 === "font-family")
        values.font = Object.entries(FONT_STACKS).find(([, stack]) => stack.replace(/['"]/g, "") === value.replace(/['"]/g, ""))?.[0];
    }
    return sanitizeStyleTokens(values);
  };
  var tokensToInlineStyle = (tokens) => Object.entries(styleTokensToCss(sanitizeStyleTokens(tokens))).filter(([key4]) => key4 !== "textAlign").map(([key4, value]) => `${key4.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${value}`).join(";");
  var sanitizeInlineStyle = (style) => tokensToInlineStyle(inlineStyleToTokens(style));

  // remix/app/components/Editor/inlineHtmlText.ts
  var ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi;
  var UNKNOWN_ENTITY_PATTERN = /&(?:#|[a-z][a-z\d]+;)/i;
  var TAG_NAME_PATTERN = /^\s*(\/?)\s*([a-z][\w:-]*)/i;
  var ALLOWED_INLINE_TAGS = /* @__PURE__ */ new Set(["b", "strong", "i", "em", "u", "s", "a", "mark", "code", "br", "span"]);
  var DROPPED_CONTENT_TAGS = /* @__PURE__ */ new Set(["script", "style", "template"]);
  var SAFE_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:", "mailto:", "tel:"]);
  var SAFE_BASE = "https://thingtime.invalid/";
  var MAX_INLINE_NESTING = 64;
  var decodeEntityOnce = (entity) => {
    const lower = entity.toLowerCase();
    const named = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
      "&nbsp;": " "
    };
    if (named[lower]) return named[lower];
    const radix = lower.startsWith("&#x") ? 16 : 10;
    const digits = lower.slice(radix === 16 ? 3 : 2, -1);
    const codePoint = Number.parseInt(digits, radix);
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 1114111 ? String.fromCodePoint(codePoint) : entity;
  };
  var decodeEntitiesOnce = (source) => source.replace(ENTITY_PATTERN, decodeEntityOnce);
  var escapeHtmlText = (text2) => text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var escapeAttribute = (text2) => escapeHtmlText(text2).replace(/"/g, "&quot;");
  var readTag = (source, start) => {
    let quote = "";
    for (let index = start + 1; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === ">") return { end: index + 1, contents: source.slice(start + 1, index) };
    }
    return null;
  };
  var readAttribute = (tag, wantedName) => {
    const nameMatch = TAG_NAME_PATTERN.exec(tag);
    let index = nameMatch?.[0].length ?? 0;
    while (index < tag.length) {
      while (/\s|\//.test(tag[index] || "")) index += 1;
      const nameStart = index;
      while (index < tag.length && !/[\s=/>]/.test(tag[index])) index += 1;
      const name = tag.slice(nameStart, index).toLowerCase();
      while (/\s/.test(tag[index] || "")) index += 1;
      let value = "";
      if (tag[index] === "=") {
        index += 1;
        while (/\s/.test(tag[index] || "")) index += 1;
        const quote = tag[index] === '"' || tag[index] === "'" ? tag[index++] : "";
        const valueStart = index;
        if (quote) {
          while (index < tag.length && tag[index] !== quote) index += 1;
          value = tag.slice(valueStart, index);
          if (tag[index] === quote) index += 1;
        } else {
          while (index < tag.length && !/[\s>]/.test(tag[index])) index += 1;
          value = tag.slice(valueStart, index);
        }
      }
      if (name === wantedName) return value;
      if (!name && index < tag.length) index += 1;
    }
    return "";
  };
  var safeHref = (rawHref) => {
    const href = decodeEntitiesOnce(rawHref).trim();
    if (!href || UNKNOWN_ENTITY_PATTERN.test(href)) return "";
    try {
      return SAFE_PROTOCOLS.has(new URL(href, SAFE_BASE).protocol) ? href : "";
    } catch {
      return "";
    }
  };
  var parseInlineHtml = (value) => {
    const source = typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" ? String(value) : "";
    let html = "";
    let text2 = "";
    let cursor = 0;
    let inlineOverflowDepth = 0;
    const suppressedTags = [];
    const suppressedOverflowTags = [];
    const openTags = [];
    const appendText = (segment) => {
      if (!segment || suppressedTags.length) return;
      const decoded = decodeEntitiesOnce(segment);
      text2 += decoded;
      html += escapeHtmlText(decoded);
    };
    while (cursor < source.length) {
      const tagStart = source.indexOf("<", cursor);
      if (tagStart < 0) {
        appendText(source.slice(cursor));
        break;
      }
      appendText(source.slice(cursor, tagStart));
      const nextCharacter = source[tagStart + 1] || "";
      if (!/[a-z!/]/i.test(nextCharacter)) {
        appendText("<");
        cursor = tagStart + 1;
        continue;
      }
      const token = readTag(source, tagStart);
      if (!token) {
        appendText(source.slice(tagStart));
        break;
      }
      cursor = token.end;
      if (/^\s*!--/.test(token.contents)) continue;
      const nameMatch = TAG_NAME_PATTERN.exec(token.contents);
      if (!nameMatch) continue;
      const closing = Boolean(nameMatch[1]);
      const tagName = nameMatch[2].toLowerCase();
      if (DROPPED_CONTENT_TAGS.has(tagName)) {
        if (closing) {
          if (suppressedOverflowTags.length) {
            if (suppressedOverflowTags[suppressedOverflowTags.length - 1] === tagName) suppressedOverflowTags.pop();
          } else if (suppressedTags[suppressedTags.length - 1] === tagName) suppressedTags.pop();
        } else if (!suppressedTags.length || suppressedTags[suppressedTags.length - 1] === "template") {
          if (suppressedTags.length >= MAX_INLINE_NESTING) suppressedOverflowTags.push(tagName);
          else suppressedTags.push(tagName);
        }
        continue;
      }
      if (suppressedTags.length || !ALLOWED_INLINE_TAGS.has(tagName)) continue;
      if (closing) {
        if (inlineOverflowDepth > 0) {
          inlineOverflowDepth -= 1;
          continue;
        }
        let matchingIndex = -1;
        for (let index = openTags.length - 1; index >= 0; index -= 1) {
          if (openTags[index].name === tagName) {
            matchingIndex = index;
            break;
          }
        }
        if (matchingIndex >= 0) {
          for (let index = openTags.length - 1; index >= matchingIndex; index -= 1) html += openTags[index].closingHtml;
          openTags.splice(matchingIndex);
        }
        continue;
      }
      if (tagName === "br") {
        text2 += "\n";
        html += "<br/>";
        continue;
      }
      if (openTags.length >= MAX_INLINE_NESTING) {
        inlineOverflowDepth += 1;
        continue;
      }
      if (tagName === "a") {
        const href = safeHref(readAttribute(token.contents, "href"));
        if (href) {
          html += `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">`;
          openTags.push({ name: tagName, closingHtml: "</a>" });
        } else {
          openTags.push({ name: tagName, closingHtml: "" });
        }
        continue;
      }
      if (tagName === "span") {
        const style = sanitizeInlineStyle(decodeEntitiesOnce(readAttribute(token.contents, "style")));
        html += style ? `<span style="${escapeAttribute(style)}">` : "<span>";
        openTags.push({ name: tagName, closingHtml: "</span>" });
        continue;
      }
      html += `<${tagName}>`;
      openTags.push({ name: tagName, closingHtml: `</${tagName}>` });
    }
    for (let index = openTags.length - 1; index >= 0; index -= 1) html += openTags[index].closingHtml;
    return { html, text: text2 };
  };
  var inlineHtmlToText = (value) => parseInlineHtml(value).text;

  // remix/app/components/Editor/editorJsValue.ts
  var EDITOR_JS_AUTO_DETECT_LIMITS = {
    sourceLength: 1e6,
    blocks: 500,
    values: 1e4,
    depth: 32,
    fieldLength: 1e5
  };
  var isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  var isEditorJsDocSafeToEdit = (value) => {
    if (value.blocks.length > EDITOR_JS_AUTO_DETECT_LIMITS.blocks) return false;
    const seen = /* @__PURE__ */ new WeakSet();
    const stack = [{ value, depth: 0 }];
    let enqueuedValues = 1;
    let textLength = 0;
    try {
      while (stack.length) {
        const current = stack.pop();
        if (current.depth > EDITOR_JS_AUTO_DETECT_LIMITS.depth) return false;
        if (typeof current.value === "string") {
          if (current.value.length > EDITOR_JS_AUTO_DETECT_LIMITS.fieldLength) return false;
          textLength += current.value.length;
          if (textLength > EDITOR_JS_AUTO_DETECT_LIMITS.sourceLength) return false;
        }
        if (!current.value || typeof current.value !== "object") continue;
        if (seen.has(current.value)) continue;
        seen.add(current.value);
        const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
        enqueuedValues += children.length;
        if (enqueuedValues > EDITOR_JS_AUTO_DETECT_LIMITS.values) return false;
        for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
      }
      return true;
    } catch {
      return false;
    }
  };
  var isEditorJsDoc = (value) => {
    if (!isRecord(value) || !Array.isArray(value.blocks)) return false;
    return value.blocks.every((block) => isRecord(block) && typeof block.type === "string" && block.type.length > 0 && isRecord(block.data));
  };
  var checklistItems = (data) => (Array.isArray(data.items) ? data.items : []).map((item) => {
    const record3 = item || {};
    return { text: inlineHtmlToText(record3.text ?? record3.content ?? item), checked: record3.checked === true };
  });
  var blocksToText = (blocks) => blocks.map((block) => {
    const data = block.data || {};
    if (block.type === "header") {
      const level = Math.max(1, Math.min(6, Number(data.level) || 2));
      return `${"#".repeat(level)} ${inlineHtmlToText(data.text)}`;
    }
    if (block.type === "list") {
      const style = String(data.style ?? "unordered");
      const serializeItems = (items, depth) => items.map((item, idx) => {
        const record3 = item || {};
        const meta = record3.meta || {};
        const text2 = inlineHtmlToText(typeof item === "string" ? item : record3.text ?? record3.content);
        const indent = "  ".repeat(depth);
        const line = style === "checklist" ? `${indent}- [${record3.checked === true || meta.checked === true ? "x" : " "}] ${text2}` : style === "ordered" ? `${indent}${idx + 1}. ${text2}` : `${indent}- ${text2}`;
        const children = Array.isArray(record3.items) && record3.items.length ? `
${serializeItems(record3.items, depth + 1)}` : "";
        return line + children;
      }).join("\n");
      return serializeItems(Array.isArray(data.items) ? data.items : [], 0);
    }
    if (block.type === "checklist") {
      return checklistItems(data).map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`).join("\n");
    }
    if (block.type === "quote") {
      const caption = inlineHtmlToText(data.caption);
      return `> ${inlineHtmlToText(data.text)}${caption ? `
> \u2014 ${caption}` : ""}`;
    }
    if (block.type === "delimiter") {
      return "---";
    }
    if (block.type === "code") {
      return `\`\`\`
${String(data.code ?? "")}
\`\`\``;
    }
    if (block.type === "table") {
      const content = Array.isArray(data.content) ? data.content : [];
      if (!content.length) return "";
      const rows = content.map((row) => `| ${(Array.isArray(row) ? row : []).map((cell) => inlineHtmlToText(cell)).join(" | ")} |`);
      if (data.withHeadings === true && content[0]) {
        rows.splice(1, 0, `| ${content[0].map(() => "---").join(" | ")} |`);
      }
      return rows.join("\n");
    }
    if (block.type === "warning") {
      const title = inlineHtmlToText(data.title);
      const message = inlineHtmlToText(data.message);
      return `\u26A0\uFE0F ${title}${message ? ` \u2014 ${message}` : ""}`;
    }
    if (block.type === "image") {
      const file = data.file || {};
      const url = String(data.url ?? file.url ?? "");
      if (!url) return inlineHtmlToText(data.caption);
      return `![${inlineHtmlToText(data.caption)}](${url})`;
    }
    if (block.type === "embed") {
      const source = String(data.source ?? data.embed ?? "");
      const caption = inlineHtmlToText(data.caption);
      return source ? `${source}${caption ? `
${caption}` : ""}` : caption;
    }
    return inlineHtmlToText(data.text);
  }).filter((piece) => piece.trim() !== "").join("\n\n");

  // remix/app/schemas/actionExpressions.ts
  var MAX_EXPRESSION_ARGS = 24;
  var sig = (min, max, doc, extra = {}) => ({ min, max, doc, ...extra });
  var EXPRESSION_CATALOGUE = {
    // ── math ──
    add: sig(2, MAX_EXPRESSION_ARGS, "Sum of numbers."),
    sub: sig(2, 2, "a \u2212 b."),
    mul: sig(2, MAX_EXPRESSION_ARGS, "Product of numbers."),
    div: sig(2, 2, "a \xF7 b (b must be non-zero)."),
    mod: sig(2, 2, "a mod b (b must be non-zero)."),
    pow: sig(2, 2, "a to the power b."),
    min: sig(1, MAX_EXPRESSION_ARGS, "Smallest of numbers (a single list arg is spread)."),
    max: sig(1, MAX_EXPRESSION_ARGS, "Largest of numbers (a single list arg is spread)."),
    abs: sig(1, 1, "Absolute value."),
    floor: sig(1, 1, "Round down."),
    ceil: sig(1, 1, "Round up."),
    round: sig(1, 2, "Round to the nearest integer, or to `digits` decimals."),
    clamp: sig(3, 3, "Clamp x into [lo, hi]."),
    sqrt: sig(1, 1, "Square root."),
    // ── random ──
    random: sig(0, 0, "A float in [0, 1)."),
    randomInt: sig(2, 2, "An integer in [lo, hi] inclusive."),
    chance: sig(1, 1, "true with probability p (0\u20131)."),
    randomPick: sig(1, 1, "A random element of a list."),
    seededInt: sig(3, 3, "A deterministic integer in [lo, hi] from a seed string."),
    hash: sig(1, 1, "A stable non-negative 32-bit hash of a string."),
    // ── compare / logic ──
    eq: sig(2, 2, "a equals b (numbers and numeric strings compare as numbers)."),
    ne: sig(2, 2, "a does not equal b."),
    lt: sig(2, 2, "a < b."),
    lte: sig(2, 2, "a \u2264 b."),
    gt: sig(2, 2, "a > b."),
    gte: sig(2, 2, "a \u2265 b."),
    and: sig(1, MAX_EXPRESSION_ARGS, "Every arg truthy."),
    or: sig(1, MAX_EXPRESSION_ARGS, "Any arg truthy."),
    not: sig(1, 1, "Logical negation."),
    if: sig(2, 3, "cond ? then : else (else defaults to null)."),
    coalesce: sig(1, MAX_EXPRESSION_ARGS, 'First arg that is not null/undefined/"".'),
    isEmpty: sig(1, 1, 'true for null, "", [], {}.'),
    typeof: sig(1, 1, '"string" | "number" | "boolean" | "list" | "object" | "null".'),
    // ── text ──
    concat: sig(1, MAX_EXPRESSION_ARGS, 'Join args as text (null \u2192 "").'),
    upper: sig(1, 1, "Upper-case."),
    lower: sig(1, 1, "Lower-case."),
    trim: sig(1, 1, "Trim whitespace."),
    capitalize: sig(1, 1, "Upper-case the first character."),
    slice: sig(2, 3, "Slice a string or list from start (to end)."),
    length: sig(1, 1, "Length of a string or list."),
    join: sig(1, 2, 'Join a list with a separator (default ", ").'),
    split: sig(2, 2, "Split text on a separator."),
    includes: sig(2, 2, "Text contains substring / list contains value."),
    startsWith: sig(2, 2, "Text starts with prefix."),
    endsWith: sig(2, 2, "Text ends with suffix."),
    replace: sig(3, 3, "Replace every occurrence of a substring."),
    padStart: sig(2, 3, 'Pad text on the left to a length (fill defaults to " ").'),
    toNumber: sig(1, 1, "Coerce to a number (null when not numeric)."),
    toString: sig(1, 1, "Coerce to text."),
    // ── list ──
    len: sig(1, 1, "Length of a list (0 for non-lists)."),
    get: sig(2, 3, "Read a key/index from an object/list (default when missing)."),
    first: sig(1, 1, "First element."),
    last: sig(1, 1, "Last element."),
    filter: sig(2, 2, "Elements where the lambda is truthy.", { lambda: [1] }),
    map: sig(2, 2, "Lambda applied to every element.", { lambda: [1] }),
    indexBy: sig(2, 2, "Index elements by a non-empty string/finite-number lambda key; the last duplicate wins.", { lambda: [1] }),
    groupBy: sig(2, 2, "Group elements by a non-empty string/finite-number lambda key, preserving input order.", { lambda: [1] }),
    find: sig(2, 2, "First element where the lambda is truthy (null when none).", { lambda: [1] }),
    findIndex: sig(2, 2, "Index of the first match (\u22121 when none).", { lambda: [1] }),
    some: sig(2, 2, "Any element matches.", { lambda: [1] }),
    every: sig(2, 2, "Every element matches.", { lambda: [1] }),
    sum: sig(1, 2, "Sum of elements (or of the lambda per element).", { lambda: [1] }),
    avg: sig(1, 2, "Average of elements (or of the lambda per element).", { lambda: [1] }),
    count: sig(1, 2, "Element count (or count where the lambda is truthy).", { lambda: [1] }),
    sortBy: sig(2, 3, 'Sort by the lambda value; dir "asc" (default) or "desc".', { lambda: [1] }),
    reverse: sig(1, 1, "Reversed copy."),
    range: sig(1, 2, "Integers [0, n) or [from, to)."),
    uniq: sig(1, 1, "Distinct scalar elements."),
    indexOf: sig(2, 2, "Index of a value (\u22121 when missing)."),
    pluck: sig(2, 2, "The named key of every element."),
    flatten: sig(1, 1, "One level of list flattening."),
    append: sig(2, MAX_EXPRESSION_ARGS, "List with values appended."),
    // ── object ──
    merge: sig(1, MAX_EXPRESSION_ARGS, "Shallow-merge objects (later wins)."),
    set: sig(3, 3, "Object with one key replaced."),
    pick: sig(2, 2, "Object with only the listed keys."),
    omit: sig(2, 2, "Object without the listed keys."),
    keys: sig(1, 1, "Own keys of an object."),
    values: sig(1, 1, "Own values of an object."),
    entries: sig(1, 1, "List of { key, value }."),
    has: sig(2, 2, "Object has an own key."),
    // ── date ──
    dateParts: sig(1, 2, "ISO date \u2192 { year, month, day, hour, minute, second, weekday, dayOfYear, iso } in a time zone (default UTC)."),
    dateAdd: sig(3, 3, "ISO date + amount of unit (minute/hour/day/week/month/year)."),
    dateDiff: sig(3, 3, "Difference b \u2212 a in unit (second/minute/hour/day/week)."),
    dayOfYear: sig(1, 1, "1-based day of the (UTC) year."),
    isoDate: sig(1, 1, 'Calendar date "YYYY-MM-DD" of an ISO timestamp (UTC).'),
    formatDate: sig(2, 3, 'Format an ISO timestamp: kind "date" | "time" | "datetime" | "weekday" | "month", optional time zone.'),
    // ── domain packs (implementations bind server-side; arities mirror
    // api/utils/actions/packs/<pack>/index.ts *_PACK_ARITIES) ──
    "astro.sky": sig(1, 1, "The sky at an ISO instant: planets (longitude, sign, retrograde), moon phase.", { pack: "astro" }),
    "astro.chart": sig(1, 1, "A natal chart from a birth profile { birthDate, birthTime?, timeKnown, place? }.", { pack: "astro" }),
    "astro.today": sig(1, 3, "The whole StarsAlign day model from a profile, an ISO instant (default now), and a viewer time zone.", { pack: "astro" }),
    "astro.entryId": sig(3, 3, "School entry id(s) for a planet / sign / house combination (nulls allowed).", { pack: "astro" }),
    "astro.meta": sig(0, 0, "Static astrology metadata: signs, planets, houses, aspects, sections.", { pack: "astro" }),
    "astro.cities": sig(1, 2, "Birth-place picker matches for a query (limit default 8).", { pack: "astro" }),
    "astro.search": sig(1, 2, "School search hits { id, section, title, essence, score } for a query (limit default 30).", { pack: "astro" }),
    "astro.section": sig(1, 4, "One school section, filtered and paginated: (section, filter?, page?, perPage?).", { pack: "astro" }),
    "astro.entry": sig(1, 1, "One full school entry by id (short + deep dive), or null.", { pack: "astro" }),
    "pokeworld.species": sig(1, 1, "A species record (stats, types, catch rate, sprites) by dex number or name.", { pack: "pokeworld" }),
    "pokeworld.dex": sig(0, 2, "A page of the 386-species pok\xE9dex: (page?, perPage?).", { pack: "pokeworld" }),
    "pokeworld.blockFor": sig(2, 2, "The world block { blockX, blockY } for a latitude / longitude.", { pack: "pokeworld" }),
    "pokeworld.block": sig(2, 2, "The deterministic 16\xD716 tile block at (blockX, blockY).", { pack: "pokeworld" }),
    "pokeworld.view": sig(1, 3, "The tile viewport around a trainer position: (position, radiusX?, radiusY?).", { pack: "pokeworld" }),
    "pokeworld.step": sig(2, 3, "Resolve one move: (position, direction, collectedItemKeys?) \u2192 new position, outcome, encounter biome, item, sign.", {
      pack: "pokeworld"
    }),
    "pokeworld.encounter": sig(1, 1, "Roll a wild encounter for { biome, lat?, lng? } (legendary geofences apply), or null.", { pack: "pokeworld" }),
    "pokeworld.newPokemon": sig(1, 1, "A full party-member record for { speciesId, level, gender?, shiny?, nickname? }.", { pack: "pokeworld" }),
    "pokeworld.stats": sig(1, 1, "Level-scaled Gen III stats for { speciesId, level }.", { pack: "pokeworld" }),
    "pokeworld.moves": sig(2, 2, "The move set for a species (or type list) at a level.", { pack: "pokeworld" }),
    "pokeworld.battleTurn": sig(1, 1, "Resolve one battle turn from { player, wild, moveIndex } (speed order, status, accuracy, crit, STAB, chip).", {
      pack: "pokeworld"
    }),
    "pokeworld.catchRoll": sig(1, 1, "A Gen III catch attempt from { wild, ball, player? } \u2192 caught, shakes, message (+ the wild\u2019s reply turn).", {
      pack: "pokeworld"
    }),
    "pokeworld.runRoll": sig(1, 1, "A run attempt from { player, wild, attempts } \u2192 escaped, message (+ the wild\u2019s reply turn).", {
      pack: "pokeworld"
    }),
    "pokeworld.useItem": sig(1, 1, "Apply a bag item to a party member: { member, itemId, inBattle? } \u2192 member, message, consumed.", {
      pack: "pokeworld"
    }),
    "pokeworld.items": sig(0, 0, "The item catalogue.", { pack: "pokeworld" }),
    "pokeworld.defaultTrainer": sig(0, 0, "The starting trainer: name, gender, bag, badges, party, box, pok\xE9dex.", { pack: "pokeworld" }),
    "pokeworld.badges": sig(0, 0, "The eight Hoenn badges.", { pack: "pokeworld" }),
    "pokeworld.expGain": sig(
      1,
      1,
      "Award experience for a defeat: { member, defeatedSpeciesId, defeatedLevel } \u2192 member (levelled), gained, leveledUp.",
      { pack: "pokeworld" }
    ),
    "pokeworld.levelFor": sig(2, 2, "The level a growth rate reaches at a total experience.", { pack: "pokeworld" }),
    "thingmon.species": sig(1, 1, "A Thingmon species record (types, stats, rarity, evolution, sprite) by id or slug.", { pack: "thingmon" }),
    "thingmon.dex": sig(0, 2, "A page of the 60-species Thingmon dex: (page?, perPage?).", { pack: "thingmon" }),
    "thingmon.zones": sig(0, 0, "The six expedition zones with level ranges and dex unlocks.", { pack: "thingmon" }),
    "thingmon.items": sig(0, 0, "The capture-crystal and tonic catalogue with shard prices.", { pack: "thingmon" }),
    "thingmon.starters": sig(0, 0, "The three starter species.", { pack: "thingmon" }),
    "thingmon.typeChart": sig(0, 0, "The eight types, their strengths and resistances, and the move library.", { pack: "thingmon" }),
    "thingmon.newCritter": sig(1, 1, "A full creature record for { speciesId, level, nickname?, iv? }.", { pack: "thingmon" }),
    "thingmon.encounter": sig(1, 1, "Roll a wild creature for { zone, dexCaught? } (rarity-weighted; legendaries need a fuller dex).", {
      pack: "thingmon"
    }),
    "thingmon.battleTurn": sig(1, 1, "Resolve one battle turn from { player, wild, moveIndex } (speed order, types, crits, status, drain).", {
      pack: "thingmon"
    }),
    "thingmon.catchRoll": sig(1, 1, "A capture attempt from { player, wild, itemId } \u2192 caught, shakes, log (+ the wild\u2019s reply on a miss).", {
      pack: "thingmon"
    }),
    "thingmon.fleeRoll": sig(1, 1, "A flee attempt from { player, wild, attempts } \u2192 escaped, log (+ the wild\u2019s reply on a miss).", {
      pack: "thingmon"
    }),
    "thingmon.wildTurn": sig(1, 1, "The wild creature acts alone (after an item is used): { player, wild } \u2192 player, wild, log, outcome.", {
      pack: "thingmon"
    }),
    "thingmon.expGain": sig(1, 1, "Award experience for a win: { member, defeated | amount } \u2192 member (levelled), gained, leveledUp, canEvolve.", {
      pack: "thingmon"
    }),
    "thingmon.evolve": sig(1, 1, "Evolve a creature that has reached its evolution level \u2192 member, from, to.", { pack: "thingmon" }),
    "thingmon.useItem": sig(1, 1, "Apply a tonic or elixir: { member, itemId, inBattle? } \u2192 member, message, consumed.", { pack: "thingmon" }),
    "thingmon.heal": sig(1, 1, "A creature at full HP with every condition cleared.", { pack: "thingmon" }),
    "webstandards.browse": sig(0, 1, "Search the versioned HTML/CSS/ECMAScript/Web API inventory and get reusable declarative demo programs.", { pack: "webstandards" }),
    "webstandards.component": sig(1, 1, "Build a reusable Component crystal for a standard feature id.", { pack: "webstandards" }),
    "thingmon.stats": sig(1, 1, "Level-scaled stats for { speciesId, level, iv? }.", { pack: "thingmon" })
  };
  var EXPRESSION_FUNCTION_NAMES = Object.keys(EXPRESSION_CATALOGUE);
  var catalogueSignature = (fn) => Object.prototype.hasOwnProperty.call(EXPRESSION_CATALOGUE, fn) ? EXPRESSION_CATALOGUE[fn] : void 0;
  var isLambdaArg = (fn, index) => {
    const entry = catalogueSignature(fn);
    return !!entry?.lambda?.includes(index);
  };

  // remix/app/api/utils/attachments/attachmentCore.ts
  var ATTACHMENT_THINGTIME = "attachment";
  var ATTACHMENT_ENVELOPE_VERSION = 1;
  var ATTACHMENT_STATES = ["pending", "finalizing", "ready", "deleting", "cancelled"];
  var ATTACHMENT_PURPOSES = ["post", "comment", "message", "profile", "emoji", "recording", "file", "subspace-icon", "subspace-banner", "password"];
  var ATTACHMENT_PROFILE_SLOTS = ["avatar", "banner"];
  var ATTACHMENT_MEDIA_KINDS = ["image", "video", "audio", "file"];
  var MAX_ATTACHMENT_NAME_CHARS = 255;
  var MAX_ATTACHMENT_FILENAME_PREVIEW_CHARS = 255;
  var MAX_ATTACHMENT_TITLE_CHARS = 200;
  var MAX_ATTACHMENT_DESCRIPTION_CHARS = 2e3;
  var MAX_ATTACHMENT_CONTENT_TYPE_CHARS = 127;
  var SAFE_IMAGE_CONTENT_TYPES = /* @__PURE__ */ new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
  var SAFE_VIDEO_CONTENT_TYPES = /* @__PURE__ */ new Set([
    "video/3gpp",
    "video/3gpp2",
    "video/mp4",
    "video/ogg",
    "video/quicktime",
    "video/webm",
    "video/x-m4v",
    "video/x-matroska"
  ]);
  var SAFE_AUDIO_CONTENT_TYPES = /* @__PURE__ */ new Set([
    "audio/3gpp",
    "audio/3gpp2",
    "audio/aac",
    "audio/aiff",
    "audio/amr",
    "audio/flac",
    "audio/midi",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "audio/vnd.wave",
    "audio/wav",
    "audio/webm",
    "audio/x-aiff",
    "audio/x-caf",
    "audio/x-flac",
    "audio/x-m4a",
    "audio/x-wav"
  ]);
  var CONTENT_TYPE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
  var UNSAFE_FILENAME_CHAR_RE = /[\p{Cc}\p{Cf}\p{Cs}]/u;
  var isWellFormedUnicode = (value) => {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 55296 && code <= 56319) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 56320 && next <= 57343)) return false;
        index += 1;
      } else if (code >= 56320 && code <= 57343) {
        return false;
      }
    }
    return true;
  };
  var attachmentMediaKindForContentType = (contentType) => {
    if (SAFE_IMAGE_CONTENT_TYPES.has(contentType)) return "image";
    if (SAFE_VIDEO_CONTENT_TYPES.has(contentType)) return "video";
    if (SAFE_AUDIO_CONTENT_TYPES.has(contentType) || contentType.startsWith("audio/")) return "audio";
    return "file";
  };
  var sanitizeAttachmentLine = (value, maxChars, label) => {
    if (value === void 0 || value === null) return { ok: true };
    if (typeof value !== "string") return { ok: false, error: `Attachment ${label} must be text` };
    const trimmed = value.trim();
    if (!trimmed) return { ok: true };
    if (trimmed.length > maxChars) return { ok: false, error: `Attachment ${label}s can contain at most ${maxChars} characters` };
    if (UNSAFE_FILENAME_CHAR_RE.test(trimmed)) return { ok: false, error: `Attachment ${label}s cannot contain control or format characters` };
    if (!isWellFormedUnicode(trimmed)) return { ok: false, error: `Attachment ${label}s must contain valid Unicode` };
    return { ok: true, value: trimmed };
  };
  var UNSAFE_MULTILINE_CHAR_RE = /[\p{Cf}\p{Cs}]/u;
  var sanitizeAttachmentBlock = (value, maxChars, label) => {
    if (value === void 0 || value === null) return { ok: true };
    if (typeof value !== "string") return { ok: false, error: `Attachment ${label} must be text` };
    const trimmed = value.trim();
    if (!trimmed) return { ok: true };
    if (trimmed.length > maxChars) return { ok: false, error: `Attachment ${label}s can contain at most ${maxChars} characters` };
    for (let index = 0; index < trimmed.length; index += 1) {
      const code = trimmed.charCodeAt(index);
      if (code <= 31 && code !== 10 || code === 127) {
        return { ok: false, error: `Attachment ${label}s cannot contain control characters` };
      }
    }
    if (UNSAFE_MULTILINE_CHAR_RE.test(trimmed)) {
      return { ok: false, error: `Attachment ${label}s cannot contain format characters` };
    }
    if (!isWellFormedUnicode(trimmed)) return { ok: false, error: `Attachment ${label}s must contain valid Unicode` };
    return { ok: true, value: trimmed };
  };
  var sanitizeAttachmentPublicMetadata = (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, error: "Attachment metadata must be an object" };
    }
    const raw = input;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return { ok: false, error: "Attachment name is required" };
    if (name.length > MAX_ATTACHMENT_NAME_CHARS) {
      return { ok: false, error: `Attachment names can contain at most ${MAX_ATTACHMENT_NAME_CHARS} characters` };
    }
    if (UNSAFE_FILENAME_CHAR_RE.test(name)) {
      return { ok: false, error: "Attachment names cannot contain control or format characters" };
    }
    if (!isWellFormedUnicode(name)) return { ok: false, error: "Attachment names must contain valid Unicode" };
    if (!Number.isSafeInteger(raw.size) || Number(raw.size) < 0) {
      return { ok: false, error: "Attachment size must be a non-negative whole number of bytes" };
    }
    const size = Number(raw.size);
    const contentType = typeof raw.contentType === "string" && raw.contentType.trim() ? raw.contentType.trim().toLowerCase() : "application/octet-stream";
    if (contentType.length > MAX_ATTACHMENT_CONTENT_TYPE_CHARS || !CONTENT_TYPE_RE.test(contentType)) {
      return { ok: false, error: "Attachment contentType must be a valid MIME type" };
    }
    const title = sanitizeAttachmentLine(raw.title, MAX_ATTACHMENT_TITLE_CHARS, "title");
    if (title.ok === false) return title;
    const description = sanitizeAttachmentBlock(raw.description, MAX_ATTACHMENT_DESCRIPTION_CHARS, "description");
    if (description.ok === false) return description;
    const filenamePreview = sanitizeAttachmentLine(raw.filenamePreview, MAX_ATTACHMENT_FILENAME_PREVIEW_CHARS, "filename preview");
    if (filenamePreview.ok === false) return filenamePreview;
    return {
      ok: true,
      crystal: {
        name,
        size,
        contentType,
        // Always derive this from the normalized content type. A caller cannot
        // label HTML/SVG/arbitrary bytes as inline-safe image or video content.
        mediaKind: attachmentMediaKindForContentType(contentType),
        ...filenamePreview.value ? { filenamePreview: filenamePreview.value } : {},
        // blank owner text is stored as ABSENT, never as an empty string
        ...title.value ? { title: title.value } : {},
        ...description.value ? { description: description.value } : {}
      }
    };
  };
  var REQUIRED_ATTACHMENT_CRYSTAL_KEYS = ["contentType", "mediaKind", "name", "size"];
  var LINKED_ATTACHMENT_CRYSTAL_KEYS = /* @__PURE__ */ new Set([...REQUIRED_ATTACHMENT_CRYSTAL_KEYS, "url", "filenamePreview", "title", "description"]);

  // remix/app/schemas/registry.ts
  var ERROR_LOG_THINGTIME = "error-log";
  var MIGRATION_DIAGNOSTIC_THINGTIME = "migration-diagnostic";
  var EMBEDDED_THINGTIME = "embed";
  var CI_CONTROL_THINGTIME = [
    "ci-repository",
    "ci-automation",
    "ci-feature",
    "ci-feature-stack",
    "ci-feature-stack-entry",
    "ci-branch",
    "ci-pull-request",
    "ci-workflow-run",
    "ci-deployment",
    "ci-preview",
    "ci-preview-policy",
    "ci-dispatch",
    "ci-stack-chat-message",
    "ci-event"
  ];
  var ACL_ALL = "tt:all";
  var ACL_OWNER = "tt:user";
  var ACL_FRIENDS = "tt:userFriends";
  var ACL_FAMILY = "tt:userFamily";
  var ACL_INHERIT = "tt:inherit";
  var ACL_HIDDEN = "tt:hidden";
  var ACL_CUSTOM = "tt:custom";
  var LEGACY_VISIBILITY_ACLS = {
    public: [ACL_ALL],
    friends: ["-tt:all", ACL_FRIENDS, ACL_OWNER],
    family: ["-tt:all", ACL_FAMILY, ACL_OWNER],
    private: [ACL_OWNER],
    hidden: [ACL_HIDDEN, ACL_OWNER],
    // the minimal custom acl — real custom audiences arrive as explicit acls
    // composed by the picker (marker + baseline + grants)
    custom: [ACL_CUSTOM, ACL_OWNER],
    inherit: [ACL_INHERIT]
  };
  var aclFromVisibility = (visibility) => typeof visibility === "string" && visibility in LEGACY_VISIBILITY_ACLS ? [...LEGACY_VISIBILITY_ACLS[visibility]] : null;
  var POST_TYPES = ["text", "image", "marketplace", "thingtime"];
  var MARKETPLACE_CATEGORIES = ["car", "tool", "furniture", "service", "other"];
  var MAX_TEXT_CHARS = 5e3;
  var MAX_IMAGES = 8;
  var MAX_IMAGE_URL_CHARS = 2048;
  var MAX_COMMENT_CHARS = 1e3;
  var MAX_APP_NAME_CHARS = 80;
  var MAX_APP_ORIGINS = 20;
  var MAX_APP_DATA_KEY_CHARS = 128;
  var MAX_APP_DATA_VALUE_BYTES = 32 * 1024;
  var DEFAULT_APP_STORAGE_ALLOWANCE_BYTES = 5 * 1024 * 1024 * 1024;
  var DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES = 50 * 1024 * 1024;
  var APP_STORAGE_ACCOUNTING_VERSION = 1;
  var USER_STORAGE_ACCOUNTING_VERSION = 2;
  var SANDBOX_STORAGE_BYTES = 5 * 1024 * 1024;
  var MAX_MESSAGE_CHARS = 4e3;
  var MAX_CHAT_NAME_CHARS = 80;
  var MAX_CHAT_TOPIC_CHARS = 250;
  var MAX_NICKNAME_CHARS = 40;
  var MAX_COMMUNITY_NAME_CHARS = 80;
  var MAX_COMMUNITY_DESCRIPTION_CHARS = 500;
  var MAX_SECTION_NAME_CHARS = 60;
  var MAX_SUBSPACE_SLUG_CHARS = 30;
  var MAX_SUBSPACE_NAME_CHARS = 80;
  var MAX_SUBSPACE_DESCRIPTION_CHARS = 1e3;
  var MAX_SUBSPACE_RULES = 15;
  var MAX_SUBSPACE_RULE_TITLE_CHARS = 100;
  var MAX_SUBSPACE_RULE_TEXT_CHARS = 500;
  var MAX_SUBSPACE_FLAIRS = 50;
  var MAX_SUBSPACE_FLAIR_ID_CHARS = 40;
  var MAX_SUBSPACE_FLAIR_LABEL_CHARS = 64;
  var MAX_SUBSPACE_ACCENT_CHARS = 32;
  var MAX_SUBSPACE_ICON_CHARS = 16;
  var MAX_SUBSPACE_USER_FLAIR_TEXT_CHARS = 40;
  var MAX_SUBSPACE_MOD_REASON_CHARS = 300;
  var MAX_SUBSPACE_REMOVAL_REASONS = 20;
  var MAX_SUBSPACE_REMOVAL_REASON_TITLE_CHARS = 80;
  var MAX_SUBSPACE_REMOVAL_REASON_MESSAGE_CHARS = 500;
  var MAX_SUBSPACE_REPORT_REASON_CHARS = 120;
  var MAX_SUBSPACE_REPORT_NOTE_CHARS = 500;
  var SUBSPACE_REPORT_STATUSES = ["open", "resolved"];
  var SUBSPACE_REPORT_RESOLUTIONS = ["removed", "approved", "dismissed"];
  var MAX_POST_TITLE_CHARS = 300;
  var SUBSPACE_ACCESS_MODES = ["public", "restricted", "private"];
  var SUBSPACE_ROLES = ["owner", "moderator", "member"];
  var UPDOWN_DIRECTIONS = ["up", "down"];
  var SUBSPACE_SLUG_HOLD_DAYS = 30;
  var UPDOWN_THINGTIME = "updown";
  var MAX_EMOJI_NAME_CHARS = 32;
  var MAX_EMOJI_DATA_URI_CHARS = 700 * 1024;
  var EXTENDED_MAX_BYTES = 512 * 1024;
  var COLLECTION_SCHEMA_VERSIONS = {
    things: 2,
    users: 2,
    sessions: 2,
    emailVerifications: 2,
    themes: 2,
    waitlist: 2,
    feedAlgorithms: 2,
    lopuMusingRateLimits: 2,
    // born at 2 (no v1 era): single-use auth tokens + the email outbox
    passwordResets: 2,
    authOtps: 2,
    email_messages: 2,
    // still at 1: docs carry no schemaVersion stamp yet (v1 is the pre-stamp
    // era), so their physical collections are <name>_v1 until a real shape
    // migration bumps them
    rosters: 1,
    settings: 1,
    rateLimits: 1,
    // bounded control-plane peer leases; one row per trusted deployment origin
    deploymentPeers: 1,
    // Admin-only integration control plane: encrypted credentials, saved policy,
    // short create-only claims, and redacted expiring audit events.
    adminIntegrationSecrets: 1,
    adminIntegrationEndpoints: 1,
    adminIntegrationClaims: 1,
    adminIntegrationAudit: 1,
    lopuCredentials: 1,
    // post view telemetry: one doc per (postId, viewerKey) — see api/utils/things/views.ts
    postViews: 1,
    // CI control-plane satellite (api/utils/ciControl): every ci-* Thing —
    // current-state projections AND the append-only ci-event history — lives
    // here, NOT in `things`. Machine-written webhook telemetry arrives at
    // hundreds of thousands of rows per day and must never share a collection
    // (or its ~60-index write amplification and wildcard text index) with user
    // content. Rows carry root `expiresAt` retention (ciControl/retentionCore.ts).
    ciControl: 1,
    email_events: 1,
    email_templates: 1,
    email_subscriptions: 1,
    email_suppression_list: 1,
    email_unsubscribes: 1,
    email_identities: 1
  };
  var rootThingSchema = {
    id: "thing",
    version: COLLECTION_SCHEMA_VERSIONS.things,
    kind: "root",
    collection: "things",
    title: "Thing",
    summary: "The root schema every doc in the things collection follows. Everything is a thing.",
    detail: 'Posts, comments, reactions, and shares are all the same root shape. What kind of thing a thing is lives in its `thingtime` array \u2014 schema ids pointing at the Thingtime Schemas below \u2014 and the sub-schema payload lives under `crystal`. Who can see it lives in `acl`: tt: grants plus "-"-prefixed exclusions, most-specific entry wins (["tt:all"] is public, ["-tt:all","tt:userFriends","tt:user"] is friends-only, ["tt:all","-tt:user/somebody"] is public except one user; owners always see their own things). Things that attach to another thing (comments, reactions) carry ["tt:inherit"] and are as visible as their target. The legacy visibility names (public/friends/family/private) are still accepted as input and derived on the wire. Beside the schema\u2019d crystal, every thing carries a schema-free `extended` property: any JSON up to 512KB, stored and returned as-is, never validated or interpreted, and not structured-searchable (/search field conditions can\u2019t target it, though its string content is indexed by the wildcard text index) \u2014 the open sidecar external apps park their data in. Crystals are optionally schema-less too: omit thingtime and it defaults to ["data"], the bounded free-form crystal.',
    fields: [
      { name: "shareId", type: "id", required: true, system: true, description: "Public id \u2014 the only id clients ever see." },
      {
        name: "schemaVersion",
        type: "number",
        required: true,
        system: true,
        description: "Root schema version this doc was written at (docs without one are version 1)."
      },
      {
        name: "thingtime",
        type: "string[]",
        required: true,
        description: 'Thingtime Schema ids applied to this thing, e.g. ["post"] or ["post","share"]. Omitting it on create defaults to ["data"] \u2014 the schema-less crystal.'
      },
      { name: "crystal", type: "object", required: true, description: "The sub-schema payload, validated against every schema in thingtime." },
      { name: "geo", type: "object", required: false, description: "Optional explicitly supplied geographic location, visible to everyone allowed to read this Thing. null clears it. Stored as a GeoJSON Point with derived coordinates for radius queries.", children: [
        { name: "lat", type: "number", required: true, min: -90, max: 90, description: "Latitude in degrees." },
        { name: "lng", type: "number", required: true, min: -180, max: 180, description: "Longitude in degrees." }
      ] },
      {
        name: "extended",
        type: "record",
        required: false,
        description: `Schema-free sidecar: any JSON up to ${EXTENDED_MAX_BYTES} bytes, stored untouched, never validated, structured-searchable, or interpreted. Replace-on-write; null clears it.`
      },
      { name: "ownerId", type: "id", required: true, system: true, description: "The owning user id." },
      {
        name: "sourceDeviceId",
        type: "id",
        required: false,
        system: true,
        description: "Paired device that created this Thing. Server-stamped and never accepted from generic Thing input."
      },
      {
        name: "acl",
        type: "string[]",
        required: true,
        max: 16,
        description: 'Permission entries: tt:all, tt:user (owner), tt:userFriends, tt:userFamily, tt:user/<username>, each optionally "-" prefixed to exclude; tt:inherit on target-attached things. Most specific matching entry decides; owners always view.'
      },
      {
        name: "targetId",
        type: "id",
        required: false,
        description: "shareId of the thing this thing is about (comment \u2192 post, reaction \u2192 post, share \u2192 root post)."
      },
      { name: "tags", type: "string[]", required: true, max: 12, description: "Lowercased tags, max 12 \xD7 40 chars." },
      {
        name: "sizeBytes",
        type: "number",
        required: false,
        system: true,
        description: "Exact logical bytes billed to the owner: UTF-8 JSON crystal/extended/tags bytes plus verified attachment object bytes and retained private Timeline/instruction payload bytes; absent on platform control-plane Things."
      },
      {
        name: "storageClass",
        type: "string",
        required: false,
        system: true,
        description: "Server-owned allocation class: content contributes sizeBytes to its owner account ledger; control identifies protected platform bookkeeping and never trusts user-authored crystal metadata."
      },
      {
        name: "storageAccountingVersion",
        type: "number",
        required: false,
        system: true,
        description: "Version of the logical byte projection used for sizeBytes."
      },
      {
        name: "attachmentEnvelopeVersion",
        type: "number",
        required: false,
        system: true,
        description: `Server-only proof for attachment object accounting (currently ${ATTACHMENT_ENVELOPE_VERSION}); never accepted from generic Thing input.`
      },
      {
        name: "attachmentState",
        type: "enum",
        required: false,
        values: [...ATTACHMENT_STATES],
        system: true,
        description: "Private upload lifecycle state. Pending, finalizing, ready, and deleting objects remain billable until cleanup. Cancelled receipts retain only their small JSON allocation and permanently fence delayed upload starts."
      },
      {
        name: "objectSizeBytes",
        type: "number",
        required: false,
        min: 0,
        system: true,
        description: "Verified S3 object bytes added to a protected attachment Thing\u2019s ordinary JSON allocation."
      },
      {
        name: "objectKey",
        type: "string",
        required: false,
        system: true,
        description: "Private server-generated S3 object key; never copied from generic Thing input or projected publicly."
      },
      {
        name: "objectVersionId",
        type: "string",
        required: false,
        system: true,
        description: "Private immutable S3 version id used for exact reads and permanent deletion before quota is refunded."
      },
      {
        name: "attachmentCancellationRequested",
        type: "boolean",
        required: false,
        system: true,
        description: "Server-only durable cancellation intent on deleting uploads and their zero-object cancelled receipts. Never accepted from generic input."
      },
      {
        name: "attachmentRequestFingerprint",
        type: "string",
        required: false,
        system: true,
        description: "Private server-derived fingerprint that makes upload-start retries idempotent without exposing request metadata."
      },
      {
        name: "attachmentFileSyncOrigin",
        type: "object",
        required: false,
        system: true,
        description: "Private immutable client-reported sync source/destination identity stored before bytes; owner-session detail only, never a native grant or current location."
      },
      {
        name: "attachmentPurpose",
        type: "enum",
        required: false,
        values: [...ATTACHMENT_PURPOSES],
        system: true,
        description: "Server-owned immutable binding domain: post, comment, message, profile, or custom-emoji media, or a standalone owner-private recording that never binds to a target."
      },
      {
        name: "passwordFileEnvelope",
        type: "object",
        required: false,
        system: true,
        description: "Private account-vault envelope containing encrypted password file metadata and its content key; only the full-session password service may open it."
      },
      {
        name: "passwordFileParent",
        type: "string",
        required: false,
        system: true,
        description: "Immutable owner-local password entry id used to fence attachment retries and parent deletion before final binding."
      },
      {
        name: "attachmentProfileSlot",
        type: "enum",
        required: false,
        values: [...ATTACHMENT_PROFILE_SLOTS],
        system: true,
        description: "Server-owned avatar/banner slot, present exactly when attachmentPurpose is profile."
      },
      {
        name: "moderation",
        type: "object",
        required: false,
        system: true,
        description: "Protected server-owned moderation state. Generic Thing create/update input never writes it; only moderation analysis and admin review may stamp it."
      },
      {
        name: "subspaceMod",
        type: "object",
        required: false,
        system: true,
        description: "Protected subspace moderation state on posts: { status: approved|removed, removedById, removedAt, reason, reasonId?, ruleIndex?, pinned, locked, nsfw, spoiler }. Written only by subspace moderators through POST /api/v1/subspaces/moderate (a remove on an already-removed post changes nothing); removed posts are redacted for everyone but the author and mods and hidden from feeds. The projection shows the author the reason, never removedById."
      },
      {
        name: "subspacePrivate",
        type: "boolean",
        required: false,
        system: true,
        description: "Server-stamped when a post is published into a private subspace: visible to that subspace\u2019s members (and the author) only, on every read surface."
      },
      {
        name: "attachmentFinalizationLeaseId",
        type: "string",
        required: false,
        system: true,
        description: "Private server-generated fencing token for the one request allowed to finalize a multipart upload."
      },
      {
        name: "attachmentPartsIssuedAt",
        type: "date",
        required: false,
        system: true,
        description: "Private proof that a presigned UploadPart URL left the server; only these MPUs require lifecycle-backed settlement before refund."
      },
      {
        name: "attachmentObjectlessDelete",
        type: "boolean",
        required: false,
        system: true,
        description: "Private deletion proof for a reserved upload that never received a multipart upload id or object version."
      },
      {
        name: "attachmentMpuEmptyVerifiedAt",
        type: "date",
        required: false,
        system: true,
        description: "Private timestamp of the first empty multipart verification; a later cron pass must independently confirm it before refund."
      },
      {
        name: "uploadId",
        type: "string",
        required: false,
        system: true,
        description: "Private multipart-upload id while an attachment is pending or finalizing."
      },
      {
        name: "attachmentExpiresAt",
        type: "date",
        required: false,
        system: true,
        description: "Private cleanup deadline for an unfinished upload; cleanup must refund transactionally rather than using Mongo TTL."
      },
      {
        name: "expiresAt",
        type: "date",
        required: false,
        system: true,
        description: "Optional server-owned retention deadline for protected operational Things."
      },
      {
        name: "avatarAttachmentId",
        type: "id",
        required: false,
        system: true,
        description: "Protected current managed-avatar attachment reference on a canonical user Thing."
      },
      {
        name: "bannerAttachmentId",
        type: "id",
        required: false,
        system: true,
        description: "Protected current managed-banner attachment reference on a canonical user or subspace Thing."
      },
      {
        name: "iconAttachmentId",
        type: "id",
        required: false,
        system: true,
        description: "Protected current managed-icon attachment reference on a subspace Thing."
      },
      {
        name: "subspaceMediaDeleting",
        type: "boolean",
        required: false,
        system: true,
        description: "Server-owned subspace deletion fence preventing new media bindings during cleanup."
      },
      {
        name: "emojiAttachmentId",
        type: "id",
        required: false,
        system: true,
        description: "Protected exact S3 attachment reference on a custom-emoji Thing."
      },
      { name: "createdAt", type: "date", required: true, system: true, description: "Creation time." },
      { name: "updatedAt", type: "date", required: true, system: true, description: "Last mutation time." }
    ],
    example: {
      shareId: "4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f",
      schemaVersion: 2,
      thingtime: ["post"],
      crystal: { type: "text", text: "Hello Thingtime \u{1F308}", images: [], listing: null },
      ownerId: "664f1c2a9d3e5b0012345678",
      acl: ["tt:all", "-tt:user/replicant-hunter", "tt:user"],
      targetId: null,
      tags: ["hello"],
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z"
    }
  };
  var postSchema = {
    id: "post",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Post",
    summary: "A feed post \u2014 text, image, marketplace listing, or a thingtime thing.",
    render: {
      tag: "article",
      props: { style: { display: "flex", flexDirection: "column", gap: "12px" } },
      children: [
        { tag: "h3", children: "{title}" },
        { tag: "img", props: { src: "{images.0}", alt: "{title}", style: { maxWidth: "100%", maxHeight: "360px", objectFit: "contain" } } },
        { tag: "p", props: { style: { whiteSpace: "pre-wrap" } }, children: "{text}" }
      ]
    },
    detail: "The thing shows up in feeds and profile listings. Marketplace posts carry a listing; the listing category is folded into the root tags so feed filters can find it. Thingtime posts carry a free-form structured thing under the reserved `thing` key \u2014 the same bounded JSON grammar as data crystals, but namespaced so the open shape can never ride past the post whitelist (searchable as crystal.thing.<field> on /search).",
    fields: [
      { name: "type", type: "enum", required: true, values: [...POST_TYPES], description: "What kind of post this is." },
      {
        name: "text",
        type: "string",
        required: false,
        max: MAX_TEXT_CHARS,
        description: `Canonical plain-text post body (required for text posts), max ${MAX_TEXT_CHARS} chars.`
      },
      {
        name: "richText",
        type: "record",
        required: false,
        description: "Bounded native Editor.js document preserving inline marks, block styles, whitespace, and line breaks."
      },
      {
        name: "images",
        type: "string[]",
        required: false,
        max: MAX_IMAGES,
        description: `http(s) image URLs, max ${MAX_IMAGES} \xD7 ${MAX_IMAGE_URL_CHARS} chars (image posts need at least one).`
      },
      {
        name: "listing",
        type: "object",
        required: false,
        description: "Marketplace listing \u2014 required for marketplace posts, optional on thingtime posts.",
        // mirrors the exact shape sanitizePostCrystal accepts, so the seeded
        // builtin mirror carries the real grammar instead of an opaque object
        children: [
          { name: "title", type: "string", required: true, max: 120, description: "Listing title, max 120 chars." },
          { name: "price", type: "number", required: true, min: 0, max: 1e9, description: "Non-negative price, rounded to cents." },
          { name: "currency", type: "string", required: false, max: 3, description: "3-letter currency code, defaults to AUD." },
          {
            name: "category",
            type: "enum",
            required: false,
            values: [...MARKETPLACE_CATEGORIES],
            description: "Marketplace category, defaults to other."
          },
          { name: "condition", type: "enum", required: false, values: ["new", "used"], description: "Item condition." },
          { name: "location", type: "string", required: false, max: 120, description: "Free-text location, max 120 chars." },
          { name: "sold", type: "boolean", required: false, description: "Whether the listing has sold." }
        ]
      },
      {
        name: "thing",
        type: "record",
        required: false,
        description: "Free-form structured thing payload \u2014 required for thingtime posts, bounded like data crystals (searchable as crystal.thing.<field>). Thingtime posts can also carry images and a listing."
      },
      {
        name: "title",
        type: "string",
        required: false,
        max: MAX_POST_TITLE_CHARS,
        description: `Optional headline (Reddit-style post title), max ${MAX_POST_TITLE_CHARS} chars. Subspace posts usually carry one; ordinary feed posts may too.`
      },
      {
        name: "subspaceId",
        type: "id",
        required: false,
        description: "shareId of the subspace this post is published into. Validated on every write: the author must be allowed to post there (not banned; approved in restricted subspaces; a member in private ones)."
      },
      {
        name: "flairId",
        type: "string",
        required: false,
        max: MAX_SUBSPACE_FLAIR_ID_CHARS,
        description: "Id of one of the subspace\u2019s post flairs (validated against the subspace; mod-only flairs need a moderator)."
      }
    ],
    example: {
      type: "text",
      text: "Everything is a thing \u2728",
      richText: { kind: "rich-text", blocks: [{ type: "paragraph", data: { text: "<mark>Everything</mark> is a thing \u2728" } }] },
      images: [],
      listing: null,
      thing: null
    }
  };
  var fileSchema = {
    id: "file",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "File",
    summary: "A stable file identity with retained attachment versions and Timeline history.",
    detail: "The dedicated file writer changes the current content atomically using an expected revision and immutable operation identity. Bytes remain separately accounted attachment Things linked by parentId/targetId. Trash retains content until an explicit retention workflow removes it.",
    createdVia: "POST /api/v1/files",
    example: { name: "notes.txt", trashed: false, content: { attachmentId: "att-example", version: "a".repeat(64), size: 1, fingerprint: { algorithm: "sha256-parts-v1", partSizeBytes: 8388608, partCount: 1, sha256: "b".repeat(64) } } },
    fields: [
      { name: "name", type: "string", required: true, max: 255, description: "Editable filename." },
      { name: "trashed", type: "boolean", required: true, description: "Recoverable trash state; retained bytes remain accounted." },
      { name: "content", type: "object", required: true, description: "Verified attachment identity, opaque content version, byte size and multipart fingerprint." }
    ]
  };
  var attachmentSchema = {
    id: ATTACHMENT_THINGTIME,
    version: 2,
    kind: "crystal",
    collection: null,
    title: "Attachment",
    summary: "A private-S3 file attached relationally to a post.",
    detail: "Attachment Things are created only through the dedicated upload endpoints. Their crystal contains stable, safe public metadata; object keys, multipart ids, lifecycle state, and verified object bytes are server-owned root fields. A ready post attachment points at its post through targetId and inherits that post\u2019s audience; managed profile media points at the exact public user and avatar/banner slot that references it. Pending/finalizing/deleting rows remain billable source records until cleanup confirms the object is inaccessible, preventing quota oversubscription and refund races.",
    createdVia: "POST /api/v1/attachments/uploads",
    fields: [
      {
        name: "name",
        type: "string",
        required: true,
        max: MAX_ATTACHMENT_NAME_CHARS,
        description: "Immutable original filename; never used as an S3 key."
      },
      {
        name: "filenamePreview",
        type: "string",
        required: false,
        max: MAX_ATTACHMENT_NAME_CHARS,
        description: "Owner-selected filename shown in the UI; the original download filename is preserved."
      },
      { name: "title", type: "string", required: false, max: 200, description: "Owner-authored media title." },
      { name: "description", type: "string", required: false, max: 2e3, description: "Owner-authored media description." },
      {
        name: "size",
        type: "number",
        required: true,
        min: 0,
        description: "Verified object size in bytes; must equal the server-owned root objectSizeBytes."
      },
      {
        name: "contentType",
        type: "string",
        required: true,
        max: MAX_ATTACHMENT_CONTENT_TYPE_CHARS,
        description: "Normalized MIME type, defaulting to application/octet-stream."
      },
      {
        name: "mediaKind",
        type: "enum",
        required: true,
        values: [...ATTACHMENT_MEDIA_KINDS],
        description: "Server-derived safe rendering class. SVG, HTML, and unknown types are files, never inline media."
      },
      {
        name: "detectedContentType",
        type: "string",
        required: false,
        max: MAX_ATTACHMENT_CONTENT_TYPE_CHARS,
        description: "Magic-byte-sniffed MIME type, preserved only when the served contentType stays application/octet-stream so downloads can still name the real container (for example video/x-msvideo for an AVI). Server-written at upload finalization; never client input."
      }
    ],
    example: { name: "sunset.webp", size: 482013, contentType: "image/webp", mediaKind: "image" }
  };
  var commentSchema = {
    id: "comment",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Comment",
    summary: "A comment on another thing.",
    detail: 'A standalone thing pointing at its target via targetId, carrying acl ["tt:inherit"] so it is visible exactly when the target is. Comments share the post schema: a rich comment is a ["post","comment"] thing carrying the full post vocabulary (photos, listing, thingtime thing), the post crystal rules apply, and comments are reactable and commentable like any post \u2014 each has its own /post/:id page. Comments used to live embedded inside post docs \u2014 the things v1\u2192v2 migration explodes them into these.',
    requiresTarget: true,
    fields: [{ name: "text", type: "string", required: true, max: MAX_COMMENT_CHARS, description: `Comment body, max ${MAX_COMMENT_CHARS} chars.` }],
    example: { text: "So say we all \u{1F680}" }
  };
  var reactionSchema = {
    id: "reaction",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Reaction",
    summary: "An emoji reaction to another thing \u2014 one thing per (user, target, token).",
    detail: `The emoji is an open-vocabulary token: a single emoji or a multi-emoji group typed as one unit (up to ${MAX_REACTION_EMOJIS} emoji), validated emoji-only by the shared token helper. Users can hold several reaction things on one target; toggling a token they already have removes it. Reactions used to live embedded on post docs as an emoji \u2192 userIds map \u2014 the things v1\u2192v2 migration explodes them into these.`,
    requiresTarget: true,
    fields: [
      {
        name: "emoji",
        type: "string",
        required: true,
        max: MAX_REACTION_EMOJIS,
        // emoji count, NOT UTF-16 chars (every emoji is 2+ code units) — keeps
        // the projection from publishing a maxLength that rejects legal tokens
        maxUnit: "emoji",
        description: `The reaction token \u2014 one emoji or a multi-emoji group (max ${MAX_REACTION_EMOJIS} emoji, emoji-only).`
      }
    ],
    example: { emoji: "\u{1F923}\u{1F923}\u{1F64C}\u{1F480}\u{1F4A6}" }
  };
  var shareSchema = {
    id: "share",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Share",
    summary: "A re-share of another thing into the sharer\u2019s feed.",
    detail: 'Shares are also posts \u2014 a share thing carries thingtime ["post","share"], so it renders in feeds with its own caption (the post crystal text) while targetId points at the ROOT shared thing (re-shares never nest). Share counts are computed live from these things.',
    requiresTarget: true,
    appliedThingtime: ["post", "share"],
    fields: [],
    example: {}
  };
  var MAX_STORABLE_NESTING = 179;
  var MAX_DATA_CRYSTAL_NODES = 1e4;
  var MAX_DATA_ARRAY_ITEMS = 1e3;
  var MAX_DATA_KEY_CHARS = 60;
  var dataSchema = {
    id: "data",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Data",
    summary: "Free-form structured data \u2014 any JSON shape, searchable by real datatypes on /search.",
    detail: `The default schema when a thing declares none: creating a thing without thingtime (just a crystal) resolves to ["data"], so crystals are optionally schema-less. The open half of Thingtime: a data thing\u2019s crystal holds whatever structure you give it (numbers stay numbers, booleans stay booleans), bounded but never schema-gated. Search it with real datatype conditions on /search (legs \u2265 3, material in wood/concrete, height between 60\u2013130). Data crystals stand alone \u2014 thingtime ["data"] never combines with typed schemas, so the open shape can\u2019t ride past a typed whitelist. Convention: carry a \`schema\` field naming a published schema thing (e.g. "Table") so schema-driven searches can find you, and tag the thing for feed filters. Keys are letters/numbers/_/- (max ${MAX_DATA_KEY_CHARS} chars), nesting is unbounded up to MongoDB's own ${MAX_STORABLE_NESTING}-level storage limit (circular references rejected), ${MAX_DATA_CRYSTAL_NODES} values per crystal, arrays at ${MAX_DATA_ARRAY_ITEMS} items, strings at ${MAX_TEXT_CHARS} chars.`,
    fields: [
      {
        name: "*",
        type: "record",
        required: false,
        description: "Any JSON structure within the bounds above \u2014 this schema deliberately has no fixed fields."
      },
      {
        name: "schema",
        type: "string",
        required: false,
        description: "Optional convention: the name of the published schema thing this data follows."
      }
    ],
    example: {
      schema: "Table",
      name: "Walnut standing desk",
      legs: 4,
      material: "wood",
      width: 160,
      height: 130,
      depth: 80,
      features: ["sit/stand", "cable tray"],
      price: 899.5
    }
  };
  var MAX_SCHEMA_NAME_CHARS = 60;
  var MAX_SCHEMA_DESCRIPTION_CHARS = 500;
  var MAX_SCHEMA_FIELDS = 80;
  var MAX_SCHEMA_ENUM_VALUES = 30;
  var MAX_SCHEMA_ENUM_VALUE_CHARS = 60;
  var MAX_SCHEMA_UNIT_CHARS = 20;
  var MAX_SCHEMA_FIELD_DEPTH = 6;
  var MAX_SCHEMA_RENDER_BYTES = 48 * 1024;
  var MAX_SCHEMA_RENDER_DEPTH = 48;
  var MAX_SCHEMA_RENDER_NODES = 2e3;
  var SCHEMA_FIELD_TYPES = ["string", "number", "boolean", "date", "enum", "string[]", "object", "array", "json"];
  var schemaThingSchema = {
    id: "schema",
    version: 3,
    kind: "crystal",
    collection: null,
    title: "Schema",
    summary: "A user-authored data shape \u2014 browse them on /schemas, search with them on /search.",
    detail: `Anyone can publish a schema thing describing a shape (e.g. "Table": legs, material wood/plastic/concrete, width/height/depth). Fields nest arbitrarily (object children, typed array items) with per-field constraints: required, number min/max, string maxLength, enum value lists, array min/maxItems. Things that follow a schema simply carry its fields in their crystal \u2014 a schema never gates OTHER things' writes (Thingtime searches real datatypes, not schema registrations), but schema things themselves are validated on write like any crystal, builtin seeds included. /schemas browses every published schema; /search prefills its query builder from the field definitions.`,
    fields: [
      { name: "name", type: "string", required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Table".' },
      { name: "description", type: "string", required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: "What this shape describes." },
      {
        // 'record', not 'object': the field-definition tree is recursive (children
        // of children), which the closed schema-thing grammar can't express — an
        // open-but-bounded structure is the honest classification
        name: "fields",
        type: "record",
        required: true,
        max: MAX_SCHEMA_FIELDS,
        description: `Field definition tree, max ${MAX_SCHEMA_FIELDS} nodes, ${MAX_SCHEMA_FIELD_DEPTH} levels: { name, type (${SCHEMA_FIELD_TYPES.join("/")}), description?, required?, values? (enum), min?/max?/unit? (number), maxLength? (string), minItems?/maxItems? (arrays), children? (object), items? (array) }.`
      },
      { name: "forkOf", type: "string", required: false, description: "shareId of the schema this one was forked from (provenance only)." },
      {
        name: "render",
        type: "record",
        required: false,
        description: `Optional serialised component preview \u2014 a chakra tree ({ chakra: "Box", props, children }) or element tree ({ tag: "div", props, children }), max ${MAX_SCHEMA_RENDER_BYTES} bytes / ${MAX_SCHEMA_RENDER_NODES} nodes, always drawn through the sanitising allowlist renderers.`
      }
    ],
    example: {
      name: "Table",
      description: "Tables of all kinds \u2014 dining, coffee, standing desks.",
      fields: [
        { name: "legs", type: "number", min: 0, max: 12, required: true },
        { name: "material", type: "enum", values: ["wood", "plastic", "concrete", "metal", "glass"] },
        { name: "width", type: "number", min: 0, unit: "cm" },
        { name: "height", type: "number", min: 0, unit: "cm" },
        { name: "depth", type: "number", min: 0, unit: "cm" },
        { name: "features", type: "string[]", maxItems: 12, description: "e.g. sit/stand, extendable, foldable" },
        {
          name: "maker",
          type: "object",
          children: [
            { name: "name", type: "string", required: true, maxLength: 80 },
            { name: "country", type: "string" }
          ]
        },
        {
          name: "finishes",
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            children: [
              { name: "color", type: "string", required: true },
              { name: "sheen", type: "enum", values: ["matte", "satin", "gloss"] }
            ]
          }
        }
      ]
    }
  };
  var COMPONENT_LIBRARIES = [
    "antd",
    "bootstrap",
    "mui",
    "shadcn",
    "untitled",
    "daisyui",
    "reactflow",
    "thingtime",
    "custom"
  ];
  var MAX_COMPONENT_ARGS = 16;
  var MAX_COMPONENT_ARG_NAME_CHARS = 40;
  var MAX_COMPONENT_ARG_LABEL_CHARS = 40;
  var MAX_COMPONENT_ARG_DESCRIPTION_CHARS = 200;
  var MAX_COMPONENT_ARG_DEFAULT_CHARS = 400;
  var MAX_COMPONENT_SAVED_ARGS = 24;
  var MAX_COMPONENT_SAVED_ARG_CHARS = 2e3;
  var MAX_COMPONENT_CATEGORY_CHARS = 40;
  var MAX_COMPONENT_KEY_CHARS = 80;
  var MAX_COMPONENT_PREVIEW_BG_CHARS = 200;
  var COMPONENT_ARG_TYPES = ["string", "text", "number", "boolean", "enum", "color"];
  var COMPONENT_ARG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
  var COMPONENT_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var MAX_WEBPAGE_BLOCKS = Number.POSITIVE_INFINITY;
  var MAX_WEBPAGE_BLOCK_DEPTH = Number.POSITIVE_INFINITY;
  var MAX_WEBPAGE_BLOCK_ID_CHARS = 40;
  var MAX_WEBPAGE_BLOCK_REF_CHARS = 128;
  var MAX_WEBPAGE_TEXT_CHARS = 2e3;
  var MAX_WEBPAGE_BLOCKS_BYTES = Number.POSITIVE_INFINITY;
  var MAX_WEBPAGE_ROUTE_CHARS = 120;
  var WEBPAGE_BLOCK_TYPES = ["component", "container", "text", "native", "media", "html", "element", "collection", "condition"];
  var WEBPAGE_CONTAINER_DIRECTIONS = ["column", "row", "grid"];
  var WEBPAGE_TEXT_STYLES = ["body", "heading", "eyebrow"];
  var WEBPAGE_BLOCK_ALIGNS = ["start", "center", "end", "stretch"];
  var WEBPAGE_ROUTE_PATTERN = /^\/[a-z0-9\-/_]*$/;
  var MAX_WEBPAGE_CSS_PROPS = 40;
  var MAX_WEBPAGE_CSS_KEY_CHARS = 48;
  var MAX_WEBPAGE_CSS_VALUE_CHARS = 240;
  var MAX_WEBPAGE_HTML_CHARS = 2e4;
  var MAX_WEBPAGE_MEDIA_SRC_CHARS = 2048;
  var MIN_WEBPAGE_SOURCE_INTERVAL_MS = 5e3;
  var MAX_WEBPAGE_SOURCE_INTERVAL_MS = 36e5;
  var WEBPAGE_TEXT_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "div", "blockquote", "pre", "code"];
  var WEBPAGE_MEDIA_KINDS = ["image", "video", "audio"];
  var WEBPAGE_CSS_KEY_PATTERN = /^(--)?[a-z][a-z0-9-]*$/;
  var componentSchema = {
    id: "component",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Component",
    summary: "A UI component \u2014 browse and tweak them live on /components, save versions to your Things.",
    detail: 'A component thing is a renderable UI building block: a serialised element/chakra render template (drawn only through the sanitising allowlist renderers) plus a bounded list of arg descriptors the /components tester turns into live inputs. Template strings may interpolate {argName} tokens, and ttArg/ttMap/ttIf/ttMerge/ttRepeat wrapper objects resolve against the current args before rendering. The platform library (1000+ components styled after Ant Design, Bootstrap, MUI, shadcn/ui, Untitled UI, daisyUI, React Flow, and the Thingtime house style) is seeded system-owned with shareId component-<slug>; "Save version" stores a user-owned component thing whose savedArgs snapshot the tester state, linked back via componentKey/forkOf.',
    fields: [
      { name: "name", type: "string", required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Solid Button".' },
      { name: "description", type: "string", required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: "What this component is and when to use it." },
      {
        name: "library",
        type: "enum",
        required: false,
        values: [...COMPONENT_LIBRARIES],
        description: "The design language this component follows; user-authored components default to custom."
      },
      { name: "category", type: "string", required: false, max: MAX_COMPONENT_CATEGORY_CHARS, description: "Catalog category, e.g. buttons, forms, feedback, navigation, flow." },
      { name: "source", type: "record", required: false, description: "Viewer-owned Action binding: { action, inputs?, refresh?: load/manual/interval/live, intervalMs? }. Source values resolve into result/state/error; the page can override this binding." },
      { name: "componentKey", type: "string", required: false, max: MAX_COMPONENT_KEY_CHARS, description: "Stable slug identity linking saved versions to their source component." },
      { name: "familyKey", type: "string", required: false, max: MAX_COMPONENT_KEY_CHARS, description: "Groups the library renditions (designs) of one functional component \u2014 /components shows one card per family." },
      { name: "version", type: "number", required: false, min: 1, description: "Version counter for saved instances of a componentKey." },
      { name: "forkOf", type: "string", required: false, description: "shareId of the component this one was saved/forked from (provenance only)." },
      { name: "previewBg", type: "string", required: false, max: MAX_COMPONENT_PREVIEW_BG_CHARS, description: "Optional CSS background for the preview surface (e.g. a dotted canvas)." },
      {
        // recursive/open-but-bounded structures — same honest 'record'
        // classification the schema thing uses for its field tree
        name: "args",
        type: "record",
        required: false,
        max: MAX_COMPONENT_ARGS,
        description: `Arg descriptor list, max ${MAX_COMPONENT_ARGS}: { name, type (${COMPONENT_ARG_TYPES.join("/")}), label?, description?, default, values? (enum), min?/max? (number), maxLength? (string) }. The /components tester renders one input per descriptor.`
      },
      {
        name: "savedArgs",
        type: "record",
        required: false,
        max: MAX_COMPONENT_SAVED_ARGS,
        description: "Scalar arg-value snapshot a saved version renders with (keys mirror arg names)."
      },
      {
        name: "render",
        type: "record",
        required: true,
        description: `Serialised render template \u2014 element ({ tag: "div", props, children }) or chakra shaped, max ${MAX_SCHEMA_RENDER_BYTES} bytes / ${MAX_SCHEMA_RENDER_NODES} nodes, drawn only through the sanitising allowlist renderers after arg-template resolution.`
      }
    ],
    example: {
      name: "Solid Button",
      description: "Filled primary action button in the Thingtime house style.",
      library: "thingtime",
      category: "buttons",
      componentKey: "thingtime-button-solid",
      version: 1,
      args: [
        { name: "label", type: "string", label: "Label", default: "Get started", maxLength: 40 },
        { name: "tone", type: "enum", label: "Tone", values: ["primary", "success", "danger"], default: "primary" },
        { name: "disabled", type: "boolean", label: "Disabled", default: false }
      ],
      render: {
        tag: "button",
        props: { type: "button", style: { padding: "0 16px", height: "36px", borderRadius: "9px", background: "#16161a", color: "#ffffff" } },
        children: ["{label}"]
      }
    }
  };
  var webpageSchema = {
    id: "webpage",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Webpage",
    summary: "A block-based page built from component things \u2014 create and edit with the /builder.",
    detail: "A webpage thing is an ordered, bounded tree of blocks: component blocks reference component things (by componentKey or shareId) with per-block arg overrides, container blocks arrange children in columns/rows/grids, text blocks hold short copy, and native blocks mark where a built-in Thingtime screen renders on a site page. Blocks never carry raw markup \u2014 referenced components resolve through the existing arg-template DSL and are drawn only through the sanitising allowlist renderers, each block with its own render budget. System webpage-route-<key> docs make every built-in route a block site; a viewer-owned webpage with the same siteRoute personalises it. Standalone pages serve at /p/<shareId>.",
    fields: [
      { name: "name", type: "string", required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "My portfolio".' },
      { name: "description", type: "string", required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: "What this page is for." },
      { name: "pageKey", type: "string", required: false, max: MAX_COMPONENT_KEY_CHARS, description: "Stable slug identity linking saved versions of one page." },
      { name: "siteRoute", type: "string", required: false, max: MAX_WEBPAGE_ROUTE_CHARS, description: "App route this page describes (site pages only), e.g. /status." },
      { name: "version", type: "number", required: false, min: 1, description: "Version counter for saved instances of a pageKey." },
      { name: "forkOf", type: "string", required: false, description: "shareId of the webpage this one was forked from (provenance only)." },
      { name: "previewBg", type: "string", required: false, max: MAX_COMPONENT_PREVIEW_BG_CHARS, description: "Optional CSS background for the page canvas." },
      {
        name: "blocks",
        type: "record",
        required: true,
        description: "Ordered editable block tree: { id, type: component (component ref + args), container (direction/gap/columns + children), text (text + style, optional href link), or native (built-in screen key) \u2014 plus align/maxWidth per block }."
      }
    ],
    example: {
      name: "Launch page",
      pageKey: "launch-page",
      blocks: [
        { id: "hero-title", type: "text", text: "A GUI for the internet.", style: "heading", align: "center" },
        {
          id: "cta-row",
          type: "container",
          direction: "row",
          gap: 4,
          align: "center",
          children: [
            { id: "cta", type: "component", component: "thingtime-button-solid", args: { label: "Join the waitlist \u{1F680}" } }
          ]
        }
      ]
    }
  };
  var ACTION_STEP_OPS = [
    "http.request",
    "lookup",
    "things.create",
    "things.get",
    "things.search",
    "things.update",
    "things.delete",
    "actions.invoke",
    "compute",
    "each",
    "fail",
    "return"
  ];
  var ACTION_CAPABILITIES = ["http.request", "lookup", "things.read", "things.create", "things.update", "things.delete", "actions.invoke"];
  var ACTION_INPUT_TYPES = ["string", "text", "number", "boolean", "enum", "json"];
  var MAX_ACTION_STEPS = 40;
  var MAX_ACTION_INPUTS = 16;
  var MAX_ACTION_CAPABILITY_ENTRIES = 8;
  var MAX_ACTION_CAPABILITY_SCOPES = 12;
  var MAX_ACTION_KEY_CHARS = 80;
  var MAX_ACTION_SCHEMA_REF_CHARS = 128;
  var MAX_ACTION_STEP_VALUE_KEYS = 48;
  var MAX_ACTION_STEP_STRING_CHARS = 2e3;
  var MAX_ACTION_STEP_VALUE_DEPTH = 16;
  var MAX_ACTION_CONCAT_PARTS = 24;
  var MAX_ACTION_SEARCH_LIMIT = 100;
  var MAX_ACTION_SEARCH_OFFSET = 1e3;
  var MAX_ACTION_SEARCH_WHERE_KEYS = 8;
  var MAX_ACTION_SEARCH_MATCH_KEYS = 4;
  var MAX_ACTION_EACH_ITEMS = 20;
  var ACTION_SEARCH_SCOPES = ["own", "public", "system"];
  var ACTION_SEARCH_SORT_DIRECTIONS = ["asc", "desc"];
  var ACTION_SEARCH_FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,59}$/;
  var MAX_ACTION_TRACE_ENTRIES = 60;
  var MAX_ACTION_RUN_ERROR_CHARS = 2e3;
  var MAX_ACTION_RUNS_RETAINED = 50;
  var ACTION_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var ACTION_LIMIT_CEILINGS = {
    timeoutMs: 1e4,
    maxOperations: 100,
    maxDepth: 8,
    maxChildActions: 20,
    maxResultBytes: 256 * 1024,
    maxInputBytes: 64 * 1024
  };
  var ACTION_LIMIT_DEFAULTS = {
    timeoutMs: 5e3,
    maxOperations: 40,
    maxDepth: 4,
    maxChildActions: 10,
    maxResultBytes: 64 * 1024,
    maxInputBytes: 16 * 1024
  };
  var actionSchema = {
    id: "action",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Action",
    summary: "A declarative, capability-bounded program \u2014 inspect and run it on /actions.",
    detail: `An action thing is a small declarative program over a closed operation vocabulary (${ACTION_STEP_OPS.join(", ")}) \u2014 no persisted code, no loops unless the vocabulary ever defines one. It declares typed inputs, explicit capabilities (a NARROWING filter: every operation still runs through the normal things API as the invoking user, so ACL, quotas and schema validation always apply and an action can never do something its invoker could not), and a limits envelope (timeout, operation budget, depth, result bytes). Step values reference data with whole-value refs ("$input.name", "$step.1.id", "$now") or { ttConcat: [...] } string composition \u2014 reference substitution, never evaluation. Child actions started via actions.invoke consume the PARENT invocation's budget, so recursive chains terminate by construction. Every run is recorded as a protected action-run child thing for inspection. Lookup steps use a registered provider and the action owner\u2019s Vault credential; provider results are omitted from run history. Authored actions cannot supply arbitrary network destinations or read raw secrets.`,
    fields: [
      { name: "name", type: "string", required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Create customer".' },
      { name: "description", type: "string", required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: "What this action does and when to run it." },
      { name: "runtime", type: "string", required: false, description: "server (default) or browser. Browser programs use request steps with the current session." },
      { name: "actionKey", type: "string", required: false, max: MAX_ACTION_KEY_CHARS, description: "Stable slug identity (lowercase-dashed) other actions can invoke by key." },
      { name: "category", type: "string", required: false, max: MAX_COMPONENT_CATEGORY_CHARS, description: "Catalog category, e.g. customers, invoices, utilities." },
      { name: "version", type: "number", required: false, min: 1, description: "Version counter for saved revisions of an actionKey." },
      { name: "forkOf", type: "string", required: false, description: "shareId of the action this one was forked from (provenance only)." },
      {
        name: "inputs",
        type: "record",
        required: false,
        max: MAX_ACTION_INPUTS,
        description: `Typed input descriptor list, max ${MAX_ACTION_INPUTS}: { name, type (${ACTION_INPUT_TYPES.join("/")}), label?, description?, required?, default?, values? (enum), min?/max? (number), maxLength? (string) }. The /actions run panel renders one input per descriptor.`
      },
      {
        name: "steps",
        type: "record",
        required: true,
        max: MAX_ACTION_STEPS,
        description: `Ordered step list, 1\u2013${MAX_ACTION_STEPS}, each { op: ${ACTION_STEP_OPS.join(" | ")}, \u2026 }. things.create { schema, values }; things.get { id }; things.search { schema?, limit? }; things.update { id, values }; actions.invoke { action, inputs? }; lookup { provider, credentialId, query }; return { value }. Values are literal JSON, whole-value refs, or ttConcat compositions.`
      },
      {
        name: "capabilities",
        type: "record",
        required: false,
        max: MAX_ACTION_CAPABILITY_ENTRIES,
        description: `Declared capability list, max ${MAX_ACTION_CAPABILITY_ENTRIES}: { capability (${ACTION_CAPABILITIES.join("/")}), schemas? (scope list), actions? (invoke allowlist), providers? (lookup allowlist) }. Save-time validation requires every step to be covered by a declared capability, so the declaration is always true.`
      },
      {
        name: "limits",
        type: "record",
        required: false,
        description: `Per-invocation envelope overrides: { timeoutMs, maxOperations, maxDepth, maxChildActions, maxResultBytes, maxInputBytes } \u2014 clamped to server ceilings (${ACTION_LIMIT_CEILINGS.timeoutMs}ms / ${ACTION_LIMIT_CEILINGS.maxOperations} ops / depth ${ACTION_LIMIT_CEILINGS.maxDepth} / ${ACTION_LIMIT_CEILINGS.maxChildActions} child actions / ${ACTION_LIMIT_CEILINGS.maxResultBytes} result bytes).`
      }
    ],
    example: {
      name: "Create customer",
      description: "Creates a customer data thing from typed inputs.",
      actionKey: "create-customer",
      category: "customers",
      version: 1,
      inputs: [
        { name: "name", type: "string", label: "Name", required: true, maxLength: 120 },
        { name: "email", type: "string", label: "Email", required: true, maxLength: 200 }
      ],
      steps: [
        { op: "things.create", schema: "customer", values: { name: "$input.name", email: "$input.email" } },
        { op: "return", value: "$step.1" }
      ],
      capabilities: [{ capability: "things.create", schemas: ["customer"] }],
      limits: { timeoutMs: 5e3, maxOperations: 10 }
    }
  };
  var actionRunSchema = {
    id: "action-run",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Action run",
    summary: "One recorded execution of an action (targetId) \u2014 status, budget usage, per-step trace.",
    requiresTarget: true,
    createdVia: "POST /api/v1/actions/run",
    detail: `Written only by the action executor: the invoker owns the record (acl ["tt:user"]), targetId points at the action that ran. Captures status, timing, the budget actually consumed (operations, depth, child actions), a size-capped echo of the inputs and result, and a per-step trace \u2014 the inspectable "what actually happened" half of the action contract. Direct create/update/delete through the generic things routes is refused. Operational telemetry, so the trail is retained rather than kept forever: the executor keeps the newest ${MAX_ACTION_RUNS_RETAINED} records per action per owner and prunes older ones after each run, and deleting the action deletes its run records with it. Canonical Timeline separately retains private admission and redacted outcome events; this bounded record is supplementary debugging data.`,
    fields: [
      { name: "status", type: "enum", required: true, values: ["ok", "error"], description: "Whether the run completed or failed." },
      { name: "startedAt", type: "date", required: true, description: "When the invocation began." },
      { name: "durationMs", type: "number", required: true, min: 0, description: "Wall-clock execution time." },
      { name: "opsUsed", type: "number", required: true, min: 0, description: "Operations consumed from the shared budget." },
      { name: "depthUsed", type: "number", required: false, min: 0, description: "Deepest actions.invoke nesting reached." },
      { name: "childActionsUsed", type: "number", required: false, min: 0, description: "Child actions invoked across the whole run." },
      { name: "error", type: "string", required: false, max: MAX_ACTION_RUN_ERROR_CHARS, description: "Failure message when status is error." },
      { name: "inputs", type: "record", required: false, description: "Size-capped echo of the invocation inputs." },
      { name: "result", type: "record", required: false, description: "Size-capped return value of the run." },
      { name: "trace", type: "record", required: false, max: MAX_ACTION_TRACE_ENTRIES, description: "Per-step trace: { step, op, ms, target?, note? }." }
    ],
    example: {
      status: "ok",
      startedAt: "2026-08-24T10:00:00.000Z",
      durationMs: 482,
      opsUsed: 3,
      depthUsed: 1,
      childActionsUsed: 0,
      result: { id: "abc123" },
      trace: [{ step: 1, op: "things.create", ms: 41, target: "abc123" }]
    }
  };
  var saveThingSchema = {
    id: "save",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Save",
    summary: 'A private library save of another thing (targetId) \u2014 powers "add to my library".',
    detail: `Created/removed by POST /api/v1/things/save { id }. Saves are always private to their owner (acl ["tt:user"]) \u2014 they never inherit the target's audience, so a library is personal by construction. List yours via GET /api/v1/things?thingtime=save or filter /api/v1/schemas/browse with library=1.`,
    requiresTarget: true,
    createdVia: "POST /api/v1/things/save",
    fields: [],
    example: {}
  };
  var voteSchema = {
    id: "vote",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Poll vote",
    summary: "One user\u2019s vote on a poll thing \u2014 one doc per (user, poll), re-votes update in place.",
    detail: 'Created/changed/removed only by POST /api/v1/things/vote { id, optionIndex }. A standalone thing pointing at its poll via targetId, carrying acl ["tt:inherit"] so it is visible exactly when the poll is. crystal.optionIndex is the zero-based option; crystal.voteKey ("<pollId>~<userId>", server-written) makes one-vote-per-user structural via a partial unique index. Vote counts are batch-aggregated onto poll posts as pollVotes.',
    requiresTarget: true,
    createdVia: "POST /api/v1/things/vote",
    fields: [
      { name: "optionIndex", type: "number", required: true, min: 0, description: "Zero-based index into the poll\u2019s options." },
      { name: "voteKey", type: "string", required: true, description: "Canonical dedupe key <pollId>~<userId> \u2014 unique per (poll, user), server-written." }
    ],
    example: { optionIndex: 1, voteKey: "poll_123~664f1c2a9d3e5b0012345678" }
  };
  var updownSchema = {
    id: UPDOWN_THINGTIME,
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Up/down vote",
    summary: "One user\u2019s upvote or downvote on a post or comment \u2014 one doc per (user, target).",
    detail: 'Created/flipped/removed only by POST /api/v1/things/updown { id, direction }. A standalone thing pointing at the voted post or comment via targetId, carrying acl ["tt:inherit"] so it is visible exactly when its target is. crystal.direction is "up" or "down"; crystal.updownKey ("<targetId>~<userId>", server-written) rides the root uniqueKeys namespace so one vote per user per target is structural. Tallies are batch-aggregated onto posts/comments as `votes { up, down, score, viewerVote }` \u2014 native emoji reactions are untouched by this kind.',
    requiresTarget: true,
    createdVia: "POST /api/v1/things/updown",
    fields: [
      { name: "direction", type: "enum", required: true, values: [...UPDOWN_DIRECTIONS], description: "up or down." },
      { name: "updownKey", type: "string", required: true, description: "Canonical dedupe key <targetId>~<userId> \u2014 unique per (target, user), server-written." }
    ],
    example: { direction: "up", updownKey: "4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f~664f1c2a9d3e5b0012345678" }
  };
  var subspaceSchema = {
    id: "subspace",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Subspace",
    summary: "A Reddit-style community: slug, branding, rules, post flairs, user flairs, and an access mode.",
    detail: 'Created through POST /api/v1/subspaces; the creator becomes its owner and first member. The slug is unique (root uniqueKeys `subspaceSlug:<slug>`), lowercase [a-z0-9_] 3\u201330 chars, and is the /s/<slug> URL. Membership is relational subspace-member things (never an embedded member array); member counts are aggregated on read. access: public (anyone posts), restricted (only approved posters/mods post, everyone reads), private (members only \u2014 posts are hidden from non-members everywhere). Subspace things themselves are always listable (acl ["tt:all"]). userFlairs are the templates members wear beside their name (stored on their subspace-member row as userFlair); userFlairSelfAssign (default true) lets members pick one themselves, allowCustomUserFlair (default false) lets them type their own text (\u226440 chars) \u2014 moderators may set anyone\u2019s, modOnly templates included. removalReasons are the canned reasons moderators pick when removing a post (title + message become the stored reason on the post and the author\u2019s subspace-post-removed notification).',
    createdVia: "POST /api/v1/subspaces",
    fields: [
      { name: "slug", type: "string", required: true, max: MAX_SUBSPACE_SLUG_CHARS, description: "Unique URL slug, lowercase [a-z0-9_], 3\u201330 chars." },
      { name: "name", type: "string", required: true, max: MAX_SUBSPACE_NAME_CHARS, description: "Display name." },
      { name: "description", type: "string", required: false, max: MAX_SUBSPACE_DESCRIPTION_CHARS, description: "About text shown in the sidebar." },
      { name: "access", type: "enum", required: true, values: [...SUBSPACE_ACCESS_MODES], description: "public / restricted / private." },
      { name: "nsfw", type: "boolean", required: false, description: "Marks the whole subspace 18+." },
      {
        name: "rules",
        type: "record",
        required: false,
        description: `Ordered community rules \u2014 a list of { title (\u2264${MAX_SUBSPACE_RULE_TITLE_CHARS}), text (\u2264${MAX_SUBSPACE_RULE_TEXT_CHARS}) }, max ${MAX_SUBSPACE_RULES}.`
      },
      {
        name: "flairs",
        type: "record",
        required: false,
        description: `Post flairs authors (or mods, when modOnly) can tag posts with \u2014 a list of { id (slug \u2264${MAX_SUBSPACE_FLAIR_ID_CHARS}), label (\u2264${MAX_SUBSPACE_FLAIR_LABEL_CHARS}), emoji, color, modOnly }, max ${MAX_SUBSPACE_FLAIRS}.`
      },
      {
        name: "userFlairs",
        type: "record",
        required: false,
        description: `User-flair templates members wear beside their name \u2014 the same shape as post flairs ({ id, label, emoji, color, modOnly }), max ${MAX_SUBSPACE_FLAIRS}; modOnly templates are assigned by moderators only.`
      },
      {
        name: "removalReasons",
        type: "record",
        required: false,
        description: `Canned removal reasons moderators pick when removing a post \u2014 a list of { id (slug \u2264${MAX_SUBSPACE_FLAIR_ID_CHARS}), title (\u2264${MAX_SUBSPACE_REMOVAL_REASON_TITLE_CHARS}), message (\u2264${MAX_SUBSPACE_REMOVAL_REASON_MESSAGE_CHARS}) }, max ${MAX_SUBSPACE_REMOVAL_REASONS}; title + message become the post\u2019s stored reason and the author\u2019s notification.`
      },
      { name: "userFlairSelfAssign", type: "boolean", required: false, description: "Members may pick their own user flair (default true; moderators always can, for anyone)." },
      {
        name: "allowCustomUserFlair",
        type: "boolean",
        required: false,
        description: `Members may type a custom user-flair text (\u2264${MAX_SUBSPACE_USER_FLAIR_TEXT_CHARS} chars) instead of picking a template (default false; moderators always may).`
      },
      {
        name: "branding",
        type: "object",
        required: false,
        description: "Visual identity of the subspace.",
        children: [
          { name: "icon", type: "string", required: false, max: MAX_SUBSPACE_ICON_CHARS, description: "Emoji icon." },
          { name: "iconUrl", type: "string", required: false, description: "http(s) icon image URL." },
          { name: "bannerUrl", type: "string", required: false, description: "http(s) banner image URL." },
          { name: "accent", type: "string", required: false, max: MAX_SUBSPACE_ACCENT_CHARS, description: "CSS accent color." }
        ]
      }
    ],
    example: {
      slug: "rainbows",
      name: "Rainbows",
      description: "All things prismatic \u{1F308}",
      access: "public",
      nsfw: false,
      rules: [{ title: "Be kind", text: "No gatekeeping the spectrum." }],
      flairs: [{ id: "photo", label: "Photo", emoji: "\u{1F4F8}", color: "#7c5cff", modOnly: false }],
      userFlairs: [{ id: "prism", label: "Prism", emoji: "\u{1F52E}", color: "#7c5cff", modOnly: false }],
      userFlairSelfAssign: true,
      allowCustomUserFlair: false,
      removalReasons: [{ id: "no-spam", title: "No spam", message: "Posts that only advertise are removed." }],
      branding: { icon: "\u{1F308}", iconUrl: null, bannerUrl: null, accent: "#7c5cff" }
    }
  };
  var subspaceMemberSchema = {
    id: "subspace-member",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Subspace member",
    summary: "One user's membership of one subspace \u2014 role, posting approval, ban state, the two request flags and the user flair (relational child doc).",
    detail: "targetId = the subspace shareId, ownerId = the member. Uniqueness rides the root uniqueKeys namespace (`subspaceMemberKey:<subspaceId>:<userId>`). Roles: owner > moderator > member. A banned user keeps a member doc (banned: true) so the ban outlives leaving/rejoining; approved marks a trusted poster in restricted subspaces. A JOIN REQUEST to a private subspace is the same row with pending: true \u2014 not a membership (isActiveMember = row && !left && !banned && !pending; member counts exclude it) until a moderator accepts it (or adds the user); deny drops the row, leave cancels it. approvalRequested marks an active member of a restricted subspace who asked for posting rights (approve grants + clears, unapprove/deny clear). userFlair is the flair the member wears beside their name in this subspace ({ id (template id or null for custom text), text, emoji, color } | null) \u2014 projected as authorFlair on their posts and comments there while they are an active member. Written only by /api/v1/subspaces/join, /leave and /members.",
    createdVia: "POST /api/v1/subspaces (creator) / POST /api/v1/subspaces/join",
    fields: [
      { name: "memberKey", type: "string", required: true, description: "Unique `<subspaceId>:<userId>` pair key." },
      { name: "role", type: "enum", required: true, values: [...SUBSPACE_ROLES], description: "owner / moderator / member." },
      { name: "approved", type: "boolean", required: false, description: "Approved poster (restricted subspaces)." },
      { name: "banned", type: "boolean", required: false, description: "Banned from posting, commenting and voting here." },
      { name: "banReason", type: "string", required: false, max: MAX_SUBSPACE_MOD_REASON_CHARS, description: "Shown to the banned user." },
      { name: "banUntil", type: "date", required: false, description: "Temporary ban expiry (null = permanent)." },
      { name: "left", type: "boolean", required: false, description: "True once the user left (kept for bans); rejoining clears it." },
      { name: "pending", type: "boolean", required: false, description: "A join request awaiting a moderator (private subspaces) \u2014 not yet a member." },
      { name: "approvalRequested", type: "boolean", required: false, description: "An active member asked for posting approval (restricted subspaces)." },
      {
        name: "userFlair",
        type: "object",
        required: false,
        description: "The flair worn beside the member\u2019s name in this subspace (null = none).",
        children: [
          { name: "id", type: "string", required: false, max: MAX_SUBSPACE_FLAIR_ID_CHARS, description: "Template id (null for custom text)." },
          { name: "text", type: "string", required: true, max: MAX_SUBSPACE_FLAIR_LABEL_CHARS, description: "The text shown (a template\u2019s label snapshot, or the custom text \u226440)." },
          { name: "emoji", type: "string", required: false, max: MAX_SUBSPACE_ICON_CHARS, description: "Optional emoji." },
          { name: "color", type: "string", required: false, max: MAX_SUBSPACE_ACCENT_CHARS, description: "Optional CSS color (hex or named)." }
        ]
      }
    ],
    example: { memberKey: "c0ffee\u2026:5eed\u2026", role: "member", approved: false, banned: false, pending: false, approvalRequested: false, userFlair: { id: "prism", text: "Prism", emoji: "\u{1F52E}", color: "#7c5cff" } }
  };
  var subspaceModlogSchema = {
    id: "subspace-modlog",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Subspace mod log entry",
    summary: "One moderator action in a subspace (append-only audit trail).",
    detail: "targetId = the subspace shareId, ownerId = the acting moderator. Written beside every moderation mutation (remove/approve/pin/lock/flair/ban/unban/role/approve-poster/settings) so /s/<slug>/mod can show who did what (member.accept / member.deny cover the Requests queue); listed via GET /api/v1/subspaces/modlog.",
    createdVia: "moderation mutations under /api/v1/subspaces/*",
    fields: [
      { name: "action", type: "string", required: true, max: 40, description: "Action key, e.g. post.remove, member.ban." },
      { name: "postId", type: "id", required: false, description: "Affected post/comment shareId." },
      { name: "userId", type: "id", required: false, description: "Affected user id." },
      { name: "reason", type: "string", required: false, max: MAX_SUBSPACE_MOD_REASON_CHARS, description: "Moderator note." },
      { name: "detail", type: "record", required: false, description: "Small bounded extra (e.g. { flairId, role })." }
    ],
    example: { action: "post.remove", postId: "4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f", reason: "Rule 1" }
  };
  var subspaceTombstoneSchema = {
    id: "subspace-tombstone",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Subspace slug tombstone",
    summary: "Holds a deleted subspace\u2019s slug so its deep links can\u2019t be hijacked (control-plane row).",
    detail: `Written by POST /api/v1/subspaces/delete in the same transaction that removes the subspace thing; carries the subspaceSlug uniqueKey the subspace held. targetId = the deleted subspace shareId, ownerId = its last owner, who may re-found the slug immediately; anyone else only once the ${SUBSPACE_SLUG_HOLD_DAYS}-day hold has passed (POST /api/v1/subspaces answers 409 until then). Re-founding the slug consumes the tombstone. Never listed: /s/<slug> and GET /api/v1/subspaces/get answer 404 for a tombstoned slug.`,
    createdVia: "POST /api/v1/subspaces/delete",
    fields: [
      { name: "slug", type: "string", required: true, max: MAX_SUBSPACE_SLUG_CHARS, description: "The held slug." },
      { name: "subspaceId", type: "id", required: true, description: "shareId of the deleted subspace." },
      { name: "previousOwnerId", type: "id", required: true, description: "Who owned it at deletion (may re-found at once)." },
      { name: "deletedAt", type: "date", required: true, description: "When the subspace was deleted (the hold counts from here)." }
    ],
    example: { slug: "rainbows", subspaceId: "c0ffee12-dddd-4ddd-8ddd-000000000004", previousOwnerId: "5eed\u2026", deletedAt: "2026-09-05T00:00:00.000Z" }
  };
  var subspaceReportSchema = {
    id: "subspace-report",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Subspace report",
    summary: "One viewer\u2019s report of a post to a subspace\u2019s moderators (relational row; the Reports queue groups them by post).",
    detail: 'targetId = the subspace the report sits in (the post\u2019s subspace when it was filed \u2014 a repeat re-files a row in the subspace the post lives in now), ownerId = the reporter, acl ["tt:user"] \u2014 the OWNER acl: the reporter can read their own row through the generic single read, every other viewer gets 404; the moderators read the collection through the dedicated /reports endpoint, never through canView. One row per (post, reporter) \u2014 uniqueness rides the root uniqueKeys namespace (`subspaceReportKey:<postId>:<reporterId>`): reporting the same post again updates the reason / note (and re-opens a resolved row). Reports of a COMMENT resolve to the root post (postId = the post; commentId keeps which comment was flagged). A post the moderators already removed takes no new report (409). status open \u2192 resolved with a resolution: removed / approved (a moderator\u2019s `moderate` remove / approve settles every open report on the post) or dismissed (POST /api/v1/subspaces/reports { postId, action: "dismiss" }). Control-plane storage \u2014 never billable content. Written only by POST /api/v1/subspaces/report and settled by /moderate and /reports; deleted with the subspace, with the post, and (the rows that flagged it) with a deleted comment.',
    createdVia: "POST /api/v1/subspaces/report",
    fields: [
      { name: "postId", type: "id", required: true, description: "The reported (root) post\u2019s shareId." },
      { name: "commentId", type: "id", required: false, description: "The flagged comment\u2019s shareId when a comment was reported (null for the post itself)." },
      { name: "reason", type: "string", required: true, max: MAX_SUBSPACE_REPORT_REASON_CHARS, description: "A rule title, a removal-reason id, or free text." },
      { name: "note", type: "string", required: false, max: MAX_SUBSPACE_REPORT_NOTE_CHARS, description: "The reporter\u2019s optional context (moderators only)." },
      { name: "status", type: "enum", required: true, values: [...SUBSPACE_REPORT_STATUSES], description: "open until a moderator settles it." },
      { name: "resolution", type: "enum", required: false, values: [...SUBSPACE_REPORT_RESOLUTIONS], description: "How it was settled (null while open)." },
      { name: "resolvedById", type: "id", required: false, description: "The moderator who settled it (null while open)." },
      { name: "resolvedAt", type: "date", required: false, description: "When it was settled (null while open)." },
      { name: "reportKey", type: "string", required: true, description: "Unique `<postId>:<reporterId>` pair key." }
    ],
    example: { postId: "4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f", commentId: null, reason: "No spam", note: "Third ad this week from the same account", status: "open", resolution: null, resolvedById: null, resolvedAt: null, reportKey: "4f6b2c1e\u2026:5eed\u2026" }
  };
  var subspaceEmbedSchema = {
    id: "subspace-embed",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Subspace embedded Thing",
    summary: "One moderator-managed Thing reference in the sidebar or feed.",
    detail: "targetId is the subspace. Each ordered reference is an accounted relational Thing. Only current moderators add, move or remove references through /api/v1/subspaces/embeds. Reads reauthorize both the subspace and the referenced Thing for the current viewer; embedding never changes the source audience or discloses management capabilities.",
    createdVia: "POST /api/v1/subspaces/embeds",
    fields: [
      { name: "region", type: "enum", required: true, values: ["sidebar", "feed"], description: "Where this reference appears." },
      { name: "thingId", type: "id", required: true, description: "Referenced Thing shareId; independently authorized on read." },
      { name: "order", type: "number", required: true, description: "Server-owned stable position within the region." }
    ],
    example: { region: "sidebar", thingId: "example-thing", order: 0 }
  };
  var subscriptionSchema = {
    id: "subscription",
    version: 3,
    kind: "crystal",
    collection: null,
    title: "Subscription",
    summary: "A tier/quota assignment (admin-managed; PROTECTED from generic CRUD).",
    detail: 'One protected Thing per user subject, written only through the admin-gated /api/v1/admin/subscriptions (self-assigning a tier through /api/v1/things would be privilege escalation). App subscriptions use the same API shape but live atomically on the app Thing beside its aggregate storage counter. Every assignment snapshots an immutable subscription-tier version id + version so a later publish/archive never changes the plan someone originally selected. The tier supplies default quotas; per-field admin overrides win, with null meaning unlimited. payg is the metered tier: no hard caps, usage is measured by the byte ledgers and billed. The same protected Thing is the authoritative whole-account byte ledger, keeping the userStorageBytes entitlement and storageUsedBytes admission counter together in one atomic document. Enforcement (account/app storage budgets, app/PAT mint caps) resolves through the merged "effective" quotas.',
    fields: [
      { name: "quotaKind", type: "string", required: true, values: ["subscription"], description: "Bookkeeping marker (like the app-storage ledger)." },
      {
        name: "subjectType",
        type: "enum",
        required: true,
        values: ["user"],
        description: "Stored subscription Things apply to users; app plans live on app Things."
      },
      { name: "subjectId", type: "id", required: true, description: "User id." },
      { name: "tier", type: "string", required: true, description: "Stable tier id." },
      { name: "tierVersionId", type: "id", required: true, description: "Immutable subscription-tier Thing shareId selected for this assignment." },
      { name: "tierVersion", type: "number", required: true, min: 1, description: "Human-readable revision number of the selected tier." },
      { name: "tierQuotas", type: "record", required: true, description: "Immutable quota snapshot from the selected tier revision." },
      {
        name: "overrides",
        type: "record",
        required: false,
        description: "Per-field user quota overrides (userStorageBytes, maxApps, maxPats; null = unlimited)."
      },
      { name: "note", type: "string", required: false, max: 500, description: "Admin note (why this assignment exists)." },
      { name: "updatedBy", type: "id", required: false, description: "The admin who last changed it." },
      {
        name: "storageUsedBytes",
        type: "number",
        required: true,
        min: 0,
        description: "Canonical whole-account logical content bytes currently used."
      },
      {
        name: "storageAccountingVersion",
        type: "number",
        required: true,
        min: 1,
        description: "Version of the byte projection and ledger contract; positive writes fail closed until initialized."
      },
      {
        name: "storageLedgerStatus",
        type: "enum",
        required: true,
        values: ["initializing", "ready", "needs-reconcile"],
        description: "Ready admits growth; other states block growth while source-document reconciliation runs."
      },
      { name: "storageReconciledAt", type: "date", required: false, description: "Last exact reconciliation from content size stamps." }
    ],
    example: {
      quotaKind: "subscription",
      subjectType: "user",
      subjectId: "664f1c2a9d3e5b0012345678",
      tier: "pro",
      tierVersionId: "subscription-tier-pro-v1",
      tierVersion: 1,
      overrides: { userStorageBytes: 21474836480 },
      storageUsedBytes: 1048576,
      storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      storageLedgerStatus: "ready",
      note: "Beta partner"
    }
  };
  var subscriptionTierSchema = {
    id: "subscription-tier",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Subscription tier revision",
    summary: "An immutable, versioned pricing/quota tier (admin-managed; PROTECTED from generic CRUD).",
    detail: "One protected Thing per tier revision. tierId stays stable while version and shareId identify the exact revision. Drafts are editable; publishing makes the draft live and archives the previous live revision. Published/archived revisions remain permanently readable so user and app subscription assignments can trace the exact prices, inclusions, and quotas originally selected. Only live revisions appear in customer tier cards.",
    createdVia: "POST /api/v1/admin/tiers",
    fields: [
      { name: "quotaKind", type: "string", required: true, values: ["subscription-tier"], description: "Bookkeeping marker." },
      { name: "tierId", type: "id", required: true, description: "Stable product id shared by every revision." },
      { name: "version", type: "number", required: true, min: 1, description: "Immutable integer revision." },
      { name: "status", type: "enum", required: true, values: ["draft", "live", "archived"], description: "Catalog lifecycle section." },
      { name: "title", type: "string", required: true, max: 80, description: "Tier name." },
      { name: "tagline", type: "string", required: false, max: 240, description: "Short subtitle shown on tier cards." },
      { name: "emoji", type: "string", required: false, max: 16, description: "Optional visual shorthand shown beside the name." },
      { name: "bannerImageUrl", type: "string", required: false, description: "Optional http(s) banner image." },
      { name: "sortOrder", type: "number", required: true, description: "Customer-card ordering." },
      { name: "metered", type: "boolean", required: true, description: "Whether usage is metered rather than blocked at finite caps." },
      { name: "currency", type: "string", required: true, max: 3, description: "Three-letter ISO currency code." },
      { name: "prices", type: "record", required: true, description: "Daily, weekly, monthly, yearly integer minor-unit prices." },
      {
        name: "discountOverrides",
        type: "record",
        required: false,
        description: "Optional custom percentage-saved values; absent comparisons are computed."
      },
      {
        name: "discounts",
        type: "record",
        required: true,
        description: "Saved six-way percentage-saved matrix resolved from prices plus custom overrides."
      },
      {
        name: "discountFormulaVersion",
        type: "number",
        required: true,
        min: 1,
        description: "Version of the annualized discount formula used for this snapshot."
      },
      { name: "inclusions", type: "record", required: true, description: "Editor.js rich-text document rendered on customer tier cards." },
      { name: "quotas", type: "record", required: true, description: "Quota defaults snapshotted into each assignment." },
      { name: "sourceVersionId", type: "id", required: false, description: "Revision cloned to create this draft." },
      { name: "createdBy", type: "id", required: true, description: "Admin who created this revision." },
      { name: "updatedBy", type: "id", required: true, description: "Admin who last changed its draft or lifecycle status." },
      { name: "publishedAt", type: "date", required: false, description: "When this revision first became live." },
      { name: "archivedAt", type: "date", required: false, description: "When this revision left the live catalog." }
    ],
    example: {
      quotaKind: "subscription-tier",
      tierId: "pro",
      version: 2,
      status: "live",
      title: "Pro",
      emoji: "\u{1F333}",
      sortOrder: 20,
      metered: false,
      currency: "USD",
      prices: { daily: 300, weekly: 1800, monthly: 5900, yearly: 59e3 },
      discounts: { yearlyFromDaily: 46.12, yearlyFromWeekly: 36.97, yearlyFromMonthly: 16.67 },
      discountFormulaVersion: 1,
      createdBy: "system",
      updatedBy: "system"
    }
  };
  var appStorageLedgerSchema = {
    id: "app-storage",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "App-user storage ledger",
    summary: "Protected byte accounting and an optional sub-tier for one (app, user) namespace.",
    detail: "One deterministic relational Thing per app user. The ledger meters usedBytes and optionally stores a manager-assigned storageAllowanceBytes override; no override inherits the app default. It is a PROTECTED system kind, so the end user can browse/delete their app data without editing or deleting the quota counter itself. The app aggregate still wins if many user caps add up beyond the app plan.",
    createdVia: "App authorization/storage writes and /api/v1/apps/storage",
    fields: [
      { name: "quotaKind", type: "string", required: true, description: "Bookkeeping marker: app-storage." },
      { name: "appId", type: "id", required: true, description: "Registered app clientId." },
      { name: "usedBytes", type: "number", required: true, min: 0, description: "Bytes currently used by this app user." },
      {
        name: "storageAllowanceBytes",
        type: "number",
        required: false,
        min: 0,
        description: "Optional app-manager override; absent inherits the app default."
      }
    ],
    example: { quotaKind: "app-storage", appId: "ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f", usedBytes: 1048576, storageAllowanceBytes: 209715200 }
  };
  var serviceQuotaSchema = {
    id: "service-quota",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Service quota ledger",
    summary: "Protected rate/admission accounting for one user-owned service capability.",
    detail: "One deterministic server-owned Thing per (user, service key). Dedicated quota endpoints atomically reserve, permit, release, and reset capacity. The generic Things API cannot create or edit this protected kind, and the root storageClass is control so these operational counters never inflate customer content usage. Legacy data-kind quota records are promoted on first use and by the whole-account storage migration.",
    createdVia: "Dedicated service quota utilities",
    fields: [
      { name: "quotaKind", type: "string", required: true, values: ["service-quota"], description: "Protected bookkeeping marker." },
      { name: "quotaVersion", type: "number", required: true, min: 1, description: "Service quota state-machine version." },
      { name: "key", type: "string", required: true, description: "Server-selected capability key." },
      { name: "policy", type: "record", required: true, description: "Pinned daily and rolling-window limits." },
      { name: "dayKey", type: "string", required: true, description: "Current UTC accounting day." },
      { name: "dailyUsed", type: "number", required: true, min: 0, description: "Reserved capacity for the current UTC day." },
      { name: "reservations", type: "object", required: true, description: "Bounded idempotent reservation records." },
      { name: "permitIds", type: "string[]", required: true, description: "Granted rolling-window permit ids." },
      { name: "releasedIds", type: "string[]", required: true, description: "Released idempotency keys." },
      { name: "rollingPermits", type: "object", required: true, description: "Permit ids and timestamps still inside the rolling window." }
    ],
    example: {
      quotaKind: "service-quota",
      quotaVersion: 1,
      key: "map-blocks",
      policy: { dailyLimit: 1e3, rollingLimit: 20, rollingWindowMs: 6e4 },
      dayKey: "2026-08-07",
      dailyUsed: 12,
      reservations: [],
      permitIds: [],
      releasedIds: [],
      rollingPermits: []
    }
  };
  var errorLogSchema = {
    id: ERROR_LOG_THINGTIME,
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Error log",
    summary: "A redacted server error, searchable by current admins in /things?logs=1.",
    detail: "Server-only, home-plane control Thing. No generic reads or writes. Seven-day TTL, bounded capture, no account storage charge. Redacted detail is binary; only safe metadata is searchable through the admin endpoint.",
    createdVia: "Server error capture",
    fields: [
      { name: "source", type: "string", required: true, max: 128, description: "Authored operation label." },
      { name: "message", type: "string", required: true, max: 2048, description: "Redacted error summary." },
      { name: "provider", type: "string", required: false, description: "External provider when applicable." },
      { name: "status", type: "number", required: false, description: "Upstream or HTTP status." },
      { name: "code", type: "string", required: false, description: "Provider error code." },
      { name: "requestId", type: "string", required: false, description: "Server-generated correlation id." },
      { name: "route", type: "string", required: false, description: "Registered API route, without query strings." },
      { name: "method", type: "string", required: false, description: "HTTP request method." },
      { name: "providerType", type: "string", required: false, description: "Provider error classification." },
      { name: "providerRequestId", type: "string", required: false, description: "Upstream request correlation id." },
      { name: "retryAfter", type: "string", required: false, description: "Upstream retry delay." },
      { name: "attempt", type: "number", required: false, description: "Bounded provider attempt number." }
    ],
    example: { source: "moderation", message: "Rate limit reached", provider: "openai", status: 429 }
  };
  var migrationDiagnosticSchema = {
    id: MIGRATION_DIAGNOSTIC_THINGTIME,
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Migration diagnostic",
    summary: "A short-lived, admin-owned report captured when a database migration throws.",
    detail: "Protected control-plane Thing written only by the admin migration runner after its lease is released. The crystal contains bounded run metadata; the full redacted error is an opaque binary root field, read only through the current-admin diagnostic endpoint. Version 2 may retain a bounded map of explicitly contextual MongoDB ObjectIds behind value-free references; each raw value requires fresh current-password confirmation through the closed reveal endpoint. Credentials and ambiguous values remain irreversible. It expires automatically and never enters storage billing.",
    createdVia: "POST /api/v1/admin/migrations/run (failure path)",
    fields: [
      { name: "diagnosticVersion", type: "number", required: true, description: "Diagnostic envelope version." },
      { name: "migrationId", type: "string", required: true, max: 128, description: "Registered migration id." },
      {
        name: "mode",
        type: "enum",
        required: true,
        values: ["run"],
        description: "Only real runs persist diagnostics; failed dry runs never create a diagnostic Thing."
      },
      { name: "status", type: "number", required: true, description: "HTTP status returned by the migration endpoint." },
      { name: "outcome", type: "enum", required: true, values: ["rejected", "unknown"], description: "Whether mutation outcome is known." },
      { name: "summary", type: "string", required: true, max: 2048, description: "Safe operator-facing failure summary." },
      { name: "capturedAt", type: "date", required: true, description: "Diagnostic capture time." }
    ],
    example: {
      diagnosticVersion: 2,
      migrationId: "backfill-user-storage-accounting",
      mode: "run",
      status: 500,
      outcome: "unknown",
      summary: "Migration stopped before completion.",
      capturedAt: "2026-08-08T00:00:00.000Z"
    }
  };
  var ciEntitySchema = (id3, title, summary) => ({
    id: id3,
    version: 1,
    kind: "crystal",
    collection: null,
    title,
    summary,
    detail: "A private, system-owned control-plane projection written only by signed GitHub/Vercel webhook ingestion, an administrator reconciliation, or an allowlisted administrator dispatch. The deterministic shareId keeps one current projection per external entity; status changes are stored separately as relational ci-event Things so history never grows an embedded array. Generic Thing CRUD cannot create, edit, or delete it. Stored in the ciControl satellite collection (never in things); activity rows carry root expiresAt retention.",
    createdVia: "Signed integration webhooks and /api/v1/admin/ci*",
    fields: [
      { name: "provider", type: "enum", required: true, values: ["github", "vercel", "thingtime"], description: "Authoritative provider." },
      { name: "repository", type: "string", required: true, max: 300, description: "Canonical owner/repository name." },
      { name: "externalId", type: "string", required: true, max: 300, description: "Provider-scoped stable identifier." },
      { name: "entityKey", type: "string", required: true, max: 1e3, description: "Deterministic provider/repository/kind/id key." },
      { name: "title", type: "string", required: true, max: 500, description: "Bounded operator-facing label." },
      { name: "status", type: "string", required: true, max: 120, description: "Latest normalized provider status." },
      { name: "url", type: "string", required: false, max: 1500, description: "Provider detail URL, when available." },
      { name: "sourceUpdatedAt", type: "date", required: true, description: "Provider timestamp used to reject stale updates." }
    ],
    example: {
      provider: "github",
      repository: "lopugit/thingtime",
      externalId: "172",
      entityKey: `github:lopugit/thingtime:${id3}:172`,
      title: "Example control-plane entity",
      status: "clean",
      url: "https://github.com/lopugit/thingtime/pull/172",
      sourceUpdatedAt: "2026-08-09T00:00:00.000Z"
    }
  });
  var ciControlSchemas = [
    ciEntitySchema("ci-repository", "CI repository", "Current integration and default-branch state for one repository."),
    ciEntitySchema("ci-automation", "CI automation policy", "Current execution-provider policy for one allowlisted automation."),
    ciEntitySchema("ci-feature", "CI feature", "A feature/stack grouping that relates source and promotion pull requests."),
    {
      id: "ci-feature-stack",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Saved CI Feature Stack",
      summary: "An editable named Feature Stack configuration owned by the protected CI control plane.",
      detail: "The root stores fixed configuration and latest-run metadata. Ordered sources and targets are relational ci-feature-stack-entry Things published by revision, so edits never expose a partially replaced list.",
      createdVia: "/api/v1/admin/ci/stacks",
      fields: [
        { name: "title", type: "string", required: true, max: 80, description: "Human name of the saved Feature Stack." },
        { name: "repository", type: "string", required: true, max: 300, description: "GitHub owner/name the stack builds against." },
        { name: "autoDecideBranches", type: "boolean", required: true, description: "Whether Lopu chooses branch names for each stacked feature." },
        { name: "revision", type: "string", required: true, max: 80, description: "Immutable revision id of the saved stack definition." },
        { name: "status", type: "string", required: true, max: 120, description: "Lifecycle status such as saved, dispatched or completed." },
        { name: "archived", type: "boolean", required: true, description: "Hidden from the active stack list when true." },
        { name: "createdBy", type: "string", required: true, max: 180, description: "Admin username that saved the stack." },
        { name: "updatedBy", type: "string", required: true, max: 180, description: "Admin username of the latest edit." },
        { name: "lastDispatchId", type: "string", required: false, max: 180, description: "Id of the most recent controller dispatch, when any." },
        { name: "lastRunAt", type: "date", required: false, description: "When the stack was last dispatched to the controller." }
      ],
      example: { title: "Search + Actions", repository: "lopugit/thingtime", autoDecideBranches: true, revision: "revision-id", status: "saved", archived: false, createdBy: "admin", updatedBy: "admin" }
    },
    {
      id: "ci-feature-stack-entry",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "CI Feature Stack entry",
      summary: "One ordered source pull request or target branch related to a saved Feature Stack.",
      detail: "Each child belongs to one root and revision. entryType chooses either prNumber or branch; position preserves administrator order without embedding an unbounded list on the root.",
      createdVia: "/api/v1/admin/ci/stacks",
      fields: [
        { name: "repository", type: "string", required: true, max: 300, description: "GitHub owner/name the entry belongs to." },
        { name: "revision", type: "string", required: true, max: 80, description: "Revision of the parent Feature Stack this entry is part of." },
        { name: "entryType", type: "enum", required: true, values: ["source", "target"], description: "Whether the entry is a source pull request or a target branch." },
        { name: "position", type: "number", required: true, min: 0, description: "Zero-based administrator ordering within the stack." },
        { name: "prNumber", type: "number", required: false, min: 1, description: "Pull request number for source entries." },
        { name: "branch", type: "string", required: false, max: 180, description: "Branch name for target entries." }
      ],
      example: { repository: "lopugit/thingtime", revision: "revision-id", entryType: "source", position: 0, prNumber: 427 }
    },
    ciEntitySchema("ci-branch", "CI branch", "Current ref and head state for one repository branch."),
    ciEntitySchema("ci-pull-request", "CI pull request", "Current topology, mergeability, and review state for one pull request."),
    ciEntitySchema("ci-workflow-run", "CI workflow run", "Current state of one GitHub Actions workflow run or job."),
    ciEntitySchema("ci-deployment", "CI deployment", "Current state of one GitHub or Vercel deployment."),
    ciEntitySchema("ci-preview", "CI preview", "Current address and readiness of one branch/deployment preview."),
    ciEntitySchema("ci-preview-policy", "CI preview policy", "Admin-only develop and production-data preview choices for one pull request."),
    {
      id: "ci-stack-chat-message",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Stack run conversation",
      summary: "A private run question and bounded responder result.",
      detail: "System-protected, relational records in ciControl. Only CI administrators can read/send; HMAC-authenticated exact-run workers can lease and answer. Retained for 90 days.",
      createdVia: "/api/v1/admin/ci/stacks/chat",
      fields: [
        { name: "repository", description: "Repository bound to the dispatch.", type: "string", required: true, max: 300 },
        { name: "runId", description: "Immutable Feature Stack run identity.", type: "string", required: true, max: 80 },
        { name: "actorId", description: "Administrator who asked the question.", type: "string", required: true, max: 180 },
        { name: "question", description: "Redacted question, at most 2000 characters.", type: "string", required: true, max: 2e3 },
        // The protected chat writer enforces 8000; public schema maxLength caps at 5000.
        { name: "answer", description: "Redacted responder result, at most 8000 characters.", type: "string", required: false },
        { name: "status", description: "Durable delivery state.", type: "enum", required: true, values: ["queued", "answering", "answered", "failed"] },
        { name: "attempts", description: "Number of delivery claims.", type: "number", required: true },
        { name: "lease", description: "Opaque worker delivery token, never exposed to admins.", type: "string", required: false, max: 80 },
        { name: "completedLease", description: "Private idempotent reply receipt token.", type: "string", required: false, max: 80 },
        { name: "leaseUntil", description: "Claim expiry.", type: "date", required: false },
        { name: "runAttempt", description: "GitHub workflow attempt owning the delivery.", type: "number", required: false }
      ],
      example: { repository: "owner/repo", runId: "feature-stack-run-example", actorId: "admin", question: "What is waiting?", status: "queued", attempts: 0 }
    },
    ciEntitySchema("ci-dispatch", "CI dispatch", "An administrator-requested, allowlisted GitHub Actions dispatch."),
    {
      id: "ci-event",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "CI status event",
      summary: "One immutable, idempotent status-history entry attached to a control-plane Thing.",
      detail: "A relational audit record keyed by provider delivery id and parent entity. Events are append-only and bounded; retries of the same signed webhook do not duplicate history. Generic Thing CRUD cannot create, edit, or delete it. Stored in the ciControl satellite collection with root expiresAt retention (THINGTIME_CI_EVENT_RETENTION_DAYS, default 14); a delivery that changes nothing on the repository row records no event.",
      createdVia: "Signed integration webhooks and /api/v1/admin/ci*",
      fields: [
        { name: "provider", type: "enum", required: true, values: ["github", "vercel", "thingtime"], description: "Event provider." },
        { name: "repository", type: "string", required: true, max: 300, description: "Canonical owner/repository name." },
        { name: "deliveryId", type: "string", required: true, max: 300, description: "Provider idempotency key." },
        { name: "eventType", type: "string", required: true, max: 120, description: "Webhook or controller event family." },
        { name: "action", type: "string", required: false, max: 120, description: "Provider action subtype." },
        { name: "actor", type: "string", required: false, max: 180, description: "Bounded provider actor identifier." },
        { name: "statusFrom", type: "string", required: false, max: 120, description: "Previous normalized status." },
        { name: "statusTo", type: "string", required: false, max: 120, description: "New normalized status." },
        { name: "occurredAt", type: "date", required: true, description: "Provider event time." },
        { name: "data", type: "record", required: false, description: "Bounded event-specific metadata." }
      ],
      example: {
        provider: "github",
        repository: "lopugit/thingtime",
        deliveryId: "delivery-id",
        eventType: "pull_request",
        action: "synchronize",
        actor: "github-actions[bot]",
        statusFrom: "conflicting",
        statusTo: "clean",
        occurredAt: "2026-08-09T00:00:00.000Z",
        data: {}
      }
    }
  ];
  var accountLinkSchema = {
    id: "account-link",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Account link",
    summary: "An ownership link: a user manages another account or co-manages an app (admin-assigned; PROTECTED).",
    detail: `Written only through the admin-gated /api/v1/admin/links \u2014 many-to-many by construction (any number of owners per target, any number of targets per owner). linkKind "account" puts the target under the user's "Owned accounts" (assumable without credentials via /api/v1/auth/accounts/assume); linkKind "app" adds them as a co-manager of a registered app (it appears in their /apps, and update/delete accept them). The doc's ownerId is the managing user, so their links surface first-party.`,
    fields: [
      { name: "linkKind", type: "enum", required: true, values: ["account", "app"], description: "Owned account, or co-managed app." },
      { name: "userId", type: "id", required: true, description: "The managing (owner) user." },
      { name: "targetId", type: "id", required: true, description: "Owned account's user id, or the app's clientId." },
      { name: "role", type: "string", required: true, values: ["owner"], description: "Link role (owner today)." },
      { name: "createdBy", type: "id", required: true, description: "The admin who assigned it." }
    ],
    example: {
      linkKind: "account",
      userId: "664f1c2a9d3e5b0012345678",
      targetId: "664f1c2a9d3e5b0087654321",
      role: "owner",
      createdBy: "664f1c2a9d3e5b0000000001"
    }
  };
  var friendThingSchema = {
    id: "friend",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Friendship",
    summary: "A friendship (or pending friend request) between two users \u2014 one doc per pair.",
    detail: "Driven by POST /api/v1/users/friend { userId, intent }. ownerId is the requester, targetId the recipient; crystal.status is pending until the recipient accepts. Accepted friendships power the tt:userFriends acl circle (friends-only posts). Private to the pair (served via the users endpoints); the generic things CRUD refuses this kind.",
    requiresTarget: true,
    createdVia: "POST /api/v1/users/friend",
    fields: [
      { name: "status", type: "enum", required: true, values: ["pending", "accepted"], description: "Request state." },
      { name: "friendKey", type: "string", required: true, description: "Canonical unordered pair key <minId>~<maxId> \u2014 unique per pair." }
    ],
    example: { status: "accepted", friendKey: "664f1c2a9d3e5b0012345678~664f1c2a9d3e5b0012345679" }
  };
  var NOTIFICATION_TYPES = [
    "friend-request",
    "friend-accepted",
    "new-follower",
    "post-from-followed",
    "post-from-friend",
    "comment",
    "reply",
    "reaction",
    "share",
    "mention",
    "groups",
    "subspace-join-request",
    "subspace-join-accepted",
    "subspace-post-removed",
    "subspace-report",
    "subspace-role",
    "subspace-ban",
    "action-run",
    "recording-reminder",
    "lopu-reminder",
    "lopu-message",
    "login-success",
    "system-message"
  ];
  var EMAIL_ONLY_NOTIFICATION_TYPES = ["weekly-summary"];
  var EMAIL_NOTIFICATION_TYPES = [...NOTIFICATION_TYPES, ...EMAIL_ONLY_NOTIFICATION_TYPES];
  var notificationThingSchema = {
    id: "notification",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Notification",
    summary: "A server-minted in-app notification for one recipient (ownerId).",
    detail: 'Minted by the server when someone else follows you, sends/accepts a friend request, comments, replies, reacts, shares, @mentions you in a post or comment, or (fan-out, capped) posts while you follow them \u2014 by subspace moderation (subspace-* types: join requests/accepts, post removals, reports, role changes incl. ownership transfer and deletion, bans; subspace-scoped ones put "s/<slug> \xB7 \u2026" in preview and the subspace shareId in targetId, post-scoped ones set postId) \u2014 plus SYSTEM notes (category system, actorId "thingtime", actor name Lopu) such as action-run, written when an action you ran finishes. ownerId is the recipient, targetId the subject thing (post/comment/user/subspace, or the action-run record), root readAt flips when read. Listed via GET /api/v1/notifications?history=1 (independent of delivery preferences, searchable and filterable by category/type/unread/date for the /notifications history page), marked via POST /api/v1/notifications/read. Always acl ["tt:user"]; the generic things CRUD refuses this kind. History has no count-based pruning. Root historyOnly marks quiet events excluded from the bell, not from history. Authenticated client messages use the validated, idempotent /api/v1/notifications/record endpoint.',
    createdVia: "server-side emission (social/engagement events + system notes)",
    fields: [
      { name: "type", type: "enum", required: true, values: [...NOTIFICATION_TYPES], description: "Notification type (drives prefs, category + copy)." },
      { name: "actorId", type: "id", required: true, description: 'The user whose action triggered this, or "thingtime" for system notes.' },
      { name: "actorName", type: "string", required: false, description: "Actor display name snapshot (Lopu for system notes)." },
      { name: "actorUsername", type: "string", required: false, description: "Actor username snapshot \u2014 searchable in history." },
      { name: "postId", type: "id", required: false, description: "Related post for click-through." },
      { name: "preview", type: "string", required: false, max: 140, description: "Short content preview, or the detail line of a system note." },
      { name: "title", type: "string", required: false, max: 400, description: 'System notes only: the headline shown instead of "<actor> <verb>".' },
      { name: "delivery", type: "enum", required: false, values: ["quiet", "normal", "urgent"], description: "Optional passive, active or time-sensitive delivery. User device settings apply; never Apple Critical." },
      { name: "richText", type: "string", required: false, max: 2e3, description: "Optional safe Markdown for the Thingtime history view; native banners use preview." },
      { name: "image", type: "string", required: false, description: "Server-approved same-origin illustration path; arbitrary remote images are not accepted." },
      { name: "detail", type: "string", required: false, description: "Credential-redacted message detail beyond the preview. Its protected record endpoint enforces the 48,000-character input and 64 KiB request limits; generic schema-editor string limits do not apply." },
      { name: "href", type: "string", required: false, max: 300, description: "System notes only: internal click-through path (e.g. /actions/<key>)." },
      { name: "outcome", type: "enum", required: false, values: ["ok", "error"], description: "System notes only: whether the thing being reported succeeded." }
    ],
    example: { type: "new-follower", actorId: "664f1c2a9d3e5b0012345678", actorName: "Rick Deckard" }
  };
  var pushDeviceThingSchema = {
    id: "push-device",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Push Device",
    summary: "A protected APNs delivery target owned by one Thingtime account.",
    detail: "Registered only through /api/v1/notifications/devices. The public crystal contains platform, environment, and server-selected topic metadata; the APNs token is encrypted-at-rest-compatible binary secure data and is never returned by the API or exposed through generic Thing CRUD.",
    createdVia: "POST /api/v1/notifications/devices",
    fields: [
      { name: "platform", type: "enum", required: true, values: ["ios", "watchos"], description: "Apple device family." },
      { name: "environment", type: "enum", required: true, values: ["sandbox", "production"], description: "APNs gateway environment." },
      { name: "topic", type: "string", required: true, description: "Server-selected application bundle topic." }
    ],
    example: { platform: "watchos", environment: "sandbox", topic: "com.thingtime.appletime.watchkitapp" }
  };
  var MAX_FOLDER_NAME_CHARS = 120;
  var MAX_FOLDER_ICON_CHARS = 32;
  var MAX_FOLDER_DESCRIPTION_CHARS = 500;
  var folderSchema = {
    id: "folder",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Folder",
    summary: "A Drive-style folder for organising your things on /things.",
    detail: 'Folders organise the /things page: any of your things (posts, data, schemas, other folders) can carry a folderId pointing at one of YOUR folder things \u2014 moving is just rewriting that pointer (PATCH /api/v1/things { id, folderId } or POST /api/v1/things/bulk). Folders nest; moves cycle-check the chain. Deleting a folder never deletes its contents \u2014 they re-parent to the deleted folder\u2019s parent. Folders default private (acl ["tt:user"]): how you organise your things is yours even when the things themselves are public.',
    fields: [
      { name: "name", type: "string", required: true, max: MAX_FOLDER_NAME_CHARS, description: "Folder display name." },
      { name: "icon", type: "string", required: false, max: MAX_FOLDER_ICON_CHARS, description: "Optional emoji shown instead of the default \u{1F4C1}." },
      { name: "description", type: "string", required: false, max: MAX_FOLDER_DESCRIPTION_CHARS, description: "Optional note about what lives here." }
    ],
    example: { name: "Recipes", icon: "\u{1F35C}", description: "Everything I want to cook someday." }
  };
  var sessionSchema = {
    id: "session",
    version: COLLECTION_SCHEMA_VERSIONS.sessions,
    kind: "collection",
    collection: "sessions",
    title: "Session",
    summary: "A revocable login session backing a JWT (jti).",
    detail: "Mongo is the source of truth for whether a token is still live \u2014 revoking flips revokedAt.",
    fields: [
      { name: "jti", type: "id", required: true, description: "Unique token id carried in the JWT." },
      { name: "userId", type: "id", required: true, description: "The session owner." },
      { name: "type", type: "string", required: true, values: ["tt.session"], description: "Doc type tag." },
      {
        name: "purpose",
        type: "enum",
        required: false,
        values: ["browser", "service", "app", "app-sandbox", "pat", "oauth-code"],
        description: "Browser cookie session, service Bearer token, app-scoped grant, sandbox grant, personal access token, or one-time desktop OAuth code."
      },
      {
        name: "expiresAt",
        type: "date",
        required: false,
        description: "Expiry (null = non-expiring service token). Revoking a non-expiring session stamps a reap date here so the TTL index can clear the dead row; an existing expiry is never overwritten."
      },
      { name: "revokedAt", type: "date", required: false, description: "Set when revoked \u2014 token stops working immediately." },
      { name: "meta", type: "record", required: false, description: "Session metadata." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." },
      { name: "createdAt", type: "date", required: true, description: "Login time." }
    ],
    example: { jti: "f0e1d2c3-...", userId: "664f1c2a9d3e5b0012345678", type: "tt.session", purpose: "browser", schemaVersion: 2 }
  };
  var emailVerificationSchema = {
    id: "email-verification",
    version: COLLECTION_SCHEMA_VERSIONS.emailVerifications,
    kind: "collection",
    collection: "emailVerifications",
    title: "Email verification",
    summary: "A pending email-verification token.",
    detail: "Consumed by GET /api/v1/auth/verify-email; expires after 24h (7d for service accounts).",
    fields: [
      { name: "token", type: "string", required: true, description: "Unique 64-hex token." },
      { name: "userId", type: "id", required: true, description: "User being verified." },
      { name: "email", type: "string", required: true, description: "Email the token was sent to." },
      { name: "expiresAt", type: "date", required: true, description: "Expiry." },
      { name: "consumedAt", type: "date", required: false, description: "Set once used." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." },
      { name: "createdAt", type: "date", required: true, description: "Issue time." }
    ],
    example: { token: "ab12\u202664hex", userId: "664f\u2026", email: "rick@example.com", schemaVersion: 2 }
  };
  var passwordResetSchema = {
    id: "password-reset",
    version: COLLECTION_SCHEMA_VERSIONS.passwordResets,
    kind: "collection",
    collection: "passwordResets",
    title: "Password reset",
    summary: "A pending single-use password-reset token.",
    detail: "Created by POST /api/v1/auth/password-reset and burned atomically by /confirm; expires after one hour (TTL index reaps the doc). Consuming one rotates the bcrypt hash and revokes every live session.",
    fields: [
      { name: "token", type: "string", required: true, description: "Unique single-use token (two UUIDs, ~256 bits)." },
      { name: "userId", type: "id", required: true, description: "User being reset." },
      { name: "email", type: "string", required: true, description: "Address the link was sent to." },
      { name: "expiresAt", type: "date", required: true, description: "Expiry (1h) \u2014 TTL index reaps the doc." },
      { name: "consumedAt", type: "date", required: false, description: "Set once used; racing submits burn exactly one." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." },
      { name: "createdAt", type: "date", required: true, description: "Request time." }
    ],
    example: { token: "ab12\u202664hex", userId: "664f\u2026", email: "rick@example.com", schemaVersion: 2 }
  };
  var authOtpSchema = {
    id: "auth-otp",
    version: COLLECTION_SCHEMA_VERSIONS.authOtps,
    kind: "collection",
    collection: "authOtps",
    title: "Auth OTP challenge",
    summary: "A pending email-2FA login challenge \u2014 only a hash of the code is stored.",
    detail: "Minted when an email-2FA account passes the password step of POST /api/v1/login. Stores sha256(challenge:code) \u2014 never the code \u2014 with a 10-minute TTL and an attempt counter incremented atomically BEFORE each constant-time comparison (capped at 5).",
    fields: [
      { name: "challenge", type: "string", required: true, description: "Unique challenge id returned to the client." },
      { name: "userId", type: "id", required: true, description: "User completing login." },
      { name: "purpose", type: "enum", required: true, values: ["login"], description: "What the code proves." },
      { name: "codeHash", type: "string", required: true, description: "sha256(challenge:code) \u2014 plaintext codes are never stored." },
      { name: "attempts", type: "number", required: true, description: "Verification attempts so far (max 5, incremented pre-compare)." },
      { name: "expiresAt", type: "date", required: true, description: "Expiry (10 min) \u2014 TTL index reaps the doc." },
      { name: "consumedAt", type: "date", required: false, description: "Set once the login completes." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." },
      { name: "createdAt", type: "date", required: true, description: "Challenge mint time." }
    ],
    example: { challenge: "cd34\u202664hex", userId: "664f\u2026", purpose: "login", attempts: 0, schemaVersion: 2 }
  };
  var emailMessageSchema = {
    id: "email-message",
    version: COLLECTION_SCHEMA_VERSIONS.email_messages,
    kind: "collection",
    collection: "email_messages",
    title: "Email message (outbox)",
    summary: "One row per email send \u2014 queued, then sent/logged/skipped/failed.",
    detail: "The owned email layer writes every send here before delivery (SES or console), then stamps the outcome. Satellite collections back deliverability: email_events (provider events), email_suppression_list + email_unsubscribes (list hygiene, checked before every send), and email_templates/email_subscriptions/email_identities (reserved for the owned-email roadmap).",
    fields: [
      { name: "provider", type: "enum", required: true, values: ["console", "ses"], description: "Delivery provider resolved from env." },
      {
        name: "stream",
        type: "enum",
        required: true,
        values: ["transactional", "newsletter"],
        description: "Send stream \u2014 picks the from-address and unsubscribe rules."
      },
      { name: "templateKey", type: "string", required: false, description: "Dotted template id, e.g. auth.password_reset." },
      {
        name: "status",
        type: "enum",
        required: true,
        values: ["queued", "sent", "logged", "skipped", "failed"],
        description: "Delivery lifecycle state."
      },
      { name: "from", type: "string", required: true, description: "From address used." },
      { name: "replyTo", type: "string", required: false, description: "Reply-to address (null when unset)." },
      { name: "to", type: "string[]", required: true, description: "Normalized recipient list." },
      { name: "subject", type: "string", required: true, description: "Subject line." },
      { name: "html", type: "string", required: true, description: "Rendered HTML body \u2014 replaced by a redacted placeholder when sensitive is true." },
      { name: "text", type: "string", required: true, description: "Rendered text body \u2014 replaced by a redacted placeholder when sensitive is true." },
      {
        name: "sensitive",
        type: "boolean",
        required: true,
        description: "True for secret-bearing mail (OTP codes, reset links); its body is stored redacted so the outbox can\u2019t replay the secret."
      },
      { name: "metadata", type: "record", required: false, description: "Purpose tags for analytics (never secrets)." },
      { name: "tags", type: "record", required: false, description: "Provider tags ({ stream, template })." },
      { name: "providerMessageId", type: "string", required: false, description: "SES message id when delivered." },
      {
        name: "suppressedRecipients",
        type: "string[]",
        required: false,
        description: "Recipients dropped for suppression/unsubscribe (set only when some were skipped)."
      },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." },
      { name: "createdAt", type: "date", required: true, description: "Queue time." },
      {
        name: "updatedAt",
        type: "date",
        required: true,
        description: "Last status change (sentAt/loggedAt/failedAt/skippedAt + error/skippedReason ride alongside per outcome)."
      }
    ],
    example: { provider: "console", stream: "transactional", templateKey: "auth.email_otp", status: "logged", schemaVersion: 2 }
  };
  var rateLimitSchema = {
    id: "rate-limit",
    version: COLLECTION_SCHEMA_VERSIONS.lopuMusingRateLimits,
    kind: "collection",
    collection: "lopuMusingRateLimits",
    title: "Rate-limit window",
    summary: "Sliding/fixed rate-limit windows keyed by hashed IP.",
    detail: "Two shapes share this collection: Lopu musing quotas (requests: Date[] sliding window) and waitlist join counters (count: number fixed window). Both expire via the TTL index on expiresAt.",
    fields: [
      { name: "key", type: "string", required: true, description: "Unique window key (sha256 of IP, optionally prefixed)." },
      { name: "expiresAt", type: "date", required: true, description: "TTL expiry." },
      { name: "requests", type: "object", required: false, description: "Sliding-window request timestamps (musing shape)." },
      { name: "count", type: "number", required: false, description: "Fixed-window counter (waitlist shape)." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." }
    ],
    example: { key: "waitlist:9f2c\u2026", count: 3, schemaVersion: 2 }
  };
  var deploymentPeerSchema = {
    id: "deployment-peer",
    version: COLLECTION_SCHEMA_VERSIONS.deploymentPeers,
    kind: "collection",
    collection: "deploymentPeers",
    title: "Deployment peer lease",
    summary: "One bounded, expiring control-plane lease for each trusted Thingtime deployment origin.",
    detail: "Peer rows are relational control-plane records, not user Things. They are accepted only from deployments that hold the shared discovery secret, contain no account data, and expire quickly unless the peer announces again.",
    fields: [
      { name: "origin", type: "string", required: true, description: "Canonical HTTPS deployment origin; unique." },
      { name: "signingPublicKey", type: "string", required: true, description: "Pinned Ed25519 public key for signed peer traffic." },
      { name: "firstSeenAt", type: "date", required: true, description: "First accepted announcement." },
      { name: "lastSeenAt", type: "date", required: true, description: "Most recent accepted announcement." },
      { name: "expiresAt", type: "date", required: true, description: "TTL lease expiry." },
      { name: "syncCursor", type: "string", required: false, description: "Private bounded traversal cursor for the next remote peer page; never projected to peers." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." }
    ],
    example: { origin: "https://pr-68.previews.dev.thingtime.com", signingPublicKey: "<base64url-ed25519-spki>", lastSeenAt: "2026-08-24T00:00:00.000Z", schemaVersion: 1 }
  };
  var adminIntegrationSecretSchema = {
    id: "admin-integration-secret",
    version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationSecrets,
    kind: "collection",
    collection: "adminIntegrationSecrets",
    title: "Admin integration secret vault entry",
    summary: "Admin-only AES-256-GCM encrypted external credential; its value is never projected by an API.",
    detail: "Endpoint policies reference the credential through an opaque id. Ciphertext, IV, and authentication tag remain server-only; deleting is blocked while an endpoint references the secret.",
    fields: [
      { name: "id", type: "string", required: true, description: "Opaque vault id." },
      { name: "label", type: "string", required: true, description: "Non-sensitive operator label." },
      { name: "cipherText", type: "string", required: true, description: "AES-GCM ciphertext. Never projected." },
      { name: "iv", type: "string", required: true, description: "AES-GCM nonce. Never projected." },
      { name: "tag", type: "string", required: true, description: "AES-GCM auth tag. Never projected." },
      { name: "createdAt", type: "date", required: true, description: "Creation time." },
      { name: "updatedAt", type: "date", required: true, description: "Rotation time." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." }
    ],
    example: { id: "secret_example", label: "Vercel write-only token", cipherText: "<encrypted>", schemaVersion: 1 }
  };
  var lopuCredentialSchema = {
    id: "lopu-credential",
    version: COLLECTION_SCHEMA_VERSIONS.lopuCredentials,
    kind: "collection",
    collection: "lopuCredentials",
    title: "Lopu ordered credential vault entry",
    summary: "Named Claude credential encrypted with AES-256-GCM and ordered for Lopu usage failover.",
    detail: "The browser receives metadata only. Credential values are decrypted solely for a fresh, replay-protected HMAC request from the protected GitHub Actions control plane.",
    fields: [
      { name: "id", type: "string", required: true, description: "Opaque credential id." },
      { name: "name", type: "string", required: true, description: "Non-sensitive admin label." },
      { name: "credentialType", type: "string", required: true, description: "Closed credential type." },
      { name: "cipherText", type: "string", required: true, description: "AES-GCM ciphertext. Never projected to a browser." },
      { name: "iv", type: "string", required: true, description: "AES-GCM nonce. Never projected." },
      { name: "tag", type: "string", required: true, description: "AES-GCM authentication tag. Never projected." },
      { name: "priority", type: "number", required: true, description: "Zero-based waterfall position." },
      { name: "enabled", type: "boolean", required: true, description: "Whether Lopu may use the credential." },
      { name: "createdAt", type: "date", required: true, description: "Creation time." },
      { name: "updatedAt", type: "date", required: true, description: "Last metadata or value change." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." }
    ],
    example: { id: "lopu_credential_example", name: "Thingtime Claude", credentialType: "claude-code-oauth-token", priority: 0, enabled: true, cipherText: "<encrypted>", schemaVersion: 1 }
  };
  var adminIntegrationEndpointSchema = {
    id: "admin-integration-endpoint",
    version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationEndpoints,
    kind: "collection",
    collection: "adminIntegrationEndpoints",
    title: "Admin integration endpoint policy",
    summary: "Admin-managed upstream origin, closed paths, credential reference, and read/write permission policy.",
    detail: "The proxy receives an endpoint id rather than an arbitrary URL. It enforces the selected read, create-only, or full-write mode before decrypting the referenced credential.",
    fields: [
      { name: "id", type: "string", required: true, description: "Opaque endpoint id." },
      { name: "origin", type: "string", required: true, description: "Allowlisted HTTPS upstream origin." },
      { name: "secretId", type: "string", required: true, description: "Referenced vault id." },
      { name: "allowedPathPrefixes", type: "string[]", required: true, description: "Closed upstream path prefixes." },
      { name: "allowRead", type: "boolean", required: true, description: "Whether GET through the proxy is permitted." },
      { name: "writeMode", type: "enum", required: true, values: ["none", "create-only", "write"], description: "Allowed write policy." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." }
    ],
    example: {
      id: "endpoint_example",
      origin: "https://api.vercel.com",
      secretId: "secret_example",
      allowedPathPrefixes: ["/v9/projects"],
      allowRead: true,
      writeMode: "create-only",
      schemaVersion: 1
    }
  };
  var adminIntegrationClaimSchema = {
    id: "admin-integration-claim",
    version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationClaims,
    kind: "collection",
    collection: "adminIntegrationClaims",
    title: "Admin integration create-only claim",
    summary: "Short-lived relational lock preventing concurrent create-only requests for the same provider resource.",
    detail: "Claims contain a derived provider resource identity but never a credential or request body. They expire automatically and are removed after each completed proxy call.",
    fields: [
      { name: "endpointId", type: "string", required: true, description: "Saved endpoint policy id." },
      { name: "resourceKey", type: "string", required: true, description: "Bounded provider-specific create identity." },
      { name: "createdAt", type: "date", required: true, description: "Claim creation time." },
      { name: "expiresAt", type: "date", required: true, description: "TTL expiry time." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." }
    ],
    example: { endpointId: "endpoint_example", resourceKey: "project:ENV_KEY:production", expiresAt: "2026-08-24T00:02:00.000Z", schemaVersion: 1 }
  };
  var adminIntegrationAuditSchema = {
    id: "admin-integration-audit",
    version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationAudit,
    kind: "collection",
    collection: "adminIntegrationAudit",
    title: "Admin integration proxy audit event",
    summary: "Redacted, expiring control-plane evidence for a policy-proxied external call.",
    detail: "Audit rows record endpoint, operation, path, status, and coarse outcome only. Credentials, request bodies, response bodies, and provider secret values are never stored here.",
    fields: [
      { name: "id", type: "string", required: true, description: "Opaque audit event id." },
      { name: "endpointId", type: "string", required: true, description: "Saved endpoint policy id." },
      { name: "operation", type: "enum", required: true, values: ["read", "create", "write"], description: "Policy operation." },
      { name: "path", type: "string", required: true, description: "Allowed upstream path without query values." },
      { name: "status", type: "number", required: true, description: "Upstream status or policy-block code." },
      { name: "outcome", type: "enum", required: true, values: ["allowed", "blocked", "failed"], description: "Coarse result." },
      { name: "createdAt", type: "date", required: true, description: "Event time." },
      { name: "expiresAt", type: "date", required: true, description: "TTL expiry time." },
      { name: "schemaVersion", type: "number", required: true, description: "Collection schema version." }
    ],
    example: {
      id: "audit_example",
      endpointId: "endpoint_example",
      operation: "create",
      path: "/v10/projects/example/env",
      status: 200,
      outcome: "allowed",
      schemaVersion: 1
    }
  };
  var appSchema = {
    id: "app",
    version: 3,
    kind: "crystal",
    collection: null,
    title: "App",
    summary: 'A registered third-party app that can embed "Login with Thingtime".',
    detail: "Created only through /api/v1/apps (no generic-route sanitizer on purpose \u2014 the server mints the clientId and validates the origin allowlist, so neither can be forged through /api/v1/things). The clientId identifies the app to the embed SDK; origins is the exact list of web origins allowed to open the authorize popup and receive tokens. The subscription tier and optional admin override determine storageAllowanceBytes; storageUsedBytes is the atomic aggregate ledger. The app owner controls userStorageAllowanceBytes as the default app-user cap, while protected relational app-storage Things hold individual overrides. Deleting the app revokes every app-scoped session minted for it.",
    fields: [
      { name: "clientId", type: "id", required: true, description: "Server-minted public app id (ttapp_<uuid>) used by the embed SDK." },
      {
        name: "name",
        type: "string",
        required: true,
        max: MAX_APP_NAME_CHARS,
        description: `App name shown on the consent screen, max ${MAX_APP_NAME_CHARS} chars.`
      },
      {
        name: "origins",
        type: "string[]",
        required: true,
        max: MAX_APP_ORIGINS,
        description: `Allowed web origins (https, or http for localhost dev), max ${MAX_APP_ORIGINS}. One * wildcard is allowed in the leftmost host label for preview deploys (e.g. https://myapp-*-myteam.vercel.app); it never crosses a dot. Per the Public Suffix List: on multi-tenant hosts (vercel.app, netlify.app, \u2026) the star label must END with your platform-appended slug, and public suffixes (co.uk, \u2026) take no wildcard at all.`
      },
      { name: "nativeRedirectUris", type: "string[]", required: false, max: MAX_APP_ORIGINS, description: "Exact installed-app OAuth callbacks, e.g. com.example.app://oauth/callback. Separate from web origins; no wildcards." },
      { name: "subscriptionTier", type: "string", required: true, description: "Stable app storage tier id." },
      { name: "subscriptionTierVersionId", type: "id", required: true, description: "Immutable subscription-tier revision assigned to this app." },
      { name: "subscriptionTierVersion", type: "number", required: true, min: 1, description: "Revision number of the assigned tier." },
      {
        name: "storageAllowanceBytes",
        type: "number",
        required: true,
        description: "Server-owned aggregate app-data allowance across every user of this app, in bytes; null is metered/unlimited."
      },
      {
        name: "storageAllowanceOverrideBytes",
        type: "number",
        required: false,
        description: "Optional administrator plan override; null means metered/unlimited."
      },
      {
        name: "storageUsedBytes",
        type: "number",
        required: true,
        description: "Bytes currently charged across every non-sandbox namespace owned by this app."
      },
      {
        name: "userStorageAllowanceBytes",
        type: "number",
        required: true,
        description: "App-owner-managed default allowance for each individual app user, in bytes."
      },
      { name: "storageAccountingVersion", type: "number", required: true, description: "Enables fail-closed quota writes after reconciliation." }
    ],
    example: {
      clientId: "ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f",
      name: "Rainbow Notes",
      origins: ["https://rainbownotes.example"],
      nativeRedirectUris: ["com.rainbownotes.app://oauth/callback"],
      subscriptionTier: "free",
      subscriptionTierVersionId: "subscription-tier-free-v1",
      subscriptionTierVersion: 1,
      storageAllowanceBytes: DEFAULT_APP_STORAGE_ALLOWANCE_BYTES,
      storageUsedBytes: 0,
      userStorageAllowanceBytes: DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES,
      storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION
    }
  };
  var appDataSchema = {
    id: "app-data",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "App data",
    summary: "A key/value entry a third-party app stores in a user's Thingtime account.",
    detail: `Written only through /api/v1/app-data with an app-scoped Bearer token (no generic-route sanitizer on purpose), one thing per (user, app, key) \u2014 relational, atomic, and bounded per FUNDAMENTALS.md \xA73: values cap at ${MAX_APP_DATA_VALUE_BYTES / 1024} KiB of JSON and the (user, app) namespace starts with a ${DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES / (1024 * 1024)} MiB app-managed storage allowance inside the app's ${DEFAULT_APP_STORAGE_ALLOWANCE_BYTES / (1024 * 1024 * 1024)} GiB free-tier aggregate allowance (unlimited entry count). Owned by the END USER (acl ["tt:user"]), not the app developer, so users can see and delete what an app has stored for them.`,
    fields: [
      { name: "appId", type: "id", required: true, description: "The clientId of the app this entry belongs to." },
      {
        name: "key",
        type: "string",
        required: true,
        max: MAX_APP_DATA_KEY_CHARS,
        description: `Entry key ([A-Za-z0-9._:-], first char alphanumeric, max ${MAX_APP_DATA_KEY_CHARS} chars).`
      },
      { name: "value", type: "record", required: true, description: `Arbitrary JSON value, max ${MAX_APP_DATA_VALUE_BYTES / 1024} KiB serialized.` }
    ],
    example: { appId: "ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f", key: "preferences", value: { theme: "rainbow" } }
  };
  var communitySchema = {
    id: "community",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Community",
    summary: "A Slack-style workspace that groups channels, members and custom emojis.",
    detail: 'Created through POST /api/v1/communities. Channels (chat things with chatType "channel") and sidebar sections link back via targetId; membership is relational community-member things (never an embedded member array). Invites mint community-invite things with single-use-or-capped codes.',
    createdVia: "POST /api/v1/communities",
    fields: [
      { name: "name", type: "string", required: true, max: MAX_COMMUNITY_NAME_CHARS, description: "Community name." },
      { name: "description", type: "string", required: false, max: MAX_COMMUNITY_DESCRIPTION_CHARS, description: "Optional description." }
    ],
    example: { name: "Rainbow Makers", description: "Everything rainbow." }
  };
  var communityMemberSchema = {
    id: "community-member",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Community member",
    summary: "One user's membership of one community (relational child doc).",
    detail: "targetId = the community shareId, ownerId = the member. Uniqueness rides the single crystal.memberKey field (`<communityId>:<userId>`, partial unique index) \u2014 the reaction-index pattern. Roles: owner > admin > member.",
    createdVia: "POST /api/v1/communities (creator) / POST /api/v1/communities/join (invite code)",
    fields: [
      { name: "memberKey", type: "string", required: true, description: "Unique `<communityId>:<userId>` pair key." },
      { name: "role", type: "enum", required: true, values: ["owner", "admin", "member"], description: "Community role." }
    ],
    example: { memberKey: "c0ffee\u2026:5eed\u2026", role: "member" }
  };
  var communityInviteSchema = {
    id: "community-invite",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Community invite",
    summary: "An invite code that lets a user join a community.",
    detail: "targetId = the community shareId. The code is server-minted, unique via a partial index on crystal.inviteCode, optionally expiring and use-capped; redemption is atomic (uses is incremented with a guard, never read-modify-write).",
    createdVia: "POST /api/v1/communities/invites",
    fields: [
      { name: "inviteCode", type: "string", required: true, description: "Server-minted redemption code." },
      { name: "uses", type: "number", required: true, description: "Times redeemed so far." },
      { name: "maxUses", type: "number", required: false, description: "Redemption cap (null = unlimited)." },
      { name: "expiresAt", type: "string", required: false, description: "ISO expiry (null = never)." },
      { name: "revoked", type: "boolean", required: false, description: "True once revoked by an admin." }
    ],
    example: { inviteCode: "tt-inv-8f2a4c3d9e5b", uses: 0, maxUses: 25 }
  };
  var chatSectionSchema = {
    id: "chat-section",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Chat section",
    summary: "A named sidebar group that community channels can be filed under.",
    detail: "targetId = the community shareId. Pure organisation \u2014 deleting a section un-files its channels.",
    createdVia: "POST /api/v1/communities/sections",
    fields: [
      { name: "name", type: "string", required: true, max: MAX_SECTION_NAME_CHARS, description: "Section name." },
      { name: "order", type: "number", required: true, description: "Sort position within the sidebar." }
    ],
    example: { name: "Announcements", order: 0 }
  };
  var chatSchema = {
    id: "chat",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Chat",
    summary: "A conversation: a community channel, a standalone group, or a direct message.",
    detail: "Created through POST /api/v1/chats. Membership, roles, nicknames and read receipts are relational chat-member things; messages are relational chat-message things. DMs are deduped by crystal.dmKey (sorted participant ids, partial unique index). Channels link their community via targetId + crystal.communityId and can be public (any community member may join) or private (admins add).",
    createdVia: "POST /api/v1/chats",
    fields: [
      {
        name: "name",
        type: "string",
        required: false,
        max: MAX_CHAT_NAME_CHARS,
        description: "Chat name (null for DMs \u2014 the UI shows the other member)."
      },
      { name: "topic", type: "string", required: false, max: MAX_CHAT_TOPIC_CHARS, description: "Channel topic line." },
      { name: "chatType", type: "enum", required: true, values: ["channel", "group", "dm"], description: "Conversation shape." },
      { name: "communityId", type: "id", required: false, description: "Owning community shareId (channels only)." },
      { name: "sectionId", type: "id", required: false, description: "Sidebar section shareId (channels only)." },
      {
        name: "channelVisibility",
        type: "enum",
        required: false,
        values: ["public", "private"],
        description: "Channel joinability within its community (channels only, default public)."
      },
      { name: "dmKey", type: "string", required: false, description: "Sorted participant-id pair key deduping DMs." }
    ],
    example: { name: "general", topic: "Anything goes", chatType: "channel", channelVisibility: "public" }
  };
  var chatMemberSchema = {
    id: "chat-member",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Chat member",
    summary: "One user's membership of one chat \u2014 role, nickname, request state and read receipt.",
    detail: 'targetId = the chat shareId, ownerId = the member. Unique per (chat, user) via crystal.memberKey. state tracks the Messenger request flow: active, pending (message request awaiting accept), left, declined. requestOrigin buckets pending DMs into "follower" (the sender follows you) vs "unknown". lastReadMessageId/lastReadAt are the read receipt \u2014 one atomic doc per member, never an array on the chat.',
    createdVia: "POST /api/v1/chats / POST /api/v1/chats/members",
    fields: [
      { name: "memberKey", type: "string", required: true, description: "Unique `<chatId>:<userId>` pair key." },
      { name: "role", type: "enum", required: true, values: ["owner", "admin", "member"], description: "Chat role." },
      { name: "nickname", type: "string", required: false, max: MAX_NICKNAME_CHARS, description: "Per-chat nickname (Messenger style)." },
      {
        name: "state",
        type: "enum",
        required: true,
        values: ["active", "pending", "left", "declined"],
        description: "Membership lifecycle / message-request state."
      },
      { name: "requestOrigin", type: "enum", required: false, values: ["follower", "unknown"], description: "Message-request bucket while pending." },
      { name: "lastReadMessageId", type: "id", required: false, description: "Newest message this member has read." },
      { name: "lastReadAt", type: "string", required: false, description: "ISO timestamp of that read (drives unread counts + seen-by)." },
      { name: "muted", type: "boolean", required: false, description: "Suppress notifications for this chat." }
    ],
    example: { memberKey: "cha7\u2026:5eed\u2026", role: "member", state: "active" }
  };
  var chatMessageSchema = {
    id: "chat-message",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Chat message",
    summary: "One message in a chat \u2014 the post shape adapted for conversations.",
    detail: "targetId = the chat shareId. Deliberately NOT a post kind, so messages can never surface in feeds or profiles; visibility is chat membership, enforced by the messenger endpoints. threadRootId threads Slack-style replies under a root message; replyToId quotes a message Messenger-style. Deleting is soft (deletedAt + text cleared) so threads keep their shape. System events (member added, renamed\u2026) are messages with systemType. Reactions are the standard reaction things targeting the message, including custom `custom:<emoji id>` tokens.",
    createdVia: "POST /api/v1/chats/messages",
    fields: [
      {
        name: "text",
        type: "string",
        required: false,
        max: MAX_MESSAGE_CHARS,
        description: `Optional message text, max ${MAX_MESSAGE_CHARS} chars. A message may instead contain one or more bound attachments. :name: tokens render as custom emojis.`
      },
      { name: "threadRootId", type: "id", required: false, description: "Root message shareId when this is a thread reply." },
      { name: "replyToId", type: "id", required: false, description: "Quoted message shareId (inline reply)." },
      { name: "editedAt", type: "string", required: false, description: "ISO timestamp of the last edit." },
      { name: "deletedAt", type: "string", required: false, description: "ISO soft-delete timestamp (text is cleared)." },
      {
        name: "systemType",
        type: "enum",
        required: false,
        values: ["member-added", "member-left", "member-removed", "chat-renamed", "chat-created", "topic-changed"],
        description: "Set on system event messages."
      },
      { name: "systemMeta", type: "record", required: false, description: "Event payload for system messages ({ subjectId, value\u2026 })." }
    ],
    example: { text: "hello from the messenger \u{1F44B}" }
  };
  var aiModelSchema = {
    id: "ai-model",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "AI model",
    summary: "One catalog model Lopu can chat with \u2014 provider, effort tiers, speeds, and the admin enabled toggle.",
    detail: 'Written only by the catalog seed (api/utils/ai/models.ts): ownerId "system", storageClass "control", acl ["tt:all"], deterministic shareId ai-model-<modelId>, root uniqueKeys aiModel:<modelId>. The seed runs once per process on the first catalog read and on demand through POST /api/v1/admin/ai/models { seed: true }; it inserts missing rows and heals drifted catalog fields but never touches enabled. GET /api/v1/ai/models projects every row publicly with available = enabled && provider key configured; POST /api/v1/admin/ai/models { id, enabled } is the only writer of the toggle. Direct create/update/delete through the generic things routes is refused and the rows never appear in generic listings.',
    createdVia: "Seeded by api/utils/ai/models.ts (first catalog read, or POST /api/v1/admin/ai/models { seed: true })",
    fields: [
      { name: "modelId", type: "string", required: true, max: 128, description: "Provider-native model id; equals the catalog id and the shareId suffix." },
      { name: "label", type: "string", required: true, max: 80, description: "Display label from the catalog." },
      { name: "provider", type: "enum", required: true, values: ["anthropic", "openai"], description: "Which API serves the model." },
      { name: "efforts", type: "string[]", required: true, max: 8, description: "Selectable reasoning-effort tiers; empty means provider-default effort only." },
      { name: "speeds", type: "string[]", required: true, max: 2, description: "Offered lanes: normal, plus fast where the provider sells one." },
      { name: "family", type: "enum", required: true, values: ["claude", "gpt", "o-series"], description: "Derived model family for grouping in pickers." },
      { name: "enabled", type: "boolean", required: true, description: "Admin toggle; a disabled model is listed but never selectable." },
      { name: "sortOrder", type: "number", required: true, min: 0, description: "Position in the base-model catalog." },
      { name: "contextWindow", type: "number", required: false, min: 1, description: "Context window in tokens when the catalog knows it." },
      { name: "notes", type: "string", required: false, max: 500, description: "Optional admin note." }
    ],
    example: {
      modelId: "claude-opus-5",
      label: "Claude Opus 5",
      provider: "anthropic",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      speeds: ["normal", "fast"],
      family: "claude",
      enabled: true,
      sortOrder: 2,
      contextWindow: 1e6
    }
  };
  var lopuAccountSchema = {
    id: "lopu-account",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Lopu account",
    summary: "One per user \u2014 the Lopu credit balance plus lifetime and monthly usage counters.",
    detail: 'Created lazily by ensureLopuAccount (the first gated Lopu turn or GET /api/v1/lopu/account), which grants the Thingtime.LopuAccess starterCredits exactly once. ownerId = the user, acl ["tt:user"], storageClass "control", root uniqueKeys lopuAccount:<userId>. Every debit is ONE $inc on this row (balance, lifetime, month \u2014 the month counters reset when monthKey moves on), guarded by the write id in appliedIds so a retried $inc cannot land twice; the balance may go negative by at most one turn and the next turn is refused with 402 LOPU_NO_CREDITS. A billed turn also holds an inflight slot for as long as the provider call runs (429 LOPU_TURN_IN_FLIGHT past the cap), so concurrent turns cannot each spend the same last credit. 1 credit = 1 USD of list price = 1,000,000 micros.',
    createdVia: "api/utils/lopu/accounting.ts ensureLopuAccount (first gated Lopu turn, GET /api/v1/lopu/account, admin credit grant)",
    fields: [
      { name: "balanceMicros", type: "number", required: true, description: "Current credit balance in micro-USD (signed; negative by at most one turn)." },
      { name: "lifetimeCostMicros", type: "number", required: true, min: 0, description: "Micros ever debited from this account." },
      { name: "lifetimeInputTokens", type: "number", required: true, min: 0, description: "Input tokens across every recorded turn (all billings)." },
      { name: "lifetimeOutputTokens", type: "number", required: true, min: 0, description: "Output tokens across every recorded turn (all billings)." },
      { name: "turns", type: "number", required: true, min: 0, description: "Recorded turns (chat, voice, voice sessions)." },
      { name: "monthKey", type: "string", required: true, max: 7, description: "UTC month the month counters belong to (YYYY-MM)." },
      { name: "monthCostMicros", type: "number", required: true, min: 0, description: "Micros debited in monthKey." },
      { name: "monthTurns", type: "number", required: true, min: 0, description: "Turns recorded in monthKey." },
      { name: "starterGranted", type: "boolean", required: true, description: "The one-time starter grant was applied (also true when starterCredits was 0)." },
      { name: "starterMicros", type: "number", required: true, min: 0, description: "The starter amount that was granted, in micros." },
      { name: "lowBalanceNotifiedAt", type: "string", required: false, max: 40, description: "When the balance last dropped under the low-balance threshold (null once lifted)." },
      { name: "inflight", type: "number", required: false, min: 0, description: "Billed turns currently running for this account (the concurrency cap the gate enforces)." },
      { name: "inflightSince", type: "string", required: false, max: 40, description: "When a slot was last taken \u2014 a slot older than the TTL is swept by the next reservation." },
      { name: "appliedIds", type: "string[]", required: false, max: 8, description: "The last few write ids applied to the balance (bounded by $slice) so a retried $inc is a no-op." }
    ],
    example: {
      balanceMicros: 14e5,
      lifetimeCostMicros: 6e5,
      lifetimeInputTokens: 300,
      lifetimeOutputTokens: 150,
      turns: 1,
      monthKey: "2026-09",
      monthCostMicros: 6e5,
      monthTurns: 1,
      starterGranted: true,
      starterMicros: 2e6
    }
  };
  var lopuUsageSchema = {
    id: "lopu-usage",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Lopu usage",
    summary: "One row per Lopu turn \u2014 tokens, the list price, and what was actually debited.",
    detail: 'Written by debitLopuUsage after every chat reply, voice turn and direct-voice session (ownerId = the user, acl ["tt:user"], storageClass "control"; the chat row\u2019s shareId derives from the requestId so a retried debit never doubles). billing says who paid: "thingtime" (server keys \u2014 debited), "byo" (the viewer\u2019s own Secure Vault provider \u2014 recorded, never debited) or "free" (the canned fallback). costMicros is the list price from api/utils/ai/pricing.ts (priced: false for a model outside the pricing table, estimated: true for a sibling-priced row); debitedMicros is the amount taken from the account. Listed through GET /api/v1/lopu/account/history beside the debits that point at it.',
    createdVia: "api/utils/lopu/accounting.ts debitLopuUsage (chats reply, voice reply, voice session)",
    fields: [
      { name: "chatId", type: "string", required: false, max: 160, description: "The Lopu conversation (chat turns)." },
      { name: "requestId", type: "string", required: false, max: 160, description: "The client request id of the turn." },
      { name: "surface", type: "enum", required: true, values: ["chat", "voice", "voice-session"], description: "Which Lopu surface ran the turn." },
      { name: "provider", type: "string", required: true, max: 40, description: "claude | openai | vault | test | fallback, or the vault connection kind." },
      { name: "providerLabel", type: "string", required: false, max: 80, description: "The vault connection\u2019s display name (byo turns)." },
      { name: "model", type: "string", required: false, max: 128, description: "The model that answered." },
      { name: "billing", type: "enum", required: true, values: ["thingtime", "byo", "free"], description: "Who paid for the turn." },
      { name: "inputTokens", type: "number", required: true, min: 0, description: "Uncached input tokens." },
      { name: "outputTokens", type: "number", required: true, min: 0, description: "Output tokens." },
      { name: "cacheReadTokens", type: "number", required: true, min: 0, description: "Prompt-cache read tokens when the provider reported them." },
      { name: "cacheWriteTokens", type: "number", required: true, min: 0, description: "Prompt-cache write tokens when the provider reported them." },
      { name: "costMicros", type: "number", required: true, min: 0, description: "List price of the turn in micro-USD." },
      { name: "priced", type: "boolean", required: true, description: "The model has a pricing row." },
      { name: "estimated", type: "boolean", required: true, description: "The pricing row is a sibling estimate." },
      { name: "debitedMicros", type: "number", required: true, min: 0, description: "Micros actually taken from the account (0 for byo / free)." },
      { name: "toolCalls", type: "number", required: true, min: 0, description: "Tool executions in the turn." },
      { name: "hops", type: "number", required: true, min: 0, description: "Model hops in the turn." },
      { name: "durationMs", type: "number", required: true, min: 0, description: "Wall-clock time of the turn." }
    ],
    example: {
      chatId: "lopu-chat-7d1f2c1a-3b7e-4d0a-9c1d-000000000001",
      requestId: "0f7d2c3a-8b1e-4c2d-9a4f-000000000002",
      surface: "chat",
      provider: "claude",
      model: "claude-opus-5",
      billing: "thingtime",
      inputTokens: 1200,
      outputTokens: 380,
      cacheReadTokens: 8e3,
      cacheWriteTokens: 0,
      costMicros: 19500,
      priced: true,
      estimated: false,
      debitedMicros: 19500,
      toolCalls: 2,
      hops: 3,
      durationMs: 8400
    }
  };
  var lopuCreditSchema = {
    id: "lopu-credit",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Lopu credit ledger row",
    summary: "One signed movement of a Lopu credit balance, or a top-up request waiting for an admin.",
    detail: 'The ledger (ownerId = the user, acl ["tt:user"], storageClass "control"): entry "starter" (the one-time grant), "grant" / "topup" / "adjust" / "refund" (admin movements through POST /api/v1/admin/lopu/credits, adjust and refund may be negative), "debit" (one per debited turn, usageId points at the lopu-usage row) \u2014 each carrying balanceAfterMicros \u2014 and "request" (POST /api/v1/lopu/account/topup-request: amountMicros is the requested amount, balanceAfterMicros null, requestStatus pending \u2192 approved | declined; while pending the row also carries the root uniqueKeys lopuTopupPending:<userId>, so an account can only have one open request). Newest first through GET /api/v1/lopu/account/history.',
    createdVia: "api/utils/lopu/accounting.ts (ensureLopuAccount, debitLopuUsage, grantLopuCredits, createLopuTopupRequest, resolveLopuTopupRequest)",
    fields: [
      { name: "entry", type: "enum", required: true, values: ["starter", "grant", "topup", "debit", "adjust", "refund", "request"], description: "What kind of movement or request this is." },
      { name: "amountMicros", type: "number", required: true, description: "Signed movement in micro-USD (a request carries the requested amount, positive)." },
      { name: "balanceAfterMicros", type: "number", required: false, description: "The balance after the movement (null on a request)." },
      { name: "reason", type: "string", required: true, max: 300, description: "Why \u2014 the admin\u2019s reason, the turn, or the request kind." },
      { name: "actorId", type: "string", required: true, max: 128, description: 'Who caused it: the admin, the user, or "system".' },
      { name: "usageId", type: "string", required: false, max: 160, description: "The lopu-usage row a debit paid for." },
      { name: "requestId", type: "string", required: false, max: 160, description: "The request row a topup grant answered." },
      { name: "requestStatus", type: "enum", required: false, values: ["pending", "approved", "declined"], description: "Request rows only." },
      { name: "note", type: "string", required: false, max: 500, description: "The user\u2019s note on a request, or the admin\u2019s note on a grant." },
      { name: "resolvedAt", type: "string", required: false, max: 40, description: "When a request was approved or declined." },
      { name: "resolvedBy", type: "string", required: false, max: 128, description: "The admin who resolved a request." },
      { name: "grantedMicros", type: "number", required: false, min: 0, description: "What an approved request actually granted." }
    ],
    example: {
      entry: "debit",
      amountMicros: -19500,
      balanceAfterMicros: 1980500,
      reason: "Chat turn \xB7 claude-opus-5",
      actorId: "64f000000000000000000002",
      usageId: "lopu-usage-3f9c2a1b7d5e4c6a8b0f1e2d3c4b5a69"
    }
  };
  var aiConnectionSchema = {
    id: "ai-connection",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "AI desktop connection",
    summary: "One consented ChatGPT or Claude desktop source linked to Thingtime Messenger.",
    detail: "Created only through /api/v1/ai/connections or an authenticated device live sync. It stores bounded sync status and counts, never provider credentials, cookies, raw local paths or conversation bodies. Projects map to communities, conversations or native sessions to chats, and visible completed messages to relational chat-message Things with hashed source keys for idempotent resync. Live connections expose safe command capabilities and remain writable only through the paired device bridge.",
    createdVia: "POST /api/v1/ai/connections or /api/v1/devices/node/live-sync",
    fields: [
      {
        name: "sourceType",
        type: "enum",
        required: true,
        values: ["imported", "live"],
        description: "Discriminates snapshot imports from a live paired connector."
      },
      { name: "provider", type: "enum", required: true, values: ["chatgpt", "claude"], description: "Source provider." },
      { name: "sourceId", type: "string", required: true, description: "Non-secret desktop source identifier." },
      { name: "deviceId", type: "id", required: false, description: "Paired device for node-originated sources." },
      { name: "connectorId", type: "string", required: false, max: 80, description: "Live connector identifier." },
      { name: "label", type: "string", required: true, description: "User-facing app/profile label." },
      { name: "connectors", type: "string[]", required: true, description: "Bounded connector ids seen for this source." },
      { name: "capabilities", type: "string[]", required: false, max: 64, description: "Safe live connector command capabilities." },
      { name: "status", type: "enum", required: true, values: ["syncing", "connected", "error"], description: "Latest sync state." },
      { name: "readOnly", type: "boolean", required: true, description: "True for imports; false for live connector-backed sessions." },
      { name: "lastSyncAt", type: "string", required: false, description: "Last completed sync timestamp." }
    ],
    example: {
      sourceType: "imported",
      provider: "claude",
      sourceId: "claude-thingtime",
      label: "Claude Thingtime",
      connectors: ["claude-code-local"],
      status: "connected",
      readOnly: true
    }
  };
  var deviceSchema = {
    id: "device",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Mesh device",
    summary: "One paired computer participating in the user\u2019s Thingtime mesh.",
    detail: "Created only by the one-time device pairing flow. The crystal contains bounded, safe display metadata and capability ids; the node credential hash lives only in its scoped session and is never projected. Device rows are protected private user content and count toward account storage.",
    createdVia: "POST /api/v1/devices/pairing/claim",
    fields: [
      { name: "deviceKey", type: "string", required: true, description: "Server-hashed unique owner/device key." },
      { name: "name", type: "string", required: true, max: 120, description: "User-facing computer name." },
      { name: "platform", type: "enum", required: true, values: [...DEVICE_PLATFORMS], description: "Operating-system family; capabilities are negotiated separately." },
      { name: "model", type: "string", required: false, max: 160, description: "Bounded hardware model label." },
      { name: "osVersion", type: "string", required: false, max: 80, description: "Bounded OS version label." },
      { name: "appVersion", type: "string", required: false, max: 80, description: "Thingtime node version." },
      { name: "capabilities", type: "string[]", required: true, max: 64, description: "Allowlisted capability identifiers reported at pairing." },
      { name: "pairedAt", type: "date", required: true, description: "Server pairing timestamp." }
    ],
    example: { name: "Lopu\u2019s MacBook Pro", platform: "macos", capabilities: ["session.read", "session.send"] }
  };
  var deviceStateSchema = {
    id: "device-state",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Device state mirror",
    summary: "The latest bounded state snapshot for one paired device.",
    detail: "targetId is the device. Exactly one row per device is replace-on-write under a monotonic revision and content hash. Heartbeats stay in scoped session metadata rather than appending Things. Raw paths, process arguments, window titles, frames and media are never accepted. This persistent mirror counts toward account storage.",
    createdVia: "POST /api/v1/devices/node/state",
    fields: [
      { name: "deviceStateKey", type: "string", required: true, description: "Server-hashed unique device-state key." },
      { name: "revision", type: "number", required: true, min: 1, description: "Node-monotonic snapshot revision." },
      { name: "stateHash", type: "string", required: true, description: "Canonical content hash used for exact retry reconciliation." },
      { name: "snapshotHash", type: "string", required: true, description: "Canonical hash of the complete state plus connector snapshot." },
      { name: "state", type: "record", required: true, description: "Bounded locked, volume, brightness, battery and safe open-app summary." },
      { name: "observedAt", type: "date", required: true, description: "Server receipt timestamp." }
    ],
    example: { revision: 42, state: { locked: false, volume: 0.5, brightness: 0.8, openApps: [] } }
  };
  var deviceConnectorSchema = {
    id: "device-connector",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Device connector mirror",
    summary: "One bounded program connector available on a paired device.",
    detail: "targetId is the device. One row per connector is updated by monotonic snapshot revision and content hash. Credentials, cookies, raw local paths and process arguments are never stored. This persistent mirror counts toward account storage.",
    createdVia: "POST /api/v1/devices/node/state",
    fields: [
      { name: "deviceConnectorKey", type: "string", required: true, description: "Server-hashed unique device/connector key." },
      { name: "revision", type: "number", required: true, min: 1, description: "Node-monotonic connector revision." },
      { name: "connectorHash", type: "string", required: true, description: "Canonical content hash." },
      { name: "connector", type: "record", required: true, description: "Safe id, kind, label, status and capability projection." }
    ],
    example: {
      revision: 42,
      connector: { id: "chatgpt-desktop", kind: "chatgpt", label: "ChatGPT", status: "connected", capabilities: ["session.read"] }
    }
  };
  var deviceCommandSchema = {
    id: "device-command",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Device command",
    summary: "Bounded allowlisted work queued for one paired device.",
    detail: "Control-plane delivery state: exact requestId retries return the existing command and conflicting payloads return 409. Required-approval commands remain unleaseable until a linked one-decision approval atomically queues them. Commands use hashed short leases and never expose arbitrary shell, script, executable, path, SDP or frame input. User chat content persists once in quota-billed chat-message Things.",
    createdVia: "POST /api/v1/devices/commands",
    fields: [
      { name: "deviceCommandKey", type: "string", required: true, description: "Server-hashed unique owner/device/request key." },
      { name: "requestId", type: "string", required: true, max: 160, description: "Client idempotency identifier." },
      { name: "kind", type: "string", required: true, description: "Allowlisted typed command kind." },
      { name: "input", type: "record", required: true, description: "Closed, kind-specific bounded input." },
      { name: "requiresApproval", type: "boolean", required: true, description: "Whether dispatch requires an account-user decision." },
      {
        name: "approvalState",
        type: "enum",
        required: true,
        values: ["not-required", "pending", "approved", "denied"],
        description: "Server-enforced dispatch approval gate."
      },
      {
        name: "status",
        type: "enum",
        required: true,
        values: ["queued", "claimed", "running", "needs-approval", "succeeded", "failed", "cancelled", "needs-review"],
        description: "Monotonic command lifecycle."
      },
      {
        name: "controlBytes",
        type: "number",
        required: true,
        min: 0,
        description: "Logical command-envelope bytes used by the strict pending control-plane budget."
      },
      {
        name: "inputTextHash",
        type: "string",
        required: false,
        description: "Hash retained after a delivered session prompt is redacted from the control row."
      },
      {
        name: "inputRedactedAt",
        type: "date",
        required: false,
        description: "When duplicate prompt text was removed after durable Messenger materialization or terminal completion."
      },
      { name: "expiresAt", type: "date", required: false, description: "TTL deadline applied only after the command becomes terminal." }
    ],
    example: {
      requestId: "web-123",
      kind: "session.send",
      input: { connectorId: "chatgpt", sessionId: "chat-1", text: "Hello", delivery: "queue" },
      status: "queued"
    }
  };
  var deviceCommandEventSchema = {
    id: "device-command-event",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Device event",
    summary: "One bounded device, command, approval or screen lifecycle event.",
    detail: "Relational child event consumed through the cursor-based NDJSON feed. Live AI rows may retain bounded visible deltas and safe activity briefly as control-plane events; reasoning, paths, tool input/output, frames and arbitrary output bodies are rejected. Completed chat content updates the corresponding quota-billed message row.",
    createdVia: "Device state machines",
    fields: [
      { name: "deviceEventKey", type: "string", required: true, description: "Server-hashed event idempotency key." },
      { name: "deviceControlEventScopeKey", type: "string", required: true, description: "Server-hashed owner/device retention namespace." },
      {
        name: "liveControlEventScopeKey",
        type: "string",
        required: false,
        description: "Server-hashed connector/session retention namespace for live AI rows."
      },
      {
        name: "retainedBytes",
        type: "number",
        required: true,
        min: 0,
        description: "Logical row bytes enforced by strict control-plane retention budgets."
      },
      {
        name: "liveEventSequenceKey",
        type: "string",
        required: false,
        description: "Server-hashed connector/session/sequence uniqueness key for live AI events."
      },
      {
        name: "liveEventHash",
        type: "string",
        required: false,
        description: "Canonical live event hash used to distinguish exact replay from conflicting reuse."
      },
      { name: "liveActivityHash", type: "string", required: false, description: "Canonical safe historical activity hash used for revision checks." },
      { name: "eventType", type: "string", required: true, description: "Bounded event type." },
      { name: "resourceId", type: "id", required: false, description: "Related resource id." },
      { name: "revision", type: "number", required: false, description: "Related monotonic revision." },
      { name: "payload", type: "record", required: true, description: "Small safe event projection." },
      {
        name: "expiresAt",
        type: "date",
        required: false,
        description: "TTL deadline for transient live deltas and activity; durable completed text lives in chat-message rows."
      }
    ],
    example: { eventType: "command.running", resourceId: "command-id", payload: { status: "running" } }
  };
  var deviceAiLiveStateSchema = {
    id: "device-ai-live-state",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Device AI live cursor",
    summary: "One monotonic live-event cursor per device connector session.",
    detail: "Control-plane replay state only. The server hashes the owner/device/connector/session namespace, rejects gaps and stale sequence reuse, and never stores credentials, local paths, reasoning, or tool input/output.",
    createdVia: "POST /api/v1/devices/node/live-sync",
    fields: [
      { name: "deviceAiLiveStateKey", type: "string", required: true, description: "Server-hashed unique live session namespace." },
      { name: "connectorId", type: "string", required: true, max: 80, description: "Opaque connector identifier." },
      { name: "sessionId", type: "string", required: true, max: 512, description: "Opaque native session identifier." },
      { name: "lastSequence", type: "number", required: true, min: 1, description: "Last contiguous accepted event sequence." },
      { name: "lastObservedAt", type: "date", required: true, description: "Node observation time for the accepted cursor." }
    ],
    example: { connectorId: "chatgpt-desktop", sessionId: "session-1", lastSequence: 42, lastObservedAt: "2026-08-18T01:00:00.000Z" }
  };
  var deviceApprovalSchema = {
    id: "device-approval",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Device approval",
    summary: "A one-decision approval requested by a local connector.",
    detail: "Operational approval state tied to one command/device. Exact repeats are idempotent, conflicting decisions return 409, and expired approvals cannot be revived.",
    createdVia: "POST /api/v1/devices/node/commands (approval-request)",
    fields: [
      { name: "deviceApprovalKey", type: "string", required: true, description: "Server-hashed unique command/request key." },
      { name: "commandId", type: "id", required: true, description: "Parent device command." },
      { name: "requestId", type: "string", required: true, max: 160, description: "Node idempotency id." },
      { name: "kind", type: "string", required: true, max: 80, description: "Approval category." },
      { name: "prompt", type: "string", required: true, max: 1e3, description: "Human-readable bounded question." },
      { name: "status", type: "enum", required: true, values: ["pending", "approved", "denied", "expired"], description: "One-decision state." }
    ],
    example: { commandId: "command-id", requestId: "approval-1", kind: "computer-use", prompt: "Allow app control?", status: "pending" }
  };
  var deviceScreenSessionSchema = {
    id: "device-screen-session",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Device screen session",
    summary: "Safe lifecycle metadata for a remote screen session.",
    detail: "Persistent, quota-billed lifecycle metadata only. Frames, images, audio, SDP, ICE candidates and TURN credentials are never accepted or stored; media uses a separately authorized real-time channel with local approval.",
    createdVia: "POST /api/v1/devices/screen",
    fields: [
      { name: "deviceScreenKey", type: "string", required: true, description: "Server-hashed idempotency key." },
      { name: "requestId", type: "string", required: true, max: 160, description: "Client request id." },
      {
        name: "status",
        type: "enum",
        required: true,
        values: ["requested", "awaiting-local-approval", "connecting", "active", "ended", "failed"],
        description: "Screen lifecycle state."
      },
      { name: "viewOnly", type: "boolean", required: true, description: "Whether input control is disabled." },
      { name: "startedAt", type: "date", required: false, description: "Server timestamp when active." },
      { name: "endedAt", type: "date", required: false, description: "Server terminal timestamp." }
    ],
    example: { requestId: "screen-1", status: "awaiting-local-approval", viewOnly: true }
  };
  var customEmojiSchema = {
    id: "custom-emoji",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Custom emoji",
    summary: "An uploaded emoji/gif usable in chat reactions and messages.",
    detail: "One thing per emoji (relational, FUNDAMENTALS \xA73 \u2014 never an array on the community). The image is a protected, quota-accounted S3 attachment (gif/webp/png/jpeg, \u2264512 KiB); legacy inline data-URI rows remain read-compatible. Scope is a community (targetId set) or personal (targetId null); names are unique per scope via crystal.emojiKey. Reaction tokens reference emojis by id (`custom:<shareId>`), so renames never orphan reactions.",
    createdVia: "POST /api/v1/emojis",
    fields: [
      { name: "name", type: "string", required: true, max: MAX_EMOJI_NAME_CHARS, description: "Lowercase [a-z0-9_-] name, rendered as :name:." },
      { name: "emojiKey", type: "string", required: true, description: "Unique `<scope>:<name>` key (scope = communityId or user:<userId>)." },
      { name: "image", type: "string", required: false, description: "Legacy inline data:image/... base64 URI; never written for new emojis." },
      { name: "animated", type: "boolean", required: false, description: "True for new GIF uploads or a compatible legacy animated row." }
    ],
    example: { name: "party-parrot", emojiKey: "c0ffee\u2026:party-parrot", animated: true }
  };
  var followSchema = {
    id: "follow",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Follow",
    summary: "One user following another (the start of the relationship graph).",
    detail: `ownerId = the follower, targetId = the followed user's shareId; unique per pair via crystal.followKey. Powers the messenger request buckets (a DM from someone you follow lands normally; from a follower it queues as a "follower" request; otherwise "unknown"). The acl circle entries (tt:userFriends\u2026) are designed to plug into this graph later.`,
    createdVia: "POST /api/v1/users/follow",
    fields: [{ name: "followKey", type: "string", required: true, description: "Unique `<followerId>:<followeeId>` pair key." }],
    example: { followKey: "5eed\u2026:c0ffee\u2026" }
  };
  var passkeyThingSchema = {
    id: "passkey",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Passkey",
    summary: "A WebAuthn credential (passkey) that can sign into its owner's account.",
    detail: "Registered via POST /api/v1/auth/passkeys/register-options + /register (password confirmation required), authenticates via /api/v1/auth/passkeys/login-options + /login (discoverable credentials \u2014 no username needed). ownerId is the account it signs into. Credential material (credentialId, public key, sign counter) lives in the root secure blob; uniqueness and the login lookup ride uniqueKeys. Revocation (crystal.revokedAt) immediately blocks logins while keeping the record; revoked passkeys can then be deleted. The generic things CRUD refuses this kind end to end.",
    createdVia: "POST /api/v1/auth/passkeys/register",
    fields: [
      { name: "nickname", type: "string", required: false, description: "Owner-chosen label, defaults to the provider name." },
      { name: "description", type: "string", required: false, description: "Free-form owner note." },
      { name: "providerName", type: "string", required: false, description: "Authenticator provider derived from its AAGUID (e.g. iCloud Keychain, 1Password)." },
      { name: "aaguid", type: "string", required: false, description: "Authenticator AAGUID as reported at registration." },
      { name: "deviceType", type: "enum", required: false, values: ["singleDevice", "multiDevice"], description: "Whether the credential is synced (multiDevice) or bound to one authenticator." },
      { name: "backedUp", type: "boolean", required: false, description: "True when the authenticator reports the credential as backed up/synced." },
      { name: "transports", type: "string[]", required: false, description: "Browser-reported transports (internal, hybrid, usb, nfc, ble)." },
      { name: "lastUsedAt", type: "string", required: false, description: "ISO timestamp of the most recent successful login." },
      { name: "lastUsedOrigin", type: "string", required: false, description: "Origin of the most recent successful login." },
      { name: "revokedAt", type: "string", required: false, description: "ISO timestamp \u2014 set once revoked; a revoked passkey can never log in." }
    ],
    example: { nickname: "MacBook Touch ID", providerName: "iCloud Keychain", deviceType: "multiDevice", backedUp: true }
  };
  var passkeyAppLinkThingSchema = {
    id: "passkey-app-link",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Passkey app link",
    summary: "A record that a passkey has authenticated a particular app or origin.",
    detail: "Minted/updated server-side whenever POST /api/v1/auth/passkeys/login succeeds: the deployment origin always links, and an SSO/app context (clientId) links additionally. Aggregated onto GET /api/v1/auth/passkeys as each passkey's linkedApps. ownerId = the passkey's owner, targetId = the passkey thing. The generic things CRUD refuses this kind.",
    requiresTarget: true,
    createdVia: "POST /api/v1/auth/passkeys/login",
    fields: [
      { name: "linkKey", type: "string", required: true, description: "Pair key `<passkeyId>:<appKey>` \u2014 dedupe rides root uniqueKeys, not this path." },
      { name: "appKey", type: "string", required: true, description: "Stable link key \u2014 `origin:<origin>` or `app:<clientId>`." },
      { name: "appName", type: "string", required: false, description: "Display name for the app/origin." },
      { name: "firstUsedAt", type: "string", required: true, description: "ISO timestamp of the first login through this link." },
      { name: "lastUsedAt", type: "string", required: true, description: "ISO timestamp of the most recent login through this link." },
      { name: "usageCount", type: "number", required: true, description: "Total successful logins through this link." }
    ],
    example: { appKey: "origin:https://thingtime.com", appName: "thingtime.com", usageCount: 4 }
  };
  var EXTERNAL_CONNECTION_THINGTIME = [
    "external-account",
    "external-account-link",
    "external-post",
    "external-post-source",
    "feed-filter",
    "feed-filter-verdict"
  ];
  var DEVICE_THINGTIME = [
    "device",
    "device-state",
    "device-connector",
    "device-command",
    "device-command-event",
    "device-ai-live-state",
    "device-approval",
    "device-screen-session"
  ];
  var CHAT_ARCHIVE_THINGTIME = ["chat-archive", "chat-archive-participant", "chat-archive-message", "chat-archive-reaction"];
  var PROTECTED_THINGTIME = [
    "lopu-instruction-transfer",
    "lopu-instruction-part",
    "file",
    "mail-account",
    "mail-folder",
    "mail-message",
    "mail-inbox",
    "mail-operation",
    "password-manager-entry",
    "draft",
    // Moderator-managed references; only the subspace embeds endpoint writes them.
    "subspace-embed",
    TIMELINE_EVENT_KIND,
    TIMELINE_LINK_KIND,
    TIMELINE_BRANCH_KIND,
    TIMELINE_BRANCH_HEAD_KIND,
    TIMELINE_SNAPSHOT_PART_KIND,
    TIMELINE_NOTE_KIND,
    TIMELINE_VERSION_NAME_KIND,
    "post-discovery",
    ...CHAT_ARCHIVE_THINGTIME,
    "account-invite",
    "lopu-recording-settings",
    "lopu-background-task",
    "lopu-recording-job",
    "lopu-recording-reminder",
    "lopu-reminder",
    ATTACHMENT_THINGTIME,
    "user",
    "theme",
    "feed-algorithm",
    "waitlist",
    "app",
    // audience groups (custom visibility) — managed only via /api/v1/groups
    "group",
    "group-member",
    "subscription-tier",
    "subscription",
    "account-link",
    "app-storage",
    "service-quota",
    MIGRATION_DIAGNOSTIC_THINGTIME,
    ERROR_LOG_THINGTIME,
    "moderationFlag",
    ...CI_CONTROL_THINGTIME,
    ...EXTERNAL_CONNECTION_THINGTIME,
    "follow",
    "friend",
    "notification",
    "push-device",
    // auth-plane credentials: a forged passkey doc would BE a working login
    // credential, so these are server-minted end to end (auth/passkeys.ts)
    "passkey",
    "passkey-app-link",
    // Embed SDK things (api/utils/things/embeddedThings.ts) are owned by
    // /api/v1/embed/things end to end — version-checked writes, their own
    // audience field. Protected so generic /things CRUD cannot forge or edit
    // them AND so the search/listThings `$nin` keeps a *public* embed out of
    // the ordinary post surfaces it is not content for.
    EMBEDDED_THINGTIME,
    ...DEVICE_THINGTIME,
    // executor-minted run records — a forged action-run would falsify the
    // audit trail the /actions inspector shows (api/utils/actions/)
    "action-run",
    // the Lopu model catalog (api/utils/ai/models.ts): catalog fields are code
    // and `enabled` is admin-only, so nothing may mint a model or flip
    // availability through generic Thing CRUD
    "ai-model",
    // Lopu credits and usage (api/utils/lopu/accounting.ts): a forged account,
    // ledger row or usage row would be free credits or a falsified bill
    "lopu-account",
    "lopu-usage",
    "lopu-credit"
  ];
  var isProtectedThingtime = (ids) => ids.some((id3) => PROTECTED_THINGTIME.includes(id3));
  var userThingSchema = {
    id: "user",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "User (thing)",
    summary: "A user account as a thing \u2014 public profile in crystal, credentials in the secure root field.",
    detail: "Users are things too: the crystal holds ONLY the public profile (what /api/v1/users/profile already exposes), so user things are safely listable/searchable like any public thing. Credentials and private account state (email, passwordHash, verification, storage, meta) live under the root `secure` field \u2014 omitted from every projection, unreachable by the search grammar, sensitive strings stored as binary so the text index cannot index them. Username/email uniqueness rides uniqueKeys (email hashed). Created only via POST /api/v1/auth/register or /api/v1/auth/service-account \u2014 the generic things CRUD refuses this kind. Migrated users keep their legacy id as shareId, so ownerId references, sessions, and rosters keep working unchanged.",
    createdVia: "POST /api/v1/auth/register",
    fields: [
      { name: "username", type: "string", required: true, description: "Unique, lowercased." },
      { name: "ttid", type: "string", required: true, description: "Thingtime id (currently the username)." },
      { name: "displayName", type: "string", required: false, description: "Optional display name." },
      { name: "bio", type: "string", required: false, description: "Profile bio." },
      { name: "avatarUrl", type: "string", required: false, description: "Avatar image URL." },
      { name: "bannerUrl", type: "string", required: false, description: "Profile banner URL." }
    ],
    example: { username: "rick.deckard", ttid: "rick.deckard", displayName: "Rick Deckard", bio: "Blade runner." }
  };
  var themeThingSchema = {
    id: "theme",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Theme (thing)",
    summary: "A saved user theme as a thing \u2014 share visibility maps onto the acl.",
    detail: 'The resolved token doc lives in crystal.theme; the legacy visibility enum maps onto the thing acl (public \u2192 ["tt:all"], private \u2192 ["tt:user"]). shareIds are preserved by the migration so existing share links keep resolving. Written only through /api/v1/themes (the 100-per-user cap and token validation live there); the generic things CRUD refuses this kind.',
    createdVia: "POST /api/v1/themes",
    fields: [
      { name: "name", type: "string", required: true, max: 60, description: "Theme name." },
      { name: "theme", type: "record", required: true, description: "Resolved theme tokens." }
    ],
    example: { name: "Midnight", theme: { "--tt-accent": "hotpink" } }
  };
  var feedAlgorithmThingSchema = {
    id: "feed-algorithm",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Feed algorithm (thing)",
    summary: "A user-trained feed ranking algorithm as a thing (always private to its owner).",
    detail: 'Weights over post types, tags, and authors, trained from engagement events. Always acl ["tt:user"] \u2014 weights encode reading habits. Written only through /api/v1/algorithms*; the generic things CRUD refuses this kind. shareIds are preserved by the migration so users.meta.activeFeedAlgorithmId pointers keep working.',
    createdVia: "POST /api/v1/algorithms",
    fields: [
      { name: "name", type: "string", required: true, max: 60, description: "Algorithm name." },
      { name: "emoji", type: "string", required: true, description: "Display emoji." },
      { name: "parentId", type: "id", required: false, description: "Branch lineage parent." },
      { name: "description", type: "string", required: false, max: 300, description: "Owner-written directory description." },
      { name: "listed", type: "boolean", required: false, description: "Explicit public directory opt-in, requires shared=true. Existing link-only profiles remain unlisted." },
      {
        name: "weights",
        type: "record",
        required: true,
        description: "{ types, tags, authors } weight maps \u2014 open keys, so the shape stays a record."
      },
      { name: "eventCount", type: "number", required: true, description: "Engagement events trained on." },
      { name: "lastTrainedAt", type: "date", required: false, description: "Last training time." },
      {
        name: "shared",
        type: "boolean",
        required: false,
        description: 'Owner-granted branch invitation ("try my feed brain"). Never changes the acl \u2014 it only lets /feed?algorithm=<shareId> holders read the name/emoji/eventCount preview and branch their own copy.'
      }
    ],
    example: { name: "Chronological+", emoji: "\u{1F9E0}", weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, shared: false }
  };
  var waitlistThingSchema = {
    id: "waitlist",
    version: 1,
    kind: "crystal",
    collection: null,
    title: "Waitlist entry (thing)",
    summary: "A launch-waitlist signup as a thing \u2014 the email never leaves the secure field.",
    detail: 'The crystal is empty by design: the email lives under the root secure field as binary (invisible to projections, the search grammar, and the text index) and uniqueness rides a hashed uniqueKey. System-owned and private (ownerId "system", acl ["tt:user"]) so no viewer ever matches it. Written only through /api/v1/waitlist; duplicate joins are treated as success.',
    createdVia: "POST /api/v1/waitlist",
    fields: [],
    example: {}
  };
  var thingtimeSchemas = [
    ...["mail-account", "mail-folder", "mail-message", "mail-inbox", "mail-operation"].map((id3) => ({
      id: id3,
      version: 1,
      kind: "crystal",
      collection: null,
      title: id3.replace("mail-", "Mail "),
      summary: "Private encrypted mail record.",
      detail: "Owned mail records use the same versioned model in the cloud, browser and local connector. Credentials and message content are encrypted. Proxy inboxes contain folder references only. Generic Thing reads, writes and sharing cannot access these records.",
      createdVia: "/api/v1/mail",
      fields: [],
      example: {}
    })),
    {
      id: "password-manager-entry",
      version: 2,
      kind: "crystal",
      collection: null,
      title: "Password manager entry",
      summary: "An encrypted, private credential with ordered custom fields.",
      detail: "Created only through the password manager API. The title, password type, ordered fields and field types form an extensible document; field values are encrypted together with the account vault key. Generic Thing CRUD, search, sharing and history cannot disclose the entry. The Thing fields mod supplies sectioned and typed field editors. Imported source JSON, account/vault attributes, flags, tags, and password history are encrypted alongside the fields; private encrypted files are relational attachment Things.",
      createdVia: "/api/v1/passwords",
      fields: [
        { name: "title", type: "string", required: true, description: "Entry title." },
        { name: "passwordType", type: "enum", required: true, values: [...PASSWORD_TYPES], description: "Credential category. Native passkeys hold encrypted signing material." },
        { name: "fields", type: "array", required: true, children: [
          { name: "id", type: "string", required: true, description: "Stable field id." },
          { name: "label", type: "string", required: true, description: "Field label." },
          { name: "type", type: "enum", required: true, values: [...FIELD_TYPES], description: "Field editor." },
          { name: "value", type: "string", required: false, description: "Encrypted field value. The password manager has no character-count cap." },
          { name: "section", type: "string", required: false, description: "Section heading." },
          { name: "concealed", type: "boolean", required: false, description: "Hide the value until revealed." },
          { name: "structured", type: "boolean", required: false, description: "Preserve the original JSON type of structured values." }
        ], description: "Ordered fields in the encrypted document: id, label, type and value. Defaults are username, password and website." }
      ],
      example: { title: "Example login", passwordType: "login", fields: [{ id: "username", label: "Username", type: "text", value: "" }, { id: "password", label: "Password", type: "password", value: "" }] }
    },
    {
      id: "draft",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Draft or template",
      summary: "Private account-backed editing snapshots and reusable templates.",
      detail: "Owner-only, quota-accounted drafts, version-checked through the drafts API. Each is an atomic Thing; files are relational attachment children. Generic CRUD, feeds and search cannot publish drafts.",
      createdVia: "/api/v1/drafts",
      fields: [],
      example: {}
    },
    {
      id: TIMELINE_SNAPSHOT_PART_KIND,
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Timeline snapshot part",
      summary: "One bounded private fragment of a retained large version.",
      detail: "The shared canonical part record lives in secure BinData. parentId and targetId reference its immutable event; scalar side and ordinal identify its position. Each part is a separate atomic Thing, with no accumulating arrays. The parent event accounts for retained customer bytes exactly once. Only the canonical content transaction writes parts; generic reads and writes are refused.",
      createdVia: "Canonical Timeline transaction",
      fields: [],
      example: {}
    },
    {
      id: TIMELINE_BRANCH_KIND,
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Timeline branch",
      summary: "A named private branch with relational Thing memberships.",
      detail: "The shared branch record lives in secure BinData. Each contained Thing has a separate timeline-branch-head record; neither revisions nor heads accumulate in this document. Dedicated Timeline commands own the lifecycle and record branch changes in History.",
      createdVia: "Timeline branch command",
      fields: [{ name: "name", type: "string", required: true, system: true, description: "Branch display name." }],
      example: { name: "Design experiment" }
    },
    {
      id: TIMELINE_BRANCH_HEAD_KIND,
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Timeline branch version",
      summary: "One current version for one branch and Thing.",
      detail: "A protected atomic relationship with scalar branchId, thingId, eventId and optimistic revision. targetId names its Thing and parentId its branch. A push requires the current revision and preserves ancestry; divergence requires a merge. The canonical head record is identical locally and remotely.",
      createdVia: "Timeline branch command",
      fields: [],
      example: {}
    },
    {
      id: TIMELINE_NOTE_KIND,
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Timeline note",
      summary: "A private contextual message attached to one immutable Timeline event.",
      detail: "Each note is its own protected relational Thing: the identical local/server note record (owner or Lopu author, plain text up to 2000 characters, at most 8192 bytes) lives in secure BinData, targetId points to its event Thing, and hashed crystal.targetId plus crystal.linkKind support reverse lookup through the existing shared index. Events stay immutable and exact-keyed; notes never accumulate as an array on the event, the Thing or the Timeline folder. At most 8 notes per event; the owner may remove either author\u2019s note, refunding metered storage. Only the dedicated Timeline note commands write notes; generic Things reads, search and sharing never expose them.",
      createdVia: "Timeline note command",
      fields: [{ name: "name", type: "string", required: true, system: true, description: "Value-free display label." }],
      example: { name: "Note" }
    },
    {
      id: TIMELINE_VERSION_NAME_KIND,
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Timeline version name",
      summary: "A private pinned display name for one saved Timeline version.",
      detail: "One protected relational Thing per named event: the identical local/server name record (1\u201380 characters, at most 4096 bytes) lives in secure BinData, targetId points to its event Thing, hashed crystal.targetId plus crystal.linkKind support reverse lookup through the existing shared index, and a root nameRevision fences concurrent renames. The crystal label is constant, so the name text never reaches crystal projections, search or root data. Events stay immutable and exact-keyed; names never accumulate on the event, the Thing or the Timeline folder and invent no version numbers. The record is unbilled control metadata, but every name, rename and clear appends a metered timeline-version-name effect event beside the named version. Only the dedicated name-version Timeline command writes names; generic Things reads, search and sharing never expose them.",
      createdVia: "Timeline name-version command",
      fields: [{ name: "name", type: "string", required: true, system: true, description: "Value-free display label." }],
      example: { name: "Version name" }
    },
    {
      id: "lopu-instruction-transfer",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Private instruction transfer",
      summary: "A resumable private account instruction manifest and durable receipt.",
      detail: "Home-plane protected state. Secure BinData retains immutable attempt identity, scope, revision fence, bounded sequential digest checkpoint and terminal receipt. Committed generations remain immutable for history and backups; only abandoned staging may be cleaned. All payload bytes use canonical account storage accounting.",
      createdVia: "Private Lopu instruction transport",
      fields: [],
      example: {}
    },
    {
      id: "lopu-instruction-part",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Private instruction part",
      summary: "An immutable verified fragment of one private account instruction.",
      detail: "Home-plane protected relational content, never generic search, sharing, reads or CRUD. Owner and manifest identity fence every read; secure BinData stores text outside wildcard text indexing. Root Binary uniqueKeys on first fragments enforce instruction id uniqueness using the existing shared sparse unique index. Canonical accounting meters retained UTF-8 bytes; no account content size cap.",
      createdVia: "Private Lopu instruction transport",
      fields: [],
      example: {}
    },
    {
      id: TIMELINE_LINK_KIND,
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Timeline relationship",
      summary: "One immutable private link between an event and a version, Thing, branch or operation.",
      detail: "Each relationship is its own protected Thing in Timeline. The identical local/server link record lives in secure BinData; targetId points to its event Thing. Hashed crystal.targetId and crystal.linkKind support reverse lookup through the existing shared index. Links commit with the event, never accumulate in document arrays, and cannot be edited through generic Things APIs.",
      createdVia: "Canonical Timeline transaction",
      fields: [],
      example: {}
    },
    {
      id: TIMELINE_EVENT_KIND,
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Timeline event",
      summary: "An immutable private change and its server acceptance receipt.",
      detail: "An atomic Thing under the owner\u2019s Timeline folder. targetId names the affected Thing, including deleted Things. The shared versioned event and receipt live in secure BinData, excluded from generic reads/search. V3 stores the canonical relational event record; parent, dependency, Thing, branch and operation links are separate atomic timeline-link Things. Logical storage accounting meters retained customer snapshot content. Dedicated Timeline reads authenticate the owner; ordinary content sharing never shares its history.",
      createdVia: "Canonical mutation transactions and the Timeline sync API",
      fields: [{ name: "name", type: "string", required: true, system: true, description: "Value-free display label." }],
      example: { name: "Change" }
    },
    {
      id: "lopu-background-task",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Background AI task",
      summary: "Protected owner-private execution and reconnect state.",
      detail: "Home control Thing with origin/data-source scope, immutable request digest and bounded secure BinData output. Seven-day output access; lazy byte removal; retained operation marker prevents replay. Chat output additionally requires current conversation access. Optional management and workflowStatus track a durable chain. The root workflowInput is protected BinData containing the initial request and a revocable session grant; it is never indexed or projected and is removed at terminal completion. Child parts link by protected rootTaskId. Protected activeWorkerRequestId, workerStarted, workerFinishedAt, workflowFinalStatus and workflowFinalizedAt fence admission and preserve the conversation claim until all executors acknowledge their final saved output; lease expiry alone never releases that claim.",
      createdVia: "Background transport on the canonical AI endpoints",
      fields: [],
      example: {}
    },
    ...["lopu-recording-settings", "lopu-recording-job", "lopu-recording-reminder", "lopu-reminder"].map((id3) => ({
      id: id3,
      version: 1,
      kind: "crystal",
      collection: null,
      title: id3,
      summary: "Protected owner-private recording or reminder automation state.",
      detail: "Managed by the Lopu recording API. Bounded operational state; private processing scratch is in secure BinData, never indexed or projected. Transcript comments and generated Things use ordinary quota-billed content writes.",
      createdVia: id3 === "lopu-reminder" ? "POST /api/v1/lopu/reminders" : "POST /api/v1/lopu/recordings",
      fields: [],
      example: {}
    })),
    rootThingSchema,
    postSchema,
    attachmentSchema,
    fileSchema,
    commentSchema,
    reactionSchema,
    shareSchema,
    dataSchema,
    {
      id: "scheduled-task-run",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Scheduled task run",
      summary: "An owner-private, editable run note linked to its task by targetId.",
      requiresTarget: true,
      detail: "A quota-billed child Thing, not an embedded task history. These owner-editable notes are not security audit records. Deleting the task cascades its run notes; destination conversations remain separate.",
      fields: [
        { name: "title", type: "string", required: true, max: 240, description: "Run title." },
        { name: "chatId", type: "id", required: true, description: "Destination Lopu conversation." },
        { name: "scheduledAt", type: "date", required: true, description: "Scheduled occurrence." },
        { name: "status", type: "enum", required: true, values: ["running", "done", "needs-attention"], description: "Last saved run status." },
        { name: "notificationStatus", type: "string", required: false, description: "Optional notification delivery diagnostic." }
      ],
      example: { title: "Daily update", chatId: "chat-id", scheduledAt: "2026-09-10T09:00:00.000Z", status: "done" }
    },
    schemaThingSchema,
    componentSchema,
    webpageSchema,
    actionSchema,
    actionRunSchema,
    {
      id: "post-discovery",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Collected secret post",
      summary: "Private record of a successful secret-link visit.",
      requiresTarget: true,
      createdVia: "GET /api/v1/things?id=...&key=...",
      detail: "One protected control Thing per account or anonymous browser and post. targetId identifies the discovered post. Never exposed through generic reads, exports, search or CRUD. Current hidden ACL and key digest are rechecked on every access; rotation or removal revokes the record. Post deletion cascades it. IP metadata is private and does not itself authorize access.",
      fields: [
        { name: "authorId", type: "id", required: true, system: true, description: "Author whose profile may list the discovered post." },
        { name: "linkKeyDigest", type: "string", required: true, system: true, max: 64, description: "One-way digest of the valid secret link generation." },
        { name: "anonymousId", type: "id", required: false, system: true, description: "One-way browser identity, absent for signed-in accounts." },
        { name: "ipAddress", type: "string", required: false, system: true, max: 45, description: "Private IP observed when this link generation was collected." }
      ],
      example: { authorId: "author-id", linkKeyDigest: "one-way-link-generation-digest" }
    },
    saveThingSchema,
    voteSchema,
    updownSchema,
    subspaceSchema,
    subspaceMemberSchema,
    subspaceModlogSchema,
    subspaceTombstoneSchema,
    subspaceReportSchema,
    subspaceEmbedSchema,
    folderSchema,
    fileSyncSchema,
    appSchema,
    appDataSchema,
    // admin-plane kinds (PROTECTED: written only through admin endpoints)
    subscriptionTierSchema,
    subscriptionSchema,
    accountLinkSchema,
    appStorageLedgerSchema,
    serviceQuotaSchema,
    migrationDiagnosticSchema,
    errorLogSchema,
    // the Lopu model catalog (protected, seeded by api/utils/ai/models.ts)
    aiModelSchema,
    // Lopu credits + usage accounting (protected, api/utils/lopu/accounting.ts)
    {
      id: "account-invite",
      version: 1,
      kind: "crystal",
      collection: null,
      title: "Account invite",
      summary: "Single-use signup invite with reserved gift credits.",
      detail: "Protected control Thing. Private editable profile suggestions are BinData; bearer tokens are hashed in uniqueKeys. Creation reserves credits atomically, cancellation/expiry refunds them, and redemption joins canonical account creation in one transaction. At most 20 pending invites per owner, each lasting 30 days, with a moderated 128px thumbnail capped at 16 KiB. No recipient identity is disclosed to the creator.",
      createdVia: "POST /api/v1/auth/invites",
      example: { status: "pending", amountMicros: 1e6 },
      fields: [
        { name: "status", type: "string", required: true, description: "pending, claimed, cancelled or expired" },
        { name: "amountMicros", type: "number", required: true, min: 0, description: "Gift reserved from the creator balance, in millionths of a credit." }
      ]
    },
    lopuAccountSchema,
    lopuUsageSchema,
    lopuCreditSchema,
    ...ciControlSchemas,
    // social graph + notifications (protected, server-minted). The `follow`
    // kind registers ONCE, below with the messenger family: followSchema is the
    // crystal.followKey shape POST /api/v1/users/follow actually mints, which
    // supersedes the earlier followThingSchema (crystal.follow marker) draft.
    friendThingSchema,
    notificationThingSchema,
    pushDeviceThingSchema,
    // auth-plane credentials (protected, server-minted by auth/passkeys.ts)
    passkeyThingSchema,
    passkeyAppLinkThingSchema,
    // messenger kinds (dedicated endpoints only — no generic sanitizers)
    communitySchema,
    communityMemberSchema,
    communityInviteSchema,
    chatSectionSchema,
    chatSchema,
    chatMemberSchema,
    chatMessageSchema,
    aiConnectionSchema,
    deviceSchema,
    deviceStateSchema,
    deviceConnectorSchema,
    deviceCommandSchema,
    deviceCommandEventSchema,
    deviceAiLiveStateSchema,
    deviceApprovalSchema,
    deviceScreenSessionSchema,
    customEmojiSchema,
    followSchema,
    // system kinds (collections collapsing into things — dual-era)
    userThingSchema,
    themeThingSchema,
    feedAlgorithmThingSchema,
    waitlistThingSchema,
    // collections that remain collections
    sessionSchema,
    emailVerificationSchema,
    passwordResetSchema,
    authOtpSchema,
    emailMessageSchema,
    rateLimitSchema,
    deploymentPeerSchema,
    adminIntegrationSecretSchema,
    adminIntegrationEndpointSchema,
    adminIntegrationClaimSchema,
    adminIntegrationAuditSchema,
    lopuCredentialSchema
  ];
  var fail = (status, error) => ({ ok: false, status, error });
  var isFail = (value) => value.ok === false;
  var UNSAFE_HTTP_URL_CHAR_RE = /[\p{Cc}\p{Cf}\p{Cs}\s]/u;
  var isHttpUrl = (value) => {
    if (!/^https?:\/\//i.test(value) || UNSAFE_HTTP_URL_CHAR_RE.test(value) || value.includes("\\")) return false;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && !!parsed.hostname && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  };
  var sanitizeAttachmentCrystal = (input) => {
    const sanitized = sanitizeAttachmentPublicMetadata(input);
    if (sanitized.ok === false) return fail(400, sanitized.error);
    return sanitized;
  };
  var MEDIA_LAYOUT_MODES = ["masonry", "rows", "grid"];
  var MEDIA_LAYOUT_SPAN_VALUES = ["normal", "wide", "tall", "big"];
  var MAX_MEDIA_LAYOUT_ENTRIES = 25;
  var MAX_MEDIA_LAYOUT_TRACK = 6;
  var sanitizeMediaLayout = (value) => {
    if (value === void 0 || value === null) return { ok: true, mediaLayout: null };
    if (typeof value !== "object" || Array.isArray(value)) return fail(400, "mediaLayout must be an object");
    const raw = value;
    const mode = MEDIA_LAYOUT_MODES.includes(raw.mode) ? raw.mode : null;
    if (!mode) return fail(400, "mediaLayout.mode must be masonry, rows, or grid");
    if (mode === "masonry") return { ok: true, mediaLayout: { mode } };
    if (mode === "rows") {
      const pattern = raw.pattern;
      if (!Array.isArray(pattern) || !pattern.length || pattern.length > MAX_MEDIA_LAYOUT_ENTRIES) {
        return fail(400, `mediaLayout.pattern must be 1-${MAX_MEDIA_LAYOUT_ENTRIES} row sizes`);
      }
      const rows = [];
      for (const entry of pattern) {
        if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 1 || entry > MAX_MEDIA_LAYOUT_TRACK) {
          return fail(400, `mediaLayout.pattern rows must be integers 1-${MAX_MEDIA_LAYOUT_TRACK}`);
        }
        rows.push(entry);
      }
      return { ok: true, mediaLayout: { mode, pattern: rows } };
    }
    const columns = raw.columns === void 0 ? 3 : raw.columns;
    if (typeof columns !== "number" || !Number.isInteger(columns) || columns < 1 || columns > MAX_MEDIA_LAYOUT_TRACK) {
      return fail(400, `mediaLayout.columns must be an integer 1-${MAX_MEDIA_LAYOUT_TRACK}`);
    }
    let spans;
    if (raw.spans !== void 0 && raw.spans !== null) {
      if (typeof raw.spans !== "object" || Array.isArray(raw.spans)) return fail(400, "mediaLayout.spans must be an object");
      const entries = Object.entries(raw.spans);
      if (entries.length > MAX_MEDIA_LAYOUT_ENTRIES) return fail(400, `mediaLayout.spans can hold at most ${MAX_MEDIA_LAYOUT_ENTRIES} entries`);
      const cleaned = /* @__PURE__ */ Object.create(null);
      for (const [key4, entry] of entries) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/.test(key4)) {
          return fail(400, "mediaLayout.spans keys must be attachment ids");
        }
        if (!MEDIA_LAYOUT_SPAN_VALUES.includes(entry)) {
          return fail(400, "mediaLayout.spans values must be normal, wide, tall, or big");
        }
        if (entry !== "normal") cleaned[key4] = entry;
      }
      if (Object.keys(cleaned).length) spans = { ...cleaned };
    }
    return { ok: true, mediaLayout: { mode, columns, ...spans ? { spans } : {} } };
  };
  var SUBSPACE_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  var SUBSPACE_FLAIR_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
  var sanitizePostCrystal = (input, appliedIds, options = {}) => {
    const type = POST_TYPES.includes(input.type) ? input.type : null;
    if (!type) return fail(400, "Post type must be text, image, marketplace, or thingtime");
    const isShare = appliedIds.includes("share");
    const hasAnyAttachment = options.postAttachments?.hasAny === true;
    const hasVisualAttachment = options.postAttachments?.hasVisual === true;
    const richTextProvided = input.richText !== void 0;
    let richText = null;
    let text2 = typeof input.text === "string" ? input.text.trim() : "";
    if (richTextProvided && input.richText !== null) {
      if (!input.richText || typeof input.richText !== "object" || Array.isArray(input.richText)) {
        return fail(400, "richText must be a native rich-text document");
      }
      const sanitized = sanitizeDataValue(input.richText, { path: "richText", depth: 2 });
      if (sanitized.ok === false) return sanitized;
      if (!isEditorJsDoc(sanitized.value) || !isEditorJsDocSafeToEdit(sanitized.value)) {
        return fail(400, "richText must be a safe native rich-text document");
      }
      richText = sanitized.value;
      text2 = blocksToText(richText.blocks).trim();
    }
    if (text2.length > MAX_TEXT_CHARS) return fail(400, `Post text is too long (max ${MAX_TEXT_CHARS})`);
    const rawImages = input.images;
    const images = [];
    if (rawImages !== void 0 && rawImages !== null) {
      if (!Array.isArray(rawImages)) return fail(400, "images must be a list of URLs");
      if (rawImages.length > MAX_IMAGES) return fail(400, `A post can have at most ${MAX_IMAGES} images`);
      for (const entry of rawImages) {
        if (typeof entry !== "string") return fail(400, "images must be a list of URLs");
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (trimmed.length > MAX_IMAGE_URL_CHARS || !isHttpUrl(trimmed)) {
          return fail(400, "Images must be http(s) URLs");
        }
        images.push(trimmed);
      }
    }
    let listing = null;
    const listingProvided = input.listing !== void 0 && input.listing !== null;
    if (type === "marketplace" && !isShare || (type === "marketplace" || type === "thingtime") && listingProvided) {
      const value = input.listing;
      if (!value || typeof value !== "object") return fail(400, "Marketplace posts need listing details");
      const raw = value;
      const title2 = typeof raw.title === "string" ? raw.title.trim().slice(0, 120) : "";
      if (!title2) return fail(400, "Listing title is required");
      const price = Number(raw.price);
      if (!Number.isFinite(price) || price < 0 || price > 1e9) {
        return fail(400, "Listing price must be a non-negative number");
      }
      const currency = typeof raw.currency === "string" && /^[A-Za-z]{3}$/.test(raw.currency.trim()) ? raw.currency.trim().toUpperCase() : "AUD";
      const category = MARKETPLACE_CATEGORIES.includes(raw.category) ? raw.category : "other";
      const condition = raw.condition === "new" || raw.condition === "used" ? raw.condition : null;
      const location2 = typeof raw.location === "string" ? raw.location.trim().slice(0, 120) || null : null;
      listing = { title: title2, price: Math.round(price * 100) / 100, currency, category, condition, location: location2, sold: !!raw.sold };
    }
    let thing = null;
    if (type === "thingtime") {
      const raw = input.thing;
      if (raw !== void 0 && raw !== null) {
        if (typeof raw !== "object" || Array.isArray(raw)) {
          return fail(400, "Thingtime posts need a thing \u2014 an object with at least one field \u{1F300}");
        }
        const sanitized = sanitizeDataValue(raw, { path: "thing", depth: 2 });
        if (sanitized.ok === false) return sanitized;
        thing = sanitized.value;
        if (thing.kind === "thing-collection") {
          if (!Array.isArray(thing.items) || !thing.items.length || thing.items.length > MAX_POST_THINGS || thing.items.some((item) => !item || typeof item !== "object" || !["data", "interactive"].includes(item.mode))) {
            return fail(400, `Attach 1-${MAX_POST_THINGS} Things with a data or interactive mode`);
          }
          const items = postThingReferences(thing);
          if (items.length !== thing.items.length) return fail(400, "Attached Things require unique valid ids");
          if (thing.data !== void 0 && (!thing.data || typeof thing.data !== "object" || Array.isArray(thing.data))) return fail(400, "Inline Thing data must be an object");
          thing = { kind: "thing-collection", items, ...thing.data ? { data: thing.data } : {} };
        }
      }
      if (!isShare && (!thing || !Object.keys(thing).length)) {
        return fail(400, "Thingtime posts need a thing with at least one field \u{1F300}");
      }
    }
    if (!isShare && type === "text" && !text2 && !hasAnyAttachment) return fail(400, "Say something first \u270D\uFE0F");
    if (!isShare && type === "image" && !images.length && !hasVisualAttachment) {
      return fail(400, "Image posts need at least one image or video attachment");
    }
    const layout = sanitizeMediaLayout(input.mediaLayout);
    if (layout.ok === false) return layout;
    if (input.title !== void 0 && input.title !== null && typeof input.title !== "string") {
      return fail(400, "title must be a string");
    }
    const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
    if (title.length > MAX_POST_TITLE_CHARS) return fail(400, `Post title is too long (max ${MAX_POST_TITLE_CHARS})`);
    let subspaceId = null;
    if (input.subspaceId !== void 0 && input.subspaceId !== null && input.subspaceId !== "") {
      if (typeof input.subspaceId !== "string" || !SUBSPACE_REF_PATTERN.test(input.subspaceId.trim())) {
        return fail(400, "subspaceId must be a subspace id");
      }
      subspaceId = input.subspaceId.trim();
    }
    let flairId = null;
    if (input.flairId !== void 0 && input.flairId !== null && input.flairId !== "") {
      if (typeof input.flairId !== "string" || !SUBSPACE_FLAIR_ID_PATTERN.test(input.flairId.trim())) {
        return fail(400, "flairId must be a flair id");
      }
      flairId = input.flairId.trim();
    }
    if (flairId && !subspaceId) return fail(400, "Flairs belong to subspace posts \u2014 set subspaceId too");
    return {
      ok: true,
      crystal: {
        type,
        text: text2,
        ...richTextProvided ? { richText } : {},
        images,
        listing,
        thing,
        ...layout.mediaLayout ? { mediaLayout: layout.mediaLayout } : {},
        ...title ? { title } : {},
        ...subspaceId ? { subspaceId } : {},
        ...flairId ? { flairId } : {}
      }
    };
  };
  var sanitizeCommentCrystal = (input, ids) => {
    if (ids?.includes("post")) return { ok: true, crystal: {} };
    const text2 = typeof input.text === "string" ? input.text.trim() : "";
    if (!text2) return fail(400, "Comment text is required");
    if (text2.length > MAX_COMMENT_CHARS) return fail(400, `Comment is too long (max ${MAX_COMMENT_CHARS})`);
    return { ok: true, crystal: { text: text2 } };
  };
  var sanitizeReactionCrystal = (input) => {
    const token = sanitizeReactionToken(input.emoji);
    if (!token) return fail(400, "Unsupported reaction");
    return { ok: true, crystal: { emoji: token } };
  };
  var KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
  var DATA_KEY_PATTERN = KEY_SEGMENT_PATTERN;
  var PROTOTYPE_POLLUTION_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  var sanitizeDataValue = (input, base) => {
    let rootOut;
    let nodes = 0;
    const seen = /* @__PURE__ */ new WeakSet();
    const stack = [
      {
        value: input,
        path: base?.path ?? "",
        depth: base?.depth ?? 1,
        assign: (out) => {
          rootOut = out;
        }
      }
    ];
    while (stack.length) {
      const item = stack.pop();
      const { value, path: path2, depth } = item;
      if (item.key !== void 0) {
        if (item.key.length > MAX_DATA_KEY_CHARS || !DATA_KEY_PATTERN.test(item.key)) {
          return fail(400, `Data keys are letters/numbers/_/- up to ${MAX_DATA_KEY_CHARS} chars (got ${item.key.slice(0, 80)})`);
        }
        if (PROTOTYPE_POLLUTION_KEYS.has(item.key)) {
          return fail(400, `Data keys cannot be prototype accessors (got ${item.key})`);
        }
      }
      nodes += 1;
      if (nodes > MAX_DATA_CRYSTAL_NODES) {
        return fail(400, `Data crystals can hold at most ${MAX_DATA_CRYSTAL_NODES} values`);
      }
      if (value === null || typeof value === "boolean") {
        item.assign(value);
        continue;
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return fail(400, `Data numbers must be finite (${path2})`);
        item.assign(value);
        continue;
      }
      if (typeof value === "string") {
        if (value.length > MAX_TEXT_CHARS) return fail(400, `Data strings cap at ${MAX_TEXT_CHARS} chars (${path2})`);
        item.assign(value);
        continue;
      }
      if (Array.isArray(value)) {
        if (seen.has(value)) return fail(400, `Data can\u2019t hold circular or repeated object references (${path2 || "root"})`);
        seen.add(value);
        if (depth > MAX_STORABLE_NESTING) {
          return fail(400, `MongoDB can store at most ${MAX_STORABLE_NESTING} nested levels per crystal (${path2 || "root"})`);
        }
        if (value.length > MAX_DATA_ARRAY_ITEMS) return fail(400, `Data arrays cap at ${MAX_DATA_ARRAY_ITEMS} items (${path2})`);
        const out = new Array(value.length);
        item.assign(out);
        for (let index = value.length - 1; index >= 0; index--) {
          const slot = index;
          stack.push({
            value: value[slot],
            path: `${path2}[${slot}]`,
            depth: depth + 1,
            assign: (child) => {
              out[slot] = child;
            }
          });
        }
        continue;
      }
      if (typeof value === "object") {
        if (seen.has(value)) return fail(400, `Data can\u2019t hold circular or repeated object references (${path2 || "root"})`);
        seen.add(value);
        if (depth > MAX_STORABLE_NESTING) {
          return fail(400, `MongoDB can store at most ${MAX_STORABLE_NESTING} nested levels per crystal (${path2 || "root"})`);
        }
        const out = {};
        item.assign(out);
        const entries = Object.entries(value);
        for (let index = entries.length - 1; index >= 0; index--) {
          const [key4, entry] = entries[index];
          stack.push({
            value: entry,
            path: path2 ? `${path2}.${key4}` : key4,
            depth: depth + 1,
            key: key4,
            assign: (child) => {
              out[key4] = child;
            }
          });
        }
        continue;
      }
      return fail(400, `Data values must be JSON (${path2})`);
    }
    return { ok: true, value: rootOut };
  };
  var sanitizeDataCrystal = (input) => {
    const sanitized = sanitizeDataValue(input);
    if (sanitized.ok === false) return sanitized;
    return { ok: true, crystal: sanitized.value };
  };
  var SCHEMA_FIELD_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
  var MAX_SCHEMA_FIELD_NAME_CHARS = 60;
  var MAX_SCHEMA_FIELD_DESCRIPTION_CHARS = 200;
  var SCHEMA_RESERVED_TOP_LEVEL_FIELD_NAMES = /* @__PURE__ */ new Set(["schema", "schemaid"]);
  var sanitizeCountConstraint = (raw, label, ceiling) => {
    if (raw === void 0 || raw === null) return { ok: true, value: null };
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0) return fail(400, `${label} must be a whole number \u2265 0`);
    if (num > ceiling) return fail(400, `${label} caps at ${ceiling}`);
    return { ok: true, value: num };
  };
  var sanitizeSchemaField = (raw, depth, counter, named, path2) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return fail(400, `Each schema field must be an object (${path2 || "fields"})`);
    }
    counter.nodes += 1;
    if (counter.nodes > MAX_SCHEMA_FIELDS) {
      return fail(400, `A schema can define at most ${MAX_SCHEMA_FIELDS} fields (nested ones count)`);
    }
    if (depth > MAX_SCHEMA_FIELD_DEPTH) {
      return fail(400, `Schema fields nest at most ${MAX_SCHEMA_FIELD_DEPTH} levels (${path2})`);
    }
    const def = raw;
    let fieldName = "";
    if (named) {
      fieldName = typeof def.name === "string" ? def.name.trim() : "";
      if (!fieldName || fieldName.length > MAX_SCHEMA_FIELD_NAME_CHARS || !SCHEMA_FIELD_NAME_PATTERN.test(fieldName)) {
        return fail(400, `Schema field names are letters/numbers/_/- \u2014 nest with children, not dots (got ${String(def.name).slice(0, 80)})`);
      }
      if (["__proto__", "prototype", "constructor"].includes(fieldName.toLowerCase())) return fail(400, `Unsafe schema field name: ${fieldName}`);
      if (depth === 1 && SCHEMA_RESERVED_TOP_LEVEL_FIELD_NAMES.has(fieldName.toLowerCase())) {
        return fail(400, `Field name ${fieldName} is reserved (it tags data things with their schema)`);
      }
    }
    const label = path2 || fieldName || "items";
    const type = SCHEMA_FIELD_TYPES.includes(def.type) ? def.type : null;
    if (!type) return fail(400, `Schema field types are ${SCHEMA_FIELD_TYPES.join(", ")} (${label})`);
    const field = named ? { name: fieldName, type } : { type };
    const fieldDescription = typeof def.description === "string" ? def.description.trim() : "";
    if (fieldDescription) field.description = fieldDescription.slice(0, MAX_SCHEMA_FIELD_DESCRIPTION_CHARS);
    if (named && (def.required === true || def.required === "true")) field.required = true;
    if (type === "enum") {
      if (!Array.isArray(def.values) || !def.values.length) return fail(400, `Enum field ${label} needs a values list`);
      if (def.values.length > MAX_SCHEMA_ENUM_VALUES) {
        return fail(400, `Enum field ${label} can have at most ${MAX_SCHEMA_ENUM_VALUES} values`);
      }
      const values = [];
      for (const value of def.values) {
        if (typeof value !== "string") return fail(400, `Enum field ${label} values must be strings`);
        const trimmed = value.replace(/\s+/g, " ").trim().slice(0, MAX_SCHEMA_ENUM_VALUE_CHARS);
        if (trimmed && !values.includes(trimmed)) values.push(trimmed);
      }
      if (!values.length) return fail(400, `Enum field ${label} needs a values list`);
      field.values = values;
    }
    if (type === "number") {
      const min = Number(def.min);
      const max = Number(def.max);
      if (def.min !== void 0 && def.min !== null) {
        if (!Number.isFinite(min)) return fail(400, `Field ${label} min must be a number`);
        field.min = min;
      }
      if (def.max !== void 0 && def.max !== null) {
        if (!Number.isFinite(max)) return fail(400, `Field ${label} max must be a number`);
        field.max = max;
      }
      if (field.min !== void 0 && field.max !== void 0 && field.min > field.max) {
        return fail(400, `Field ${label} min can\u2019t exceed its max`);
      }
      if (typeof def.unit === "string" && def.unit.trim()) {
        field.unit = def.unit.trim().slice(0, MAX_SCHEMA_UNIT_CHARS);
      }
    }
    if (type === "string" || type === "string[]") {
      const maxLength = sanitizeCountConstraint(def.maxLength, `Field ${label} maxLength`, MAX_TEXT_CHARS);
      if (isFail(maxLength)) return maxLength;
      if (maxLength.value !== null && maxLength.value > 0) field.maxLength = maxLength.value;
    }
    if (type === "string[]" || type === "array") {
      const minItems = sanitizeCountConstraint(def.minItems, `Field ${label} minItems`, MAX_DATA_ARRAY_ITEMS);
      if (isFail(minItems)) return minItems;
      const maxItems = sanitizeCountConstraint(def.maxItems, `Field ${label} maxItems`, MAX_DATA_ARRAY_ITEMS);
      if (isFail(maxItems)) return maxItems;
      if (minItems.value !== null) field.minItems = minItems.value;
      if (maxItems.value !== null) field.maxItems = maxItems.value;
      if (field.minItems !== void 0 && field.maxItems !== void 0 && field.minItems > field.maxItems) {
        return fail(400, `Field ${label} minItems can\u2019t exceed its maxItems`);
      }
    }
    if (type === "object") {
      const children = sanitizeSchemaFieldList(def.children, depth + 1, counter, `${label}.children`);
      if (isFail(children)) return children;
      field.children = children.fields;
    }
    if (type === "array") {
      if (!def.items || typeof def.items !== "object" || Array.isArray(def.items)) {
        return fail(400, `Array field ${label} needs an items spec ({ type, ... })`);
      }
      const items = sanitizeSchemaField(def.items, depth + 1, counter, false, `${label}.items`);
      if (isFail(items)) return items;
      field.items = items.field;
    }
    return { ok: true, field };
  };
  var sanitizeSchemaFieldList = (raw, depth, counter, path2, allowEmpty = false) => {
    if (!Array.isArray(raw)) return fail(400, `Schema fields must be a list (${path2})`);
    const fields2 = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of raw) {
      const sanitized = sanitizeSchemaField(entry, depth, counter, true, path2);
      if (isFail(sanitized)) return sanitized;
      const key4 = sanitized.field.name.toLowerCase();
      if (seen.has(key4)) return fail(400, `Duplicate schema field name: ${sanitized.field.name} (${path2})`);
      seen.add(key4);
      fields2.push(sanitized.field);
    }
    if (!fields2.length && !allowEmpty) return fail(400, `Schemas need at least one field (${path2})`);
    return { ok: true, fields: fields2 };
  };
  var SCHEMA_RENDER_BLOCKED_KEYS = PROTOTYPE_POLLUTION_KEYS;
  var checkSchemaRenderTree = (value, depth, counter) => {
    counter.nodes++;
    if (counter.nodes > MAX_SCHEMA_RENDER_NODES) {
      return fail(400, `render can hold at most ${MAX_SCHEMA_RENDER_NODES} nodes`);
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
    if (depth >= MAX_SCHEMA_RENDER_DEPTH) return fail(400, `render nests at most ${MAX_SCHEMA_RENDER_DEPTH} levels`);
    if (Array.isArray(value)) {
      for (const entry of value) {
        const checked = checkSchemaRenderTree(entry, depth + 1, counter);
        if (checked !== true) return checked;
      }
      return true;
    }
    if (typeof value === "object") {
      for (const [key4, entry] of Object.entries(value)) {
        if (key4.includes("\0") || key4.includes(".") || key4.startsWith("$") || SCHEMA_RENDER_BLOCKED_KEYS.has(key4)) {
          return fail(400, `render keys can\u2019t contain dots or null bytes, start with $, or shadow object internals (${key4.slice(0, 40)})`);
        }
        const checked = checkSchemaRenderTree(entry, depth + 1, counter);
        if (checked !== true) return checked;
      }
      return true;
    }
    return fail(400, "render must be JSON-serializable (objects, arrays, strings, numbers, booleans)");
  };
  var sanitizeSchemaRender = (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return fail(400, "render must be a serialised component object");
    }
    const root = input;
    const chakraShaped = typeof root.chakra === "string" || root.type === "chakra";
    const elementShaped = typeof root.tag === "string";
    if (!chakraShaped && !elementShaped) {
      return fail(400, 'render must be chakra shaped ({ chakra: "Box", \u2026 }) or element shaped ({ tag: "div", \u2026 })');
    }
    let serialized;
    try {
      serialized = JSON.stringify(input);
    } catch {
      return fail(400, "render must be JSON-serializable");
    }
    if (typeof serialized !== "string") return fail(400, "render must be JSON-serializable");
    if (serialized.length > MAX_SCHEMA_RENDER_BYTES) {
      return fail(400, `render exceeds the ${MAX_SCHEMA_RENDER_BYTES} byte limit`);
    }
    if (serialized.length * 3 > MAX_SCHEMA_RENDER_BYTES) {
      const bytes = new TextEncoder().encode(serialized).byteLength;
      if (bytes > MAX_SCHEMA_RENDER_BYTES) {
        return fail(400, `render exceeds the ${MAX_SCHEMA_RENDER_BYTES} byte limit`);
      }
    }
    const checked = checkSchemaRenderTree(input, 0, { nodes: 0 });
    if (checked !== true) return checked;
    return { ok: true, render: root };
  };
  var sanitizeSchemaCrystal = (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return fail(400, "Schemas need a name");
    if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Schema name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);
    const description = typeof input.description === "string" ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : "";
    const sanitized = sanitizeSchemaFieldList(input.fields, 1, { nodes: 0 }, "fields", true);
    if (isFail(sanitized)) return sanitized;
    const crystal = { name, description, fields: sanitized.fields };
    if (input.forkOf !== void 0 && input.forkOf !== null && input.forkOf !== "") {
      const forkOf = typeof input.forkOf === "string" ? input.forkOf.trim() : "";
      if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, "forkOf must be a thing id");
      crystal.forkOf = forkOf;
    }
    if (input.render !== void 0 && input.render !== null) {
      const render = sanitizeSchemaRender(input.render);
      if (isFail(render)) return render;
      crystal.render = render.render;
    }
    return { ok: true, crystal };
  };
  var sanitizeComponentArgScalar = (value, cap) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") return value.slice(0, cap);
    return null;
  };
  var sanitizeComponentArgs = (input) => {
    if (!Array.isArray(input)) return fail(400, "Component args must be a list of arg descriptors");
    if (input.length > MAX_COMPONENT_ARGS) return fail(400, `Components can declare at most ${MAX_COMPONENT_ARGS} args`);
    const args = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of input) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail(400, "Each component arg must be an object");
      const raw = entry;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name || name.length > MAX_COMPONENT_ARG_NAME_CHARS || !COMPONENT_ARG_NAME_PATTERN.test(name)) {
        return fail(400, `Component arg names must match ${COMPONENT_ARG_NAME_PATTERN} (got "${String(raw.name).slice(0, 40)}")`);
      }
      const lower = name.toLowerCase();
      if (seen.has(lower)) return fail(400, `Duplicate component arg: ${name}`);
      seen.add(lower);
      const type = typeof raw.type === "string" ? raw.type : "";
      if (!COMPONENT_ARG_TYPES.includes(type)) {
        return fail(400, `Component arg ${name} has an unknown type (expected ${COMPONENT_ARG_TYPES.join("/")})`);
      }
      const arg = { name, type };
      if (typeof raw.label === "string" && raw.label.trim()) arg.label = raw.label.trim().slice(0, MAX_COMPONENT_ARG_LABEL_CHARS);
      if (typeof raw.description === "string" && raw.description.trim()) {
        arg.description = raw.description.trim().slice(0, MAX_COMPONENT_ARG_DESCRIPTION_CHARS);
      }
      if (type === "enum") {
        if (!Array.isArray(raw.values) || !raw.values.length || raw.values.length > MAX_SCHEMA_ENUM_VALUES) {
          return fail(400, `Enum arg ${name} needs 1\u2013${MAX_SCHEMA_ENUM_VALUES} values`);
        }
        const values = [];
        for (const value of raw.values) {
          if (typeof value !== "string" || !value.trim() || value.length > MAX_SCHEMA_ENUM_VALUE_CHARS) {
            return fail(400, `Enum arg ${name} has an invalid value`);
          }
          if (!values.includes(value)) values.push(value);
        }
        arg.values = values;
      }
      if (raw.default !== void 0) {
        const fallback = sanitizeComponentArgScalar(raw.default, MAX_COMPONENT_ARG_DEFAULT_CHARS);
        if (fallback === null && raw.default !== null) return fail(400, `Arg ${name} default must be a string, number, or boolean`);
        if (fallback !== null) arg.default = fallback;
      }
      if (typeof raw.min === "number" && Number.isFinite(raw.min)) arg.min = raw.min;
      if (typeof raw.max === "number" && Number.isFinite(raw.max)) arg.max = raw.max;
      if (typeof raw.maxLength === "number" && Number.isFinite(raw.maxLength)) {
        arg.maxLength = Math.max(1, Math.min(Math.round(raw.maxLength), MAX_TEXT_CHARS));
      }
      args.push(arg);
    }
    return { ok: true, args };
  };
  var sanitizeSourceBinding = (input) => {
    if (typeof input !== "object" || Array.isArray(input)) return fail(400, `Component/page source must be an object`);
    const rawSource = input;
    const action = typeof rawSource.action === "string" ? rawSource.action.trim() : "";
    if (!action || action.length > MAX_ACTION_KEY_CHARS || !ACTION_KEY_PATTERN.test(action)) {
      return fail(400, `Component/page source.action must be an actionKey (lowercase-dashed slug)`);
    }
    const source = { action };
    if (rawSource.inputs !== void 0 && rawSource.inputs !== null) {
      if (typeof rawSource.inputs !== "object" || Array.isArray(rawSource.inputs)) {
        return fail(400, `Component/page source.inputs must be an object of scalar input values`);
      }
      const inputs = {};
      const entries = Object.entries(rawSource.inputs);
      if (entries.length > MAX_ACTION_INPUTS) return fail(400, `Component/page source.inputs can hold at most ${MAX_ACTION_INPUTS} entries`);
      for (const [key4, value] of entries) {
        if (!COMPONENT_ARG_NAME_PATTERN.test(key4) || key4.length > MAX_COMPONENT_ARG_NAME_CHARS) {
          return fail(400, `Component/page source input "${key4.slice(0, 40)}" is not a valid input name`);
        }
        const scalar = sanitizeComponentArgScalar(value, MAX_COMPONENT_SAVED_ARG_CHARS);
        if (scalar === null && value !== null) return fail(400, `Component/page source input ${key4} must be a string, number, or boolean`);
        if (scalar !== null) inputs[key4] = scalar;
      }
      if (Object.keys(inputs).length) source.inputs = inputs;
    }
    if (rawSource.refresh !== void 0 && rawSource.refresh !== null) {
      if (rawSource.refresh !== "load" && rawSource.refresh !== "manual" && rawSource.refresh !== "interval" && rawSource.refresh !== "live") {
        return fail(400, `Component/page source.refresh must be load, manual, interval, or live`);
      }
      if (rawSource.refresh !== "load") source.refresh = rawSource.refresh;
    }
    if (rawSource.stream !== void 0 || rawSource.refresh === "live") {
      const stream = validateLiveSource(rawSource.stream);
      if (!stream) return fail(400, "Component/page live source must use a registered read-only stream adapter");
      source.stream = stream;
    }
    if (rawSource.intervalMs !== void 0 && rawSource.intervalMs !== null) {
      const intervalMs = Number(rawSource.intervalMs);
      if (!Number.isInteger(intervalMs) || intervalMs < MIN_WEBPAGE_SOURCE_INTERVAL_MS || intervalMs > MAX_WEBPAGE_SOURCE_INTERVAL_MS) {
        return fail(400, `Component/page source.intervalMs must be ${MIN_WEBPAGE_SOURCE_INTERVAL_MS}\u2013${MAX_WEBPAGE_SOURCE_INTERVAL_MS}`);
      }
      if (source.refresh === "interval") source.intervalMs = intervalMs;
    }
    return { ok: true, source };
  };
  var sanitizeComponentCrystal = (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return fail(400, "Components need a name");
    if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Component name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);
    const crystal = { name };
    const description = typeof input.description === "string" ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : "";
    if (description) crystal.description = description;
    const library = typeof input.library === "string" ? input.library.trim() : "";
    crystal.library = COMPONENT_LIBRARIES.includes(library) ? library : "custom";
    const category = typeof input.category === "string" ? input.category.trim().slice(0, MAX_COMPONENT_CATEGORY_CHARS) : "";
    crystal.category = category || "general";
    if (input.componentKey !== void 0 && input.componentKey !== null && input.componentKey !== "") {
      const componentKey = typeof input.componentKey === "string" ? input.componentKey.trim() : "";
      if (!componentKey || componentKey.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(componentKey)) {
        return fail(400, "componentKey must be a lowercase-dashed slug");
      }
      crystal.componentKey = componentKey;
    }
    if (input.familyKey !== void 0 && input.familyKey !== null && input.familyKey !== "") {
      const familyKey = typeof input.familyKey === "string" ? input.familyKey.trim() : "";
      if (!familyKey || familyKey.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(familyKey)) {
        return fail(400, "familyKey must be a lowercase-dashed slug");
      }
      crystal.familyKey = familyKey;
    }
    if (input.version !== void 0 && input.version !== null) {
      const version = Number(input.version);
      if (!Number.isInteger(version) || version < 1 || version > 999999) return fail(400, "version must be a positive integer");
      crystal.version = version;
    }
    if (input.forkOf !== void 0 && input.forkOf !== null && input.forkOf !== "") {
      const forkOf = typeof input.forkOf === "string" ? input.forkOf.trim() : "";
      if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, "forkOf must be a thing id");
      crystal.forkOf = forkOf;
    }
    if (input.previewBg !== void 0 && input.previewBg !== null && input.previewBg !== "") {
      const previewBg = typeof input.previewBg === "string" ? input.previewBg.trim() : "";
      if (!previewBg || previewBg.length > MAX_COMPONENT_PREVIEW_BG_CHARS || /[<>]|javascript:/i.test(previewBg)) {
        return fail(400, "previewBg must be a short CSS background value");
      }
      crystal.previewBg = previewBg;
    }
    if (input.args !== void 0 && input.args !== null) {
      const args = sanitizeComponentArgs(input.args);
      if (isFail(args)) return args;
      if (args.args.length) crystal.args = args.args;
    }
    if (input.savedArgs !== void 0 && input.savedArgs !== null) {
      if (typeof input.savedArgs !== "object" || Array.isArray(input.savedArgs)) {
        return fail(400, "savedArgs must be an object of scalar arg values");
      }
      const savedArgs = {};
      const entries = Object.entries(input.savedArgs);
      if (entries.length > MAX_COMPONENT_SAVED_ARGS) return fail(400, `savedArgs can hold at most ${MAX_COMPONENT_SAVED_ARGS} entries`);
      for (const [key4, value] of entries) {
        if (!COMPONENT_ARG_NAME_PATTERN.test(key4) || key4.length > MAX_COMPONENT_ARG_NAME_CHARS) {
          return fail(400, `savedArgs key "${key4.slice(0, 40)}" is not a valid arg name`);
        }
        const scalar = sanitizeComponentArgScalar(value, MAX_COMPONENT_SAVED_ARG_CHARS);
        if (scalar === null && value !== null) return fail(400, `savedArgs.${key4} must be a string, number, or boolean`);
        if (scalar !== null) savedArgs[key4] = scalar;
      }
      if (Object.keys(savedArgs).length) crystal.savedArgs = savedArgs;
    }
    if (input.render === void 0 || input.render === null) {
      return fail(400, 'Components need a render template ({ tag: "div", \u2026 })');
    }
    const render = sanitizeSchemaRender(input.render);
    if (isFail(render)) return render;
    crystal.render = render.render;
    if (input.source !== void 0 && input.source !== null) {
      const checked = sanitizeSourceBinding(input.source);
      if (isFail(checked)) return checked;
      crystal.source = checked.source;
    }
    return { ok: true, crystal };
  };
  var isSafeWebpageCssValue = (value) => {
    if (/[<>{}]/.test(value)) return false;
    const lower = value.toLowerCase();
    if (lower.includes("expression(") || lower.includes("@import") || lower.includes("javascript:")) return false;
    const urlMatches = lower.matchAll(/url\(\s*['"]?([^'")]*)/g);
    for (const match of urlMatches) {
      const target = (match[1] || "").trim();
      if (!/^(https:\/\/|\/(?![/\\])|data:image\/)/.test(target)) return false;
    }
    return true;
  };
  var isSafeWebpageMediaSrc = (value) => /^(https:\/\/|\/(?![/\\]))/.test(value) && !/\s/.test(value);
  var isSafeWebpageHref = (value) => isSafeWebpageMediaSrc(value) || /^(mailto:|tel:)[^\s/][^\s]*$/i.test(value);
  var sanitizeWebpageBlock = (input, depth, state) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return fail(400, "Each webpage block must be an object");
    }
    if (depth > MAX_WEBPAGE_BLOCK_DEPTH) return fail(400, `Webpage blocks nest at most ${MAX_WEBPAGE_BLOCK_DEPTH} levels`);
    state.nodes += 1;
    if (state.nodes > MAX_WEBPAGE_BLOCKS) return fail(400, `Webpages can hold at most ${MAX_WEBPAGE_BLOCKS} blocks`);
    const raw = input;
    const id3 = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id3 || id3.length > MAX_WEBPAGE_BLOCK_ID_CHARS || !COMPONENT_KEY_PATTERN.test(id3)) {
      return fail(400, "Every block needs a lowercase-dashed id");
    }
    if (state.ids.has(id3)) return fail(400, `Duplicate block id: ${id3}`);
    state.ids.add(id3);
    const type = typeof raw.type === "string" ? raw.type : "";
    if (!WEBPAGE_BLOCK_TYPES.includes(type)) {
      return fail(400, `Block ${id3} has an unknown type (expected ${WEBPAGE_BLOCK_TYPES.join("/")})`);
    }
    const block = { id: id3, type };
    const align = typeof raw.align === "string" ? raw.align : "";
    if (align) {
      if (!WEBPAGE_BLOCK_ALIGNS.includes(align)) {
        return fail(400, `Block ${id3} align must be ${WEBPAGE_BLOCK_ALIGNS.join("/")}`);
      }
      block.align = align;
    }
    if (raw.maxWidth !== void 0 && raw.maxWidth !== null) {
      const maxWidth = Number(raw.maxWidth);
      if (!Number.isInteger(maxWidth) || maxWidth < 120 || maxWidth > 1680) {
        return fail(400, `Block ${id3} maxWidth must be 120\u20131680`);
      }
      block.maxWidth = maxWidth;
    }
    if (raw.css !== void 0 && raw.css !== null) {
      if (typeof raw.css !== "object" || Array.isArray(raw.css)) {
        return fail(400, `Block ${id3} css must be an object of css property \u2192 value`);
      }
      const entries = Object.entries(raw.css);
      if (entries.length > MAX_WEBPAGE_CSS_PROPS) {
        return fail(400, `Block ${id3} css can hold at most ${MAX_WEBPAGE_CSS_PROPS} properties`);
      }
      const css = {};
      for (const [key4, value] of entries) {
        if (!WEBPAGE_CSS_KEY_PATTERN.test(key4) || key4.length > MAX_WEBPAGE_CSS_KEY_CHARS) {
          return fail(400, `Block ${id3} css key "${key4.slice(0, 40)}" must be a kebab-case css property`);
        }
        if (typeof value !== "string" || !value.trim()) continue;
        if (value.length > MAX_WEBPAGE_CSS_VALUE_CHARS) {
          return fail(400, `Block ${id3} css value for ${key4} is too long (max ${MAX_WEBPAGE_CSS_VALUE_CHARS})`);
        }
        if (!isSafeWebpageCssValue(value)) {
          return fail(400, `Block ${id3} css value for ${key4} contains a blocked construct`);
        }
        css[key4] = value.trim();
      }
      if (Object.keys(css).length) block.css = css;
    }
    if (raw.args !== void 0 && raw.args !== null) {
      if (typeof raw.args !== "object" || Array.isArray(raw.args)) {
        return fail(400, `Block ${id3} args must be an object of scalar arg values`);
      }
      const args = {};
      const entries = Object.entries(raw.args);
      if (entries.length > MAX_COMPONENT_SAVED_ARGS) {
        return fail(400, `Block ${id3} args can hold at most ${MAX_COMPONENT_SAVED_ARGS} entries`);
      }
      for (const [key4, value] of entries) {
        if (!COMPONENT_ARG_NAME_PATTERN.test(key4) || key4.length > MAX_COMPONENT_ARG_NAME_CHARS) {
          return fail(400, `Block ${id3} arg key "${key4.slice(0, 40)}" is not a valid arg name`);
        }
        const scalar = sanitizeComponentArgScalar(value, MAX_COMPONENT_SAVED_ARG_CHARS);
        if (scalar === null && value !== null) return fail(400, `Block ${id3} arg ${key4} must be a string, number, or boolean`);
        if (scalar !== null) args[key4] = scalar;
      }
      if (Object.keys(args).length) block.args = args;
    }
    if (raw.source != null) {
      const checked = sanitizeSourceBinding(raw.source);
      if (isFail(checked)) return checked;
      block.source = checked.source;
    }
    if (type === "element" || type === "collection" || type === "condition") {
      if (type === "element") {
        const tag = typeof raw.tag === "string" ? raw.tag.toLowerCase() : "div";
        if (!HTML_ALLOWED_TAGS.has(tag) || tag.startsWith("tt-") && tag !== "tt-media-pipeline") return fail(400, "Element blocks require a safe HTML tag");
        if (tag === "tt-media-pipeline") {
          try {
            validateMediaPipeline(raw.props?.pipeline);
          } catch (error) {
            return fail(400, error instanceof Error ? error.message : "Invalid media pipeline");
          }
        }
        block.tag = tag;
        if (typeof raw.text === "string") block.text = raw.text;
      }
      for (const key4 of ["props", "condition", "format"]) {
        if (raw[key4] == null) continue;
        if (typeof raw[key4] !== "object" || Array.isArray(raw[key4])) return fail(400, `Block ${key4} must be an object`);
        const checked = checkSchemaRenderTree(raw[key4], 0, { nodes: 0 });
        if (checked !== true) return checked;
        block[key4] = raw[key4];
      }
      if (raw.children != null && !Array.isArray(raw.children)) return fail(400, "Block children must be a list");
      const children = [];
      for (const child of raw.children || []) {
        const checked = sanitizeWebpageBlock(child, depth + 1, state);
        if (isFail(checked)) return checked;
        children.push(checked.block);
      }
      if (children.length || type !== "element") block.children = children;
      return { ok: true, block };
    }
    if (type === "component") {
      const component = typeof raw.component === "string" ? raw.component.trim() : "";
      if (!component || component.length > MAX_WEBPAGE_BLOCK_REF_CHARS || /[$\s]/.test(component)) {
        return fail(400, `Block ${id3} needs a component reference (componentKey or shareId)`);
      }
      block.component = component;
      if (raw.source !== void 0 && raw.source !== null) {
        const checked = sanitizeSourceBinding(raw.source);
        if (isFail(checked)) return checked;
        block.source = checked.source;
      }
      return { ok: true, block };
    }
    if (type === "container") {
      const direction = typeof raw.direction === "string" ? raw.direction : "column";
      if (!WEBPAGE_CONTAINER_DIRECTIONS.includes(direction)) {
        return fail(400, `Block ${id3} direction must be ${WEBPAGE_CONTAINER_DIRECTIONS.join("/")}`);
      }
      block.direction = direction;
      if (raw.gap !== void 0 && raw.gap !== null) {
        const gap = Number(raw.gap);
        if (!Number.isInteger(gap) || gap < 0 || gap > 12) return fail(400, `Block ${id3} gap must be 0\u201312`);
        block.gap = gap;
      }
      if (raw.columns !== void 0 && raw.columns !== null) {
        const columns = Number(raw.columns);
        if (!Number.isInteger(columns) || columns < 1 || columns > 6) return fail(400, `Block ${id3} columns must be 1\u20136`);
        block.columns = columns;
      }
      const children = [];
      if (raw.children !== void 0 && raw.children !== null) {
        if (!Array.isArray(raw.children)) return fail(400, `Block ${id3} children must be a list of blocks`);
        for (const child of raw.children) {
          const sanitized = sanitizeWebpageBlock(child, depth + 1, state);
          if (isFail(sanitized)) return sanitized;
          children.push(sanitized.block);
        }
      }
      block.children = children;
      return { ok: true, block };
    }
    if (type === "text") {
      const text2 = typeof raw.text === "string" ? raw.text : "";
      const html = typeof raw.html === "string" ? raw.html : "";
      if (!text2.trim() && !html.trim()) return fail(400, `Block ${id3} needs text`);
      block.text = text2.slice(0, MAX_WEBPAGE_TEXT_CHARS);
      if (html.trim()) {
        if (html.length > MAX_WEBPAGE_HTML_CHARS) {
          return fail(400, `Block ${id3} rich text is too long (max ${MAX_WEBPAGE_HTML_CHARS} chars)`);
        }
        block.html = html;
      }
      const style = typeof raw.style === "string" ? raw.style : "";
      if (style) {
        if (!WEBPAGE_TEXT_STYLES.includes(style)) {
          return fail(400, `Block ${id3} style must be ${WEBPAGE_TEXT_STYLES.join("/")}`);
        }
        block.style = style;
      }
      const tag = typeof raw.tag === "string" ? raw.tag.toLowerCase() : "";
      if (tag) {
        if (!WEBPAGE_TEXT_TAGS.includes(tag)) {
          return fail(400, `Block ${id3} tag must be ${WEBPAGE_TEXT_TAGS.join("/")}`);
        }
        block.tag = tag;
      }
      const href = typeof raw.href === "string" ? raw.href.trim() : "";
      if (href) {
        if (href.length > MAX_WEBPAGE_MEDIA_SRC_CHARS || !isSafeWebpageHref(href)) {
          return fail(400, `Block ${id3} href must be an https, site-relative, mailto:, or tel: link`);
        }
        block.href = href;
      }
      return { ok: true, block };
    }
    if (type === "media") {
      const src = typeof raw.src === "string" ? raw.src.trim() : "";
      if (src && (src.length > MAX_WEBPAGE_MEDIA_SRC_CHARS || !isSafeWebpageMediaSrc(src))) {
        return fail(400, `Block ${id3} src must be an https or site-relative URL`);
      }
      block.src = src;
      const media = typeof raw.media === "string" ? raw.media : "image";
      if (!WEBPAGE_MEDIA_KINDS.includes(media)) {
        return fail(400, `Block ${id3} media must be ${WEBPAGE_MEDIA_KINDS.join("/")}`);
      }
      block.media = media;
      const alt = typeof raw.alt === "string" ? raw.alt.trim() : "";
      if (alt) block.alt = alt.slice(0, 300);
      return { ok: true, block };
    }
    if (type === "html") {
      const html = typeof raw.html === "string" ? raw.html : "";
      if (!html.trim()) return fail(400, `Block ${id3} needs html`);
      if (html.length > MAX_WEBPAGE_HTML_CHARS) {
        return fail(400, `Block ${id3} html is too long (max ${MAX_WEBPAGE_HTML_CHARS} chars)`);
      }
      block.html = html;
      return { ok: true, block };
    }
    const native = typeof raw.native === "string" ? raw.native.trim() : "";
    if (!native || native.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(native)) {
      return fail(400, `Block ${id3} needs a native screen key (lowercase-dashed slug)`);
    }
    block.native = native;
    return { ok: true, block };
  };
  var sanitizeWebpageBlocks = (input) => {
    if (!Array.isArray(input)) return fail(400, "Webpage blocks must be a list");
    const state = { nodes: 0, ids: /* @__PURE__ */ new Set() };
    const blocks = [];
    const pending = input.map((entry) => ({ entry, target: blocks }));
    const seen = /* @__PURE__ */ new Set();
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const { entry, target } = pending[cursor];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail(400, "Each webpage block must be an object");
      if (seen.has(entry)) return fail(400, "Webpage blocks must be an acyclic tree");
      seen.add(entry);
      const raw = entry;
      if (raw.children != null && !Array.isArray(raw.children)) return fail(400, "Block children must be a list");
      const sanitized = sanitizeWebpageBlock({ ...raw, children: void 0 }, 1, state);
      if (isFail(sanitized)) return sanitized;
      target.push(sanitized.block);
      if (Array.isArray(raw.children)) {
        if (!["container", "element", "collection", "condition"].includes(String(raw.type))) return fail(400, "This block type cannot contain children");
        const children = [];
        sanitized.block.children = children;
        for (const child of raw.children) pending.push({ entry: child, target: children });
      }
    }
    let serialized = "";
    try {
      serialized = JSON.stringify(blocks);
    } catch {
      return fail(400, "Webpage blocks must be JSON-serialisable");
    }
    if (serialized.length > MAX_WEBPAGE_BLOCKS_BYTES) {
      return fail(400, `Webpage blocks are too large (max ${MAX_WEBPAGE_BLOCKS_BYTES} bytes)`);
    }
    return { ok: true, blocks };
  };
  var sanitizeWebpageCrystal = (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return fail(400, "Webpages need a name");
    if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Webpage name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);
    const crystal = { name };
    const description = typeof input.description === "string" ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : "";
    if (description) crystal.description = description;
    if (input.pageKey !== void 0 && input.pageKey !== null && input.pageKey !== "") {
      const pageKey = typeof input.pageKey === "string" ? input.pageKey.trim() : "";
      if (!pageKey || pageKey.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(pageKey)) {
        return fail(400, "pageKey must be a lowercase-dashed slug");
      }
      crystal.pageKey = pageKey;
    }
    if (input.suiteKey !== void 0 && input.suiteKey !== null && input.suiteKey !== "") {
      const suiteKey = typeof input.suiteKey === "string" ? input.suiteKey.trim() : "";
      if (!suiteKey || suiteKey.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(suiteKey)) {
        return fail(400, "suiteKey must be a lowercase-dashed slug");
      }
      crystal.suiteKey = suiteKey;
    }
    if (input.siteRoute !== void 0 && input.siteRoute !== null && input.siteRoute !== "") {
      const siteRoute = typeof input.siteRoute === "string" ? input.siteRoute.trim() : "";
      if (!siteRoute || siteRoute.length > MAX_WEBPAGE_ROUTE_CHARS || !WEBPAGE_ROUTE_PATTERN.test(siteRoute)) {
        return fail(400, "siteRoute must be an app path like /status");
      }
      crystal.siteRoute = siteRoute;
    }
    if (input.version !== void 0 && input.version !== null) {
      const version = Number(input.version);
      if (!Number.isInteger(version) || version < 1 || version > 999999) return fail(400, "version must be a positive integer");
      crystal.version = version;
    }
    if (input.forkOf !== void 0 && input.forkOf !== null && input.forkOf !== "") {
      const forkOf = typeof input.forkOf === "string" ? input.forkOf.trim() : "";
      if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, "forkOf must be a thing id");
      crystal.forkOf = forkOf;
    }
    if (input.previewBg !== void 0 && input.previewBg !== null && input.previewBg !== "") {
      const previewBg = typeof input.previewBg === "string" ? input.previewBg.trim() : "";
      if (!previewBg || previewBg.length > MAX_COMPONENT_PREVIEW_BG_CHARS || !isSafeWebpageCssValue(previewBg)) {
        return fail(400, "previewBg must be a short CSS background value");
      }
      crystal.previewBg = previewBg;
    }
    if (input.blocks === void 0 || input.blocks === null) {
      return fail(400, "Webpages need a blocks list (may be empty)");
    }
    const blocks = sanitizeWebpageBlocks(input.blocks);
    if (isFail(blocks)) return blocks;
    crystal.blocks = blocks.blocks;
    return { ok: true, crystal };
  };
  var ACTION_REF_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  var ACTION_BANNED_SEGMENTS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  var ACTION_STEP_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
  var MAX_ACTION_REF_PATH_SEGMENTS = 6;
  var parseRefPath = (value, segments) => {
    if (segments.length > MAX_ACTION_REF_PATH_SEGMENTS) return fail(400, `Reference path is too deep "${value.slice(0, 80)}"`);
    for (const segment of segments) {
      if (!ACTION_REF_SEGMENT_PATTERN.test(segment) || ACTION_BANNED_SEGMENTS.has(segment)) {
        return fail(400, `Invalid reference segment in "${value.slice(0, 80)}"`);
      }
    }
    return segments;
  };
  var parseActionRef = (value) => {
    if (!value.startsWith("$") || value.startsWith("$$")) return null;
    if (value === "$now") return { kind: "now" };
    if (value === "$index") return { kind: "index" };
    const parts = value.slice(1).split(".");
    if (parts[0] === "input") {
      if (parts.length !== 2 || !COMPONENT_ARG_NAME_PATTERN.test(parts[1])) {
        return fail(400, `Invalid input reference "${value.slice(0, 80)}" (expected $input.<name>)`);
      }
      return { kind: "input", name: parts[1] };
    }
    if (parts[0] === "step") {
      const step = Number(parts[1]);
      if (!Number.isInteger(step) || step < 1 || step > MAX_ACTION_STEPS) {
        return fail(400, `Invalid step reference "${value.slice(0, 80)}" (expected $step.<n> with n 1\u2013${MAX_ACTION_STEPS})`);
      }
      const path2 = parseRefPath(value, parts.slice(2));
      if (!Array.isArray(path2)) return path2;
      return { kind: "step", step, path: path2 };
    }
    if (parts[0] === "viewer") {
      if (parts.length !== 2 || parts[1] !== "id" && parts[1] !== "username") {
        return fail(400, `Invalid viewer reference "${value.slice(0, 80)}" (expected $viewer.id or $viewer.username)`);
      }
      return { kind: "viewer", field: parts[1] };
    }
    if (parts[0] === "item") {
      const path2 = parseRefPath(value, parts.slice(1));
      if (!Array.isArray(path2)) return path2;
      return { kind: "item", path: path2 };
    }
    return fail(400, `Unknown reference root "${value.slice(0, 80)}" (expected $input, $step, $now, $viewer, $item, or $index)`);
  };
  var TOP_SCOPE = { itemDepth: 0 };
  var validateActionValue = (value, stepIndex, depth = 0, scope2 = TOP_SCOPE) => {
    if (depth > MAX_ACTION_STEP_VALUE_DEPTH) return fail(400, `Step ${stepIndex} values nest too deeply (max ${MAX_ACTION_STEP_VALUE_DEPTH})`);
    if (value === null || typeof value === "boolean") return { ok: true };
    if (typeof value === "number") {
      return Number.isFinite(value) ? { ok: true } : fail(400, `Step ${stepIndex} numbers must be finite`);
    }
    if (typeof value === "string") {
      if (value.length > MAX_ACTION_STEP_STRING_CHARS) {
        return fail(400, `Step ${stepIndex} strings cap at ${MAX_ACTION_STEP_STRING_CHARS} characters`);
      }
      const ref = parseActionRef(value);
      if (ref && !("kind" in ref)) return ref;
      if (ref && "kind" in ref && ref.kind === "step" && ref.step >= stepIndex) {
        return fail(400, `Step ${stepIndex} references $step.${ref.step} before it has run`);
      }
      if (ref && "kind" in ref && (ref.kind === "item" || ref.kind === "index") && scope2.itemDepth <= 0) {
        return fail(400, `Step ${stepIndex} uses ${value.slice(0, 40)} outside an each step or a list lambda`);
      }
      return { ok: true };
    }
    if (typeof value !== "object") return fail(400, `Step ${stepIndex} values must be JSON data`);
    if (Array.isArray(value)) {
      if (value.length > MAX_ACTION_STEP_VALUE_KEYS) return fail(400, `Step ${stepIndex} lists cap at ${MAX_ACTION_STEP_VALUE_KEYS} entries`);
      for (const entry of value) {
        const checked = validateActionValue(entry, stepIndex, depth + 1, scope2);
        if (isFail(checked)) return checked;
      }
      return { ok: true };
    }
    const record3 = value;
    const keys4 = Object.keys(record3);
    if (keys4.length === 1 && keys4[0] === "ttConcat") {
      if (!Array.isArray(record3.ttConcat) || !record3.ttConcat.length || record3.ttConcat.length > MAX_ACTION_CONCAT_PARTS) {
        return fail(400, `ttConcat needs 1\u2013${MAX_ACTION_CONCAT_PARTS} parts`);
      }
      for (const part of record3.ttConcat) {
        if (typeof part !== "string" && typeof part !== "number" && typeof part !== "boolean" && !(part && typeof part === "object" && !Array.isArray(part))) {
          return fail(400, "ttConcat parts must be strings, numbers, booleans, refs, or expressions");
        }
        const checked = validateActionValue(part, stepIndex, depth + 1, scope2);
        if (isFail(checked)) return checked;
      }
      return { ok: true };
    }
    if (keys4.length === 1 && keys4[0] === "ttExpr") {
      const expression = record3.ttExpr;
      if (!Array.isArray(expression) || !expression.length || expression.length > MAX_EXPRESSION_ARGS + 1) {
        return fail(400, `Step ${stepIndex} ttExpr needs [fn, ...args] with at most ${MAX_EXPRESSION_ARGS} args`);
      }
      const fn = typeof expression[0] === "string" ? expression[0] : "";
      const signature = catalogueSignature(fn);
      if (!signature) {
        return fail(400, `Step ${stepIndex} ttExpr names an unknown function "${String(expression[0]).slice(0, 40)}" (the catalogue is closed)`);
      }
      const args = expression.slice(1);
      if (args.length < signature.min || args.length > signature.max) {
        return fail(400, `Step ${stepIndex} ${fn} takes ${signature.min === signature.max ? signature.min : `${signature.min}\u2013${signature.max}`} args`);
      }
      for (let index = 0; index < args.length; index += 1) {
        const lambda = isLambdaArg(fn, index);
        const checked = validateActionValue(args[index], stepIndex, depth + 1, lambda ? { itemDepth: scope2.itemDepth + 1 } : scope2);
        if (isFail(checked)) return checked;
      }
      return { ok: true };
    }
    if (keys4.length > MAX_ACTION_STEP_VALUE_KEYS) return fail(400, `Step ${stepIndex} objects cap at ${MAX_ACTION_STEP_VALUE_KEYS} keys`);
    for (const key4 of keys4) {
      if (!ACTION_STEP_KEY_PATTERN.test(key4) || ACTION_BANNED_SEGMENTS.has(key4)) {
        return fail(400, `Step ${stepIndex} has an invalid key "${key4.slice(0, 64)}"`);
      }
      const checked = validateActionValue(record3[key4], stepIndex, depth + 1, scope2);
      if (isFail(checked)) return checked;
    }
    return { ok: true };
  };
  var sanitizeActionSchemaRef = (value, label) => {
    const ref = typeof value === "string" ? value.trim() : "";
    if (!ref || ref.length > MAX_ACTION_SCHEMA_REF_CHARS || /[$\s]/.test(ref)) {
      return fail(400, `${label} must be a schema id or name (max ${MAX_ACTION_SCHEMA_REF_CHARS} chars, no $ or spaces)`);
    }
    return { ok: true, ref };
  };
  var sanitizeActionInputs = (input) => {
    if (!Array.isArray(input)) return fail(400, "Action inputs must be a list of input descriptors");
    if (input.length > MAX_ACTION_INPUTS) return fail(400, `Actions can declare at most ${MAX_ACTION_INPUTS} inputs`);
    const inputs = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of input) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail(400, "Each action input must be an object");
      const raw = entry;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name || name.length > MAX_COMPONENT_ARG_NAME_CHARS || !COMPONENT_ARG_NAME_PATTERN.test(name)) {
        return fail(400, `Action input names must match ${COMPONENT_ARG_NAME_PATTERN} (got "${String(raw.name).slice(0, 40)}")`);
      }
      const lower = name.toLowerCase();
      if (seen.has(lower)) return fail(400, `Duplicate action input: ${name}`);
      seen.add(lower);
      const type = typeof raw.type === "string" ? raw.type : "";
      if (!ACTION_INPUT_TYPES.includes(type)) {
        return fail(400, `Action input ${name} has an unknown type (expected ${ACTION_INPUT_TYPES.join("/")})`);
      }
      const descriptor = { name, type };
      if (raw.required === true) descriptor.required = true;
      if (typeof raw.label === "string" && raw.label.trim()) descriptor.label = raw.label.trim().slice(0, MAX_COMPONENT_ARG_LABEL_CHARS);
      if (typeof raw.description === "string" && raw.description.trim()) {
        descriptor.description = raw.description.trim().slice(0, MAX_COMPONENT_ARG_DESCRIPTION_CHARS);
      }
      if (type === "enum") {
        if (!Array.isArray(raw.values) || !raw.values.length || raw.values.length > MAX_SCHEMA_ENUM_VALUES) {
          return fail(400, `Enum input ${name} needs 1\u2013${MAX_SCHEMA_ENUM_VALUES} values`);
        }
        const values = [];
        for (const value of raw.values) {
          if (typeof value !== "string" || !value.trim() || value.length > MAX_SCHEMA_ENUM_VALUE_CHARS) {
            return fail(400, `Enum input ${name} has an invalid value`);
          }
          if (!values.includes(value)) values.push(value);
        }
        descriptor.values = values;
      }
      if (raw.default !== void 0 && type === "json") {
        try {
          descriptor.default = copyActionJson(raw.default);
        } catch (error) {
          return fail(400, `Input ${name}: ${error instanceof Error ? error.message : "Invalid JSON default"}`);
        }
      } else if (raw.default !== void 0) {
        const fallback = sanitizeComponentArgScalar(raw.default, MAX_COMPONENT_ARG_DEFAULT_CHARS);
        if (fallback === null && raw.default !== null) return fail(400, `Input ${name} default must be a string, number, or boolean`);
        if (fallback !== null) {
          if ((type === "string" || type === "text") && typeof fallback !== "string") {
            return fail(400, `Input ${name} default must be text to match its ${type} type`);
          }
          if (type === "number" && typeof fallback !== "number") {
            return fail(400, `Input ${name} default must be a number to match its number type`);
          }
          if (type === "boolean" && typeof fallback !== "boolean") {
            return fail(400, `Input ${name} default must be true or false to match its boolean type`);
          }
          if (type === "enum" && (typeof fallback !== "string" || !descriptor.values.includes(fallback))) {
            return fail(400, `Input ${name} default must be one of its enum values`);
          }
          descriptor.default = fallback;
        }
      }
      if (typeof raw.min === "number" && Number.isFinite(raw.min)) descriptor.min = raw.min;
      if (typeof raw.max === "number" && Number.isFinite(raw.max)) descriptor.max = raw.max;
      if (typeof raw.maxLength === "number" && Number.isFinite(raw.maxLength)) {
        descriptor.maxLength = Math.max(1, Math.min(Math.round(raw.maxLength), MAX_TEXT_CHARS));
      }
      inputs.push(descriptor);
    }
    return { ok: true, inputs };
  };
  var sanitizeActionCapabilities = (input) => {
    if (!Array.isArray(input)) return fail(400, "Action capabilities must be a list");
    if (input.length > MAX_ACTION_CAPABILITY_ENTRIES) {
      return fail(400, `Actions can declare at most ${MAX_ACTION_CAPABILITY_ENTRIES} capabilities`);
    }
    const capabilities = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of input) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail(400, "Each capability must be an object");
      const raw = entry;
      const capability = typeof raw.capability === "string" ? raw.capability.trim() : "";
      if (!ACTION_CAPABILITIES.includes(capability)) {
        return fail(400, `Unknown capability "${String(raw.capability).slice(0, 40)}" (expected ${ACTION_CAPABILITIES.join("/")})`);
      }
      if (seen.has(capability)) return fail(400, `Duplicate capability: ${capability}`);
      seen.add(capability);
      const sanitized = { capability };
      if (capability === "http.request") {
        if (!Array.isArray(raw.endpoints) || !raw.endpoints.length || raw.endpoints.length > MAX_ACTION_CAPABILITY_SCOPES || !raw.endpoints.every(isActionHttpEndpoint))
          return fail(400, "http.request needs a literal method and API path allowlist");
        sanitized.endpoints = [...new Set(raw.endpoints)];
      } else if (raw.endpoints !== void 0) return fail(400, "Only http.request takes endpoints");
      if (capability === "lookup") {
        if (!Array.isArray(raw.providers) || !raw.providers.length || raw.providers.length > MAX_ACTION_CAPABILITY_SCOPES || raw.providers.some((provider) => !isActionLookupProvider(provider))) return fail(400, "lookup needs a registered providers allowlist");
        sanitized.providers = [...new Set(raw.providers)];
      } else if (raw.providers !== void 0) return fail(400, "Only lookup takes providers");
      if (raw.schemas !== void 0 && raw.schemas !== null) {
        if (!Array.isArray(raw.schemas) || raw.schemas.length > MAX_ACTION_CAPABILITY_SCOPES) {
          return fail(400, `Capability ${capability} scopes cap at ${MAX_ACTION_CAPABILITY_SCOPES} schemas`);
        }
        const schemas = [];
        for (const value of raw.schemas) {
          const ref = sanitizeActionSchemaRef(value, `Capability ${capability} schema scope`);
          if (isFail(ref)) return ref;
          if (!schemas.includes(ref.ref)) schemas.push(ref.ref);
        }
        if (schemas.length) sanitized.schemas = schemas;
      }
      if (raw.actions !== void 0 && raw.actions !== null) {
        if (capability !== "actions.invoke") return fail(400, `Only actions.invoke takes an actions allowlist`);
        if (!Array.isArray(raw.actions) || raw.actions.length > MAX_ACTION_CAPABILITY_SCOPES) {
          return fail(400, `actions.invoke allowlist caps at ${MAX_ACTION_CAPABILITY_SCOPES} entries`);
        }
        const actions = [];
        for (const value of raw.actions) {
          const ref = sanitizeActionSchemaRef(value, "actions.invoke allowlist entry");
          if (isFail(ref)) return ref;
          if (!actions.includes(ref.ref)) actions.push(ref.ref);
        }
        if (actions.length) sanitized.actions = actions;
      }
      capabilities.push(sanitized);
    }
    return { ok: true, capabilities };
  };
  var sanitizeActionLimits = (input, browser = false) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail(400, "Action limits must be an object");
    const raw = input;
    const limits = {};
    const ceilings = browser ? { ...ACTION_LIMIT_CEILINGS, ...BROWSER_ACTION_EXPANDED_LIMITS } : ACTION_LIMIT_CEILINGS;
    for (const key4 of Object.keys(ACTION_LIMIT_CEILINGS)) {
      if (raw[key4] === void 0 || raw[key4] === null) continue;
      const value = Number(raw[key4]);
      if (!Number.isInteger(value) || value < 1) return fail(400, `Limit ${key4} must be a positive integer`);
      limits[key4] = Math.min(value, ceilings[key4]);
    }
    const unknown = Object.keys(raw).find((key4) => !(key4 in ACTION_LIMIT_CEILINGS));
    if (unknown) return fail(400, `Unknown limit "${unknown.slice(0, 40)}"`);
    return { ok: true, limits };
  };
  var sanitizeActionSteps = (input, declared) => {
    if (!Array.isArray(input) || !input.length) return fail(400, "Actions need a non-empty steps list");
    if (input.length > MAX_ACTION_STEPS) return fail(400, `Actions cap at ${MAX_ACTION_STEPS} steps`);
    const byCapability = new Map(declared.map((entry) => [entry.capability, entry]));
    const requireCapability = (stepIndex, capability, schemaRef) => {
      const entry = byCapability.get(capability);
      if (!entry) return fail(400, `Step ${stepIndex} needs the ${capability} capability declared`);
      if (schemaRef && entry.schemas && !entry.schemas.includes(schemaRef)) {
        return fail(400, `Step ${stepIndex} touches schema "${schemaRef}" but the ${capability} capability is scoped to ${entry.schemas.join(", ")}`);
      }
      return null;
    };
    const steps = [];
    for (let index = 0; index < input.length; index += 1) {
      const stepIndex = index + 1;
      const entry = input[index];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail(400, `Step ${stepIndex} must be an object`);
      const raw = entry;
      const op = typeof raw.op === "string" ? raw.op : "";
      if (!ACTION_STEP_OPS.includes(op)) {
        return fail(400, `Step ${stepIndex} has an unknown op "${String(raw.op).slice(0, 40)}" (the vocabulary is closed: ${ACTION_STEP_OPS.join(", ")})`);
      }
      const step = { op };
      if (raw.when !== void 0 && raw.when !== null) {
        const checked = validateActionValue(raw.when, stepIndex);
        if (isFail(checked)) return checked;
        step.when = raw.when;
      }
      if (op === "return" && step.when === void 0 && stepIndex !== input.length) return fail(400, "return must be the last step (guard it with `when` for an early exit)");
      const checkValues = (value, field, required, scope2 = TOP_SCOPE) => {
        if (value === void 0 || value === null) {
          return required ? fail(400, `Step ${stepIndex} (${op}) needs ${field}`) : null;
        }
        if (typeof value === "string") {
          const ref = value.trim().startsWith("$") ? parseActionRef(value.trim()) : null;
          if (!ref || !("kind" in ref)) return fail(400, `Step ${stepIndex} ${field} must be an object or a $ref to one`);
          const checked2 = validateActionValue(value.trim(), stepIndex, 0, scope2);
          if (isFail(checked2)) return checked2;
          step[field] = value.trim();
          return null;
        }
        if (typeof value !== "object" || Array.isArray(value)) return fail(400, `Step ${stepIndex} ${field} must be an object`);
        const checked = validateActionValue(value, stepIndex, 0, scope2);
        if (isFail(checked)) return checked;
        step[field] = value;
        return null;
      };
      const isExpressionObject = (value) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && ("ttExpr" in value || "ttConcat" in value);
      const checkRefString = (value, field) => {
        if (isExpressionObject(value)) {
          const checked2 = validateActionValue(value, stepIndex);
          if (isFail(checked2)) return checked2;
          step[field] = value;
          return null;
        }
        if (typeof value !== "string" || !value.trim()) return fail(400, `Step ${stepIndex} (${op}) needs ${field}`);
        const checked = validateActionValue(value.trim(), stepIndex);
        if (isFail(checked)) return checked;
        step[field] = value.trim();
        return null;
      };
      const checkAnyValue = (value, field, scope2 = TOP_SCOPE) => {
        if (value === void 0) return fail(400, `Step ${stepIndex} (${op}) needs ${field}`);
        const checked = validateActionValue(value, stepIndex, 0, scope2);
        if (isFail(checked)) return checked;
        step[field] = value;
        return null;
      };
      let failure2 = null;
      if (op === "http.request") {
        const endpoint = actionHttpEndpoint(raw.method, raw.path);
        if (!endpoint) return fail(400, `Step ${stepIndex} needs a literal API path and HTTP method`);
        if (!byCapability.get("http.request")?.endpoints?.includes(endpoint)) return fail(400, `Step ${stepIndex} endpoint is outside its http.request capability`);
        if (typeof raw.feature !== "string" || !/^api\.[a-z0-9-]+$/.test(raw.feature) || typeof raw.minimumVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.minimumVersion))
          return fail(400, `Step ${stepIndex} needs an API capability feature and minimumVersion`);
        Object.assign(step, { method: raw.method, path: raw.path, feature: raw.feature, minimumVersion: raw.minimumVersion });
        if (raw.method === "GET" && raw.body !== void 0) return fail(400, "GET request steps cannot carry a body");
        failure2 = checkValues(raw.query ?? {}, "query", true) || checkValues(raw.body, "body", false);
        if (raw.pagination !== void 0) {
          const pagination = parseActionRequestPagination(raw.pagination);
          if (raw.method !== "GET" || !pagination) return fail(400, "Pagination needs a GET request and valid cursor/items paths and budgets");
          step.pagination = pagination;
        }
      } else if (op === "lookup") {
        if (!isActionLookupProvider(raw.provider)) return fail(400, `Step ${stepIndex} needs a registered lookup provider`);
        if (!byCapability.get("lookup")?.providers?.includes(raw.provider)) return fail(400, `Step ${stepIndex} needs lookup capability for ${raw.provider}`);
        if (typeof raw.credentialId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.credentialId)) return fail(400, "lookup credentialId must be a literal Vault entry id");
        step.provider = raw.provider;
        step.credentialId = raw.credentialId;
        failure2 = checkRefString(raw.query, "query");
      } else if (op === "things.create") {
        const schema = sanitizeActionSchemaRef(raw.schema, `Step ${stepIndex} schema`);
        if (isFail(schema)) return schema;
        step.schema = schema.ref;
        failure2 = checkValues(raw.values, "values", true) || requireCapability(stepIndex, "things.create", schema.ref);
      } else if (op === "things.get") {
        failure2 = checkRefString(raw.id, "id") || requireCapability(stepIndex, "things.read");
      } else if (op === "things.search") {
        if (raw.schema !== void 0 && raw.schema !== null) {
          const schema = sanitizeActionSchemaRef(raw.schema, `Step ${stepIndex} schema`);
          if (isFail(schema)) return schema;
          step.schema = schema.ref;
        }
        if (raw.limit !== void 0 && raw.limit !== null) {
          const limit = Number(raw.limit);
          if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTION_SEARCH_LIMIT) {
            return fail(400, `Step ${stepIndex} limit must be 1\u2013${MAX_ACTION_SEARCH_LIMIT}`);
          }
          step.limit = limit;
        }
        if (raw.offset !== void 0 && raw.offset !== null) {
          const offset = Number(raw.offset);
          if (!Number.isInteger(offset) || offset < 0 || offset > MAX_ACTION_SEARCH_OFFSET) {
            return fail(400, `Step ${stepIndex} offset must be 0\u2013${MAX_ACTION_SEARCH_OFFSET}`);
          }
          step.offset = offset;
        }
        if (raw.scope !== void 0 && raw.scope !== null) {
          const scope2 = typeof raw.scope === "string" ? raw.scope : "";
          if (!ACTION_SEARCH_SCOPES.includes(scope2)) {
            return fail(400, `Step ${stepIndex} scope must be ${ACTION_SEARCH_SCOPES.join(", ")}`);
          }
          if (scope2 !== "own" && typeof step.schema !== "string") return fail(400, `Step ${stepIndex} ${scope2} searches must name a schema`);
          step.scope = scope2;
        }
        const checkFieldMap = (value, field, maxKeys) => {
          if (value === void 0 || value === null) return null;
          if (typeof value !== "object" || Array.isArray(value)) return fail(400, `Step ${stepIndex} ${field} must be an object of field \u2192 value`);
          const entries = Object.entries(value);
          if (!entries.length) return null;
          if (entries.length > maxKeys) return fail(400, `Step ${stepIndex} ${field} caps at ${maxKeys} fields`);
          for (const [key4, entry2] of entries) {
            if (!ACTION_SEARCH_FIELD_PATTERN.test(key4) || ACTION_BANNED_SEGMENTS.has(key4) || key4 === "schema" || key4 === "schemaId") {
              return fail(400, `Step ${stepIndex} ${field} field "${key4.slice(0, 40)}" is not a plain crystal field name`);
            }
            if (entry2 !== null && typeof entry2 === "object" && !Array.isArray(entry2)) {
              const keys4 = Object.keys(entry2);
              if (!(keys4.length === 1 && (keys4[0] === "ttConcat" || keys4[0] === "ttExpr"))) {
                return fail(400, `Step ${stepIndex} ${field}.${key4} must be a scalar, a ref, or an expression`);
              }
            } else if (Array.isArray(entry2)) {
              return fail(400, `Step ${stepIndex} ${field}.${key4} must be a scalar, a ref, or an expression`);
            }
            const checked = validateActionValue(entry2, stepIndex);
            if (isFail(checked)) return checked;
          }
          step[field] = value;
          return null;
        };
        failure2 = checkFieldMap(raw.where, "where", MAX_ACTION_SEARCH_WHERE_KEYS) || checkFieldMap(raw.match, "match", MAX_ACTION_SEARCH_MATCH_KEYS);
        if (!failure2 && raw.sort !== void 0 && raw.sort !== null) {
          const sort = raw.sort;
          const field = typeof sort === "object" && sort && typeof sort.field === "string" ? sort.field.trim() : "";
          const dir = typeof sort === "object" && sort && typeof sort.dir === "string" ? sort.dir : "desc";
          if (!field || field !== "createdAt" && field !== "updatedAt" && !ACTION_SEARCH_FIELD_PATTERN.test(field) || ACTION_BANNED_SEGMENTS.has(field)) {
            return fail(400, `Step ${stepIndex} sort.field must be createdAt, updatedAt, or a crystal field name`);
          }
          if (!ACTION_SEARCH_SORT_DIRECTIONS.includes(dir)) return fail(400, `Step ${stepIndex} sort.dir must be asc or desc`);
          step.sort = { field, dir };
        }
        if (!failure2) failure2 = requireCapability(stepIndex, "things.read", typeof step.schema === "string" ? step.schema : void 0);
      } else if (op === "things.update") {
        failure2 = checkRefString(raw.id, "id") || checkValues(raw.values, "values", true) || requireCapability(stepIndex, "things.update");
      } else if (op === "things.delete") {
        failure2 = checkRefString(raw.id, "id") || requireCapability(stepIndex, "things.delete");
      } else if (op === "actions.invoke" || op === "each") {
        const actionRef = sanitizeActionSchemaRef(raw.action, `Step ${stepIndex} action`);
        if (isFail(actionRef)) return actionRef;
        step.action = actionRef.ref;
        if (op === "each") {
          failure2 = checkAnyValue(raw.list, "list");
          if (!failure2 && raw.max !== void 0 && raw.max !== null) {
            const max = Number(raw.max);
            if (!Number.isInteger(max) || max < 1 || max > MAX_ACTION_EACH_ITEMS) return fail(400, `Step ${stepIndex} max must be 1\u2013${MAX_ACTION_EACH_ITEMS}`);
            step.max = max;
          }
          if (!failure2) failure2 = checkValues(raw.inputs, "inputs", false, { itemDepth: 1 });
        } else {
          failure2 = checkValues(raw.inputs, "inputs", false);
        }
        if (!failure2) failure2 = requireCapability(stepIndex, "actions.invoke");
        if (!failure2) {
          const invoke = byCapability.get("actions.invoke");
          if (invoke?.actions && !invoke.actions.includes(actionRef.ref)) {
            failure2 = fail(400, `Step ${stepIndex} invokes "${actionRef.ref}" but the actions.invoke allowlist is ${invoke.actions.join(", ")}`);
          }
        }
      } else if (op === "compute") {
        failure2 = checkAnyValue(raw.value, "value");
      } else if (op === "fail") {
        failure2 = checkAnyValue(raw.message, "message");
      } else if (op === "return") {
        failure2 = checkAnyValue(raw.value, "value");
      }
      if (failure2) return failure2;
      steps.push(step);
    }
    return { ok: true, steps };
  };
  var sanitizeActionCrystal = (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return fail(400, "Actions need a name");
    if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Action name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);
    const crystal = { name };
    if (input.runtime !== void 0 && input.runtime !== "server" && input.runtime !== "browser") return fail(400, "Action runtime must be server or browser");
    if (input.runtime === "browser") crystal.runtime = "browser";
    if (input.expressionLimits !== void 0) {
      const parsed = parseBrowserExpressionLimits(input.expressionLimits);
      if (input.runtime !== "browser" || !parsed) return fail(400, "Expression limits require browser execution and bounded nodes/listItems");
      crystal.expressionLimits = parsed;
    }
    const description = typeof input.description === "string" ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : "";
    if (description) crystal.description = description;
    if (input.actionKey !== void 0 && input.actionKey !== null && input.actionKey !== "") {
      const actionKey = typeof input.actionKey === "string" ? input.actionKey.trim() : "";
      if (!actionKey || actionKey.length > MAX_ACTION_KEY_CHARS || !ACTION_KEY_PATTERN.test(actionKey)) {
        return fail(400, "actionKey must be a lowercase-dashed slug");
      }
      crystal.actionKey = actionKey;
    }
    const category = typeof input.category === "string" ? input.category.trim().slice(0, MAX_COMPONENT_CATEGORY_CHARS) : "";
    crystal.category = category || "general";
    if (input.version !== void 0 && input.version !== null) {
      const version = Number(input.version);
      if (!Number.isInteger(version) || version < 1 || version > 999999) return fail(400, "version must be a positive integer");
      crystal.version = version;
    }
    if (input.forkOf !== void 0 && input.forkOf !== null && input.forkOf !== "") {
      const forkOf = typeof input.forkOf === "string" ? input.forkOf.trim() : "";
      if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, "forkOf must be a thing id");
      crystal.forkOf = forkOf;
    }
    let inputs = [];
    if (input.inputs !== void 0 && input.inputs !== null) {
      const sanitized = sanitizeActionInputs(input.inputs);
      if (isFail(sanitized)) return sanitized;
      inputs = sanitized.inputs;
      if (inputs.length) crystal.inputs = inputs;
    }
    let capabilities = [];
    if (input.capabilities !== void 0 && input.capabilities !== null) {
      const sanitized = sanitizeActionCapabilities(input.capabilities);
      if (isFail(sanitized)) return sanitized;
      capabilities = sanitized.capabilities;
      if (capabilities.length) crystal.capabilities = capabilities;
    }
    const steps = sanitizeActionSteps(input.steps, capabilities);
    if (isFail(steps)) return steps;
    crystal.steps = steps.steps;
    if (input.runtime === "browser") {
      if (steps.steps.some((step) => !BROWSER_ACTION_OPS.includes(step.op))) return fail(400, "Browser actions use HTTP requests, computations, child actions and returns");
    } else if (steps.steps.some((step) => step.op === "http.request")) return fail(400, "HTTP request steps require the browser runtime");
    const declaredInputs = new Set(inputs.map((descriptor) => String(descriptor.name)));
    const walkForInputRefs = (value) => {
      if (typeof value === "string") {
        const ref = parseActionRef(value);
        if (ref && "kind" in ref && ref.kind === "input" && !declaredInputs.has(ref.name)) {
          return fail(400, `Step references $input.${ref.name} but no such input is declared`);
        }
        return null;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          const found = walkForInputRefs(entry);
          if (found) return found;
        }
        return null;
      }
      if (value && typeof value === "object") {
        for (const entry of Object.values(value)) {
          const found = walkForInputRefs(entry);
          if (found) return found;
        }
      }
      return null;
    };
    const inputRefIssue = walkForInputRefs(steps.steps);
    if (inputRefIssue) return inputRefIssue;
    if (input.limits !== void 0 && input.limits !== null) {
      const limits = sanitizeActionLimits(input.limits, input.runtime === "browser");
      if (isFail(limits)) return limits;
      if (Object.keys(limits.limits).length) crystal.limits = limits.limits;
    }
    return { ok: true, crystal };
  };
  var MAX_USERNAME_CHARS = 60;
  var MAX_DISPLAY_NAME_CHARS = 80;
  var MAX_BIO_CHARS = 500;
  var MAX_PROFILE_URL_CHARS = 64 * 1024;
  var boundedString = (value, max) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
  var sanitizeUserCrystal = (input) => {
    const username = boundedString(input.username, MAX_USERNAME_CHARS)?.toLowerCase();
    if (!username) return fail(400, "User things need a username");
    return {
      ok: true,
      crystal: {
        username,
        ttid: boundedString(input.ttid, MAX_USERNAME_CHARS) || username,
        displayName: boundedString(input.displayName, MAX_DISPLAY_NAME_CHARS),
        bio: boundedString(input.bio, MAX_BIO_CHARS),
        avatarUrl: boundedString(input.avatarUrl, MAX_PROFILE_URL_CHARS),
        bannerUrl: boundedString(input.bannerUrl, MAX_PROFILE_URL_CHARS)
      }
    };
  };
  var sanitizeThemeCrystal = (input) => {
    const name = boundedString(input.name, 60);
    if (!name) return fail(400, "Themes need a name");
    if (!input.theme || typeof input.theme !== "object" || Array.isArray(input.theme)) {
      return fail(400, "Themes need a theme token object");
    }
    return { ok: true, crystal: { name, theme: input.theme } };
  };
  var sanitizeFeedAlgorithmCrystal = (input) => {
    const name = boundedString(input.name, 60);
    if (!name) return fail(400, "Algorithms need a name");
    const emoji = boundedString(input.emoji, 16) || "\u{1F9E0}";
    if (!input.weights || typeof input.weights !== "object" || Array.isArray(input.weights)) {
      return fail(400, "Algorithms need a weights object");
    }
    const eventCount = Number(input.eventCount);
    return {
      ok: true,
      crystal: {
        name,
        emoji,
        parentId: boundedString(input.parentId, 128),
        weights: input.weights,
        eventCount: Number.isFinite(eventCount) && eventCount >= 0 ? Math.floor(eventCount) : 0,
        lastTrainedAt: boundedString(input.lastTrainedAt, 40),
        // Carried, not dropped: this allowlist rebuilds the crystal from scratch,
        // so an omitted `shared` would silently unshare the algorithm. Strict
        // === true matches updateAlgorithm's boolean-only gate.
        //
        // Defensive, not load-bearing today: 'feed-algorithm' is in
        // PROTECTED_THINGTIME, so generic Thing CRUD refuses the kind (403) and
        // no feed-algorithm crystal is ever WRITTEN through this sanitizer —
        // algorithms.ts and the feed-algorithms-to-things migration build the
        // crystal directly. Keep the field listed anyway so the allowlist stays
        // honest if the kind ever becomes generically writable.
        shared: input.shared === true,
        listed: input.shared === true && input.listed === true,
        description: boundedString(input.description, 300) || ""
      }
    };
  };
  var sanitizeFolderCrystal = (input) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return fail(400, "Folder name is required");
    if (name.length > MAX_FOLDER_NAME_CHARS) return fail(400, `Folder name is too long (max ${MAX_FOLDER_NAME_CHARS})`);
    const crystal = { name };
    if (input.icon !== void 0 && input.icon !== null) {
      if (typeof input.icon !== "string" || input.icon.trim().length > MAX_FOLDER_ICON_CHARS) {
        return fail(400, `Folder icon must be a short emoji (max ${MAX_FOLDER_ICON_CHARS} chars)`);
      }
      if (input.icon.trim()) crystal.icon = input.icon.trim();
    }
    if (input.description !== void 0 && input.description !== null) {
      if (typeof input.description !== "string" || input.description.trim().length > MAX_FOLDER_DESCRIPTION_CHARS) {
        return fail(400, `Folder description is too long (max ${MAX_FOLDER_DESCRIPTION_CHARS})`);
      }
      if (input.description.trim()) crystal.description = input.description.trim();
    }
    return { ok: true, crystal };
  };
  var crystalSanitizers = {
    attachment: sanitizeAttachmentCrystal,
    post: sanitizePostCrystal,
    folder: sanitizeFolderCrystal,
    [FILE_SYNC_KIND]: (input, ids) => {
      if (ids.length !== 1) return fail(400, "File sync configurations stand alone");
      try {
        return { ok: true, crystal: { ...parseFileSyncConfiguration(input) } };
      } catch (error) {
        return fail(400, error instanceof Error ? error.message : "Invalid file sync configuration");
      }
    },
    comment: sanitizeCommentCrystal,
    reaction: sanitizeReactionCrystal,
    share: () => ({ ok: true, crystal: {} }),
    save: () => ({ ok: true, crystal: {} }),
    schema: sanitizeSchemaCrystal,
    component: sanitizeComponentCrystal,
    webpage: sanitizeWebpageCrystal,
    // action-run deliberately has NO sanitizer — run records are executor-
    // minted only, and the missing entry makes the generic write path 403.
    action: sanitizeActionCrystal,
    data: sanitizeDataCrystal,
    "scheduled-task-run": (input, ids) => {
      if (ids.length !== 1) return fail(400, "Scheduled run notes cannot combine with other schemas");
      if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 240) return fail(400, "A run title is required (up to 240 characters)");
      if (typeof input.chatId !== "string" || !/^[\w-]{1,128}$/.test(input.chatId)) return fail(400, "A valid destination chat is required");
      if (typeof input.scheduledAt !== "string" || !Number.isFinite(Date.parse(input.scheduledAt))) return fail(400, "A valid occurrence is required");
      if (!["running", "done", "needs-attention"].includes(String(input.status))) return fail(400, "Invalid run status");
      return { ok: true, crystal: { title: input.title, chatId: input.chatId, scheduledAt: input.scheduledAt, status: input.status, ...input.notificationStatus === "unavailable" ? { notificationStatus: "unavailable" } : {} } };
    },
    user: sanitizeUserCrystal,
    theme: sanitizeThemeCrystal,
    "feed-algorithm": sanitizeFeedAlgorithmCrystal,
    waitlist: () => ({ ok: true, crystal: {} })
  };

  // remix/app/timeline/componentBindings.ts
  var COMPONENT_BINDING_ADAPTER = "component-binding";
  var COMPONENT_BINDING_PREFIX = "timeline-component-";
  var MAX_COMPONENT_BINDINGS = 120;
  var validRef = (value) => typeof value === "string" && !!value && value.length <= 128 && !/[$\s]/.test(value);
  function webpageComponentRefs(blocks) {
    const refs = /* @__PURE__ */ new Set();
    let visited = 0;
    const walk = (items, depth) => {
      if (!Array.isArray(items)) return;
      if (depth > 24) throw new Error("Page components exceed the nesting limit.");
      for (const raw of items) {
        if (++visited > 1200) throw new Error("Page components exceed the block limit.");
        if (!raw || typeof raw !== "object") continue;
        if (raw.type === "component" && typeof raw.component === "string" && validRef(raw.component.trim())) refs.add(raw.component.trim());
        if (refs.size > MAX_COMPONENT_BINDINGS) throw new Error("Page components exceed the capture limit.");
        if (raw.type === "container") walk(raw.children, depth + 1);
      }
    };
    walk(blocks, 0);
    return [...refs];
  }
  function componentBindingSnapshot(ref, component) {
    if (!validRef(ref) || component !== null && (!component || typeof component.id !== "string" || !component.id || !component.crystal || typeof component.crystal !== "object" || Array.isArray(component.crystal)))
      throw new Error("Invalid captured component");
    return {
      adapter: COMPONENT_BINDING_ADAPTER,
      version: 1,
      value: copyBoundedJson(
        { ref, component: component === null ? null : { id: component.id, crystal: component.crystal } },
        { maxBytes: 3 * 1024 * 1024, maxDepth: 80, maxNodes: 9e4, sortKeys: true },
        "Captured component"
      )
    };
  }
  function readComponentBinding(event) {
    if (!event.thingId.startsWith(COMPONENT_BINDING_PREFIX) || event.after?.adapter !== COMPONENT_BINDING_ADAPTER || event.after.version !== 1)
      return null;
    const value = event.after.value;
    if (!value || Object.keys(value).sort().join(",") !== "component,ref") throw new Error("Invalid component capture");
    const checked = componentBindingSnapshot(value.ref, value.component);
    if (JSON.stringify(checked.value) !== JSON.stringify(event.after.value)) throw new Error("Invalid component capture projection");
    return checked.value;
  }
  function captureComponentBindings(page, bindings, previous, idForRef) {
    const reusable = /* @__PURE__ */ new Map();
    for (const event of previous) {
      if (event.ownerId !== page.ownerId) continue;
      const binding = readComponentBinding(event);
      if (binding) reusable.set(binding.ref, event);
    }
    const events = [];
    for (const [ref, component] of Object.entries(bindings)) {
      if (events.length >= MAX_COMPONENT_BINDINGS) throw new Error("Too many captured components.");
      const after = componentBindingSnapshot(ref, component);
      const old = reusable.get(ref);
      if (old && JSON.stringify(old.after?.value) === JSON.stringify(after.value)) {
        events.push(old);
        continue;
      }
      const id3 = idForRef(ref);
      events.push(
        parseTimelineEvent({
          ...page,
          id: id3,
          thingId: COMPONENT_BINDING_PREFIX + id3,
          branchId: "captures",
          parentIds: [],
          operation: "create",
          label: `Captured component ${ref}`,
          before: null,
          after,
          dependencies: []
        })
      );
    }
    return { events, dependencies: events.map((event) => ({ thingId: event.thingId, eventId: event.id })) };
  }

  // remix/app/utils/thingTransfer/format.ts
  var TRANSFER_LIMITS = { manifestBytes: 16 * 1024 * 1024, things: 1e3, files: 2e3, fileBytes: 512 * 1024 * 1024, depth: 64 };
  var TransferFormatError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "TransferFormatError";
    }
  };

  // remix/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/_u64.js
  var fromNumH = (n) => n / 2 ** 32 | 0;
  var fromNumL = (n) => n >>> 0;
  function setU64FromNum(view, byteOffset, n, isLE) {
    const h = fromNumH(n);
    const l = fromNumL(n);
    view.setUint32(byteOffset, isLE ? l : h, isLE);
    view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
  }

  // remix/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  var atitle = (title) => title ? `"${title}" ` : "";
  function anumber(n, title = "") {
    if (typeof n !== "number")
      throw new TypeError(atitle(title) + "expected number, got " + typeof n);
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
    return n;
  }
  function abytes(value, length, title = "") {
    if (isBytes(value) && (length === void 0 || value.length === length))
      return value;
    if (length !== void 0)
      anumber(length, "length");
    const bytes = isBytes(value);
    const ofLen = length !== void 0 ? ` of length ${length}` : "";
    const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
    const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  var aobject = (value, label) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
  };
  var aopts = (value, label) => {
    aobject(value, label);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError(`"${label}" expected plain object`);
    if (Object.hasOwn(value, "__proto__"))
      throw new TypeError(`"${label}.__proto__" is not allowed`);
  };
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("hash was destroyed");
    if (checkFinished && instance.finished)
      throw new Error("digest() was already called");
  }
  function aoutput(out, instance) {
    abytes(out, void 0, "output");
    const min = instance.outputLen;
    if (!(out.length >= min)) {
      throw new RangeError('"output" expected length >= ' + min);
    }
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function checkOpts(defaults, opts, title = "opts") {
    aopts(defaults, "defaults");
    if (opts !== void 0)
      aopts(opts, title);
    const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
    return merged;
  }
  function createHasher(hashCons, info = {}) {
    if (typeof hashCons !== "function")
      throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
    info = checkOpts({}, info, "info");
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  var oidNist = (suffix) => ({
    // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
    // Larger suffix values would need base-128 OID encoding and a different length byte.
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // remix/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/_md.js
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  var HashMD = class {
    blockLen;
    outputLen;
    canXOF = false;
    padOffset;
    isLE;
    // For partial updates less than block size
    buffer;
    view;
    finished = false;
    length = 0;
    pos = 0;
    destroyed = false;
    constructor(blockLen, outputLen, padOffset, isLE) {
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      abytes(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      let processed = false;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          processed = true;
          continue;
        }
        buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
          processed = true;
        }
      }
      this.length += data.length;
      if (processed)
        this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      buffer.fill(0, pos);
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        buffer.fill(0);
      }
      setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
      this.process(view, 0);
      this.roundClean();
      const oview = out === buffer ? view : createView(out);
      const len = this.outputLen;
      const outLen = len / 4;
      const state = this.get();
      if (len % 4 || outLen > state.length)
        throw new Error("invalid outputLen");
      for (let i = 0; i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneIntoMeta(to) {
      const { buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (pos)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);

  // remix/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/sha2.js
  var SHA256_K = /* @__PURE__ */ Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
  var SHA2_32B = class extends HashMD {
    // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    // Numeric initializers matter: starting the fields as `undefined` changes
    // V8's field representation and makes sha256 3x slower (measured).
    A = 0;
    B = 0;
    C = 0;
    D = 0;
    E = 0;
    F = 0;
    G = 0;
    H = 0;
    constructor(outputLen, IV) {
      super(64, outputLen, 8, false);
      this.A = IV[0] | 0;
      this.B = IV[1] | 0;
      this.C = IV[2] | 0;
      this.D = IV[3] | 0;
      this.E = IV[4] | 0;
      this.F = IV[5] | 0;
      this.G = IV[6] | 0;
      this.H = IV[7] | 0;
    }
    get() {
      const { A, B, C, D, E, F, G, H } = this;
      return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    _cloneInto(to) {
      (to ||= new this.constructor()).set(...this.get());
      return this._cloneIntoMeta(to);
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4)
        SHA256_W[i] = view.getUint32(offset, false);
      for (let i = 16; i < 64; i++) {
        const W15 = SHA256_W[i - 15];
        const W2 = SHA256_W[i - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i = 0; i < 64; i++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
        const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
        const T2 = sigma0 + Maj(A, B, C) | 0;
        H = G;
        G = F;
        F = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F = F + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      this.destroyed = true;
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      clean(this.buffer);
    }
  };
  var _SHA256 = class extends SHA2_32B {
    constructor() {
      super(32, SHA256_IV);
    }
  };
  var sha256 = /* @__PURE__ */ createHasher(
    () => new _SHA256(),
    /* @__PURE__ */ oidNist(1)
  );

  // remix/app/timeline/thingContent.ts
  function thingContentSnapshot(doc) {
    if (!doc) return null;
    return {
      adapter: "thing-content",
      version: 1,
      value: copyBoundedJson({
        thingtime: doc.thingtime ?? ["data"],
        crystal: doc.crystal ?? null,
        extended: doc.extended ?? null,
        tags: doc.tags ?? [],
        acl: doc.acl ?? ["tt:user"],
        folderId: doc.folderId ?? null,
        targetId: doc.targetId ?? null,
        geo: doc.geo ?? null
      }, { maxBytes: TIMELINE_SNAPSHOT_MAX_BYTES, maxDepth: 90, maxNodes: 9e4, sortKeys: true }, "Thing revision")
    };
  }

  // remix/app/local-workspace/webpageResolution.ts
  function resolveWorkspacePage(all, target, ownerId) {
    const ordered = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const pages = ordered.filter((row) => row.thingtime.includes("webpage"));
    const page = target.kind === "id" ? pages.find((row) => row.id === target.id) || pages.find((row) => row.crystal.pageKey === target.id) : pages.find((row) => target.kind === "path" ? row.crystal.siteRoute === target.path : row.crystal.pageKey === "site-global");
    const candidates = ordered.filter((row) => row.thingtime.includes("component")).map((row) => ({ row, shareId: row.id, ownerId, crystal: row.crystal }));
    const refs = /* @__PURE__ */ Object.create(null), selected = /* @__PURE__ */ new Map();
    for (const ref of webpageComponentRefs(page?.crystal.blocks)) {
      const found = selectComponent(ref, candidates, ownerId)?.row;
      refs[ref] = found?.id || null;
      if (found) selected.set(found.id, found);
    }
    return { page: page || null, components: [...selected.values()], refs };
  }

  // remix/app/local-workspace/timeline.ts
  var LOCAL_TIMELINE_OWNER = "local-workspace";
  var EVENTS = "timeline-events";
  var LINKS = "timeline-links";
  var INDEX = "timeline-index";
  var META = "timeline-meta";
  var fail2 = (message, status = 400) => {
    throw new WorkspaceError("LOCAL_TIMELINE", message, status);
  };
  var byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  var PAGE_BYTES = TIMELINE_EVENT_MAX_BYTES + 4096;
  function parseHeader(value, id3) {
    if (!value || value.id !== id3 || typeof value.thingId !== "string" || !value.thingId || value.thingId.length > 200 || !Number.isSafeInteger(value.position) || value.position < 1 || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > TIMELINE_EVENT_MAX_BYTES + 2048) fail2("Local Timeline index is damaged.");
    return value;
  }
  async function localTimelineEntry(tx, id3) {
    const row = await tx.get(EVENTS, id3);
    if (!row) return null;
    const event = parseTimelineEventRecord(row.event);
    const ids = [
      timelineLinkId(id3, "thing", 0),
      timelineLinkId(id3, "branch", 0),
      timelineLinkId(id3, "operation", 0),
      ...Array.from({ length: event.parentCount }, (_, n) => timelineLinkId(id3, "parent", n)),
      ...Array.from({ length: event.dependencyCount }, (_, n) => timelineLinkId(id3, "dependency", n))
    ];
    if (ids.length > 2053) fail2("Local Timeline links are damaged.");
    const links = [];
    for (const key4 of ids) {
      const link = await tx.get(LINKS, key4);
      if (!link) fail2("Local Timeline links are incomplete.");
      links.push(link);
    }
    const entry = parseTimelineEntry({ event: joinTimelineEvent(event, links), receipt: row.receipt });
    if (entry.event.id !== id3 || entry.event.ownerId !== LOCAL_TIMELINE_OWNER) fail2("Local Timeline identity changed.");
    const header2 = parseHeader(await tx.get(INDEX, id3), id3);
    if (header2.thingId !== entry.event.thingId || header2.position !== entry.receipt.position || header2.bytes !== byteLength(entry)) fail2("Local Timeline index does not match its event.");
    return entry;
  }
  async function appendLocalTimeline(tx, input) {
    const event = parseTimelineEvent(input);
    if (event.ownerId !== LOCAL_TIMELINE_OWNER || event.actorId !== LOCAL_TIMELINE_OWNER) fail2("This event belongs to another workspace.");
    const previous = await localTimelineEntry(tx, event.id);
    if (previous) {
      if (timelineEventText(previous.event) !== timelineEventText(event)) fail2("Timeline event identity was reused with different content.", 409);
      return previous;
    }
    for (const [id3, thingId] of [...event.parentIds.map((id4) => [id4, event.thingId]), ...event.dependencies.map((ref) => [ref.eventId, ref.thingId])]) {
      const ancestor = await localTimelineEntry(tx, id3);
      if (!ancestor || ancestor.event.thingId !== thingId) fail2("Timeline ancestry or dependencies are missing.", 409);
    }
    const position = (await tx.get(META, "position") || 0) + 1;
    if (!Number.isSafeInteger(position)) fail2("Local Timeline ordering is exhausted.");
    const entry = parseTimelineEntry({ event, receipt: { formatVersion: 1, eventId: event.id, ownerId: event.ownerId, position, acceptedAt: event.occurredAt } });
    const split = splitTimelineEvent(event);
    await tx.put(EVENTS, event.id, { event: split.event, receipt: entry.receipt });
    for (const link of split.links) await tx.put(LINKS, link.id, link);
    await tx.put(INDEX, event.id, { id: event.id, thingId: event.thingId, position, bytes: byteLength(entry) });
    await tx.put(META, "position", position);
    return entry;
  }
  async function recordLocalThingChanges(tx, changes, now, uuid, captures = /* @__PURE__ */ new Map(), writer) {
    const history = writer || { ownerId: LOCAL_TIMELINE_OWNER, clientId: "local-workspace", branchId: "main", mode: "revision", read: (id3) => localTimelineEntry(tx, id3), append: (event) => appendLocalTimeline(tx, event) };
    let things = null;
    for (const [id3, { before, after }] of changes) {
      const target = after || before;
      const themeSnapshots = writer?.themeSnapshots?.get(id3);
      const algorithmSnapshots = writer?.algorithmSnapshots?.get(id3);
      if (!target || isProtectedThingtime(target.thingtime) && !(isTransferTheme(target) && (!writer || themeSnapshots) || isTransferAlgorithm(target) && (!writer || algorithmSnapshots)) || ["reaction", "save", "vote", "updown", "action-run"].some((kind) => target.thingtime.includes(kind)) || id3.startsWith("timeline-")) continue;
      const snapshot2 = (row) => row && isTransferTheme(row) ? themeContentSnapshot({ crystal: row.crystal, tags: row.tags ?? [], visibility: "private", folderId: row.folderId ?? null }) : row && isTransferAlgorithm(row) ? algorithmContentSnapshot({ crystal: row.crystal, folderId: row.folderId ?? null }) : thingContentSnapshot(row && { ...row, ...!writer ? { acl: [] } : {} });
      const supplied = themeSnapshots ?? algorithmSnapshots;
      const previous = supplied ? supplied.before : snapshot2(before), next = supplied ? supplied.after : snapshot2(after);
      if (JSON.stringify(previous) === JSON.stringify(next) && !captures.has(id3)) continue;
      const parent = await tx.get(META, `head:${id3}`);
      const prior = parent ? await history.read(parent) : null;
      if (parent && (!prior || prior.event.thingId !== id3)) fail2("The previous local version is unavailable.");
      let event = parseTimelineEvent({
        formatVersion: 1,
        id: `${writer ? "device" : "local"}-event-${uuid()}`,
        ownerId: history.ownerId,
        actorId: history.ownerId,
        thingId: id3,
        branchId: history.branchId,
        parentIds: parent ? [parent] : [],
        operationId: uuid(),
        source: "client",
        clientId: history.clientId,
        occurredAt: now(),
        mode: history.mode,
        operation: !before ? "create" : !after ? "delete" : "update",
        label: (!before ? "Created Thing" : !after ? "Deleted Thing" : "Edited Thing") + (writer ? " on this device" : ""),
        before: previous,
        after: next,
        dependencies: [],
        ...captures.get(id3)
      });
      if (!after && before?.thingtime.includes("webpage") && prior) event = parseTimelineEvent({ ...event, dependencies: prior.event.dependencies });
      if (after?.thingtime.includes("webpage")) {
        const bindings = /* @__PURE__ */ Object.create(null);
        const refs = webpageComponentRefs(after.crystal.blocks);
        if (refs.length) things ??= (await tx.list("things")).map((row) => row.value);
        const resolved = resolveWorkspacePage(things || [after], { kind: "id", id: id3 }, history.ownerId);
        for (const ref of refs) {
          const selected = resolved.components.find((row) => row.id === resolved.refs[ref]);
          bindings[ref] = selected ? { id: selected.id, crystal: selected.crystal } : null;
        }
        const previousCaptures = [];
        for (const ref of prior?.event.dependencies || []) if (ref.thingId.startsWith("timeline-component-")) {
          const capture = await history.read(ref.eventId);
          if (!capture || capture.event.thingId !== ref.thingId) fail2("Recorded components are incomplete.");
          previousCaptures.push(capture.event);
        }
        const captures2 = captureComponentBindings(event, bindings, previousCaptures, () => `local-event-${uuid()}`);
        for (const capture of captures2.events) await history.append(capture);
        event = parseTimelineEvent({ ...event, dependencies: captures2.dependencies });
      }
      await history.append(event);
      await tx.put(META, `head:${id3}`, event.id);
    }
  }

  // remix/app/local-workspace/thingChanges.ts
  async function captureThingChanges(tx, run, record3, read = async (tx2, id3) => await tx2.get("things", id3) || null) {
    const before = /* @__PURE__ */ new Map();
    const capture = (collection3, id3) => {
      if (collection3 === "things" && !before.has(id3)) before.set(id3, read(tx, id3));
    };
    const tracked = {
      ...tx,
      put: async (collection3, id3, value) => {
        capture(collection3, id3);
        await before.get(id3);
        await tx.put(collection3, id3, value);
      },
      delete: async (collection3, id3) => {
        capture(collection3, id3);
        await before.get(id3);
        await tx.delete(collection3, id3);
      }
    };
    const result = await run(tracked), changes = /* @__PURE__ */ new Map();
    for (const [id3, previous] of before) changes.set(id3, { before: await previous, after: await read(tx, id3) });
    await record3(tx, changes);
    return result;
  }

  // remix/app/local-workspace/accountTimeline.ts
  var EVENTS2 = "timeline-events";
  var LINKS2 = "timeline-links";
  var INDEX2 = "timeline-index";
  var META2 = "timeline-meta";
  var accountTimelineScope = (scope2) => ({ apiOrigin: scope2.origin, ownerId: scope2.ownerId, dataPlane: scope2.dataPlane, ...scope2.delegatedBy === void 0 ? {} : { delegatedBy: scope2.delegatedBy } });
  var failure = (message) => {
    throw new WorkspaceError("ACCOUNT_HISTORY", message, 409);
  };
  function reserved(row) {
    const { receipt, status, bytes, accessedAt } = row;
    return { ...row, reserve: " ".repeat(Math.max(0, 2048 - new TextEncoder().encode(JSON.stringify({ receipt, status, bytes, accessedAt })).length)) };
  }
  async function readAccountTimelineRow(tx, scope2, id3) {
    const stored = await tx.get(EVENTS2, id3);
    if (!stored) return null;
    const event = parseTimelineEventRecord(stored.event), key4 = timelineScopeKey(scope2);
    const ids = [
      timelineLinkId(id3, "thing", 0),
      timelineLinkId(id3, "branch", 0),
      timelineLinkId(id3, "operation", 0),
      ...Array.from({ length: event.parentCount }, (_, n) => timelineLinkId(id3, "parent", n)),
      ...Array.from({ length: event.dependencyCount }, (_, n) => timelineLinkId(id3, "dependency", n))
    ];
    const links = [];
    for (const id4 of ids) {
      const link = await tx.get(LINKS2, id4);
      if (!link) failure("Account History relationships are incomplete.");
      links.push(link);
    }
    const { reserve: _reserve, ...value } = stored;
    const legacyKey = scope2.delegatedBy === void 0 ? key4 : timelineScopeKey({ ...scope2, delegatedBy: void 0 });
    const row = validateTimelineRow({ ...value, scope: value.scope === legacyKey ? key4 : value.scope, event: joinTimelineEvent(event, links) }, key4);
    if (row.event.id !== id3 || row.event.ownerId !== scope2.ownerId) failure("Account History identity changed.");
    const header2 = await tx.get(INDEX2, id3);
    if (!header2) failure("Account History index is missing.");
    const { reserve: _headerReserve, ...storedIndex } = header2;
    const index = { ...storedIndex, scope: storedIndex.scope === legacyKey ? key4 : storedIndex.scope };
    validateTimelineIndex(index, key4);
    if (JSON.stringify(index) !== JSON.stringify(timelineLocalIndex(row))) failure("Account History index does not match its event.");
    return row;
  }
  async function putRow(tx, row) {
    const split = splitTimelineEvent(row.event);
    await tx.put(EVENTS2, row.event.id, reserved({ ...row, event: split.event }));
    for (const link of split.links) await tx.put(LINKS2, link.id, link);
    await tx.put(INDEX2, row.event.id, reserved(timelineLocalIndex(row)));
  }
  async function append(tx, scope2, input) {
    const event = parseTimelineEvent(input);
    if (event.ownerId !== scope2.ownerId || event.actorId !== scope2.ownerId || event.source !== "client" || event.mode !== "draft" || !event.clientId)
      failure("Device History cannot claim server mutation authority.");
    const previous = await readAccountTimelineRow(tx, scope2, event.id);
    if (previous) {
      if (timelineEventText(previous.event) !== timelineEventText(event)) failure("History event identity was reused.");
      return;
    }
    for (const [id3, thingId] of [...event.parentIds.map((id4) => [id4, event.thingId]), ...event.dependencies.map((ref) => [ref.eventId, ref.thingId])]) {
      const ancestor = await readAccountTimelineRow(tx, scope2, id3);
      if (!ancestor || ancestor.event.thingId !== thingId) failure("Account History dependencies are missing.");
    }
    await putRow(tx, timelineLocalRow(timelineScopeKey(scope2), event, null, Date.parse(event.occurredAt)));
  }
  async function recordAccountChanges(tx, scope2, changes, now, uuid, captures, themeSnapshots, algorithmSnapshots) {
    if (!changes.size) return;
    let clientId = await tx.get(META2, "client");
    if (!clientId) {
      clientId = `workspace-${uuid()}`;
      await tx.put(META2, "client", clientId);
    }
    const timeline = accountTimelineScope(scope2);
    await recordLocalThingChanges(tx, changes, now, uuid, captures, {
      ownerId: scope2.ownerId,
      clientId,
      branchId: `device-${clientId}`,
      mode: "draft",
      themeSnapshots,
      algorithmSnapshots,
      read: (id3) => readAccountTimelineRow(tx, timeline, id3),
      append: (event) => append(tx, timeline, event)
    });
  }
  async function recordAccountThemeChange(tx, scope2, before, after, visibility, now, uuid, capture) {
    const id3 = after?.id ?? before?.id;
    if (!id3 || [before, after].some((row) => row && (!isTransferTheme(row) || row.id !== id3))) failure("Invalid theme History mutation.");
    const snapshot2 = (row, visibility2) => row ? themeContentSnapshot({ crystal: row.crystal, tags: row.tags ?? [], visibility: visibility2, folderId: row.folderId ?? null }) : null;
    await recordAccountChanges(tx, scope2, /* @__PURE__ */ new Map([[id3, { before, after }]]), now, uuid, capture ? /* @__PURE__ */ new Map([[id3, capture]]) : void 0, /* @__PURE__ */ new Map([[id3, { before: snapshot2(before, visibility.before), after: snapshot2(after, visibility.after) }]]));
  }
  async function recordAccountAlgorithmChange(tx, scope2, before, after, now, uuid, capture) {
    const id3 = after?.id ?? before?.id;
    if (!id3 || [before, after].some((row) => row && (!isTransferAlgorithm(row) || row.id !== id3))) failure("Invalid algorithm History mutation.");
    const snapshot2 = (row) => row ? algorithmContentSnapshot({ crystal: row.crystal, folderId: row.folderId ?? null }) : null;
    await recordAccountChanges(tx, scope2, /* @__PURE__ */ new Map([[id3, { before, after }]]), now, uuid, capture ? /* @__PURE__ */ new Map([[id3, capture]]) : void 0, void 0, /* @__PURE__ */ new Map([[id3, { before: snapshot2(before), after: snapshot2(after) }]]));
  }

  // remix/app/api/utils/themes/themeSelectionContract.ts
  var validId = (value) => value === null || typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
  var validVersion = (value) => typeof value === "string" && /^theme-selection-v1:[a-f0-9]{64}$/.test(value);
  var fail3 = () => {
    throw new Error("Invalid active theme synchronization.");
  };
  function parseThemeSelection(value) {
    const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 2 || !validId(row.themeId) || !validVersion(row.version))
      return fail3();
    return { themeId: row.themeId, version: row.version };
  }
  function parseThemeSelectionWrite(value) {
    const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 3 || !validId(row.themeId) || !validVersion(row.expectedVersion) || typeof row.writeId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(row.writeId))
      return fail3();
    return { themeId: row.themeId, expectedVersion: row.expectedVersion, writeId: row.writeId };
  }
  function parseThemeSelectionAcknowledgment(value) {
    const row = copyBoundedJson(value, { maxBytes: 8192, maxDepth: 4, maxNodes: 40 });
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 4) return fail3();
    const { result, ...command } = row;
    const write = parseThemeSelectionWrite(command), selection = parseThemeSelection(result);
    if (selection.themeId !== write.themeId) return fail3();
    return { ...write, result: selection };
  }

  // remix/app/utils/thingTransfer/value.ts
  var fail4 = (message) => {
    throw new TransferFormatError(message);
  };
  var snapshotTransferValue = (value) => {
    const ancestors = /* @__PURE__ */ new Set();
    let budget4 = TRANSFER_LIMITS.manifestBytes;
    const visit = (input, depth) => {
      if (depth > TRANSFER_LIMITS.depth || --budget4 < 0) return fail4("Value is too large or deeply nested");
      if (input === null) return null;
      if (typeof input === "boolean") return input;
      if (typeof input === "string") {
        budget4 -= input.length;
        if (budget4 < 0) return fail4("Value is too large");
        return input;
      }
      if (typeof input === "number" && Number.isFinite(input) && !Object.is(input, -0)) return input;
      if (!input || typeof input !== "object") return fail4("This value cannot be transferred losslessly as JSON");
      if (ancestors.has(input)) return fail4("Circular values cannot be transferred");
      if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail4("Only plain objects and arrays can be transferred");
      if (Object.getOwnPropertySymbols(input).length) return fail4("Symbol properties cannot be transferred");
      ancestors.add(input);
      const properties = Object.getOwnPropertyDescriptors(input);
      let output;
      if (Array.isArray(input)) {
        if (Object.keys(properties).length !== input.length + 1) return fail4("Sparse arrays and extra array properties cannot be transferred");
        const array = [];
        for (let index = 0; index < input.length; index++) {
          const property = properties[index];
          if (!property || !("value" in property)) return fail4("Sparse arrays and accessors cannot be transferred");
          array.push(visit(property.value, depth + 1));
        }
        output = array;
      } else {
        const object5 = {};
        for (const [key4, property] of Object.entries(properties)) {
          if (["__proto__", "prototype", "constructor"].includes(key4)) return fail4("Unsafe property in transferred value");
          if (!property.enumerable || !("value" in property)) return fail4("Hidden properties and accessors cannot be transferred");
          budget4 -= key4.length;
          object5[key4] = visit(property.value, depth + 1);
        }
        output = object5;
      }
      ancestors.delete(input);
      return output;
    };
    return visit(value, 0);
  };

  // remix/app/theme/tokens.ts
  var THINGS_BADGE_PADDING_PRESETS = {
    small: "3px 8px",
    medium: "5px 12px",
    large: "7px 16px"
  };
  var CURATED_FONTS = [
    { label: "System", css: "", kind: "any" },
    { label: "Space Grotesk", css: "Space Grotesk", kind: "heading" },
    { label: "Hanken Grotesk", css: "Hanken Grotesk", kind: "body" },
    { label: "JetBrains Mono", css: "JetBrains Mono", kind: "mono" },
    { label: "Inter", css: "Inter", kind: "any" },
    { label: "Sora", css: "Sora", kind: "heading" },
    { label: "Fraunces", css: "Fraunces", kind: "heading" },
    { label: "Instrument Serif", css: "Instrument Serif", kind: "heading" },
    { label: "Nunito", css: "Nunito", kind: "body" },
    { label: "Atkinson Hyperlegible", css: "Atkinson Hyperlegible", kind: "body" },
    { label: "IBM Plex Mono", css: "IBM Plex Mono", kind: "mono" },
    { label: "Fira Code", css: "Fira Code", kind: "mono" }
  ];
  var RAINBOW_PALETTE = [
    "#f34a4a",
    "#ffbc48",
    "#58ca70",
    "#47b5e6",
    "#a555e8"
  ];
  var THINGTIME_THEME = {
    name: "Thingtime",
    colors: {
      ink: "#16161a",
      text: "#5a5a66",
      muted: "#9a9aa6",
      faint: "#b6b6c0",
      border: "#ececef",
      borderLight: "#f0f0f2",
      surface: "#fafafb",
      surfaceAlt: "#f5f5f7",
      surfaceHover: "#ececee",
      card: "#ffffff",
      pageBg: "#ffffff",
      accent: "hotpink",
      accentTint: "#fff5fa",
      accentContrast: "#ffffff",
      link: "#2f8fd6",
      positive: "#2f8f4f",
      positiveSoft: "rgba(88, 202, 112, 0.14)",
      danger: "#d6455a",
      warning: "#ffbc48",
      rainbow: [...RAINBOW_PALETTE],
      darkBg: "#131318",
      darkChrome: "#1c1c22",
      darkBorder: "#2a2a33",
      darkText: "#e6e6ee",
      darkMuted: "#8a8a95",
      darkAccent: "#59ff9c"
    },
    fonts: {
      heading: "Space Grotesk",
      body: "Hanken Grotesk",
      mono: "JetBrains Mono",
      display: ""
    },
    general: {
      radiusScale: 1,
      borderWidth: 1,
      shadow: "soft",
      motion: true,
      animSpeed: 200,
      iconStyle: "emoji",
      thingsBadgePadding: "small",
      thingsBadgeCustomPadding: THINGS_BADGE_PADDING_PRESETS.small
    },
    windows: {
      closeColor: "",
      minimiseColor: "",
      maximiseColor: "",
      closeRadius: 3.5,
      minimiseRadius: 3.5,
      maximiseRadius: 3.5
    }
  };
  var FABLE_THEME = {
    ...THINGTIME_THEME,
    name: "Fable",
    colors: {
      ...THINGTIME_THEME.colors,
      ink: "#1a1a1a",
      text: "#4b4b4b",
      muted: "#8a8a8a",
      faint: "#c9c9c9",
      border: "#ececec",
      borderLight: "#f2f2f2",
      surface: "#ffffff",
      surfaceAlt: "#fafafa",
      surfaceHover: "#f2f2f2"
    },
    fonts: { heading: "", body: "", mono: "JetBrains Mono", display: "" },
    general: {
      radiusScale: 0,
      borderWidth: 2,
      shadow: "hard",
      motion: true,
      animSpeed: 120,
      iconStyle: "emoji",
      thingsBadgePadding: "small",
      thingsBadgeCustomPadding: THINGS_BADGE_PADDING_PRESETS.small
    }
  };
  var PRISM_THEME = {
    ...THINGTIME_THEME,
    name: "Prism",
    colors: {
      ...THINGTIME_THEME.colors,
      accent: "#a555e8",
      accentTint: "#f6effc"
    }
  };
  var MIDNIGHT_THEME = {
    ...THINGTIME_THEME,
    name: "Midnight",
    colors: {
      ...THINGTIME_THEME.colors,
      ink: "#f2f2f7",
      text: "#b9b9c6",
      muted: "#8a8a95",
      faint: "#5a5a66",
      border: "#2a2a33",
      borderLight: "#23232b",
      surface: "#16161c",
      surfaceAlt: "#1c1c22",
      surfaceHover: "#23232b",
      card: "#131318",
      pageBg: "#0b0b0f",
      accentTint: "#2a1a26",
      link: "#59bdff",
      positiveSoft: "rgba(88, 202, 112, 0.18)"
    }
  };
  var sanitizeCssValue = (value) => {
    if (typeof value !== "string") return null;
    const v = value.trim().slice(0, 120);
    if (!v) return null;
    if (/[;{}<>\\]|url\s*\(|expression|@import|\/\*/i.test(v)) return null;
    if (!/^[\w#(),.'\s%\-\/]+$/.test(v)) return null;
    return v;
  };
  var sanitizePaddingCssValue = (value) => {
    if (typeof value !== "string") return null;
    const v = value.trim().slice(0, 120);
    if (!v) return "";
    const parts = v.split(/\s+/);
    if (parts.length < 1 || parts.length > 4) return null;
    const length = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|ch|ex|vw|vh|vmin|vmax|pt))$/i;
    return parts.every((part) => length.test(part)) ? parts.join(" ") : null;
  };
  var clampNumber = (value, min, max, dflt) => {
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n !== "number" || Number.isNaN(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  };
  var resolveTheme = (base, patch) => {
    const out = {
      name: base.name,
      colors: { ...base.colors, rainbow: [...base.colors.rainbow] },
      fonts: { ...base.fonts },
      general: { ...base.general },
      // older stored themes predate the windows section — fill from defaults
      windows: { ...THINGTIME_THEME.windows, ...base.windows || {} }
    };
    if (!patch || typeof patch !== "object") return out;
    if (typeof patch.name === "string" && patch.name.trim()) {
      out.name = patch.name.trim().slice(0, 60);
    }
    const colors = patch.colors;
    if (colors && typeof colors === "object") {
      for (const key4 of Object.keys(out.colors)) {
        if (key4 === "rainbow") continue;
        const v = sanitizeCssValue(colors[key4]);
        if (v) out.colors[key4] = v;
      }
      if (Array.isArray(colors.rainbow)) {
        colors.rainbow.slice(0, 5).forEach((c, i) => {
          const v = sanitizeCssValue(c);
          if (v) out.colors.rainbow[i] = v;
        });
      }
    }
    const fonts = patch.fonts;
    if (fonts && typeof fonts === "object") {
      const curated = new Set(CURATED_FONTS.map((f) => f.css));
      for (const key4 of Object.keys(out.fonts)) {
        const raw = fonts[key4];
        if (typeof raw !== "string") continue;
        const v = raw.trim().slice(0, 60).replace(/'/g, "");
        if (curated.has(v)) out.fonts[key4] = v;
      }
    }
    const general = patch.general;
    if (general && typeof general === "object") {
      out.general.radiusScale = clampNumber(general.radiusScale, 0, 2.5, out.general.radiusScale);
      out.general.borderWidth = clampNumber(general.borderWidth, 1, 4, out.general.borderWidth);
      if (general.shadow === "soft" || general.shadow === "hard") out.general.shadow = general.shadow;
      if (typeof general.motion === "boolean") out.general.motion = general.motion;
      out.general.animSpeed = clampNumber(general.animSpeed, 0, 2e3, out.general.animSpeed);
      if (general.iconStyle === "emoji" || general.iconStyle === "lucide") out.general.iconStyle = general.iconStyle;
      if (general.thingsBadgePadding === "small" || general.thingsBadgePadding === "medium" || general.thingsBadgePadding === "large" || general.thingsBadgePadding === "custom") {
        out.general.thingsBadgePadding = general.thingsBadgePadding;
      }
      const customBadgePadding = sanitizePaddingCssValue(general.thingsBadgeCustomPadding);
      if (customBadgePadding !== null) out.general.thingsBadgeCustomPadding = customBadgePadding;
    }
    const windows = patch.windows;
    if (windows && typeof windows === "object") {
      for (const key4 of ["closeColor", "minimiseColor", "maximiseColor"]) {
        const raw = windows[key4];
        if (raw === "") {
          out.windows[key4] = "";
          continue;
        }
        const v = sanitizeCssValue(raw);
        if (v) out.windows[key4] = v;
      }
      for (const key4 of ["closeRadius", "minimiseRadius", "maximiseRadius"]) {
        out.windows[key4] = clampNumber(
          windows[key4],
          0,
          24,
          out.windows[key4]
        );
      }
    }
    return out;
  };

  // remix/app/theme/savedTheme.ts
  var MAX_SAVED_THEMES = 100;
  function normalizeSavedTheme(input) {
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
    if (!name) return { ok: false, status: 400, error: "Theme name is required" };
    if (!input.theme || typeof input.theme !== "object") return { ok: false, status: 400, error: "Theme tokens are required" };
    return { ok: true, name, theme: resolveTheme(THINGTIME_THEME, { ...input.theme, name }) };
  }

  // remix/app/local-workspace/accountSync.ts
  var REQUEST_MS = 2e4;
  var accountSyncDeadline = async (run, parent) => {
    const controller = new AbortController();
    const abort = () => controller.abort(parent.reason);
    parent.addEventListener("abort", abort, { once: true });
    if (parent.aborted) abort();
    let timer;
    const stopped = new Promise((_, reject) => {
      const fail14 = () => reject(new WorkspaceError("SYNC_INTERRUPTED", "Sync was interrupted; the same operation will be retried.", 503));
      controller.signal.addEventListener("abort", fail14, { once: true });
      if (controller.signal.aborted) fail14();
      timer = setTimeout(() => {
        controller.abort();
      }, REQUEST_MS);
    });
    try {
      return await Promise.race([run(controller.signal), stopped]);
    } finally {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    }
  };

  // remix/app/local-workspace/themeSelection.ts
  var key = "account-theme-selection";
  var fail5 = (message) => {
    throw new WorkspaceError("SELECTION_CONFLICT", message, 409);
  };
  var AccountThemeSelection = class {
    constructor(db, scope2, lease2, now = () => Date.now(), uuid = () => crypto.randomUUID()) {
      this.db = db;
      this.scope = scope2;
      this.lease = lease2;
      this.now = now;
      this.uuid = uuid;
      if (scope2.kind !== "account") throw new WorkspaceError("ACCOUNT_REQUIRED", "Anonymous selections never synchronize.", 403);
    }
    tx(mode, run, signal) {
      const lease2 = signal ? {
        assertCurrent: () => {
          this.lease.assertCurrent();
          signal.throwIfAborted();
        },
        onInvalidate: (cb) => {
          const off = this.lease.onInvalidate(cb);
          signal.addEventListener("abort", cb, { once: true });
          return () => {
            off();
            signal.removeEventListener("abort", cb);
          };
        }
      } : this.lease;
      return this.db.transaction(this.scope, mode, lease2, run);
    }
    async setIn(tx, themeId) {
      const old = await tx.get("settings", key);
      if (old?.desired === themeId) return;
      await tx.put("settings", key, {
        revision: (old?.revision ?? 0) + 1,
        desired: themeId,
        base: old?.base ?? null,
        state: old?.state === "conflict" || old?.state === "error" ? old.state : "pending",
        pending: old?.pending,
        claim: old?.claim,
        retryAt: old?.retryAt ?? 0,
        attempts: old?.attempts ?? 0,
        error: old?.error
      });
    }
    status() {
      return this.tx("readonly", (tx) => tx.get("settings", key));
    }
    async applyIn(tx, themeId) {
      if (themeId) await tx.put("settings", "active-theme", themeId);
      else await tx.delete("settings", "active-theme");
    }
    async remember(raw, revision, signal) {
      const remote = parseThemeSelection(raw);
      return this.tx(
        "readwrite",
        async (tx) => {
          const old = await tx.get("settings", key);
          if ((old?.revision ?? null) !== revision) return false;
          if (!old || old.state === "synced") {
            await tx.put("settings", key, {
              revision: (old?.revision ?? 0) + 1,
              desired: remote.themeId,
              base: remote,
              state: "synced",
              retryAt: 0,
              attempts: 0
            });
            await this.applyIn(tx, remote.themeId);
            return true;
          }
          if (!old.base) {
            await tx.put("settings", key, { ...old, base: remote });
            return true;
          }
          return false;
        },
        signal
      );
    }
    async refresh(transport2, signal = new AbortController().signal) {
      const revision = (await this.status())?.revision ?? null;
      const remote = await accountSyncDeadline((s) => transport2.selection(s), signal);
      return this.remember(remote, revision, signal);
    }
    async sync(transport2, ready, signal = new AbortController().signal) {
      const first = await this.status();
      if (!first || !["pending", "syncing"].includes(first.state) || first.retryAt > this.now()) return { completed: 0 };
      if (!first.base) await this.refresh(transport2, signal);
      const state = await this.status();
      if (!state?.pending && state?.desired && !await ready(state.desired)) return { completed: 0 };
      const claimed = await this.tx(
        "readwrite",
        async (tx) => {
          const row = await tx.get("settings", key);
          if (!row || !row.base || !["pending", "syncing"].includes(row.state) || row.retryAt > this.now() || row.claim && row.claim.expiresAt > this.now() || row.revision !== state?.revision)
            return null;
          const pending = row.pending ?? {
            command: parseThemeSelectionWrite({ themeId: row.desired, expectedVersion: row.base.version, writeId: this.uuid() }),
            revision: row.revision,
            receiptPlane: "home"
          };
          const next = { ...row, pending, state: "syncing", claim: { token: this.uuid(), expiresAt: this.now() + 6e4 } };
          await tx.put("settings", key, next);
          return next;
        },
        signal
      );
      if (!claimed) return { completed: 0 };
      const controller = new AbortController(), off = this.lease.onInvalidate(() => controller.abort()), abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      try {
        const command = claimed.pending.command;
        let result;
        try {
          const acknowledgment = parseThemeSelectionAcknowledgment(await accountSyncDeadline((s) => transport2.select(command, s, claimed.pending.receiptPlane ?? this.scope.dataPlane), controller.signal));
          if (acknowledgment.themeId !== command.themeId || acknowledgment.writeId !== command.writeId || acknowledgment.expectedVersion !== command.expectedVersion)
            throw new WorkspaceError("INVALID_SELECTION_ACK", "Selection acknowledgment changed.", 502);
          result = acknowledgment.result;
        } catch (error) {
          if (Number(error?.status) !== 409 || ["WORKSPACE_CHANGED", "ACCOUNT_UNCONFIRMED"].includes(error?.code)) throw error;
          const observed = parseThemeSelection(await accountSyncDeadline((s) => transport2.selection(s), controller.signal));
          if (observed.themeId !== command.themeId) throw error;
          result = observed;
        }
        await this.tx(
          "readwrite",
          async (tx) => {
            const row = await tx.get("settings", key);
            if (row?.claim?.token !== claimed.claim.token) return;
            await tx.put("settings", key, {
              ...row,
              base: result,
              pending: void 0,
              claim: void 0,
              state: row.revision === claimed.pending.revision ? "synced" : "pending",
              attempts: 0,
              retryAt: 0,
              error: void 0
            });
          },
          controller.signal
        );
        return { completed: 1 };
      } catch (error) {
        this.lease.assertCurrent();
        await this.tx("readwrite", async (tx) => {
          const row = await tx.get("settings", key);
          if (row?.claim?.token !== claimed.claim.token) return;
          const status = Number(error?.status), changed2 = ["WORKSPACE_CHANGED", "ACCOUNT_UNCONFIRMED"].includes(error?.code), state2 = status === 409 && !changed2 ? "conflict" : !changed2 && [400, 401, 403, 404, 410, 413, 422].includes(status) ? "error" : "pending";
          await tx.put("settings", key, {
            ...row,
            claim: void 0,
            state: state2,
            attempts: row.attempts + 1,
            retryAt: this.now() + Math.max(Math.min(6e4, 1e3 * 2 ** Math.min(row.attempts, 6)), Math.min(864e5, Number(error?.retryAfterMs) || 0)),
            error: state2 === "conflict" ? "Your account selected another theme. Review the choice." : state2 === "error" ? "Account selection was refused. This device keeps its choice." : "Applied on this device; waiting to synchronize."
          });
        });
        return { completed: 0 };
      } finally {
        off();
        signal.removeEventListener("abort", abort);
      }
    }
    async retry() {
      return this.tx("readwrite", async (tx) => {
        const row = await tx.get("settings", key);
        if (!row) return;
        if (row.state === "conflict") return fail5("Review the changed selection first.");
        if (row.claim && row.claim.expiresAt > this.now()) return;
        await tx.put("settings", key, { ...row, state: "pending", retryAt: 0, error: void 0 });
      });
    }
    async inspect(transport2, signal = new AbortController().signal) {
      const remote = parseThemeSelection(await accountSyncDeadline((s) => transport2.selection(s), signal));
      return this.tx(
        "readonly",
        async (tx) => {
          const row = await tx.get("settings", key);
          if (!row || row.claim || !["conflict", "error"].includes(row.state)) return fail5("The selection is not ready for review.");
          return { revision: row.revision, desired: row.desired, remote };
        },
        signal
      );
    }
    async resolve(review, keep, transport2, signal = new AbortController().signal) {
      if (!["local", "remote"].includes(keep)) return fail5("Choose the device or account selection.");
      const remote = parseThemeSelection(await accountSyncDeadline((s) => transport2.selection(s), signal));
      if (remote.version !== review.remote.version || remote.themeId !== review.remote.themeId) return fail5("The account selection changed again.");
      return this.tx(
        "readwrite",
        async (tx) => {
          const row = await tx.get("settings", key);
          if (!row || row.claim || row.revision !== review.revision || !["conflict", "error"].includes(row.state))
            return fail5("The device selection changed.");
          const desired = keep === "local" ? row.desired : remote.themeId;
          await tx.put("settings", key, {
            ...row,
            revision: row.revision + 1,
            base: remote,
            desired,
            state: keep === "local" ? "pending" : "synced",
            pending: void 0,
            claim: void 0,
            attempts: 0,
            retryAt: 0,
            error: void 0
          });
          await this.applyIn(tx, desired);
        },
        signal
      );
    }
  };

  // remix/app/local-workspace/protectedRecovery.ts
  var fail6 = (message) => {
    throw new WorkspaceError("PROTECTED_RECOVERY", message, 409);
  };
  var protectedRecoveryAdapter = (kind) => kind === "theme" ? THEME_CONTENT_ADAPTER : ALGORITHM_CONTENT_ADAPTER;
  async function assertProtectedRecoveryAllowed(tx, scope2, id3, kind) {
    if (await tx.get("things", id3)) fail6("This item is already present. Refresh History before recovering it.");
    if (scope2.kind !== "account") return;
    if (scope2.dataPlane !== "home") fail6("Recover account themes and algorithms from their home History.");
    const own2 = kind === "theme" ? "account-theme-sync" : "account-algorithm-sync";
    const other = kind === "theme" ? "account-algorithm-sync" : "account-theme-sync";
    if (await tx.get("thing-sync", id3) || await tx.get(other, id3)) fail6("This identity belongs to another dedicated writer.");
    const state = await tx.get(own2, id3);
    if (!state || !state.deleted || state.state !== "synced" || state.baseVersion !== null || state.base !== null || state.pending || state.claim)
      fail6("Wait for the account deletion to be acknowledged before recovering this item. Device History is preserved.");
  }
  function protectedRecoveryContent(snapshot2, kind) {
    const parse = (value) => kind === "theme" ? themeContentValue(value) : algorithmContentValue(value);
    const original = parse(snapshot2);
    const make = (value) => kind === "theme" ? themeContentSnapshot({ crystal: value.crystal, tags: [], visibility: "private", folderId: value.folderId ?? null }) : algorithmContentSnapshot({ crystal: value.crystal, folderId: value.folderId ?? null });
    const current = make(original);
    return {
      adapters: [protectedRecoveryAdapter(kind)],
      current,
      read(value) {
        if (!value) fail6("This version has no recoverable design content.");
        return parse(value);
      },
      snapshot: make
    };
  }
  async function protectedRecoveryDocument(tx, scope2, id3, snapshot2, kind) {
    await assertProtectedRecoveryAllowed(tx, scope2, id3, kind);
    const content = protectedRecoveryContent(snapshot2, kind), value = content.current.value;
    return { doc: {
      id: id3,
      thingtime: [kind],
      crystal: structuredClone(value.crystal),
      ...value.folderId ? { folderId: value.folderId } : {},
      createdAt: "",
      updatedAt: "",
      revision: 0
    }, content };
  }
  async function recoveredProtectedRow(tx, scope2, id3, input, kind, now) {
    await assertProtectedRecoveryAllowed(tx, scope2, id3, kind);
    const headId = await tx.get("timeline-meta", `head:${id3}`);
    const entry = headId ? scope2.kind === "anonymous" ? await localTimelineEntry(tx, headId) : await readAccountTimelineRow(tx, accountTimelineScope(scope2), headId) : null;
    if (!entry || entry.event.thingId !== id3 || entry.event.operation !== "delete" || entry.event.after !== null || entry.event.before?.adapter !== protectedRecoveryAdapter(kind))
      fail6("The current recorded deletion is required for dedicated recovery.");
    protectedRecoveryContent(entry.event.before, kind);
    const snapshot2 = kind === "theme" ? themeContentSnapshot({ crystal: input.crystal, tags: [], visibility: "private", folderId: input.folderId ?? null }) : algorithmContentSnapshot({ crystal: input.crystal, folderId: input.folderId ?? null });
    const { doc } = await protectedRecoveryDocument(tx, scope2, id3, snapshot2, kind);
    if (doc.folderId) {
      const folder = await tx.get("things", doc.folderId);
      if (!folder || folder.thingtime.length !== 1 || folder.thingtime[0] !== "folder") fail6("The recovery folder changed. Refresh History and review again.");
    }
    return { ...doc, createdAt: now, updatedAt: now, revision: 1 };
  }

  // remix/app/local-workspace/themes.ts
  var project = (row) => ({
    id: row.id,
    name: row.crystal.name,
    theme: row.crystal.theme,
    visibility: "private",
    localOnly: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
  var LocalThemes = class {
    constructor(db, lease2, options = {}) {
      this.db = db;
      this.lease = lease2;
      this.options = options;
      this.scope = options.scope ?? { kind: "anonymous" };
    }
    transaction(mode, run, captures, signal) {
      const lease2 = signal ? {
        assertCurrent: () => {
          this.lease.assertCurrent();
          signal.throwIfAborted();
        },
        onInvalidate: (cb) => {
          const off = this.lease.onInvalidate(cb);
          signal.addEventListener("abort", cb, { once: true });
          return () => {
            off();
            signal.removeEventListener("abort", cb);
          };
        }
      } : this.lease;
      return this.db.transaction(this.scope, mode, lease2, (tx) => {
        if (mode !== "readwrite" || this.scope.kind !== "anonymous") return run(tx);
        return captureThingChanges(
          tx,
          run,
          (transaction, changes) => recordLocalThingChanges(
            transaction,
            changes,
            () => new Date(this.options.now?.() ?? Date.now()).toISOString(),
            this.options.uuid ?? (() => crypto.randomUUID()),
            captures
          )
        );
      });
    }
    async read(tx, id3) {
      const row = await tx.get("things", id3);
      if (!row || !isTransferTheme(row)) throw new WorkspaceError("NOT_FOUND", "Theme is not in this workspace", 404);
      return row;
    }
    async list() {
      return this.transaction("readonly", async (tx) => ({
        ok: true,
        themes: (await tx.list("things")).map((row) => row.value).filter(isTransferTheme).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map(project),
        activeThemeId: await tx.get("settings", "active-theme") || null
      }));
    }
    async get(id3) {
      return this.transaction("readonly", async (tx) => ({ ok: true, theme: project(await this.read(tx, id3)) }));
    }
    async save(input) {
      return this.transaction("readwrite", (tx) => this.saveIn(tx, input));
    }
    /** History supplies design content only; current sharing and organization
     * remain owned by the dedicated theme writer. Captures are never public input. */
    async versionTransaction(run, signal) {
      const captures = /* @__PURE__ */ new Map();
      return this.transaction(
        "readwrite",
        (tx) => run({
          tx,
          update: async (input, capture) => {
            captures.set(input.id, capture);
            return this.saveIn(
              tx,
              { id: input.id, name: input.crystal.name, theme: input.crystal.theme, expectedUpdatedAt: input.expectedUpdatedAt },
              capture
            );
          },
          recover: async (input, id3, capture) => {
            const row = await recoveredProtectedRow(tx, this.scope, id3, input, "theme", new Date(this.options.now?.() ?? Date.now()).toISOString());
            const normalized = normalizeSavedTheme({ name: row.crystal.name, theme: row.crystal.theme });
            if (!normalized.ok) throw new WorkspaceError("INVALID_THEME", normalized.error, normalized.status);
            captures.set(id3, capture);
            await tx.put("things", id3, row);
            await this.options.onWrite?.(tx, row, null, { visibility: "private" }, capture);
            return { ok: true, theme: project(row) };
          }
        }),
        captures,
        signal
      );
    }
    async saveIn(tx, input, capture) {
      if (this.scope.kind === "anonymous" && input.visibility === "public")
        throw new WorkspaceError("REMOTE_ACCOUNT_REQUIRED", "Local themes stay on this device. Sign in to publish a separate account copy.", 401);
      const result = normalizeSavedTheme({ name: input.name, theme: snapshotTransferValue(input.theme ?? null) });
      if (!result.ok) throw new WorkspaceError("INVALID_THEME", result.error, result.status);
      const previous = input.id ? await this.read(tx, input.id) : null;
      if (previous && input.expectedUpdatedAt && previous.updatedAt !== input.expectedUpdatedAt)
        throw new WorkspaceError("WRITE_CONFLICT", "This theme changed in another editor. Reload it before saving.", 409);
      const now = new Date(Math.max(this.options.now?.() ?? Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
      const row = {
        ...previous,
        id: previous?.id || `${this.scope.kind === "anonymous" ? "local-" : ""}${this.options.uuid?.() ?? crypto.randomUUID()}`,
        thingtime: ["theme"],
        crystal: snapshotTransferValue({ ...previous?.crystal, name: result.name, theme: result.theme }),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        revision: (previous?.revision || 0) + 1
      };
      await tx.put("things", row.id, row);
      await this.options.onWrite?.(tx, row, previous, input, capture);
      return { ok: true, theme: project(row) };
    }
    async setActive(themeId) {
      return this.transaction("readwrite", async (tx) => {
        if (themeId) {
          await this.read(tx, themeId);
          await tx.put("settings", "active-theme", themeId);
        } else await tx.delete("settings", "active-theme");
        await this.options.onActive?.(tx, themeId);
        return { ok: true, activeThemeId: themeId };
      });
    }
    async remove(id3) {
      return this.transaction("readwrite", (tx) => this.removeIn(tx, id3));
    }
    /** Shared with atomic account library batches. */
    async removeIn(tx, id3) {
      this.lease.assertCurrent();
      const previous = await this.read(tx, id3);
      if ((await tx.list("things")).some((row) => row.value.targetId === id3 || row.value.folderId === id3))
        throw new WorkspaceError("HAS_CHILDREN", "Remove the theme\u2019s related local Things before deleting it.");
      await tx.delete("things", id3);
      if (await tx.get("settings", "active-theme") === id3) {
        await tx.delete("settings", "active-theme");
        await this.options.onActive?.(tx, null);
      }
      await this.options.onWrite?.(tx, null, previous);
      return { ok: true };
    }
  };

  // remix/app/api/utils/themes/themeSyncContract.ts
  var THEME_SYNC_MAX_BYTES = 64 * 1024;
  var validThemeVersion = (value) => typeof value === "string" && /^theme-state-v1:[a-f0-9]{64}$/.test(value);
  var identity = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
  var fail7 = () => {
    throw new Error("Invalid theme synchronization command.");
  };
  var object3 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  function parseThemeWrite(input) {
    const value = copyBoundedJson(input, { maxBytes: THEME_SYNC_MAX_BYTES, maxDepth: 10, maxNodes: 4096, sortKeys: true });
    if (!object3(value) || !identity(value.id) || !identity(value.writeId) || value.writeId.length > 160 || value.id.startsWith("timeline-") || value.expectedVersion !== null && !validThemeVersion(value.expectedVersion))
      return fail7();
    if (value.expectedVersion === null && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id)) return fail7();
    const base = { id: value.id, writeId: value.writeId, expectedVersion: value.expectedVersion };
    if (value.action === "delete") {
      if (value.expectedVersion === null || Object.keys(value).some((key4) => !["id", "writeId", "expectedVersion", "action"].includes(key4)))
        return fail7();
      return { ...base, expectedVersion: value.expectedVersion, action: "delete" };
    }
    if (value.action !== "save" || !["private", "public"].includes(String(value.visibility)) || Object.keys(value).some((key4) => !["id", "writeId", "expectedVersion", "action", "name", "theme", "visibility", "folderId", "title"].includes(key4)) || "title" in value && !validOptionalLibraryTitle(value.title) || "folderId" in value && value.folderId !== null && (!identity(value.folderId) || value.folderId === value.id || value.folderId.startsWith("timeline-")))
      return fail7();
    const normalized = normalizeSavedTheme({ name: value.name, theme: value.theme });
    if (!normalized.ok) return fail7();
    return {
      ...base,
      action: "save",
      name: normalized.name,
      theme: normalized.theme,
      visibility: value.visibility,
      ..."title" in value ? { title: value.title } : {},
      ..."folderId" in value ? { folderId: value.folderId } : {}
    };
  }
  function parseThemeWriteAcknowledgment(input) {
    if (!object3(input) || Object.keys(input).length !== 5 || Object.keys(input).some((key4) => !["id", "writeId", "action", "expectedVersion", "resultVersion"].includes(key4)) || !identity(input.id) || !identity(input.writeId) || input.writeId.length > 160 || input.id.startsWith("timeline-") || !["save", "delete"].includes(String(input.action)) || input.expectedVersion !== null && !validThemeVersion(input.expectedVersion) || (input.action === "delete" ? input.expectedVersion === null || input.resultVersion !== null : !validThemeVersion(input.resultVersion)))
      return fail7();
    if (input.expectedVersion === null && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.id)) return fail7();
    return {
      id: input.id,
      writeId: input.writeId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      resultVersion: input.resultVersion
    };
  }

  // remix/app/local-workspace/accountThemes.ts
  var collection = "account-theme-sync";
  var catalogKey = "account-theme-catalog";
  var blankCatalog = () => ({ epoch: 0, read: 0, complete: false });
  var fail8 = (message, code = "THEME_SYNC_CONFLICT", status = 409) => {
    throw new WorkspaceError(code, message, status);
  };
  var stable = (value) => JSON.stringify(copyBoundedJson(value, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 25e4, sortKeys: true }));
  function parseAccountThemeSnapshot(input) {
    const rows = copyBoundedJson(input, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 25e4 });
    if (!Array.isArray(rows) || rows.length > MAX_SAVED_THEMES) return fail8("Invalid account theme catalogue.", "INVALID_THEME_SNAPSHOT", 502);
    const seen = /* @__PURE__ */ new Set();
    return rows.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail8("Invalid account theme.", "INVALID_THEME_SNAPSHOT", 502);
      const row = raw, normalized = normalizeSavedTheme({ name: row.name, theme: row.theme });
      if (typeof row.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.id) || row.id.startsWith("timeline-") || seen.has(row.id) || !validThemeVersion(row.version) || !normalized.ok || !["private", "public"].includes(row.visibility) || "title" in row && !validOptionalLibraryTitle(row.title) || row.folderId !== null && (typeof row.folderId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.folderId)) || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)))
        return fail8("Invalid account theme.", "INVALID_THEME_SNAPSHOT", 502);
      seen.add(row.id);
      return {
        id: row.id,
        version: row.version,
        name: normalized.name,
        ..."title" in row ? { title: row.title } : {},
        theme: normalized.theme,
        visibility: row.visibility,
        folderId: row.folderId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };
    });
  }
  var AccountThemeSync = class {
    constructor(db, scope2, lease2, now = () => Date.now(), uuid = () => crypto.randomUUID()) {
      this.db = db;
      this.scope = scope2;
      this.lease = lease2;
      this.now = now;
      this.uuid = uuid;
      if (scope2.kind !== "account") throw new WorkspaceError("ACCOUNT_REQUIRED", "Anonymous themes never synchronize.", 403);
      this.selection = new AccountThemeSelection(db, scope2, lease2, now, uuid);
      this.themes = new LocalThemes(db, lease2, {
        scope: scope2,
        now,
        uuid,
        onWrite: (tx, row, previous, input, capture) => this.mutated(tx, row, previous, input, capture),
        onActive: async (tx, id3) => {
          await this.selection.setIn(tx, id3);
          await this.bump(tx);
        }
      });
    }
    tx(mode, run, signal) {
      const lease2 = signal ? {
        assertCurrent: () => {
          this.lease.assertCurrent();
          signal.throwIfAborted();
        },
        onInvalidate: (callback) => {
          const off = this.lease.onInvalidate(callback);
          signal.addEventListener("abort", callback, { once: true });
          return () => {
            off();
            signal.removeEventListener("abort", callback);
          };
        }
      } : this.lease;
      return this.db.transaction(this.scope, mode, lease2, run);
    }
    async bump(tx) {
      const catalog = await tx.get("settings", catalogKey) ?? blankCatalog();
      await tx.put("settings", catalogKey, { ...catalog, epoch: catalog.epoch + 1 });
    }
    async mutated(tx, row, previous, input, capture) {
      const id3 = row?.id ?? previous.id, old = await tx.get(collection, id3);
      if (previous && !old) return fail8("Refresh this account theme before editing it.");
      if (!previous && row?.folderId && this.scope.dataPlane !== "home")
        return fail8("Create filed theme copies in the home library.", "THEME_PLACEMENT_SCOPE");
      if (input?.visibility !== void 0 && !["private", "public"].includes(String(input.visibility)))
        return fail8("Invalid theme visibility.", "INVALID_THEME", 400);
      const visibility = input?.visibility ?? old?.visibility ?? "private";
      await recordAccountThemeChange(tx, this.scope, previous, row, { before: old?.visibility ?? "private", after: visibility }, () => new Date(this.now()).toISOString(), this.uuid, capture);
      if (!row && old?.baseVersion === null && !old.pending) {
        await tx.delete(collection, id3);
        await this.bump(tx);
        return;
      }
      const state = {
        id: id3,
        revision: (old?.revision ?? 0) + 1,
        base: old?.base ?? null,
        baseVersion: old?.baseVersion ?? null,
        remoteFolderId: old?.remoteFolderId !== void 0 ? old.remoteFolderId : old?.base?.folderId,
        visibility,
        state: old?.state === "conflict" || old?.state === "error" ? old.state : "pending",
        deleted: !row,
        titleKnown: old?.titleKnown ?? (!old?.base || old.base.title !== void 0),
        titleIntent: old?.titleIntent || !previous && row?.crystal.title !== void 0,
        placementKnown: old?.placementKnown ?? (!old?.base || old.base.folderId !== void 0),
        placementIntent: old?.placementIntent ?? (!previous && row?.folderId ? true : void 0),
        pending: old?.pending,
        claim: old?.claim,
        attempts: old?.attempts ?? 0,
        retryAt: old?.retryAt ?? 0,
        error: old?.error
      };
      await tx.put(collection, id3, state);
      await this.bump(tx);
    }
    async list() {
      return this.tx("readonly", async (tx) => {
        const states = new Map((await tx.list(collection)).map(({ id: id3, value }) => [id3, value]));
        const themes = (await tx.list("things")).filter(({ value }) => isTransferTheme(value)).map(({ value }) => {
          const state = states.get(value.id);
          return {
            id: value.id,
            name: value.crystal.name,
            theme: value.crystal.theme,
            visibility: state?.visibility ?? "private",
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
            localOnly: false,
            localSaved: true,
            syncState: state?.state ?? "error",
            syncError: state?.error
          };
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        return {
          ok: true,
          themes,
          activeThemeId: await tx.get("settings", "active-theme") ?? null,
          complete: (await tx.get("settings", catalogKey))?.complete === true
        };
      });
    }
    async save(input) {
      const result = await this.themes.save(input);
      return { ok: true, theme: (await this.list()).themes.find((row) => row.id === result.theme.id) };
    }
    /** Called only by the canonical import transaction after schema validation
     * and ID remapping. Generic protected mutations never enter this hook. */
    async importIn(tx, row) {
      this.lease.assertCurrent();
      validateTransferTheme(row);
      if (row.folderId && this.scope.dataPlane !== "home")
        return fail8("Import filed themes into the home library; folders in another database cannot contain home themes.", "THEME_PLACEMENT_SCOPE");
      if (await tx.get(collection, row.id) || await tx.get("thing-sync", row.id))
        return fail8("An imported theme must have an independent identity.", "THEME_IMPORT_IDENTITY");
      await this.mutated(tx, row, null, { visibility: "private" });
      const state = await tx.get(collection, row.id);
      await tx.put(collection, row.id, { ...state, placementKnown: true, placementIntent: true });
    }
    /** Shared private-copy writer for remote conflict review and retained device
     * variants. Call within the transaction that verifies the reviewed source. */
    async copyIn(tx, local, options = {}) {
      this.lease.assertCurrent();
      validateTransferTheme(local);
      const id3 = this.uuid();
      if (await tx.get("things", id3) || await tx.get(collection, id3) || await tx.get("thing-sync", id3))
        return fail8("A new theme identity collided. Retry the copy.");
      const normalized = normalizeSavedTheme({ name: (String(local.crystal.name) + " (device copy)").slice(0, 60), theme: local.crystal.theme });
      if (!normalized.ok) return fail8("The device theme is invalid.");
      const stamp3 = new Date(this.now()).toISOString(), folderId = options.folderId === void 0 ? local.folderId : options.folderId;
      const copy = {
        id: id3,
        thingtime: ["theme"],
        crystal: { name: normalized.name, theme: normalized.theme, ..."title" in local.crystal ? { title: local.crystal.title } : {} },
        ...folderId ? { folderId } : {},
        createdAt: stamp3,
        updatedAt: stamp3,
        revision: 1
      };
      await tx.put("things", id3, copy);
      await this.importIn(tx, copy);
      return copy;
    }
    /** Protected theme projections and mutations used by the normal library. */
    async viewIn(tx, id3) {
      this.lease.assertCurrent();
      const row = await tx.get("things", id3), state = await tx.get(collection, id3);
      if (!row || !isTransferTheme(row) || !state || state.deleted || this.scope.dataPlane !== "home" && row.folderId) return null;
      return {
        ...row,
        visibility: state.visibility,
        acl: aclFromVisibility(state.visibility),
        author: { id: this.scope.ownerId },
        syncState: state.state,
        localOnly: false,
        localWorkspace: true
      };
    }
    async isDeletedIn(tx, id3) {
      return !!(await tx.get(collection, id3))?.deleted;
    }
    async moveIn(tx, row, previous) {
      this.lease.assertCurrent();
      if (this.scope.dataPlane !== "home") return fail8("Move themes in the home library.", "THEME_PLACEMENT_SCOPE");
      validateTransferTheme(row);
      if (row.id !== previous.id || stable(row.crystal) !== stable(previous.crystal)) return fail8("Theme placement cannot replace its content.");
      await this.mutated(tx, row, previous);
      const state = await tx.get(collection, row.id);
      await tx.put(collection, row.id, { ...state, placementKnown: true, placementIntent: true });
    }
    async renameIn(tx, row, previous) {
      this.lease.assertCurrent();
      if (this.scope.dataPlane !== "home") return fail8("Rename themes in the home library.", "THEME_PLACEMENT_SCOPE");
      validateTransferTheme(row);
      const { title: _new, ...next } = row.crystal, { title: _old, ...before } = previous.crystal;
      if (row.id !== previous.id || stable(next) !== stable(before) || row.folderId !== previous.folderId)
        return fail8("Theme title changes cannot replace protected content.");
      await this.mutated(tx, row, previous);
      const state = await tx.get(collection, row.id);
      await tx.put(collection, row.id, { ...state, titleKnown: true, titleIntent: true });
    }
    removeIn(tx, id3) {
      return this.themes.removeIn(tx, id3);
    }
    /** The device folder is already removed. Only the remote deletion waits for
     * children to settle, so its canonical drain cannot invalidate theme CAS. */
    async prepareFolderDelete(tx, id3, destination) {
      if (this.scope.dataPlane !== "home") return true;
      for (const { value: state } of await tx.list(collection)) {
        const remoteFolder = state.remoteFolderId !== void 0 ? state.remoteFolderId : state.base?.folderId;
        const pendingFolder = state.pending?.command.action === "save" ? state.pending.command.folderId : void 0;
        if (remoteFolder !== id3 && pendingFolder !== id3) continue;
        const local = await tx.get("things", state.id);
        if (local?.folderId === id3) {
          const moved = {
            ...local,
            folderId: destination,
            revision: local.revision + 1,
            updatedAt: new Date(Math.max(this.now(), Date.parse(local.updatedAt) + 1)).toISOString()
          };
          await tx.put("things", local.id, moved);
          await this.moveIn(tx, moved, local);
        }
        if (["conflict", "error"].includes(state.state))
          return fail8("Review the theme synchronization conflict before retrying this folder deletion.", "THEME_SYNC_BLOCKED");
        return false;
      }
      return true;
    }
    remove(id3) {
      return this.themes.remove(id3);
    }
    setActive(id3) {
      return this.themes.setActive(id3);
    }
    async status() {
      return this.tx("readonly", async (tx) => (await tx.list(collection)).map(({ value }) => value));
    }
    /** Only the dedicated owned state admits a portable theme. The generic
     * exporter may compose these rows with other retained content, but cannot
     * turn an arbitrary protected cache row into export authority. */
    async exportSnapshot() {
      return this.tx("readonly", async (tx) => {
        const states = (await tx.list(collection)).map((row) => row.value);
        const things = [];
        for (const state of states) {
          if (state.deleted) continue;
          const row = await tx.get("things", state.id);
          if (!row || !isTransferTheme(row)) return fail8("Retained theme content is incomplete.", "LOCAL_THEME_INCOMPLETE");
          things.push({
            id: row.id,
            thingtime: ["theme"],
            crystal: { name: row.crystal.name, theme: row.crystal.theme, ...row.crystal.title !== void 0 ? { title: row.crystal.title } : {} },
            ...row.folderId ? { folderId: row.folderId } : {},
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            revision: row.revision
          });
        }
        return {
          things,
          records: states.map((state) => ({
            id: state.id,
            state: state.state,
            remote: state.baseVersion !== null,
            deleted: state.deleted,
            complete: (state.placementKnown === true || !!state.base && state.base.folderId !== void 0) && (state.titleKnown === true || !!state.base && state.base.title !== void 0)
          }))
        };
      });
    }
    async assertExportReadable(ids) {
      return this.tx("readonly", (tx) => this.assertExportReadableIn(tx, ids));
    }
    async assertExportReadableIn(tx, ids) {
      this.lease.assertCurrent();
      for (const id3 of ids) {
        const state = await tx.get(collection, id3), row = await tx.get("things", id3);
        if (!state || state.deleted || !row || !isTransferTheme(row))
          return fail8("This theme is no longer available for export.", "EXPORT_ACCESS_REFUSED");
      }
    }
    async beginRead() {
      return this.tx("readwrite", async (tx) => {
        const old = await tx.get("settings", catalogKey) ?? blankCatalog();
        const next = { ...old, read: old.read + 1 };
        await tx.put("settings", catalogKey, next);
        return { read: next.read, epoch: next.epoch };
      });
    }
    async install(tx, remote, old) {
      const row = await tx.get("things", remote.id);
      if (row && (!isTransferTheme(row) || !old)) return fail8("Account theme identity collides with another device Thing.");
      const next = {
        ...row,
        id: remote.id,
        thingtime: ["theme"],
        crystal: { ...row?.crystal, name: remote.name, theme: remote.theme, ...remote.title !== void 0 ? { title: remote.title } : {} },
        folderId: remote.folderId,
        createdAt: row?.createdAt ?? remote.createdAt,
        updatedAt: new Date(Math.max(Date.parse(remote.updatedAt), row ? Date.parse(row.updatedAt) + 1 : 0)).toISOString(),
        revision: (row?.revision ?? 0) + 1
      };
      await tx.put("things", remote.id, next);
      await tx.put(collection, remote.id, {
        id: remote.id,
        revision: (old?.revision ?? 0) + 1,
        base: remote,
        placementKnown: true,
        titleKnown: remote.title !== void 0,
        baseVersion: remote.version,
        remoteFolderId: remote.folderId,
        visibility: remote.visibility,
        state: "synced",
        deleted: false,
        retryAt: 0,
        attempts: 0
      });
    }
    async admitCatalogue(tx, remote) {
      const catalog = await tx.get("settings", catalogKey) ?? blankCatalog();
      for await (const { value: row } of remote.rows()) {
        const old = await tx.get(collection, row.id);
        if (old?.deleted) continue;
        if (!old || old.state === "synced") {
          if (!old || old.baseVersion !== row.version || !old.placementKnown || !old.titleKnown && row.title !== void 0)
            await this.install(tx, row, old);
        } else if (old.baseVersion === row.version && (!old.placementKnown || !old.titleKnown && row.title !== void 0)) {
          const local = await tx.get("things", row.id);
          if (local && isTransferTheme(local)) {
            await tx.put("things", row.id, {
              ...local,
              ...!old.placementKnown && !old.placementIntent ? { folderId: row.folderId } : {},
              crystal: { ...local.crystal, ...!old.titleKnown && !old.titleIntent && row.title !== void 0 ? { title: row.title } : {} },
              revision: local.revision + 1
            });
            await tx.put(collection, row.id, { ...old, base: row, placementKnown: true, titleKnown: old.titleKnown || row.title !== void 0 });
          }
        }
      }
      for await (const { id: id3, value: state } of scanWorkspace(tx, collection))
        if (!await remote.has(id3) && state.state === "synced" && !state.deleted) {
          if (await remote.hasDependent(id3)) {
            await tx.put(collection, id3, {
              ...state,
              state: "conflict",
              revision: state.revision + 1,
              error: "The account theme was removed. Review its related device Things before discarding the retained copy."
            });
            continue;
          }
          await tx.delete("things", id3);
          await tx.delete(collection, id3);
          if (await tx.get("settings", "active-theme") === id3) await tx.delete("settings", "active-theme");
        }
      await tx.put("settings", catalogKey, { ...catalog, complete: true, epoch: catalog.epoch + 1 });
      return true;
    }
    async remember(input, ticket, signal) {
      const remote = parseAccountThemeSnapshot(input);
      return this.tx("readwrite", async (tx) => {
        const catalog = await tx.get("settings", catalogKey) ?? blankCatalog();
        if (catalog.read !== ticket.read || catalog.epoch !== ticket.epoch) return false;
        const present = new Set(remote.map((row) => row.id));
        const dependents = /* @__PURE__ */ new Set();
        for await (const { value } of scanWorkspace(tx, "things"))
          for (const reference of [value.folderId, value.targetId]) if (reference) dependents.add(reference);
        return this.admitCatalogue(tx, {
          async *rows() {
            for (const value of remote) yield { id: value.id, value };
          },
          has: async (id3) => present.has(id3),
          hasDependent: async (id3) => dependents.has(id3)
        });
      }, signal);
    }
    async refresh(transport2, signal = new AbortController().signal) {
      const ticket = await this.beginRead();
      if (!transport2.catalogue) return this.remember(await accountSyncDeadline((s) => transport2.snapshot(s), signal), ticket, signal);
      return stageCatalogue({
        run: this.tx.bind(this),
        domain: "themes",
        catalogKey,
        ticket,
        id: this.uuid(),
        signal,
        now: this.now,
        parse: (id3, value) => {
          const row = parseAccountThemeSnapshot([value])[0];
          if (row.id !== id3 || row.title === void 0) return fail8("Invalid streamed themes entry.", "INVALID_THEME_SNAPSHOT", 502);
          return row;
        },
        load: (sink, requestSignal) => transport2.catalogue(sink, requestSignal),
        admit: (tx, rows) => this.admitCatalogue(tx, rows)
      });
    }
    async readRemote(id3, transport2, signal) {
      if (!transport2.catalogue) return parseAccountThemeSnapshot(await accountSyncDeadline((s) => transport2.snapshot(s), signal)).find((row) => row.id === id3) ?? null;
      return findCatalogueEntry((sink, requestSignal) => transport2.catalogue(sink, requestSignal), id3, (value) => {
        const row = parseAccountThemeSnapshot([value])[0];
        if (row.id !== id3) return fail8("Invalid streamed themes identity.");
        return row;
      }, signal);
    }
    async sync(transport2, signal = new AbortController().signal, maxWrites = 25) {
      let completed = 0;
      for (let i = 0; i < Math.min(100, maxWrites) && !signal.aborted; i++) {
        const claimed = await this.tx("readwrite", async (tx) => {
          for (const { value: row } of await tx.list(collection)) {
            if (!["pending", "syncing"].includes(row.state) || row.retryAt > this.now() || row.claim && row.claim.expiresAt > this.now()) continue;
            let pending = row.pending;
            if (!pending) {
              const thing = await tx.get("things", row.id);
              if (!row.deleted && row.placementIntent && thing?.folderId) {
                const parent = await tx.get("thing-sync", thing.folderId);
                if (parent && (!parent.base || parent.base.id !== thing.folderId || parent.deleted)) continue;
              }
              const common = { id: row.id, writeId: this.uuid(), expectedVersion: row.baseVersion };
              const command = parseThemeWrite(
                row.deleted ? { ...common, action: "delete" } : {
                  ...common,
                  action: "save",
                  name: thing?.crystal.name,
                  theme: thing?.crystal.theme,
                  visibility: row.visibility,
                  ...row.placementIntent ? { folderId: thing?.folderId || null } : {},
                  ...row.titleIntent ? { title: thing?.crystal.title ?? null } : {}
                }
              );
              pending = { command, revision: row.revision, receiptPlane: "home" };
            }
            const next = { ...row, pending, state: "syncing", claim: { token: this.uuid(), expiresAt: this.now() + 6e4 } };
            await tx.put(collection, row.id, next);
            return next;
          }
          return null;
        });
        if (!claimed) break;
        const controller = new AbortController(), off = this.lease.onInvalidate(() => controller.abort()), abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        try {
          const command = claimed.pending.command, acknowledgment = parseThemeWriteAcknowledgment(await accountSyncDeadline((s) => transport2.write(command, s, claimed.pending.receiptPlane ?? this.scope.dataPlane), controller.signal));
          if (acknowledgment.id !== command.id || acknowledgment.writeId !== command.writeId || acknowledgment.action !== command.action || acknowledgment.expectedVersion !== command.expectedVersion)
            return fail8("Theme acknowledgment does not match the saved operation.", "INVALID_THEME_ACK", 502);
          await this.tx("readwrite", async (tx) => {
            const row = await tx.get(collection, claimed.id);
            if (row?.claim?.token !== claimed.claim.token) return;
            if (command.action === "delete" && row.deleted && row.revision === claimed.pending.revision) {
              await tx.put(collection, row.id, {
                ...row,
                state: "synced",
                base: null,
                baseVersion: null,
                remoteFolderId: null,
                placementIntent: void 0,
                pending: void 0,
                claim: void 0,
                error: void 0,
                retryAt: 0
              });
              await this.bump(tx);
              return;
            }
            await tx.put(collection, row.id, {
              ...row,
              baseVersion: acknowledgment.resultVersion,
              remoteFolderId: command.action === "save" && command.folderId !== void 0 ? command.folderId : row.remoteFolderId !== void 0 ? row.remoteFolderId : row.base?.folderId,
              placementIntent: row.revision === claimed.pending.revision ? void 0 : row.placementIntent,
              titleIntent: row.revision === claimed.pending.revision ? void 0 : row.titleIntent,
              pending: void 0,
              claim: void 0,
              state: row.revision === claimed.pending.revision ? "synced" : "pending",
              attempts: 0,
              retryAt: 0,
              error: void 0
            });
            await this.bump(tx);
          });
          completed++;
        } catch (error) {
          this.lease.assertCurrent();
          await this.tx("readwrite", async (tx) => {
            const row = await tx.get(collection, claimed.id);
            if (row?.claim?.token !== claimed.claim.token) return;
            const status = Number(error?.status), state = status === 409 && !["WORKSPACE_CHANGED", "ACCOUNT_UNCONFIRMED"].includes(error?.code) ? "conflict" : [400, 401, 403, 404, 410, 413, 422].includes(status) ? "error" : "pending";
            await tx.put(collection, row.id, {
              ...row,
              claim: void 0,
              state,
              attempts: row.attempts + 1,
              retryAt: this.now() + Math.max(Math.min(6e4, 1e3 * 2 ** Math.min(row.attempts, 6)), Math.min(864e5, Number(error?.retryAfterMs) || 0)),
              error: state === "conflict" ? "Account theme changed. Review before synchronizing." : state === "error" ? "Account save was refused. Device changes are preserved." : "Saved on this device; waiting to synchronize."
            });
          });
          break;
        } finally {
          off();
          signal.removeEventListener("abort", abort);
        }
      }
      return { completed };
    }
    async retry(id3) {
      return this.tx("readwrite", async (tx) => {
        const row = await tx.get(collection, id3);
        if (!row) return;
        if (row.state === "conflict") return fail8("Review the changed account theme before retrying.");
        if (row.claim && row.claim.expiresAt > this.now()) return;
        await tx.put(collection, id3, { ...row, state: "pending", retryAt: 0, error: void 0 });
      });
    }
    async inspect(id3, transport2, signal = new AbortController().signal) {
      const remote = await this.readRemote(id3, transport2, signal);
      return this.tx(
        "readonly",
        async (tx) => {
          const state = await tx.get(collection, id3);
          if (!state || !["conflict", "error"].includes(state.state) || state.claim) return fail8("Theme is not ready for conflict review.");
          return { id: id3, revision: state.revision, remote, local: await tx.get("things", id3) ?? null, visibility: state.visibility };
        },
        signal
      );
    }
    async resolve(review, keep, transport2, signal = new AbortController().signal) {
      if (!["local", "remote", "copy"].includes(keep)) return fail8("Choose the device theme, account theme or independent copy.");
      const remote = await this.readRemote(review.id, transport2, signal);
      if (stable(remote) !== stable(review.remote)) return fail8("Account theme changed again. Review it again.");
      return this.tx(
        "readwrite",
        async (tx) => {
          const row = await tx.get(collection, review.id), local = await tx.get("things", review.id) ?? null;
          if (!row || row.revision !== review.revision || row.claim || !["conflict", "error"].includes(row.state) || stable(local) !== stable(review.local))
            return fail8("Device theme changed. Review it again.");
          let copyId;
          const independent = keep === "copy" || keep === "local" && !remote && !!local;
          if (independent) {
            if (!local || !isTransferTheme(local)) return fail8("There is no device theme to copy.");
            copyId = (await this.copyIn(tx, local)).id;
            if (await tx.get("settings", "active-theme") === row.id) {
              await tx.put("settings", "active-theme", copyId);
              await this.selection.setIn(tx, copyId);
            }
          }
          if (keep === "remote" || independent) {
            if (remote) await this.install(tx, remote, row);
            else {
              if ((await tx.list("things")).some(({ value }) => value.targetId === row.id || value.folderId === row.id))
                return fail8("Keep related device Things before removing this theme.");
              await tx.delete("things", row.id);
              await tx.delete(collection, row.id);
              if (await tx.get("settings", "active-theme") === row.id) {
                await tx.delete("settings", "active-theme");
                await this.selection.setIn(tx, null);
              }
            }
          } else {
            if (!remote && !local) {
              await tx.delete(collection, row.id);
            } else
              await tx.put(collection, row.id, {
                ...row,
                base: remote,
                baseVersion: remote.version,
                pending: void 0,
                claim: void 0,
                revision: row.revision + 1,
                state: "pending",
                retryAt: 0,
                attempts: 0,
                error: void 0
              });
          }
          await this.bump(tx);
          return { copyId };
        },
        signal
      );
    }
  };

  // remix/app/components/Feed/defaultAlgorithms.ts
  var DEFAULT_ALGORITHMS = [
    { id: "hot", name: "Hot", emoji: "\u{1F525}", description: "Popular posts balanced with freshness." },
    { id: "new", name: "New", emoji: "\u2728", description: "Newest posts first." },
    { id: "top", name: "Top", emoji: "\u{1F3C6}", description: "Highest net votes among the latest 400 posts." },
    { id: "rising", name: "Rising", emoji: "\u{1F4C8}", description: "Fresh posts gaining votes in the last day." },
    { id: "controversial", name: "Controversial", emoji: "\u26A1", description: "Posts with both upvotes and downvotes." },
    { id: "local", name: "Local", emoji: "\u{1F4CD}", description: "Nearby posts using your location, or a location tag you choose." },
    { id: "global", name: "Global", emoji: "\u{1F30D}", description: "Hot posts from the public feed worldwide." },
    { id: "political", name: "Political", emoji: "\u{1F3DB}\uFE0F", description: "Hot posts tagged politics or political." }
  ];
  var isDefaultAlgorithm = (id3) => DEFAULT_ALGORITHMS.some((item) => item.id === id3);

  // remix/app/api/utils/algorithms/algorithmSelectionContract.ts
  var validId2 = (value) => value === null || typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
  var validVersion2 = (value) => typeof value === "string" && /^algorithm-selection-v1:[a-f0-9]{64}$/.test(value);
  var fail9 = () => {
    throw new Error("Invalid active algorithm synchronization.");
  };
  function parseAlgorithmSelection(value) {
    const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 2 || !validId2(row.algorithmId) || !validVersion2(row.version))
      return fail9();
    return { algorithmId: row.algorithmId, version: row.version };
  }
  function parseAlgorithmSelectionWrite(value) {
    const row = copyBoundedJson(value, { maxBytes: 4096, maxDepth: 3, maxNodes: 20 });
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 3 || !validId2(row.algorithmId) || !validVersion2(row.expectedVersion) || typeof row.writeId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(row.writeId))
      return fail9();
    return { algorithmId: row.algorithmId, expectedVersion: row.expectedVersion, writeId: row.writeId };
  }
  function parseAlgorithmSelectionAcknowledgment(value) {
    const row = copyBoundedJson(value, { maxBytes: 8192, maxDepth: 4, maxNodes: 40 });
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 4) return fail9();
    const { result, ...command } = row;
    const write = parseAlgorithmSelectionWrite(command), selection = parseAlgorithmSelection(result);
    if (selection.algorithmId !== write.algorithmId) return fail9();
    return { ...write, result: selection };
  }

  // remix/app/local-workspace/algorithmSelection.ts
  var key2 = "account-algorithm-selection";
  var fail10 = (message) => {
    throw new WorkspaceError("SELECTION_CONFLICT", message, 409);
  };
  var AccountAlgorithmSelection = class {
    constructor(db, scope2, lease2, now = () => Date.now(), uuid = () => crypto.randomUUID()) {
      this.db = db;
      this.scope = scope2;
      this.lease = lease2;
      this.now = now;
      this.uuid = uuid;
      if (scope2.kind !== "account") throw new WorkspaceError("ACCOUNT_REQUIRED", "Anonymous selections never synchronize.", 403);
      if (scope2.dataPlane !== "home") throw new WorkspaceError("ALGORITHM_HOME_REQUIRED", "Account selections belong to home.", 409);
    }
    tx(mode, run, signal) {
      const lease2 = signal ? {
        assertCurrent: () => {
          this.lease.assertCurrent();
          signal.throwIfAborted();
        },
        onInvalidate: (cb) => {
          const off = this.lease.onInvalidate(cb);
          signal.addEventListener("abort", cb, { once: true });
          return () => {
            off();
            signal.removeEventListener("abort", cb);
          };
        }
      } : this.lease;
      return this.db.transaction(this.scope, mode, lease2, run);
    }
    async setIn(tx, algorithmId) {
      const old = await tx.get("settings", key2);
      if (old?.desired === algorithmId) return;
      await tx.put("settings", key2, {
        revision: (old?.revision ?? 0) + 1,
        desired: algorithmId,
        base: old?.base ?? null,
        state: old?.state === "conflict" || old?.state === "error" ? old.state : "pending",
        pending: old?.pending,
        claim: old?.claim,
        retryAt: old?.retryAt ?? 0,
        attempts: old?.attempts ?? 0,
        error: old?.error
      });
    }
    status() {
      return this.tx("readonly", (tx) => tx.get("settings", key2));
    }
    async applyIn(tx, algorithmId) {
      if (algorithmId) await tx.put("settings", "active-algorithm", algorithmId);
      else await tx.delete("settings", "active-algorithm");
    }
    async remember(raw, revision, signal) {
      const remote = parseAlgorithmSelection(raw);
      return this.tx(
        "readwrite",
        async (tx) => {
          const old = await tx.get("settings", key2);
          if ((old?.revision ?? null) !== revision) return false;
          if (!old || old.state === "synced") {
            await tx.put("settings", key2, {
              revision: (old?.revision ?? 0) + 1,
              desired: remote.algorithmId,
              base: remote,
              state: "synced",
              retryAt: 0,
              attempts: 0
            });
            await this.applyIn(tx, remote.algorithmId);
            return true;
          }
          if (!old.base) {
            await tx.put("settings", key2, { ...old, base: remote });
            return true;
          }
          return false;
        },
        signal
      );
    }
    async refresh(transport2, signal = new AbortController().signal) {
      const revision = (await this.status())?.revision ?? null;
      const remote = await accountSyncDeadline((s) => transport2.selection(s), signal);
      return this.remember(remote, revision, signal);
    }
    async sync(transport2, ready, signal = new AbortController().signal) {
      const first = await this.status();
      if (!first || !["pending", "syncing"].includes(first.state) || first.retryAt > this.now()) return { completed: 0 };
      if (!first.base) await this.refresh(transport2, signal);
      const state = await this.status();
      if (!state?.pending && state?.desired && !isDefaultAlgorithm(state.desired) && !await ready(state.desired)) return { completed: 0 };
      const claimed = await this.tx(
        "readwrite",
        async (tx) => {
          const row = await tx.get("settings", key2);
          if (!row || !row.base || !["pending", "syncing"].includes(row.state) || row.retryAt > this.now() || row.claim && row.claim.expiresAt > this.now() || row.revision !== state?.revision)
            return null;
          const pending = row.pending ?? {
            command: parseAlgorithmSelectionWrite({ algorithmId: row.desired, expectedVersion: row.base.version, writeId: this.uuid() }),
            revision: row.revision
          };
          const next = { ...row, pending, state: "syncing", claim: { token: this.uuid(), expiresAt: this.now() + 6e4 } };
          await tx.put("settings", key2, next);
          return next;
        },
        signal
      );
      if (!claimed) return { completed: 0 };
      const controller = new AbortController(), off = this.lease.onInvalidate(() => controller.abort()), abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      try {
        const command = parseAlgorithmSelectionWrite(claimed.pending.command);
        let result;
        try {
          const acknowledgment = parseAlgorithmSelectionAcknowledgment(
            await accountSyncDeadline((s) => transport2.select(structuredClone(command), s), controller.signal)
          );
          if (acknowledgment.algorithmId !== command.algorithmId || acknowledgment.writeId !== command.writeId || acknowledgment.expectedVersion !== command.expectedVersion)
            throw new WorkspaceError("INVALID_SELECTION_ACK", "Selection acknowledgment changed.", 502);
          result = acknowledgment.result;
        } catch (error) {
          if (Number(error?.status) !== 409 || ["WORKSPACE_CHANGED", "ACCOUNT_UNCONFIRMED"].includes(error?.code)) throw error;
          const observed = parseAlgorithmSelection(await accountSyncDeadline((s) => transport2.selection(s), controller.signal));
          if (observed.algorithmId !== command.algorithmId) throw error;
          result = observed;
        }
        await this.tx(
          "readwrite",
          async (tx) => {
            const row = await tx.get("settings", key2);
            if (row?.claim?.token !== claimed.claim.token) return;
            await tx.put("settings", key2, {
              ...row,
              base: result,
              pending: void 0,
              claim: void 0,
              state: row.revision === claimed.pending.revision ? "synced" : "pending",
              attempts: 0,
              retryAt: 0,
              error: void 0
            });
          },
          controller.signal
        );
        return { completed: 1 };
      } catch (error) {
        this.lease.assertCurrent();
        await this.tx("readwrite", async (tx) => {
          const row = await tx.get("settings", key2);
          if (row?.claim?.token !== claimed.claim.token) return;
          const status = Number(error?.status), changed2 = ["WORKSPACE_CHANGED", "ACCOUNT_UNCONFIRMED"].includes(error?.code), state2 = status === 409 && !changed2 ? "conflict" : !changed2 && [400, 401, 403, 404, 410, 413, 422].includes(status) ? "error" : "pending";
          await tx.put("settings", key2, {
            ...row,
            claim: void 0,
            state: state2,
            attempts: row.attempts + 1,
            retryAt: this.now() + Math.max(Math.min(6e4, 1e3 * 2 ** Math.min(row.attempts, 6)), Math.min(864e5, Number(error?.retryAfterMs) || 0)),
            error: state2 === "conflict" ? "Your account selected another algorithm. Review the choice." : state2 === "error" ? "Account selection was refused. This device keeps its choice." : "Applied on this device; waiting to synchronize."
          });
        });
        return { completed: 0 };
      } finally {
        off();
        signal.removeEventListener("abort", abort);
      }
    }
    async retry() {
      return this.tx("readwrite", async (tx) => {
        const row = await tx.get("settings", key2);
        if (!row) return;
        if (row.state === "conflict") return fail10("Review the changed selection first.");
        if (row.claim && row.claim.expiresAt > this.now()) return;
        await tx.put("settings", key2, { ...row, state: "pending", retryAt: 0, error: void 0 });
      });
    }
    async inspect(transport2, signal = new AbortController().signal) {
      const remote = parseAlgorithmSelection(await accountSyncDeadline((s) => transport2.selection(s), signal));
      return this.tx(
        "readonly",
        async (tx) => {
          const row = await tx.get("settings", key2);
          if (!row || row.claim || !["conflict", "error"].includes(row.state)) return fail10("The selection is not ready for review.");
          return { revision: row.revision, desired: row.desired, remote };
        },
        signal
      );
    }
    async resolve(review, keep, transport2, signal = new AbortController().signal) {
      if (!["local", "remote"].includes(keep)) return fail10("Choose the device or account selection.");
      const remote = parseAlgorithmSelection(await accountSyncDeadline((s) => transport2.selection(s), signal));
      if (remote.version !== review.remote.version || remote.algorithmId !== review.remote.algorithmId)
        return fail10("The account selection changed again.");
      return this.tx(
        "readwrite",
        async (tx) => {
          const row = await tx.get("settings", key2);
          if (!row || row.claim || row.revision !== review.revision || !["conflict", "error"].includes(row.state))
            return fail10("The device selection changed.");
          const desired = keep === "local" ? row.desired : remote.algorithmId;
          await tx.put("settings", key2, {
            ...row,
            revision: row.revision + 1,
            base: remote,
            desired,
            state: keep === "local" ? "pending" : "synced",
            pending: void 0,
            claim: void 0,
            attempts: 0,
            retryAt: 0,
            error: void 0
          });
          await this.applyIn(tx, desired);
        },
        signal
      );
    }
  };

  // remix/app/api/utils/things/feedRanking.ts
  var emptyWeights = () => ({ types: {}, tags: {}, authors: {} });
  var WEIGHT_CLAMP = 50;
  var BATCH_DECAY = 0.995;
  var MAX_DWELL_SIGNAL = 3;
  var SIGNAL_WEIGHTS = {
    view: 0.5,
    dwell: 0,
    // computed from dwellMs
    expand: 1.5,
    react: 2,
    comment: 3,
    share: 4
  };
  var signalStrength = (event) => {
    if (event.signal === "dwell") {
      const dwellMs = Math.max(0, Number(event.dwellMs) || 0);
      return Math.min(dwellMs / 4e3, MAX_DWELL_SIGNAL);
    }
    return SIGNAL_WEIGHTS[event.signal] ?? 0;
  };
  var clampWeight = (value) => Math.max(-WEIGHT_CLAMP, Math.min(WEIGHT_CLAMP, value));
  var bump = (bucket, key4, delta) => {
    if (!key4 || !delta) return;
    bucket[key4] = clampWeight((bucket[key4] || 0) + delta);
  };
  var decayBucket = (bucket) => {
    Object.keys(bucket).forEach((key4) => {
      const decayed = bucket[key4] * BATCH_DECAY;
      if (Math.abs(decayed) < 0.01) {
        delete bucket[key4];
      } else {
        bucket[key4] = decayed;
      }
    });
  };
  var applyEventsToWeights = (weights, events, featuresByThingId) => {
    const next = {
      types: { ...weights.types },
      tags: { ...weights.tags },
      authors: { ...weights.authors }
    };
    let applied = 0;
    events.forEach((event) => {
      const features = featuresByThingId.get(event?.thingId);
      if (!features) return;
      const strength = signalStrength(event);
      if (strength <= 0) return;
      bump(next.types, features.type, strength);
      features.tags.forEach((tag) => bump(next.tags, tag, strength));
      bump(next.authors, features.ownerId, strength);
      applied += 1;
    });
    if (applied > 0) {
      decayBucket(next.types);
      decayBucket(next.tags);
      decayBucket(next.authors);
    }
    return { weights: next, applied };
  };
  var interestScore = (weights, features) => {
    const typeScore = weights.types[features.type] || 0;
    const tagScores = features.tags.map((tag) => weights.tags[tag] || 0);
    const tagScore = tagScores.length ? tagScores.reduce((a, b) => a + b, 0) / tagScores.length : 0;
    const authorScore = weights.authors[features.ownerId] || 0;
    return typeScore + tagScore + authorScore;
  };
  var scorePost = (weights, features, now) => {
    const ageHours = Math.max(0, (now.getTime() - features.createdAt.getTime()) / 36e5);
    const interest = Math.max(0, interestScore(weights, features));
    return (1 + interest) / (1 + ageHours / 24);
  };
  var topInterests = (weights, limit = 8) => {
    const entries = [];
    Object.entries(weights.types).forEach(([key4, weight]) => entries.push({ kind: "type", key: key4, weight }));
    Object.entries(weights.tags).forEach(([key4, weight]) => entries.push({ kind: "tag", key: key4, weight }));
    Object.entries(weights.authors).forEach(([key4, weight]) => entries.push({ kind: "author", key: key4, weight }));
    return entries.filter((entry) => entry.weight > 0).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key)).slice(0, limit).map((entry) => ({ ...entry, weight: Math.round(entry.weight * 100) / 100 }));
  };

  // remix/app/api/utils/algorithms/algorithmContent.ts
  var MAX_SAVED_ALGORITHMS = 50;
  var normalizeAlgorithmName = (value) => typeof value === "string" ? value.trim().slice(0, 60) : "";
  var sanitizeAlgorithmEmoji = (value) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed && [...trimmed].length <= 3 ? trimmed : "\u{1F9E0}";
  };
  var sanitizeAlgorithmEvents = (value) => !Array.isArray(value) ? [] : value.filter(
    (entry) => !!entry && typeof entry === "object" && typeof entry.thingId === "string" && typeof entry.signal === "string"
  ).slice(0, 100);

  // remix/app/local-workspace/algorithms.ts
  var validWeightKey = (value) => typeof value === "string" && !!value && value.length <= 512 && !["__proto__", "prototype", "constructor"].includes(value) && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  var publicFeatures = (post) => {
    if (!validWeightKey(post?.id) || post.id.length > 200 || !validWeightKey(post.type) || !validWeightKey(post.author?.id) || typeof post.createdAt !== "string" || !Number.isFinite(Date.parse(post.createdAt)))
      return null;
    return {
      type: post.type,
      ownerId: post.author.id,
      tags: Array.isArray(post.tags) ? post.tags.filter(validWeightKey).slice(0, 100) : [],
      createdAt: new Date(post.createdAt).toISOString(),
      observedAt: Date.now()
    };
  };
  var project2 = (row) => ({
    id: row.id,
    name: row.crystal.name,
    emoji: row.crystal.emoji,
    parentId: row.crystal.parentId || null,
    description: row.crystal.description || "",
    shared: false,
    listed: false,
    localOnly: true,
    eventCount: row.crystal.eventCount,
    lastTrainedAt: row.crystal.lastTrainedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    topInterests: topInterests(algorithmTransferContent(row.crystal).weights)
  });
  var LocalAlgorithms = class {
    constructor(db, lease2, options = {}) {
      this.db = db;
      this.lease = lease2;
      this.options = options;
      this.scope = options.scope ?? { kind: "anonymous" };
      const source = options.observationScope;
      if (source && (this.scope.kind !== "account" || source.ownerId !== this.scope.ownerId || source.origin !== this.scope.origin || !source.dataPlane || source.dataPlane.length > 200))
        throw new WorkspaceError("WORKSPACE_CHANGED", "Feed observations must belong to this account and origin.", 409);
      this.featureCollection = this.scope.kind === "anonymous" ? "algorithm-post-features" : `algorithm-features-v1:${source?.dataPlane ?? this.scope.dataPlane}`;
    }
    now() {
      return this.options.now?.() ?? Date.now();
    }
    transaction(mode, run) {
      return this.db.transaction(this.scope, mode, this.lease, (tx) => mode === "readwrite" && this.scope.kind === "anonymous" ? captureThingChanges(tx, run, (tx2, changes) => recordLocalThingChanges(tx2, changes, () => new Date(this.now()).toISOString(), this.options.uuid ?? (() => crypto.randomUUID()))) : run(tx));
    }
    /** History uses the dedicated profile writer, within the same transaction as
     * its authored event and optional account intent. Selection is untouched. */
    async versionTransaction(run, signal) {
      const lease2 = {
        assertCurrent: () => {
          this.lease.assertCurrent();
          signal?.throwIfAborted();
        },
        onInvalidate: (callback) => {
          const off = this.lease.onInvalidate(callback);
          signal?.addEventListener("abort", callback, { once: true });
          return () => {
            off();
            signal?.removeEventListener("abort", callback);
          };
        }
      };
      return this.db.transaction(this.scope, "readwrite", lease2, async (tx) => {
        const captures = /* @__PURE__ */ new Map();
        const apply = (tx2) => run({ tx: tx2, update: async (input, capture) => {
          lease2.assertCurrent();
          const previous = await this.read(tx2, input.id);
          if (input.expectedUpdatedAt && previous.updatedAt !== input.expectedUpdatedAt)
            throw new WorkspaceError("WRITE_CONFLICT", "This algorithm changed after the version preview.", 409);
          if (Object.keys(input.crystal ?? {}).some((key4) => !["name", "emoji", "weights", "eventCount", "lastTrainedAt", "description"].includes(key4)))
            throw new WorkspaceError("INVALID_ALGORITHM", "History can replace only algorithm design content.");
          const content = algorithmContentValue({ adapter: "algorithm-content", version: 1, value: { crystal: input.crystal, folderId: null } });
          const row = structuredClone(previous);
          row.crystal = { ...row.crystal, ...snapshotTransferValue(content.crystal) };
          captures.set(input.id, capture);
          const result = await this.save(tx2, row, previous, capture);
          lease2.assertCurrent();
          return result;
        }, recover: async (input, id3, capture) => {
          lease2.assertCurrent();
          const row = await recoveredProtectedRow(tx2, this.scope, id3, input, "feed-algorithm", new Date(this.now()).toISOString());
          captures.set(id3, capture);
          await tx2.put("things", id3, row);
          await this.options.onWrite?.(tx2, row, null, capture);
          lease2.assertCurrent();
          return project2(row);
        } });
        return this.scope.kind === "anonymous" ? captureThingChanges(tx, apply, (tx2, changes) => recordLocalThingChanges(tx2, changes, () => new Date(this.now()).toISOString(), this.options.uuid ?? (() => crypto.randomUUID()), captures)) : apply(tx);
      });
    }
    async read(tx, id3) {
      const row = await tx.get("things", id3);
      if (!row || !isTransferAlgorithm(row)) throw new WorkspaceError("NOT_FOUND", "Algorithm is not in this workspace", 404);
      return row;
    }
    async save(tx, row, previous, capture) {
      algorithmTransferContent(row.crystal);
      row.updatedAt = new Date(Math.max(this.now(), Date.parse(row.updatedAt) + 1)).toISOString();
      row.revision++;
      await tx.put("things", row.id, row);
      await this.options.onWrite?.(tx, row, previous, capture);
      return project2(row);
    }
    async list() {
      return this.transaction("readonly", (tx) => this.listIn(tx));
    }
    async listIn(tx) {
      this.lease.assertCurrent();
      return {
        ok: true,
        algorithms: (await tx.list("things")).map((row) => row.value).filter(isTransferAlgorithm).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(project2),
        activeAlgorithmId: await tx.get("settings", "active-algorithm") || null
      };
    }
    async create(input) {
      const name = normalizeAlgorithmName(input.name);
      if (!name) throw new WorkspaceError("INVALID_ALGORITHM", "Algorithm name is required");
      return this.transaction("readwrite", async (tx) => {
        const parent = input.branchFrom ? await this.read(tx, input.branchFrom) : null;
        const base = {
          name,
          emoji: sanitizeAlgorithmEmoji(input.emoji),
          weights: parent ? algorithmTransferContent(parent.crystal).weights : emptyWeights(),
          eventCount: 0,
          lastTrainedAt: null
        };
        const events = sanitizeAlgorithmEvents(input.events), trained = applyEventsToWeights(
          base.weights,
          events,
          await this.features(
            tx,
            events.map((event) => event.thingId)
          )
        );
        const now = new Date(this.now()).toISOString();
        const content = parseAlgorithmTransfer({
          ...base,
          weights: trained.weights,
          eventCount: trained.applied,
          lastTrainedAt: trained.applied ? now : null
        });
        const row = {
          id: `${this.scope.kind === "anonymous" ? "local-" : ""}${this.options.uuid?.() ?? crypto.randomUUID()}`,
          thingtime: ["feed-algorithm"],
          crystal: snapshotTransferValue({
            ...content,
            parentId: parent?.id || null,
            description: typeof input.description === "string" ? input.description.trim().slice(0, 300) : ""
          }),
          createdAt: now,
          updatedAt: now,
          revision: 0
        };
        return { ok: true, algorithm: await this.save(tx, row, null) };
      });
    }
    async update(input) {
      if (input.shared || input.listed)
        throw new WorkspaceError("REMOTE_ACCOUNT_REQUIRED", "Local algorithms stay on this device. Sign in to share a separate account copy.", 401);
      return this.transaction("readwrite", async (tx) => {
        const row = await this.read(tx, input.id), previous = structuredClone(row);
        if (input.expectedUpdatedAt && row.updatedAt !== input.expectedUpdatedAt)
          throw new WorkspaceError("WRITE_CONFLICT", "This algorithm changed in another editor. Reload before saving.", 409);
        if (input.name !== void 0) {
          const name = normalizeAlgorithmName(input.name);
          if (!name) throw new WorkspaceError("INVALID_ALGORITHM", "Algorithm name is required");
          row.crystal.name = name;
        }
        if (input.emoji !== void 0) row.crystal.emoji = sanitizeAlgorithmEmoji(input.emoji);
        if (input.description !== void 0) {
          if (typeof input.description !== "string") throw new WorkspaceError("INVALID_ALGORITHM", "Description must be text");
          row.crystal.description = input.description.trim().slice(0, 300);
        }
        return { ok: true, algorithm: await this.save(tx, row, previous) };
      });
    }
    async setActive(id3) {
      return this.transaction("readwrite", async (tx) => {
        if (id3 && !isDefaultAlgorithm(id3)) await this.read(tx, id3);
        if (id3) await tx.put("settings", "active-algorithm", id3);
        else await tx.delete("settings", "active-algorithm");
        await this.options.onActive?.(tx, id3);
        return { ok: true, activeAlgorithmId: id3 };
      });
    }
    async remove(id3) {
      return this.transaction("readwrite", (tx) => this.removeIn(tx, id3));
    }
    async removeIn(tx, id3) {
      this.lease.assertCurrent();
      const previous = await this.read(tx, id3);
      if ((await tx.list("things")).some((row) => row.value.folderId === id3 || row.value.targetId === id3))
        throw new WorkspaceError("HAS_CHILDREN", "Remove related local Things before deleting this algorithm");
      await tx.delete("things", id3);
      if (await tx.get("settings", "active-algorithm") === id3) {
        await tx.delete("settings", "active-algorithm");
        await this.options.onActive?.(tx, null);
      }
      await this.options.onWrite?.(tx, null, previous);
      return { ok: true };
    }
    async features(tx, ids) {
      const result = /* @__PURE__ */ new Map();
      for (const id3 of new Set(ids)) {
        const saved2 = await tx.get(this.featureCollection, id3);
        if (saved2) result.set(id3, { ...saved2, createdAt: new Date(saved2.createdAt) });
      }
      return result;
    }
    async observePublicPosts(posts) {
      return this.observePosts(posts);
    }
    /** Input comes from the current adapter's authorized feed response. This
     * records bounded features only; it performs no reads or remote mutations. */
    async observePosts(posts) {
      return this.transaction("readwrite", async (tx) => {
        for (const post of posts.slice(0, 200)) {
          const features = publicFeatures(post);
          if (features) await tx.put(this.featureCollection, post.id, features);
        }
        const all = await tx.list(this.featureCollection);
        all.sort((a, b) => b.value.observedAt - a.value.observedAt || a.id.localeCompare(b.id));
        for (const row of all.slice(1e3)) await tx.delete(this.featureCollection, row.id);
      });
    }
    async track(input) {
      return this.transaction("readwrite", async (tx) => {
        const row = await this.read(tx, input.algorithmId), previous = structuredClone(row), content = algorithmTransferContent(row.crystal), events = sanitizeAlgorithmEvents(input.events);
        const trained = applyEventsToWeights(
          content.weights,
          events,
          await this.features(
            tx,
            events.map((event) => event.thingId)
          )
        );
        if (trained.applied) {
          row.crystal = {
            ...row.crystal,
            ...snapshotTransferValue(
              parseAlgorithmTransfer({
                ...content,
                weights: trained.weights,
                eventCount: content.eventCount + trained.applied,
                lastTrainedAt: new Date(this.now()).toISOString()
              })
            )
          };
          await this.save(tx, row, previous);
        }
        return { ok: true, trained: trained.applied > 0, applied: trained.applied, eventCount: row.crystal.eventCount };
      });
    }
    async rankPage(id3, posts) {
      return this.transaction("readonly", async (tx) => {
        const weights = algorithmTransferContent((await this.read(tx, id3)).crystal).weights, features = /* @__PURE__ */ new Map(), now = /* @__PURE__ */ new Date();
        for (const post of posts) {
          const row = publicFeatures(post);
          if (row) features.set(post.id, { ...row, createdAt: new Date(row.createdAt) });
        }
        const score = (post) => features.has(post.id) ? scorePost(weights, features.get(post.id), now) : 0;
        return [...posts].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      });
    }
  };

  // remix/app/api/utils/algorithms/algorithmSyncContract.ts
  var ALGORITHM_SYNC_MAX_BYTES = 2 * 1024 * 1024;
  var validAlgorithmVersion = (value) => typeof value === "string" && /^algorithm-state-v1:[a-f0-9]{64}$/.test(value);
  var identity2 = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) && !value.startsWith("timeline-");
  var freshId = (value) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
  var object4 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  var fail11 = () => {
    throw new Error("Invalid algorithm synchronization command.");
  };
  function parseAlgorithmWrite(input) {
    const value = copyBoundedJson(input, { maxBytes: ALGORITHM_SYNC_MAX_BYTES, maxDepth: 10, maxNodes: 65e3, sortKeys: true });
    if (!object4(value) || !identity2(value.id) || !identity2(value.writeId) || value.writeId.length > 160 || value.expectedVersion !== null && !validAlgorithmVersion(value.expectedVersion) || value.expectedVersion === null && !freshId(value.id))
      return fail11();
    const base = { id: value.id, writeId: value.writeId, expectedVersion: value.expectedVersion };
    if (value.action === "delete") {
      if (value.expectedVersion === null || Object.keys(value).some((key4) => !["id", "writeId", "expectedVersion", "action"].includes(key4)))
        return fail11();
      return { ...base, action: "delete", expectedVersion: value.expectedVersion };
    }
    if (value.action !== "save" || Object.keys(value).some(
      (key4) => !["id", "writeId", "expectedVersion", "action", "content", "description", "parentId", "folderId"].includes(key4)
    ) || typeof value.description !== "string" || value.description.length > 300 || value.description !== value.description.trim() || "folderId" in value && value.folderId !== null && (!identity2(value.folderId) || value.folderId === value.id) || "parentId" in value && (value.expectedVersion !== null || value.parentId !== null && (!identity2(value.parentId) || value.parentId === value.id)))
      return fail11();
    return {
      ...base,
      action: "save",
      content: parseAlgorithmTransfer(value.content),
      description: value.description,
      ..."parentId" in value ? { parentId: value.parentId } : {},
      ..."folderId" in value ? { folderId: value.folderId } : {}
    };
  }
  function parseAlgorithmWriteAcknowledgment(input) {
    if (!object4(input) || Object.keys(input).length !== 5 || Object.keys(input).some((key4) => !["id", "writeId", "action", "expectedVersion", "resultVersion"].includes(key4)) || !identity2(input.id) || !identity2(input.writeId) || input.writeId.length > 160 || !["save", "delete"].includes(String(input.action)) || input.expectedVersion !== null && !validAlgorithmVersion(input.expectedVersion) || input.expectedVersion === null && !freshId(input.id) || (input.action === "delete" ? input.expectedVersion === null || input.resultVersion !== null : !validAlgorithmVersion(input.resultVersion)))
      return fail11();
    return {
      id: input.id,
      writeId: input.writeId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      resultVersion: input.resultVersion
    };
  }

  // remix/app/local-workspace/accountAlgorithms.ts
  var profileMetadata = ({ content: _content, ...metadata }) => metadata;
  var collection2 = "account-algorithm-sync";
  var catalogKey2 = "account-algorithm-catalog";
  var blankCatalog2 = () => ({ epoch: 0, read: 0, complete: false });
  var fail12 = (message, code = "ALGORITHM_SYNC_CONFLICT", status = 409) => {
    throw new WorkspaceError(code, message, status);
  };
  var identity3 = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) && !value.startsWith("timeline-");
  var stamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  function parseAccountAlgorithmSnapshot(input) {
    const rows = copyBoundedJson(input, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 25e4 });
    if (!Array.isArray(rows) || rows.length > MAX_SAVED_ALGORITHMS) return fail12("Invalid algorithm catalogue.", "INVALID_ALGORITHM_SNAPSHOT", 502);
    const seen = /* @__PURE__ */ new Set();
    return rows.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail12("Invalid algorithm catalogue.", "INVALID_ALGORITHM_SNAPSHOT", 502);
      const row = raw;
      if (Object.keys(row).some(
        (key4) => !["id", "version", "content", "description", "parentId", "shared", "listed", "folderId", "legacy", "createdAt", "updatedAt"].includes(key4)
      ) || !identity3(row.id) || seen.has(row.id) || !validAlgorithmVersion(row.version) || typeof row.description !== "string" || row.description.length > 300 || row.parentId !== null && !identity3(row.parentId) || row.folderId !== null && !identity3(row.folderId) || typeof row.shared !== "boolean" || typeof row.listed !== "boolean" || typeof row.legacy !== "boolean" || !stamp(row.createdAt) || !stamp(row.updatedAt))
        return fail12("Invalid algorithm catalogue.", "INVALID_ALGORITHM_SNAPSHOT", 502);
      seen.add(row.id);
      return { ...row, content: parseAlgorithmTransfer(row.content) };
    });
  }
  var AccountAlgorithmSync = class {
    constructor(db, scope2, lease2, now = () => Date.now(), uuid = () => crypto.randomUUID(), observationScope = scope2) {
      this.db = db;
      this.scope = scope2;
      this.lease = lease2;
      this.now = now;
      this.uuid = uuid;
      if (scope2.kind !== "account") return fail12("Anonymous algorithms never synchronize.", "ACCOUNT_REQUIRED", 403);
      if (scope2.dataPlane !== "home") return fail12("Account algorithms belong to the home workspace.", "ALGORITHM_HOME_REQUIRED");
      this.selection = new AccountAlgorithmSelection(db, scope2, lease2, now, uuid);
      this.algorithms = new LocalAlgorithms(db, lease2, {
        scope: scope2,
        observationScope,
        now,
        uuid,
        onActive: (tx, id3) => this.selection.setIn(tx, id3),
        onWrite: (tx, row, previous, capture) => this.mutated(tx, row, previous, capture)
      });
    }
    tx(mode, run, signal) {
      const lease2 = signal ? {
        assertCurrent: () => {
          this.lease.assertCurrent();
          signal.throwIfAborted();
        },
        onInvalidate: (callback) => {
          const off = this.lease.onInvalidate(callback);
          signal.addEventListener("abort", callback, { once: true });
          return () => {
            off();
            signal.removeEventListener("abort", callback);
          };
        }
      } : this.lease;
      return this.db.transaction(this.scope, mode, lease2, run);
    }
    async bump(tx) {
      const old = await tx.get("settings", catalogKey2) ?? blankCatalog2();
      await tx.put("settings", catalogKey2, { ...old, epoch: old.epoch + 1 });
    }
    async mutated(tx, row, previous, capture) {
      const id3 = row?.id ?? previous.id, old = await tx.get(collection2, id3);
      if (previous && !old) return fail12("Refresh this account algorithm before editing it.");
      await recordAccountAlgorithmChange(tx, this.scope, previous, row, () => new Date(this.now()).toISOString(), this.uuid, capture);
      if (!row && old?.baseVersion === null && !old.pending) {
        await tx.delete(collection2, id3);
        await this.bump(tx);
        return;
      }
      await tx.put(collection2, id3, {
        id: id3,
        revision: (old?.revision ?? 0) + 1,
        base: old?.base ?? null,
        baseVersion: old?.baseVersion ?? null,
        remoteFolderId: old?.remoteFolderId !== void 0 ? old.remoteFolderId : old?.base?.folderId ?? null,
        placementIntent: old?.placementIntent || (row?.folderId ?? null) !== (previous?.folderId ?? null),
        state: old && ["conflict", "error"].includes(old.state) ? old.state : "pending",
        deleted: !row,
        pending: old?.pending,
        claim: old?.claim,
        retryAt: old?.retryAt ?? 0,
        attempts: old?.attempts ?? 0,
        error: old?.error
      });
      await this.bump(tx);
    }
    /** Canonical import already validated the bundle and remapped every ID.
     * This hook adds account intent in that same device transaction. */
    async importIn(tx, row) {
      this.lease.assertCurrent();
      validateTransferAlgorithm(row);
      if (await tx.get(collection2, row.id) || await tx.get("thing-sync", row.id))
        return fail12("An imported algorithm must have an independent identity.");
      await this.mutated(tx, row, null);
      const state = await tx.get(collection2, row.id);
      await tx.put(collection2, row.id, { ...state, placementIntent: true });
    }
    async viewIn(tx, id3) {
      this.lease.assertCurrent();
      const row = await tx.get("things", id3), state = await tx.get(collection2, id3);
      if (!row || !isTransferAlgorithm(row) || !state || state.deleted) return null;
      return {
        ...row,
        visibility: "private",
        acl: ["tt:user"],
        author: { id: this.scope.ownerId },
        syncState: state.state,
        localOnly: false,
        localWorkspace: true
      };
    }
    async isDeletedIn(tx, id3) {
      return !!(await tx.get(collection2, id3))?.deleted;
    }
    async moveIn(tx, row, previous) {
      this.lease.assertCurrent();
      validateTransferAlgorithm({ ...row, crystal: algorithmTransferContent(row.crystal) });
      const stable2 = (value) => JSON.stringify(copyBoundedJson(value, { maxBytes: 2 * 1024 * 1024, maxDepth: 12, maxNodes: 65e3, sortKeys: true }));
      if (row.id !== previous.id || stable2(row.crystal) !== stable2(previous.crystal))
        return fail12("Algorithm placement cannot replace its protected content.");
      await this.mutated(tx, row, previous);
      const state = await tx.get(collection2, row.id);
      await tx.put(collection2, row.id, { ...state, placementIntent: true });
    }
    async renameIn(tx, row, previous) {
      this.lease.assertCurrent();
      if (this.scope.dataPlane !== "home") return fail12("Rename algorithms in the home library.");
      validateTransferAlgorithm({ ...row, crystal: algorithmTransferContent(row.crystal) });
      const { title: _new, ...next } = row.crystal, { title: _old, ...before } = previous.crystal;
      const stable2 = (value) => JSON.stringify(copyBoundedJson(value, { maxBytes: 2 * 1024 * 1024, maxDepth: 12, maxNodes: 65e3, sortKeys: true }));
      if (row.id !== previous.id || row.folderId !== previous.folderId || stable2(next) !== stable2(before))
        return fail12("Algorithm title changes cannot replace protected content.");
      await this.mutated(tx, row, previous);
    }
    removeIn(tx, id3) {
      return this.algorithms.removeIn(tx, id3);
    }
    async prepareFolderDelete(tx, id3, destination) {
      for (const { value: state } of await tx.list(collection2)) {
        const remoteFolder = state.remoteFolderId !== void 0 ? state.remoteFolderId : state.base?.folderId;
        const pendingFolder = state.pending?.command.action === "save" ? state.pending.command.folderId : void 0;
        if (remoteFolder !== id3 && pendingFolder !== id3) continue;
        const local = await tx.get("things", state.id);
        if (local?.folderId === id3) {
          const moved = {
            ...local,
            folderId: destination,
            revision: local.revision + 1,
            updatedAt: new Date(Math.max(this.now(), Date.parse(local.updatedAt) + 1)).toISOString()
          };
          await tx.put("things", local.id, moved);
          await this.moveIn(tx, moved, local);
        }
        if (["conflict", "error"].includes(state.state))
          return fail12("Review the algorithm conflict before retrying this folder deletion.", "ALGORITHM_SYNC_BLOCKED");
        return false;
      }
      return true;
    }
    async exportSnapshot() {
      return this.tx("readonly", async (tx) => {
        const states = (await tx.list(collection2)).map((row) => row.value), things = [];
        for (const state of states) {
          if (state.deleted) continue;
          const row = await tx.get("things", state.id);
          if (!row || !isTransferAlgorithm(row)) return fail12("Retained algorithm content is incomplete.", "LOCAL_ALGORITHM_INCOMPLETE");
          things.push({
            id: row.id,
            thingtime: ["feed-algorithm"],
            crystal: algorithmTransferContent(row.crystal),
            ...row.folderId ? { folderId: row.folderId } : {},
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            revision: row.revision
          });
        }
        return {
          things,
          records: states.map((state) => ({
            id: state.id,
            state: state.state,
            remote: state.baseVersion !== null,
            deleted: state.deleted,
            complete: true
          }))
        };
      });
    }
    async assertExportReadable(ids) {
      return this.tx("readonly", (tx) => this.assertExportReadableIn(tx, ids));
    }
    async assertExportReadableIn(tx, ids) {
      this.lease.assertCurrent();
      for (const id3 of ids)
        if (!await this.viewIn(tx, id3)) return fail12("This algorithm is no longer available for export.", "EXPORT_ACCESS_REFUSED");
    }
    async list() {
      return this.tx("readonly", async (tx) => {
        const result = await this.algorithms.listIn(tx);
        const states = new Map((await tx.list(collection2)).map(({ id: id3, value }) => [id3, value]));
        return {
          ...result,
          algorithms: result.algorithms.map((row) => {
            const state = states.get(row.id);
            return {
              ...row,
              localOnly: false,
              localSaved: true,
              shared: state?.base?.shared ?? false,
              listed: state?.base?.listed ?? false,
              syncState: state?.state ?? "error",
              syncError: state?.error
            };
          }),
          complete: (await tx.get("settings", catalogKey2))?.complete === true
        };
      });
    }
    async status() {
      return this.tx("readonly", async (tx) => (await tx.list(collection2)).map((row) => row.value));
    }
    async beginRead() {
      return this.tx("readwrite", async (tx) => {
        const old = await tx.get("settings", catalogKey2) ?? blankCatalog2(), next = { ...old, read: old.read + 1 };
        await tx.put("settings", catalogKey2, next);
        return { read: next.read, epoch: next.epoch };
      });
    }
    async install(tx, remote, old) {
      const row = await tx.get("things", remote.id);
      if (row && (!isTransferAlgorithm(row) || !old)) return fail12("Account algorithm collides with another device Thing.");
      await tx.put("things", remote.id, {
        ...row,
        id: remote.id,
        thingtime: ["feed-algorithm"],
        crystal: { ...remote.content, parentId: remote.parentId, description: remote.description },
        folderId: remote.folderId,
        createdAt: row?.createdAt ?? remote.createdAt,
        updatedAt: new Date(Math.max(Date.parse(remote.updatedAt), row ? Date.parse(row.updatedAt) + 1 : 0)).toISOString(),
        revision: (row?.revision ?? 0) + 1
      });
      await tx.put(collection2, remote.id, {
        id: remote.id,
        revision: (old?.revision ?? 0) + 1,
        base: remote ? profileMetadata(remote) : null,
        baseVersion: remote.version,
        remoteFolderId: remote.folderId,
        state: "synced",
        deleted: false,
        retryAt: 0,
        attempts: 0
      });
    }
    async admitCatalogue(tx, remote) {
      const catalog = await tx.get("settings", catalogKey2) ?? blankCatalog2();
      for await (const { value: row } of remote.rows()) {
        const old = await tx.get(collection2, row.id);
        if (old?.deleted) continue;
        if (!old || old.state === "synced") {
          if (!old || old.baseVersion !== row.version || old.base?.version !== row.version) await this.install(tx, row, old);
        }
      }
      const choice = await tx.get("settings", key2);
      for await (const { id: id3, value: state } of scanWorkspace(tx, collection2))
        if (!await remote.has(id3) && state.state === "synced" && !state.deleted) {
          if (await remote.hasDependent(id3) || choice?.state !== "synced" && choice?.desired === id3 || choice?.pending?.command.algorithmId === id3) {
            await tx.put(collection2, id3, {
              ...state,
              state: "conflict",
              revision: state.revision + 1,
              error: "Account algorithm was removed. Review the device choice or related Things before discarding it."
            });
            continue;
          }
          await tx.delete("things", id3);
          await tx.delete(collection2, id3);
        }
      await tx.put("settings", catalogKey2, { ...catalog, complete: true, epoch: catalog.epoch + 1 });
      return true;
    }
    async remember(input, ticket, signal) {
      const remote = parseAccountAlgorithmSnapshot(input);
      return this.tx("readwrite", async (tx) => {
        const catalog = await tx.get("settings", catalogKey2) ?? blankCatalog2();
        if (catalog.read !== ticket.read || catalog.epoch !== ticket.epoch) return false;
        const present = new Set(remote.map((row) => row.id));
        const dependents = /* @__PURE__ */ new Set();
        for await (const { value } of scanWorkspace(tx, "things"))
          for (const reference of [value.folderId, value.targetId]) if (reference) dependents.add(reference);
        return this.admitCatalogue(tx, {
          async *rows() {
            for (const value of remote) yield { id: value.id, value };
          },
          has: async (id3) => present.has(id3),
          hasDependent: async (id3) => dependents.has(id3)
        });
      }, signal);
    }
    async refresh(transport2, signal = new AbortController().signal) {
      const ticket = await this.beginRead();
      if (!transport2.catalogue) return this.remember(await accountSyncDeadline((s) => transport2.snapshot(s), signal), ticket, signal);
      return stageCatalogue({
        run: this.tx.bind(this),
        domain: "algorithms",
        catalogKey: catalogKey2,
        ticket,
        id: this.uuid(),
        signal,
        now: this.now,
        parse: (id3, value) => {
          const row = parseAccountAlgorithmSnapshot([value])[0];
          if (row.id !== id3) return fail12("Invalid streamed algorithms entry.", "INVALID_ALGORITHM_SNAPSHOT", 502);
          return row;
        },
        load: (sink, requestSignal) => transport2.catalogue(sink, requestSignal),
        admit: (tx, rows) => this.admitCatalogue(tx, rows)
      });
    }
    async readRemote(id3, transport2, signal) {
      if (!transport2.catalogue) return parseAccountAlgorithmSnapshot(await accountSyncDeadline((s) => transport2.snapshot(s), signal)).find((row) => row.id === id3) ?? null;
      return findCatalogueEntry((sink, requestSignal) => transport2.catalogue(sink, requestSignal), id3, (value) => {
        const row = parseAccountAlgorithmSnapshot([value])[0];
        if (row.id !== id3) return fail12("Invalid streamed algorithms identity.");
        return row;
      }, signal);
    }
    async sync(transport2, signal = new AbortController().signal, maxWrites = 25) {
      let completed = 0;
      for (let i = 0; i < Math.min(100, Math.max(0, maxWrites)) && !signal.aborted; i++) {
        const claimed = await this.tx(
          "readwrite",
          async (tx) => {
            const states = await tx.list(collection2);
            let blockedDeletions;
            for (const { value: row } of states) {
              if (!["pending", "syncing"].includes(row.state) || row.retryAt > this.now() || row.claim && row.claim.expiresAt > this.now()) continue;
              let pending = row.pending;
              if (!pending) {
                const thing = await tx.get("things", row.id);
                if (row.deleted) {
                  if (!blockedDeletions) {
                    const unsent = new Set(states.filter(({ value }) => value.baseVersion === null && !value.deleted).map((row2) => row2.id));
                    blockedDeletions = new Set(
                      (await tx.list("things")).filter(({ value }) => unsent.has(value.id) && isTransferAlgorithm(value) && typeof value.crystal.parentId === "string").map(({ value }) => String(value.crystal.parentId))
                    );
                  }
                  if (blockedDeletions.has(row.id)) continue;
                }
                if (!row.deleted && row.placementIntent && thing?.folderId) {
                  const folder = await tx.get("thing-sync", thing.folderId);
                  if (folder && (!folder.base || folder.base.id !== thing.folderId || folder.deleted)) continue;
                }
                const parent = thing?.crystal.parentId;
                if (!row.baseVersion && parent) {
                  const state = await tx.get(collection2, String(parent));
                  if (state && !state.baseVersion && !state.deleted) continue;
                }
                try {
                  if (!row.deleted && (!thing || !isTransferAlgorithm(thing))) return fail12("Retained profile is missing.");
                  if (!row.baseVersion && parent) {
                    const state = await tx.get(collection2, String(parent));
                    if (!state?.baseVersion) return fail12("The branch source is unavailable. Keep an independent copy before synchronizing.");
                  }
                  const common = { id: row.id, writeId: this.uuid(), expectedVersion: row.baseVersion };
                  pending = {
                    revision: row.revision,
                    command: parseAlgorithmWrite(
                      row.deleted ? { ...common, action: "delete" } : {
                        ...common,
                        action: "save",
                        content: algorithmTransferContent(thing.crystal),
                        description: thing.crystal.description ?? "",
                        ...row.placementIntent ? { folderId: thing.folderId || null } : {},
                        ...row.baseVersion === null ? { parentId: parent ?? null } : {}
                      }
                    )
                  };
                } catch {
                  await tx.put(collection2, row.id, {
                    ...row,
                    state: "error",
                    error: "The saved profile or branch source needs review before synchronization."
                  });
                  await this.bump(tx);
                  continue;
                }
              }
              const next = { ...row, pending, state: "syncing", claim: { token: this.uuid(), expiresAt: this.now() + 6e4 } };
              await tx.put(collection2, row.id, next);
              return next;
            }
            return null;
          },
          signal
        );
        if (!claimed) break;
        const controller = new AbortController(), off = this.lease.onInvalidate(() => controller.abort()), abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        try {
          const command = parseAlgorithmWrite(claimed.pending.command), ack = parseAlgorithmWriteAcknowledgment(await accountSyncDeadline((s) => transport2.write(structuredClone(command), s), controller.signal));
          if (ack.id !== command.id || ack.writeId !== command.writeId || ack.action !== command.action || ack.expectedVersion !== command.expectedVersion)
            return fail12("Algorithm acknowledgment does not match the saved operation.", "INVALID_ALGORITHM_ACK", 502);
          await this.tx(
            "readwrite",
            async (tx) => {
              const row = await tx.get(collection2, claimed.id);
              if (row?.claim?.token !== claimed.claim.token) return;
              await tx.put(collection2, row.id, {
                ...row,
                baseVersion: ack.resultVersion,
                base: command.action === "delete" ? null : row.base,
                remoteFolderId: command.action === "delete" ? null : command.folderId !== void 0 ? command.folderId : row.remoteFolderId !== void 0 ? row.remoteFolderId : row.base?.folderId ?? null,
                placementIntent: row.revision === claimed.pending.revision ? void 0 : row.placementIntent,
                pending: void 0,
                claim: void 0,
                state: row.revision === claimed.pending.revision ? "synced" : "pending",
                attempts: 0,
                retryAt: 0,
                error: void 0
              });
              await this.bump(tx);
            },
            controller.signal
          );
          completed++;
        } catch (error) {
          this.lease.assertCurrent();
          await this.tx("readwrite", async (tx) => {
            const row = await tx.get(collection2, claimed.id);
            if (row?.claim?.token !== claimed.claim.token) return;
            const status = Number(error?.status), state = status === 409 && !["WORKSPACE_CHANGED", "ACCOUNT_UNCONFIRMED"].includes(error?.code) ? "conflict" : [400, 401, 403, 404, 410, 413, 422].includes(status) ? "error" : "pending";
            await tx.put(collection2, row.id, {
              ...row,
              claim: void 0,
              state,
              attempts: row.attempts + 1,
              retryAt: this.now() + Math.max(Math.min(6e4, 1e3 * 2 ** Math.min(row.attempts, 6)), Math.min(864e5, Number(error?.retryAfterMs) || 0)),
              error: state === "conflict" ? "Account algorithm changed. Review before synchronizing." : state === "error" ? "Account save was refused. Device changes are preserved." : "Saved on this device; waiting to synchronize."
            });
            await this.bump(tx);
          });
          break;
        } finally {
          off();
          signal.removeEventListener("abort", abort);
        }
      }
      return { completed };
    }
    async retry(id3) {
      return this.tx("readwrite", async (tx) => {
        const row = await tx.get(collection2, id3);
        if (!row) return;
        if (row.state === "conflict") return fail12("Review the account algorithm before retrying.");
        if (row.claim && row.claim.expiresAt > this.now()) return;
        await tx.put(collection2, id3, { ...row, state: "pending", retryAt: 0, error: void 0 });
        await this.bump(tx);
      });
    }
    async inspect(id3, transport2, signal = new AbortController().signal) {
      const remote = await this.readRemote(id3, transport2, signal);
      return this.tx(
        "readonly",
        async (tx) => {
          const state = await tx.get(collection2, id3);
          if (!state || !["conflict", "error"].includes(state.state) || state.claim) return fail12("Algorithm is not ready for conflict review.");
          return { id: id3, revision: state.revision, remote, local: await tx.get("things", id3) ?? null };
        },
        signal
      );
    }
    async resolve(review, keep, transport2, signal = new AbortController().signal) {
      if (!["local", "remote", "copy"].includes(keep)) return fail12("Choose the device profile, account profile or independent copy.");
      const stable2 = (value) => JSON.stringify(copyBoundedJson(value, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 25e4, sortKeys: true }));
      const remote = await this.readRemote(review.id, transport2, signal);
      if (stable2(remote) !== stable2(review.remote)) return fail12("Account algorithm changed again. Review it again.");
      return this.tx(
        "readwrite",
        async (tx) => {
          const state = await tx.get(collection2, review.id), local = await tx.get("things", review.id) ?? null;
          if (!state || state.revision !== review.revision || state.claim || !["conflict", "error"].includes(state.state) || stable2(local) !== stable2(review.local))
            return fail12("Device algorithm changed. Review it again.");
          let copyId;
          const independent = keep === "copy" || keep === "local" && !remote && !!local;
          if (independent) {
            if (!local || !isTransferAlgorithm(local)) return fail12("There is no device profile to copy.");
            copyId = this.uuid();
            if (await tx.get("things", copyId) || await tx.get(collection2, copyId) || await tx.get("thing-sync", copyId))
              return fail12("A new profile identity collided. Retry the copy.");
            const content = algorithmTransferContent(local.crystal), now = new Date(this.now()).toISOString();
            const copy = {
              id: copyId,
              thingtime: ["feed-algorithm"],
              crystal: {
                ...content,
                name: (content.name + " (device copy)").slice(0, 60),
                parentId: null,
                description: local.crystal.description ?? ""
              },
              ...local.folderId ? { folderId: local.folderId } : {},
              createdAt: now,
              updatedAt: now,
              revision: 1
            };
            await tx.put("things", copyId, copy);
            await this.mutated(tx, copy, null);
            if (await tx.get("settings", "active-algorithm") === review.id) {
              await tx.put("settings", "active-algorithm", copyId);
              await this.selection.setIn(tx, copyId);
            }
          }
          if (keep === "remote" || independent) {
            if (remote) await this.install(tx, remote, state);
            else {
              if ((await tx.list("things")).some(({ value }) => value.targetId === review.id || value.folderId === review.id))
                return fail12("Keep related device Things before removing this profile.");
              await tx.delete("things", review.id);
              await tx.put(collection2, review.id, {
                ...state,
                revision: state.revision + 1,
                base: null,
                baseVersion: null,
                remoteFolderId: null,
                state: "synced",
                deleted: true,
                pending: void 0,
                claim: void 0,
                retryAt: 0,
                error: void 0
              });
              if (await tx.get("settings", "active-algorithm") === review.id) {
                await tx.delete("settings", "active-algorithm");
                await this.selection.setIn(tx, null);
              }
            }
          } else if (!remote && !local) {
            await tx.put(collection2, review.id, {
              ...state,
              revision: state.revision + 1,
              base: null,
              baseVersion: null,
              remoteFolderId: null,
              placementIntent: false,
              state: "synced",
              deleted: true,
              pending: void 0,
              claim: void 0,
              retryAt: 0,
              error: void 0
            });
          } else
            await tx.put(collection2, review.id, {
              ...state,
              base: remote ? profileMetadata(remote) : null,
              baseVersion: remote.version,
              remoteFolderId: remote.folderId,
              placementIntent: !!local && (local.folderId ?? null) !== remote.folderId,
              pending: void 0,
              claim: void 0,
              revision: state.revision + 1,
              state: "pending",
              attempts: 0,
              retryAt: 0,
              error: void 0
            });
          await this.bump(tx);
          return { copyId };
        },
        signal
      );
    }
  };

  // remix/app/catalogue/catalogueStream.ts
  var CATALOGUE_CHUNK_BYTES = 24 * 1024;
  var CATALOGUE_FRAME_BYTES = 40 * 1024;
  var encoder = new TextEncoder();
  var fail13 = () => new Error("Catalogue stream is incomplete or invalid. Keep the last complete catalogue.");
  var hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  function identity4(value) {
    if (!value || !["themes", "algorithms"].includes(value.domain) || typeof value.ownerId !== "string" || !value.ownerId || value.ownerId.length > 1024 || typeof value.dataPlane !== "string" || !value.dataPlane || value.dataPlane.length > 1024 || value.storagePlane !== "home" || typeof value.origin !== "string" || new URL(value.origin).origin !== value.origin) throw fail13();
  }
  function header(value) {
    identity4(value);
    if (value.version !== 1 || typeof value.generation !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.generation)) throw fail13();
  }
  function exact2(value, keys4) {
    if (Object.keys(value).sort().join(",") !== keys4.sort().join(",")) throw fail13();
  }
  function validId3(id3) {
    return typeof id3 === "string" && id3.length > 0 && encoder.encode(id3).length <= 1024;
  }
  function add(a, b) {
    const result = a + b;
    if (!Number.isSafeInteger(result)) throw fail13();
    return result;
  }
  function guard(options) {
    const controller = new AbortController();
    const check2 = () => {
      controller.signal.throwIfAborted();
      options.signal?.throwIfAborted();
      options.check?.();
    };
    const timeout = options.stallTimeoutMs ?? 24e4;
    if (!Number.isFinite(timeout) || timeout <= 0) throw fail13();
    return { check: check2, signal: controller.signal, close: () => controller.abort(), async wait(operation) {
      check2();
      let timer;
      let abort;
      try {
        const interrupted = new Promise((_, reject) => {
          abort = () => {
            controller.abort(options.signal?.reason);
            reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          };
          options.signal?.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => {
            const error = new DOMException("Catalogue stream stalled", "TimeoutError");
            controller.abort(error);
            reject(error);
          }, timeout);
        });
        const result = await Promise.race([operation(), interrupted]);
        check2();
        return result;
      } finally {
        clearTimeout(timer);
        if (abort) options.signal?.removeEventListener("abort", abort);
      }
    } };
  }
  function base64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }
  function unbase64(value) {
    if (typeof value !== "string" || !value.length || value.length > CATALOGUE_CHUNK_BYTES / 3 * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw fail13();
    const result = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    if (base64(result) !== value) throw fail13();
    return result;
  }
  async function writeCatalogueStream(start, entries, write, options = {}) {
    header(start);
    const gate = guard(options), hash = sha256.create();
    let count = 0, bytes = 0, previous = "";
    const emit = async (value, hashed = true) => {
      const frame = encoder.encode(JSON.stringify(value) + "\n");
      if (frame.length - 1 > CATALOGUE_FRAME_BYTES) throw fail13();
      if (hashed) hash.update(frame);
      await gate.wait(() => write(frame, gate.signal));
    };
    const iterator = (typeof entries === "function" ? entries(gate.signal) : entries)[Symbol.asyncIterator]();
    let exhausted = false;
    try {
      await emit({ type: "start", ...start });
      for (; ; ) {
        const next = await gate.wait(() => iterator.next());
        if (next.done) {
          exhausted = true;
          break;
        }
        const entry = next.value;
        gate.check();
        if (!validId3(entry.id) || entry.id <= previous) throw fail13();
        const json = JSON.stringify(entry.value);
        if (json === void 0) throw fail13();
        const data = encoder.encode(json);
        let chunk = 0;
        for (let offset = 0; offset < data.length; offset += CATALOGUE_CHUNK_BYTES) {
          const part = data.subarray(offset, offset + CATALOGUE_CHUNK_BYTES);
          await emit({ type: "entry", ordinal: count, id: entry.id, chunk: chunk++, data: base64(part), final: offset + part.length === data.length });
        }
        bytes = add(bytes, data.length);
        count = add(count, 1);
        previous = entry.id;
      }
      gate.check();
      const receipt = { ...start, entries: count, bytes, digest: hex(hash.digest()) };
      await emit({ type: "end", entries: count, bytes, digest: receipt.digest }, false);
      return receipt;
    } finally {
      gate.close();
      if (!exhausted && iterator.return) void Promise.resolve().then(() => iterator.return()).catch(() => {
      });
    }
  }
  async function readCatalogueStream(body, expected, sink, options = {}) {
    identity4(expected);
    const gate = guard(options), reader = body.getReader(), hash = sha256.create();
    let start, terminal;
    let line = [], count = 0, bytes = 0, previous = "", activeId = "", chunk = 0;
    let entry = "", decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (; ; ) {
        const part = await gate.wait(() => reader.read());
        if (part.done) break;
        for (const byte of part.value) {
          if (terminal) throw fail13();
          if (byte !== 10) {
            line.push(byte);
            if (line.length > CATALOGUE_FRAME_BYTES) throw fail13();
            continue;
          }
          const raw = Uint8Array.from(line);
          line = [];
          const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
          if (!value || typeof value !== "object" || Array.isArray(value)) throw fail13();
          if (!start) {
            exact2(value, ["type", "version", "domain", "origin", "ownerId", "dataPlane", "storagePlane", "generation"]);
            header(value);
            if (value.type !== "start" || value.domain !== expected.domain || value.origin !== expected.origin || value.ownerId !== expected.ownerId || value.dataPlane !== expected.dataPlane || value.storagePlane !== expected.storagePlane) throw fail13();
            start = {
              version: 1,
              domain: value.domain,
              origin: value.origin,
              ownerId: value.ownerId,
              dataPlane: value.dataPlane,
              storagePlane: value.storagePlane,
              generation: value.generation
            };
          } else if (value.type === "entry") {
            exact2(value, ["type", "ordinal", "id", "chunk", "data", "final"]);
            if (value.ordinal !== count || value.chunk !== chunk || !validId3(value.id) || typeof value.final !== "boolean" || (activeId ? value.id !== activeId : value.id <= previous)) throw fail13();
            activeId = value.id;
            const data = unbase64(value.data);
            bytes = add(bytes, data.length);
            entry += decoder.decode(data, { stream: true });
            chunk = add(chunk, 1);
            if (value.final) {
              entry += decoder.decode();
              const parsed = JSON.parse(entry);
              const id3 = activeId;
              await gate.wait(() => sink.entry(id3, parsed, gate.signal));
              previous = activeId;
              activeId = "";
              entry = "";
              chunk = 0;
              decoder = new TextDecoder("utf-8", { fatal: true });
              count = add(count, 1);
            }
          } else if (value.type === "end") {
            exact2(value, ["type", "entries", "bytes", "digest"]);
            if (activeId || value.entries !== count || value.bytes !== bytes || value.digest !== hex(hash.digest())) throw fail13();
            terminal = { ...start, entries: count, bytes, digest: value.digest };
            continue;
          } else throw fail13();
          hash.update(raw);
          hash.update(Uint8Array.of(10));
        }
      }
      if (line.length || !terminal) throw fail13();
      await gate.wait(() => sink.complete(terminal, gate.signal));
      return terminal;
    } finally {
      gate.close();
      void reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
  }

  // tmp/continuation/catalogue-browser-entry.ts
  var check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  var scope = { kind: "account", origin: location.origin, ownerId: "synthetic-browser-owner", dataPlane: "home" };
  var lease = { assertCurrent() {
  }, onInvalidate: () => () => {
  } };
  var stamp2 = "2026-10-26T00:00:00.000Z";
  var key3 = (i) => `profile-${String(i).padStart(5, "0")}`;
  var saved = (domain, i, large = false) => {
    const common = { id: key3(i), folderId: null, createdAt: stamp2, updatedAt: stamp2 };
    return domain === "themes" ? { ...common, name: "Peach", title: null, theme: {}, visibility: "private", version: "theme-state-v1:" + "a".repeat(64) } : { ...common, version: "algorithm-state-v1:" + "a".repeat(64), content: { name: "Reading", emoji: "\u{1F9E0}", weights: { types: {}, tags: large ? Object.fromEntries(Array.from({ length: 600 }, (_, i2) => [`tag-${i2}-${"x".repeat(250)}`, 1])) : {}, authors: {} }, eventCount: 0, lastTrainedAt: null }, description: "", parentId: null, shared: false, listed: false, legacy: false };
  };
  function transport(domain, rows, afterEntry) {
    return {
      snapshot: async () => {
        throw Error("Legacy snapshot used");
      },
      write: async () => {
        throw Error("Unexpected account write");
      },
      catalogue: async (sink, signal) => {
        const identity5 = { domain, origin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane, storagePlane: "home" };
        const pipe = new TransformStream(), writer = pipe.writable.getWriter();
        const produced = writeCatalogueStream({ ...identity5, version: 1, generation: crypto.randomUUID() }, (async function* () {
          for (const row of rows) yield { id: row.id, value: row };
        })(), (bytes) => writer.write(bytes), { signal }).then(() => writer.close()).catch((error) => writer.abort(error).catch(() => {
        }));
        try {
          return await readCatalogueStream(pipe.readable, identity5, { entry: async (id3, value, current) => {
            await sink.entry(id3, value, current);
            await afterEntry?.(id3);
          }, complete: (receipt, current) => sink.complete(receipt, current) }, { signal });
        } finally {
          await produced;
        }
      }
    };
  }
  async function summaries(db) {
    return db.transaction(scope, "readonly", lease, async (tx) => {
      const rows = [];
      let after;
      for (; ; ) {
        const page = await tx.scan("things", { after });
        if (!page.length) break;
        for (const row of page) rows.push({ id: row.id, name: row.value.crystal.name });
        after = page.at(-1).id;
      }
      const stages = await tx.scan("catalogue-staging");
      return { rows, stages, usage: await tx.usage() };
    });
  }
  async function stageCount(name) {
    const db = await new Promise((resolve, reject) => {
      const q = indexedDB.open(name);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        let count = 0;
        const tx = db.transaction("records"), q = tx.objectStore("records").openKeyCursor();
        q.onerror = () => reject(q.error);
        q.onsuccess = () => {
          const c = q.result;
          if (!c) return;
          const collection3 = String(c.key[1]);
          if (collection3 === "catalogue-staging" || collection3.startsWith("catalogue-stage-") || collection3.startsWith("catalogue-references-")) count++;
          c.continue();
        };
        tx.oncomplete = () => resolve(count);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  window.catalogueAcceptance = {
    async run(domain) {
      const name = `catalogue-browser-${domain}`, db = new WorkspaceDatabase(indexedDB, name), sync = domain === "themes" ? new AccountThemeSync(db, scope, lease) : new AccountAlgorithmSync(db, scope, lease);
      const rows = Array.from({ length: domain === "themes" ? 145 : 60 }, (_, i) => saved(domain, i, domain === "algorithms"));
      const bytes = new TextEncoder().encode(JSON.stringify(rows)).byteLength;
      if (domain === "algorithms") check(bytes > 8 * 1024 * 1024, "Fixture must exceed legacy 8MiB response bound");
      const store = IDBObjectStore.prototype.getAll, index = IDBIndex.prototype.getAll;
      IDBObjectStore.prototype.getAll = IDBIndex.prototype.getAll = () => {
        throw Error("getAll forbidden during admission");
      };
      try {
        check(await sync.refresh(transport(domain, rows)) === true, "Admission failed");
      } finally {
        IDBObjectStore.prototype.getAll = store;
        IDBIndex.prototype.getAll = index;
      }
      check((await summaries(db)).rows.length === rows.length, "Missing admitted rows");
      if (sync instanceof AccountThemeSync) await sync.save({ id: key3(0), name: "Pending device edit", theme: {} });
      else await sync.algorithms.update({ id: key3(0), name: "Pending device edit" });
      check(await sync.refresh(transport(domain, rows)) === true, "Pending refresh failed");
      const before = await summaries(db);
      check(before.rows.find((row) => row.id === key3(0))?.name === "Pending device edit", "Pending edit overwritten");
      const aborted = new AbortController();
      let cancelled = false;
      try {
        await sync.refresh(transport(domain, [saved(domain, 200), saved(domain, 201)], () => aborted.abort(new DOMException("Synthetic cancellation", "AbortError"))), aborted.signal);
      } catch {
        cancelled = true;
      }
      check(cancelled, "Cancellation was ignored");
      check(JSON.stringify((await summaries(db)).rows) === JSON.stringify(before.rows), "Cancelled stream changed content");
      check(await stageCount(name) === 0, "Cancelled staging leaked");
      const put = IDBObjectStore.prototype.put;
      let quota = false;
      IDBObjectStore.prototype.put = function(value, ...rest) {
        if (this.name === "records" && value.collection === "things" && value.id === key3(203)) throw new DOMException("Synthetic platform quota", "QuotaExceededError");
        return put.call(this, value, ...rest);
      };
      try {
        await sync.refresh(transport(domain, [saved(domain, 202), saved(domain, 203)]));
      } catch (error) {
        quota = error.code === "LOCAL_QUOTA";
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      check(quota, "Quota-style failure not normalized");
      const after = await summaries(db);
      check(JSON.stringify(after.rows) === JSON.stringify(before.rows), "Quota-style failure changed content");
      check(JSON.stringify(after.usage) === JSON.stringify(before.usage), "Quota-style failure changed accounting");
      check(await stageCount(name) === 0, "Failed admission leaked staging");
      const admissionAbort = new AbortController();
      let admissionCancelled = false;
      IDBObjectStore.prototype.put = function(value, ...rest) {
        const result = put.call(this, value, ...rest);
        if (this.name === "records" && value.collection === "things" && value.id === key3(205)) admissionAbort.abort(new DOMException("Cancelled native admission", "AbortError"));
        return result;
      };
      try {
        await sync.refresh(transport(domain, [saved(domain, 204), saved(domain, 205)]), admissionAbort.signal);
      } catch {
        admissionCancelled = true;
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      check(admissionCancelled, "Native admission cancellation ignored");
      const rolledBack = await summaries(db);
      check(JSON.stringify(rolledBack.rows) === JSON.stringify(before.rows), "Native cancelled admission committed rows");
      check(JSON.stringify(rolledBack.usage) === JSON.stringify(before.usage), "Native cancelled admission changed accounting");
      check(await stageCount(name) === 0, "Native cancelled admission leaked stages");
      await db.close();
      return { domain, count: rows.length, serializedBytes: bytes, pendingPreserved: true, cancelled, admissionCancelled, quotaStyleRollback: quota, stagingRows: 0, nativeIndexedDB: true };
    },
    async reload(domain) {
      const db = new WorkspaceDatabase(indexedDB, `catalogue-browser-${domain}`);
      try {
        const result = await summaries(db);
        check(result.rows.length === (domain === "themes" ? 145 : 60), "Reload lost rows");
        check(result.rows[0].name === "Pending device edit", "Reload lost pending edit");
        check(await stageCount(`catalogue-browser-${domain}`) === 0, "Reload leaked stages");
        return { domain, count: result.rows.length, pendingName: result.rows[0].name, stagingRows: 0 };
      } finally {
        await db.close();
      }
    }
  };
})();
