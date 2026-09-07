import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sealArchive, snapshotDigest, validateSnapshot } from "./backup-archive.mjs";
import {
  SOURCE_PROJECT, RESTORE_PROJECT, PartialRestoreError,
  assertBackupEmulatorEnvironment, assertEmptyEmulatorProject,
  readSnapshot, restoreSnapshot, restoreArchive, verifyRestoredSnapshot,
} from "./backup-emulator.mjs";

const local = {
  GCLOUD_PROJECT: SOURCE_PROJECT, GOOGLE_CLOUD_PROJECT: SOURCE_PROJECT,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
};
const stamp = "2026-09-07T00:00:00.000Z";
const string = value => ({ stringValue: value });
const bool = value => ({ booleanValue: value });
const fields = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
  typeof value === "boolean" ? bool(value) : typeof value === "number" ? { integerValue: String(value) } : string(value),
]));

function fixture({ accounts = 1, histories = 1, catalogues = 1 } = {}) {
  const documents = [{ path: "sparkUnits/unit-a", fields: fields({ name: "Unit sintetis" }) }];
  const authUsers = [];
  for (let i = 0; i < accounts; i++) {
    const uid = `user-${String(i).padStart(3, "0")}`, email = `${uid}@example.test`;
    authUsers.push({ uid, email, emailVerified: true, disabled: false, displayName: `Synthetic ${i}`,
      providerData: [{ providerId: "password", uid: email, email }],
      ...(i ? {} : { customClaims: { pilot: true } }),
    });
    documents.push({ path: `sparkUsers/${uid}`, fields: fields({ displayName: `Synthetic ${i}`, unitId: "unit-a", role: "operator", active: true }) });
  }
  authUsers[0].providerData.push({ providerId: "google.com", uid: "synthetic-google-1", email: authUsers[0].email, displayName: "Google Synthetic", photoURL: "https://example.test/avatar" });
  for (let i = 0; i < catalogues; i++) documents.push({ path: `sparkUnits/unit-a/classifications/c${i}`, fields: fields({ code: `C${i}`, name: `Klasifikasi ${i}`, active: true }) });
  documents.push({ path: "sparkUnits/unit-a/locations/rak-a", fields: fields({ name: "Rak A", description: "Sintetis", active: true }) });
  let latest;
  for (let v = 1; v <= histories; v++) {
    latest = { ...fields({ title: "Arsip sintetis", referenceNumber: "DEMO-1", recordDate: "2026-09-07", classificationId: "c0", locationId: "rak-a", description: `Versi ${v}`, status: "active", archiveReason: "", unitId: "unit-a", createdBy: "user-000", updatedBy: "user-000", version: v }), createdAt: { timestampValue: stamp }, updatedAt: { timestampValue: stamp } };
    documents.push({ path: `sparkUnits/unit-a/records/record-a/history/v${v}`, fields: { snapshot: { mapValue: { fields: latest } }, actorUid: string("user-000"), at: { timestampValue: stamp } } });
  }
  documents.push({ path: "sparkUnits/unit-a/records/record-a", fields: latest });
  return { version: 1, sourceProject: SOURCE_PROJECT, database: "(default)", capturedAt: stamp, documents, authUsers };
}

function rawAccount(user) {
  return {
    localId: user.uid, email: user.email, emailVerified: user.emailVerified,
    disabled: user.disabled, displayName: user.displayName,
    providerUserInfo: user.providerData.map(provider => ({ providerId: provider.providerId, rawId: provider.uid,
      ...(provider.email === undefined ? {} : { email: provider.email }),
      ...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
      ...(provider.photoURL === undefined ? {} : { photoUrl: provider.photoURL }),
    })),
    ...(user.customClaims === undefined ? {} : { customAttributes: JSON.stringify(user.customClaims) }),
    passwordHash: "NEVER-COPY-SYNTHETIC-HASH", salt: "NEVER-COPY-SYNTHETIC-SALT",
    refreshToken: "NEVER-COPY-SYNTHETIC-TOKEN", createdAt: "1", lastLoginAt: "2",
  };
}

// Controlled in-memory protocol double. It never invokes fetch or any network.
function emulator(snapshot = fixture()) {
  const source = { docs: new Map(snapshot.documents.map(doc => [doc.path, structuredClone(doc.fields)])), users: snapshot.authUsers.map(rawAccount), tenants: [] };
  const target = { docs: new Map(), users: [], tenants: [] };
  const calls = [], writes = [];
  const state = { source, target, calls, writes, hook: null };
  const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const page = (items, token, key) => {
    const offset = Number(token || 0), selected = items.slice(offset, offset + 50);
    return { [key]: selected, ...(offset + 50 < items.length ? { nextPageToken: String(offset + 50) } : {}) };
  };
  state.request = async (url, options) => {
    const parsed = new URL(url), body = options.body === undefined ? undefined : JSON.parse(options.body);
    const call = { url, options, body, parsed };
    calls.push(call);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    if (state.hook) {
      const intercepted = await state.hook(call, reply);
      if (intercepted !== undefined) return intercepted;
    }
    if (parsed.port === "4408") return reply({ firestore: { host: "127.0.0.1", port: 8088 }, auth: { host: "127.0.0.1", port: 9098 } });
    assert.equal(options.headers.Authorization, "Bearer owner");
    const id = parsed.pathname.match(/\/projects\/([^/]+)/)?.[1];
    assert.ok([SOURCE_PROJECT, RESTORE_PROJECT].includes(id));
    const store = id === SOURCE_PROJECT ? source : target;
    if (parsed.port === "9098") {
      if (parsed.pathname.endsWith("/tenants")) return reply(page(store.tenants, parsed.searchParams.get("pageToken"), "tenants"));
      if (parsed.pathname.endsWith("/accounts:batchGet")) return reply(page(store.users, parsed.searchParams.get("nextPageToken"), "users"));
      assert.ok(parsed.pathname.endsWith("/accounts:batchCreate"));
      assert.equal(id, RESTORE_PROJECT);
      assert.equal(body.allowOverwrite, false);
      assert.equal(body.sanityCheck, true);
      assert.equal(body.users.length, 1);
      const user = body.users[0];
      assert.equal(user.disabled, true);
      assert.equal(user.password, undefined);
      assert.equal(user.passwordHash, undefined);
      assert.ok(user.providerUserInfo.every(provider => provider.providerId === "google.com"));
      if (store.users.some(existing => existing.localId === user.localId || existing.email === user.email)) return reply({ error: [{ index: 0, message: "already exists" }] });
      writes.push(call);
      store.users.push(structuredClone(user));
      return reply({ error: [] });
    }
    const relative = parsed.pathname.split("/documents")[1] ?? "";
    if (relative.endsWith(":listCollectionIds")) {
      const parent = relative.slice(0, -":listCollectionIds".length).replace(/^\//, "");
      const prefix = parent ? `${parent}/` : "";
      const ids = [...new Set([...store.docs.keys()].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length).split("/")[0]))].sort();
      return reply(page(ids, body.pageToken, "collectionIds"));
    }
    const collection = relative.replace(/^\//, "");
    const name = path => `projects/${id}/databases/(default)/documents/${path}`;
    if (options.method === "GET") {
      assert.equal(parsed.searchParams.get("showMissing"), "true");
      assert.equal(parsed.searchParams.has("orderBy"), false);
      const ids = [...new Set([...store.docs.keys()].filter(path => path.startsWith(`${collection}/`)).map(path => path.slice(collection.length + 1).split("/")[0]))].sort();
      return reply(page(ids.map(id => {
        const path = `${collection}/${id}`;
        return store.docs.has(path) ? { name: name(path), fields: store.docs.get(path), createTime: stamp, updateTime: stamp } : { name: name(path) };
      }), parsed.searchParams.get("pageToken"), "documents"));
    }
    assert.equal(id, RESTORE_PROJECT);
    assert.equal(options.method, "POST");
    const path = `${collection}/${parsed.searchParams.get("documentId")}`;
    if (store.docs.has(path)) return reply({ error: { status: "ALREADY_EXISTS" } }, 409);
    writes.push(call);
    store.docs.set(path, structuredClone(body.fields));
    return reply({ name: name(path), fields: body.fields, createTime: stamp, updateTime: stamp });
  };
  state.options = { env: local, request: state.request };
  return state;
}

test("fixed environment rejects live, alternate hosts, credentials, proxies and runtime injection", () => {
  assert.doesNotThrow(() => assertBackupEmulatorEnvironment(local));
  for (const patch of [
    { GCLOUD_PROJECT: "arsip-d16d3" }, { GCLOUD_PROJECT: RESTORE_PROJECT }, { GOOGLE_CLOUD_PROJECT: "demo-simsa-spark" },
    { FIRESTORE_EMULATOR_HOST: "localhost:8088" }, { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    { FIREBASE_AUTH_EMULATOR_HOST: "https://127.0.0.1:9098" },
    { GOOGLE_APPLICATION_CREDENTIALS: "do-not-read.json" }, { FIREBASE_TOKEN: "not-a-real-token" },
    { GCLOUD_ACCESS_TOKEN: "not-a-real-token" }, { VITE_API_URL: "http://example.test" },
    { NODE_OPTIONS: "--import injected" }, { NODE_USE_ENV_PROXY: "1" }, { HTTPS_PROXY: "http://example.test" },
  ]) assert.throws(() => assertBackupEmulatorEnvironment({ ...local, ...patch }), { code: "ENVIRONMENT" });
  assert.throws(() => assertBackupEmulatorEnvironment({}), { code: "ENVIRONMENT" });
});

test("only the exact three-field synthetic Firebase CLI config and fixed alias/hub are accepted", async () => {
  const config = { projectId: SOURCE_PROJECT, storageBucket: `${SOURCE_PROJECT}.appspot.com`, databaseURL: `https://${SOURCE_PROJECT}.firebaseio.com` };
  const cliEnv = { ...local, FIREBASE_EMULATOR_HUB: "127.0.0.1:4408", FIREBASE_FIRESTORE_EMULATOR_ADDRESS: "127.0.0.1:8088", FIREBASE_CONFIG: JSON.stringify(config) };
  assert.doesNotThrow(() => assertBackupEmulatorEnvironment(cliEnv));
  for (const patch of [
    { FIREBASE_EMULATOR_HUB: "localhost:4408" }, { FIREBASE_EMULATOR_HUB: "127.0.0.1:4400" },
    { FIREBASE_FIRESTORE_EMULATOR_ADDRESS: "127.0.0.1:8080" },
    { FIREBASE_CONFIG: "/do/not/open.json" }, { FIREBASE_CONFIG: "null" },
    { FIREBASE_CONFIG: JSON.stringify({ ...config, projectId: "arsip-d16d3" }) },
    { FIREBASE_CONFIG: JSON.stringify({ ...config, storageBucket: "real-bucket.appspot.com" }) },
    { FIREBASE_CONFIG: JSON.stringify({ ...config, databaseURL: "https://example.test" }) },
    { FIREBASE_CONFIG: JSON.stringify({ ...config, credential: "never-allowed" }) },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: SOURCE_PROJECT }) },
  ]) assert.throws(() => assertBackupEmulatorEnvironment({ ...cliEnv, ...patch }), { code: "ENVIRONMENT" });
  const state = emulator();
  await readSnapshot({ ...state.options, env: cliEnv });
  assert.ok(state.calls.every(call => call.parsed.hostname === "127.0.0.1"));
});

test("unknown options and roles fail before any request", async () => {
  const state = emulator();
  for (const key of ["projectId", "sourceProject", "targetProject", "url", "host", "port", "credentials", "token"]) {
    await assert.rejects(readSnapshot({ ...state.options, [key]: "forbidden" }), { code: "OPTIONS" });
  }
  await assert.rejects(assertEmptyEmulatorProject("live", state.options), { code: "ROLE" });
  assert.equal(state.calls.length, 0);
});

test("test options cannot hide an inherited credential or project override", async () => {
  const state = emulator();
  for (const [key, value] of [["GOOGLE_APPLICATION_CREDENTIALS", "must-not-open.json"], ["GCLOUD_PROJECT", "arsip-d16d3"]]) {
    const previous = process.env[key];
    try {
      process.env[key] = value;
      await assert.rejects(readSnapshot({ ...state.options, env: { ...local, ...(key === "GOOGLE_APPLICATION_CREDENTIALS" ? { [key]: undefined } : {}) } }), { code: "ENVIRONMENT" });
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
  assert.equal(state.calls.length, 0);
});

test("full recursive export follows every catalogue/Auth/history page and strips credential material", async () => {
  const expected = fixture({ accounts: 55, catalogues: 55, histories: 55 });
  const state = emulator(expected);
  const snapshot = await readSnapshot(state.options);
  assert.equal(snapshot.documents.length, expected.documents.length);
  assert.equal(snapshot.authUsers.length, 55);
  assert.equal(snapshot.documents.filter(doc => doc.path.includes("/history/")).length, 55);
  assert.equal(snapshotDigest({ ...snapshot, capturedAt: stamp }), snapshotDigest(expected));
  assert.ok(state.calls.some(call => call.url.includes("classifications?") && call.url.includes("pageToken=50")));
  assert.ok(state.calls.some(call => call.url.includes("history?") && call.url.includes("pageToken=50")));
  assert.ok(state.calls.some(call => call.url.includes("nextPageToken=50")));
  assert.equal(JSON.stringify(snapshot).includes("NEVER-COPY"), false);
  assert.equal(state.writes.length, 0);
});

test("empty/short pages with next token are continued, but repeated tokens fail", async () => {
  const state = emulator();
  state.hook = (call, reply) => {
    if (!call.url.includes("/accounts:batchGet")) return;
    if (!call.parsed.searchParams.has("nextPageToken")) return reply({ users: [], nextPageToken: "continue" });
    return reply({ users: state.source.users });
  };
  assert.equal((await readSnapshot(state.options)).authUsers.length, 1);
  state.hook = (call, reply) => call.url.includes("/accounts:batchGet") ? reply({ users: [], nextPageToken: "again" }) : undefined;
  await assert.rejects(readSnapshot(state.options), { code: "PAGINATION" });
});

test("malformed pages and HTTP200 error payloads are not interpreted as an empty source", async () => {
  for (const payload of [{ users: {} }, { users: Array.from({ length: 51 }, () => ({})) }, { error: { message: "not metadata" } }, { users: [], nextPageToken: null }]) {
    const state = emulator();
    state.hook = (call, reply) => call.url.includes("/accounts:batchGet") ? reply(payload) : undefined;
    await assert.rejects(readSnapshot(state.options));
    assert.equal(state.writes.length, 0);
  }
});

test("unexpected collections, missing parents and wrong-project document responses fail closed", async () => {
  const unexpected = emulator();
  unexpected.source.docs.set("legacySecrets/item", fields({ name: "Not Spark" }));
  await assert.rejects(readSnapshot(unexpected.options), { code: "COLLECTION" });
  const missing = emulator();
  missing.source.docs.delete("sparkUnits/unit-a/records/record-a");
  await assert.rejects(readSnapshot(missing.options), { code: "MISSING_PARENT" });
  const wrong = emulator();
  wrong.hook = (call, reply) => call.url.includes("/sparkUsers?") ? reply({ documents: [{ name: "projects/arsip-d16d3/databases/(default)/documents/sparkUsers/user-000", createTime: stamp, updateTime: stamp }] }) : undefined;
  await assert.rejects(readSnapshot(wrong.options), { code: "DOCUMENT_PATH" });
  assert.equal(unexpected.writes.length + missing.writes.length + wrong.writes.length, 0);
});

test("two complete source reads reject detected concurrent changes", async () => {
  const state = emulator();
  let scans = 0;
  state.hook = call => {
    if (call.url.endsWith("/documents:listCollectionIds")) {
      scans++;
      if (scans === 2) state.source.docs.get("sparkUnits/unit-a").name = string("Changed between reads");
    }
  };
  await assert.rejects(readSnapshot(state.options), { code: "CONCURRENT_WRITE" });
  assert.equal(state.writes.length, 0);
});

test("hub mismatch, tenant identities and unsupported Auth features abort export", async () => {
  const hub = emulator();
  hub.hook = (call, reply) => call.parsed.port === "4408" ? reply({ firestore: { host: "localhost", port: 8088 }, auth: { host: "127.0.0.1", port: 9098 } }) : undefined;
  await assert.rejects(readSnapshot(hub.options), { code: "EMULATOR_IDENTITY" });
  const tenant = emulator();
  tenant.source.tenants.push({ name: "tenant-hidden" });
  await assert.rejects(readSnapshot(tenant.options), { code: "AUTH_UNSUPPORTED" });
  for (const patch of [{ phoneNumber: "+12025550123" }, { mfaInfo: [{}] }, { passkeyInfo: [{}] }, { photoUrl: "https://example.test/photo" }]) {
    const state = emulator();
    Object.assign(state.source.users[0], patch);
    await assert.rejects(readSnapshot(state.options), { code: "AUTH_UNSUPPORTED" });
  }
});

test("empty checks cover Auth, Firestore and hidden tenant state without writes", async () => {
  const state = emulator();
  assert.deepEqual(await assertEmptyEmulatorProject("restore", state.options), { project: RESTORE_PROJECT, empty: true });
  await assert.rejects(assertEmptyEmulatorProject("source", state.options), { code: "TARGET_NOT_EMPTY" });
  state.target.users.push(rawAccount(fixture().authUsers[0]));
  await assert.rejects(restoreSnapshot(fixture(), state.options), { code: "TARGET_NOT_EMPTY" });
  state.target.users.length = 0;
  state.target.docs.set("unknown/item", {});
  await assert.rejects(restoreSnapshot(fixture(), state.options), { code: "TARGET_NOT_EMPTY" });
  assert.equal(state.writes.length, 0);
});

test("invalid snapshot and unauthenticated archive cause zero emulator requests", async () => {
  const state = emulator(), snapshot = fixture(), key = randomBytes(32);
  const malformed = structuredClone(snapshot);
  malformed.documents[0].fields.extra = string("forbidden");
  await assert.rejects(restoreSnapshot(malformed, state.options));
  const archive = sealArchive(snapshot, key);
  archive[archive.length - 1] ^= 1;
  await assert.rejects(restoreArchive(archive, key, state.options));
  assert.equal(state.calls.length, 0);
});

test("create-only restore preserves all docs, Google bindings and claims, disables all accounts and verifies", async () => {
  const snapshot = fixture({ accounts: 3, histories: 31 }), state = emulator(snapshot);
  const report = await restoreSnapshot(snapshot, state.options);
  assert.equal(report.status, "verified");
  assert.equal(report.createdDocuments, snapshot.documents.length);
  assert.equal(report.createdAccounts, 3);
  assert.equal(report.expectedDigest, report.actualDigest);
  assert.equal(report.limitations.passwordProviderBindingsOmitted, 3);
  assert.ok(state.target.users.every(user => user.disabled === true));
  assert.equal(state.target.users[0].providerUserInfo[0].providerId, "google.com");
  assert.deepEqual(JSON.parse(state.target.users[0].customAttributes), { pilot: true });
  assert.ok(state.writes.every(call => !/update|delete|:commit|:batchWrite/.test(call.url)));
  assert.ok(state.writes.every(call => call.url.includes(RESTORE_PROJECT)));
  assert.equal((await verifyRestoredSnapshot(snapshot, state.options)).actualDigest, report.actualDigest);
  const previousWrites = state.writes.length;
  await assert.rejects(restoreSnapshot(snapshot, state.options), { code: "TARGET_NOT_EMPTY" });
  assert.equal(state.writes.length, previousWrites);
});

test("HTTP200 Auth per-item errors and unknown write outcomes never report success or clean up", async () => {
  for (const failure of ["error", "errors", "network"]) {
    const state = emulator();
    state.hook = (call, reply) => {
      if (!call.url.includes("accounts:batchCreate")) return;
      if (failure === "network") throw new Error("Do not echo raw response or credential content");
      return reply({ [failure]: [{ index: 0, message: "must not be printed" }] });
    };
    await assert.rejects(restoreSnapshot(fixture(), state.options), error => {
      assert.ok(error instanceof PartialRestoreError);
      assert.equal(error.report.phase, "auth");
      assert.equal(error.report.attemptedAccounts, 1);
      assert.equal(error.report.createdAccounts, 0);
      assert.equal(error.report.writesMayHaveOccurred, true);
      assert.equal(error.report.cleanupAttempted, false);
      assert.equal(JSON.stringify(error.report).includes("must not"), false);
      return true;
    });
    assert.ok(state.calls.every(call => call.options.method !== "DELETE" && call.options.method !== "PATCH"));
  }
});

test("create collision after empty check is partial, never overwrites existing target document", async () => {
  const state = emulator();
  state.hook = call => {
    if (call.url.includes("accounts:batchCreate")) state.target.docs.set("sparkUnits/unit-a", fields({ name: "Concurrent unrelated document" }));
  };
  await assert.rejects(restoreSnapshot(fixture(), state.options), error => {
    assert.equal(error.report.phase, "firestore");
    assert.equal(error.report.createdAccounts, 1);
    assert.equal(error.report.failureCode, "HTTP_ERROR");
    return true;
  });
  assert.equal(state.target.docs.get("sparkUnits/unit-a").name.stringValue, "Concurrent unrelated document");
});

test("postrestore exact comparison detects lost bindings, claims and nested history values", async () => {
  for (const mutate of [
    state => { state.target.users[0].providerUserInfo = []; },
    state => { state.target.users[0].customAttributes = JSON.stringify({ pilot: false }); },
    state => { state.target.users[0].disabled = false; },
    state => { state.target.docs.get("sparkUnits/unit-a").name = string("Changed"); },
    state => {
      state.target.docs.get("sparkUnits/unit-a/records/record-a").description = string("Altered record and history");
      state.target.docs.get("sparkUnits/unit-a/records/record-a/history/v1").snapshot.mapValue.fields.description = string("Altered record and history");
    },
  ]) {
    const state = emulator(), snapshot = fixture();
    await restoreSnapshot(snapshot, state.options);
    mutate(state);
    await assert.rejects(verifyRestoredSnapshot(snapshot, state.options), { code: "RESTORE_MISMATCH" });
  }
});

test("archive restore authenticates then applies the same guarded create-only pathway", async () => {
  const state = emulator(), snapshot = validateSnapshot(fixture()), key = randomBytes(32);
  const report = await restoreArchive(sealArchive(snapshot, key), key, state.options);
  assert.equal(report.status, "verified");
  assert.equal(report.documentCount, snapshot.documents.length);
});
