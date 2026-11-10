var MailScopeFixture = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key2 of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key2) && key2 !== except)
          __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // tmp/continuation/mail-scope/fixture.ts
  var fixture_exports = {};
  __export(fixture_exports, {
    proof: () => proof,
    seed: () => seed
  });

  // remix/app/utils/rootIdentity.ts
  var createRootIdentityState = () => {
    let state = { generation: 0, pending: false };
    const listeners = /* @__PURE__ */ new Set();
    const publish = (next) => {
      state = next;
      listeners.forEach((listener) => listener());
    };
    return {
      read: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      changed: () => publish({ generation: state.generation + 1, pending: true }),
      confirm: (generation) => {
        if (state.pending && state.generation === generation) publish({ ...state, pending: false });
      }
    };
  };
  var rootIdentity = createRootIdentityState();

  // remix/app/mail/model.ts
  var emptyMailState = () => ({ accounts: [], folders: [], messages: [], inboxes: [] });

  // remix/app/mail/localStore.ts
  var emptyLocalMail = () => ({
    version: 1,
    storageRevision: 0,
    state: emptyMailState(),
    credentials: {},
    localAccountIds: [],
    localInboxIds: [],
    connectorToken: "",
    composeDrafts: [],
    cursors: {},
    settingsWrites: {},
    settingsRemoteRevisions: {}
  });
  var database = () => new Promise((resolve, reject) => {
    const request = indexedDB.open("thingtime-mail-v1", 3);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Reload older Thingtime tabs to finish upgrading device mail. Your saved mail is kept."));
    };
    request.onupgradeneeded = () => {
      for (const name of ["keys", "mail", "heads"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      if (!request.result.objectStoreNames.contains("records"))
        request.result.createObjectStore("records", { keyPath: ["scope", "key"] }).createIndex("scope", "scope");
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
  var result = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  var mailStorageKey = (scope) => {
    if (scope.kind === "anonymous") return JSON.stringify(["mail", "anonymous", 1]);
    if (!scope.ownerId || new URL(scope.origin).origin !== scope.origin) throw new Error("Invalid mail workspace.");
    return `${scope.origin}:${scope.ownerId}`;
  };
  var done = (transaction, lease2) => {
    let unsubscribe = () => {
    };
    const complete = new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        try {
          lease2.assertCurrent();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Mail changed in another tab or closed. Reopen it before saving."));
      const abort = () => {
        try {
          transaction.abort();
        } catch {
        }
      };
      unsubscribe = lease2.onInvalidate(abort);
      try {
        lease2.assertCurrent();
      } catch {
        abort();
      }
    });
    const settled = complete.finally(() => unsubscribe());
    void settled.catch(() => {
    });
    return settled;
  };
  async function mapRows(rows, lease2, work) {
    const results = [];
    for (let index = 0; index < rows.length; index += 16) {
      lease2.assertCurrent();
      results.push(...await Promise.all(rows.slice(index, index + 16).map(work)));
    }
    lease2.assertCurrent();
    return results;
  }
  var memo = /* @__PURE__ */ new Map();
  rootIdentity.subscribe(() => memo.clear());
  if (typeof window !== "undefined") window.addEventListener("thingtime:root-data-refresh", () => memo.clear());
  function remember(owner, rows) {
    memo.clear();
    memo.set(owner, rows);
  }
  async function key(db, owner, lease2) {
    const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    lease2.assertCurrent();
    const tx = db.transaction("keys", "readwrite"), complete = done(tx, lease2), store = tx.objectStore("keys");
    const existing = await result(store.get(owner));
    if (!existing) store.put(candidate, owner);
    await complete;
    return existing || candidate;
  }
  var aad = (owner, row) => new TextEncoder().encode(JSON.stringify([owner, row]));
  function rowsFor(value) {
    const rows = /* @__PURE__ */ new Map();
    rows.set("settings", JSON.stringify({ connectorToken: value.connectorToken }));
    for (const account of value.state.accounts)
      rows.set(
        `account:${account.id}`,
        JSON.stringify({ account, credentials: value.credentials[account.id], local: value.localAccountIds.includes(account.id) })
      );
    for (const inbox of value.state.inboxes) rows.set(`inbox:${inbox.id}`, JSON.stringify({ inbox, local: value.localInboxIds.includes(inbox.id) }));
    for (const folder of value.state.folders)
      rows.set(
        `folder:${folder.id}`,
        JSON.stringify({ folder, cloudCursor: value.cursors[`${folder.id}:cloud`], localCursor: value.cursors[`${folder.id}:local`] })
      );
    for (const message of value.state.messages) rows.set(`message:${message.id}`, JSON.stringify(message));
    for (const draft of value.composeDrafts || []) rows.set(`compose:${draft.id}`, JSON.stringify(draft));
    for (const [id, pending] of Object.entries(value.settingsWrites || {})) rows.set(`settings-write:${id}`, JSON.stringify(pending));
    for (const [id, revision] of Object.entries(value.settingsRemoteRevisions || {})) rows.set(`settings-revision:${id}`, JSON.stringify(revision));
    return rows;
  }
  async function readMailLocal(scope, lease2) {
    lease2.assertCurrent();
    const db = await database(), owner = mailStorageKey(scope);
    try {
      lease2.assertCurrent();
      const tx = db.transaction(["heads", "records", "mail"]), complete = done(tx, lease2);
      const [head, records, legacy] = await Promise.all([
        result(tx.objectStore("heads").get(owner)),
        result(tx.objectStore("records").index("scope").getAll(owner)),
        result(tx.objectStore("mail").get(owner))
      ]);
      await complete;
      if (!head && legacy) {
        const bytes = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: legacy.iv, additionalData: new TextEncoder().encode(owner) },
          await key(db, owner, lease2),
          legacy.bytes
        );
        lease2.assertCurrent();
        return { ...emptyLocalMail(), ...JSON.parse(new TextDecoder().decode(bytes)), storageRevision: 0 };
      }
      const value = emptyLocalMail();
      value.storageRevision = head?.revision || 0;
      const dataKey = await key(db, owner, lease2), plain = /* @__PURE__ */ new Map();
      await mapRows(records, lease2, async (record) => {
        const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: aad(owner, record.key) }, dataKey, record.bytes);
        const text = new TextDecoder().decode(bytes), row = JSON.parse(text);
        plain.set(record.key, text);
        if (record.key.startsWith("settings-write:")) value.settingsWrites[record.key.slice("settings-write:".length)] = row;
        else if (record.key.startsWith("settings-revision:")) value.settingsRemoteRevisions[record.key.slice("settings-revision:".length)] = row;
        else if (record.key === "settings") value.connectorToken = row.connectorToken;
        else if (record.key.startsWith("account:")) {
          value.state.accounts.push(row.account);
          if (row.credentials) value.credentials[row.account.id] = row.credentials;
          if (row.local) value.localAccountIds.push(row.account.id);
        } else if (record.key.startsWith("inbox:")) {
          value.state.inboxes.push(row.inbox);
          if (row.local) value.localInboxIds.push(row.inbox.id);
        } else if (record.key.startsWith("folder:")) {
          value.state.folders.push(row.folder);
          if (row.cloudCursor !== void 0) value.cursors[`${row.folder.id}:cloud`] = row.cloudCursor;
          if (row.localCursor !== void 0) value.cursors[`${row.folder.id}:local`] = row.localCursor;
        } else if (record.key.startsWith("message:")) value.state.messages.push(row);
        else if (record.key.startsWith("compose:")) value.composeDrafts.push(row);
      });
      remember(owner, plain);
      return value;
    } finally {
      db.close();
    }
  }
  async function writeMailLocal(scope, value, lease2) {
    lease2.assertCurrent();
    const db = await database(), owner = mailStorageKey(scope), rows = rowsFor(value);
    try {
      const dataKey = await key(db, owner, lease2), previous = memo.get(owner);
      const changed = await mapRows(
        [...rows].filter(([id, text]) => previous?.get(id) !== text),
        lease2,
        async ([id, text]) => {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(owner, id) }, dataKey, new TextEncoder().encode(text));
          return { scope: owner, key: id, iv, bytes };
        }
      );
      const tx = db.transaction(["records", "heads", "mail"], "readwrite"), complete = done(tx, lease2), store = tx.objectStore("records");
      const [head, existing] = await Promise.all([result(tx.objectStore("heads").get(owner)), result(store.index("scope").getAllKeys(owner))]);
      if ((head?.revision || 0) !== value.storageRevision) {
        tx.abort();
        await complete;
        throw new Error("Mail changed in another tab. Reload before saving.");
      }
      for (const id of existing) if (!rows.has(String(id[1]))) store.delete(id);
      changed.forEach((row) => store.put(row));
      tx.objectStore("heads").put({ revision: value.storageRevision + 1 }, owner);
      tx.objectStore("mail").delete(owner);
      await complete;
      remember(owner, rows);
      return { ...value, storageRevision: value.storageRevision + 1 };
    } finally {
      db.close();
    }
  }

  // tmp/continuation/mail-scope/fixture.ts
  var lease = { assertCurrent() {
  }, onInvalidate: () => () => {
  } };
  async function seed(ownerId, marker) {
    const scope = { kind: "account", origin: location.origin, ownerId };
    const local = emptyLocalMail();
    local.state.accounts = [{
      id: "scope_mailbox",
      name: "Saved scope mailbox",
      address: "fixture@example.test",
      revision: 0,
      servers: { imap: { host: "imap.example.test", port: 993, security: "tls", username: "fixture@example.test" } },
      sync: { local: false, cloud: false, transport: "native" }
    }];
    local.localAccountIds = ["scope_mailbox"];
    local.state.folders = [{ id: "scope_folder", accountId: "scope_mailbox", protocol: "imap", path: "INBOX", name: "Scope inbox", inbox: true }];
    local.state.messages = [{ id: "scope_message", accountId: "scope_mailbox", folderId: "scope_folder", remoteId: "1", subject: marker + " subject", text: marker + " private body", from: "fixture@example.test", to: "fixture@example.test", date: null, unread: true, attachmentCount: 0, truncated: false }];
    await writeMailLocal(scope, local, lease);
    return { subject: local.state.messages[0].subject, body: local.state.messages[0].text };
  }
  async function proof(ownerId) {
    const local = await readMailLocal({ kind: "account", origin: location.origin, ownerId }, lease);
    return local.state.messages.map((row) => ({ subject: row.subject, text: row.text }));
  }
  return __toCommonJS(fixture_exports);
})();
