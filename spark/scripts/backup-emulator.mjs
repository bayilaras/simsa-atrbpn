import { openArchive, snapshotDigest, validateSnapshot } from "./backup-archive.mjs";

// A maintenance rehearsal adapter, not a cloud backup client. No Firebase SDK,
// ADC lookup, CLI configuration, credential file, or caller-supplied URL is used.
export const SOURCE_PROJECT = "demo-simsa-spark-backup";
export const RESTORE_PROJECT = "demo-simsa-spark-restore";
const PAGE_SIZE = 50;
const MAX_DOCUMENTS = 10000;
const MAX_ACCOUNTS = 2000;
const MAX_PAGES = 10000;
const MAX_BYTES = 16 * 1024 * 1024;
const FIXED_ENV = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
};
const CLI_FIXED_ENV = {
  FIREBASE_EMULATOR_HUB: "127.0.0.1:4408",
  FIREBASE_FIRESTORE_EMULATOR_ADDRESS: "127.0.0.1:8088",
};

export class EmulatorBackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EmulatorBackupError";
    this.code = code;
  }
}
export class PartialRestoreError extends EmulatorBackupError {
  constructor(report) {
    super("PARTIAL_RESTORE", "Restore did not complete. Target may contain partial data while emulators remain live; launcher shutdown discards in-memory state. Adapter attempted no cleanup or retry.");
    this.name = "PartialRestoreError";
    this.report = Object.freeze(report);
  }
}
function fail(code, message) { throw new EmulatorBackupError(code, message); }
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectAmbientOverrides(env) {
  for (const [key, expected] of Object.entries({ ...FIXED_ENV, ...CLI_FIXED_ENV })) {
    if (env[key] !== undefined && env[key] !== expected) fail("ENVIRONMENT", "An inherited emulator host override is not accepted.");
  }
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"]) {
    if (env[key] !== undefined && env[key] !== SOURCE_PROJECT) fail("ENVIRONMENT", "An inherited project override is not accepted.");
  }
  if (env.FIREBASE_CONFIG !== undefined && env.FIREBASE_CONFIG !== "") {
    let config;
    try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { fail("ENVIRONMENT", "Firebase CLI config must be the exact generated synthetic config."); }
    const expected = {
      projectId: SOURCE_PROJECT,
      storageBucket: `${SOURCE_PROJECT}.appspot.com`,
      databaseURL: `https://${SOURCE_PROJECT}.firebaseio.com`,
    };
    if (!object(config) || Object.keys(config).length !== 3 ||
        Object.entries(expected).some(([key, value]) => config[key] !== value)) {
      fail("ENVIRONMENT", "Firebase CLI config must be the exact generated synthetic config.");
    }
    // The CLI injects these descriptive URLs even for a demo project. They are
    // validated but never passed to a client or used to construct any request.
  }
  const allowed = new Set([...Object.keys(FIXED_ENV), ...Object.keys(CLI_FIXED_ENV), "FIREBASE_CONFIG", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FIREBASE_CLI_DISABLE_UPDATE_CHECK"]);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue;
    if ((!allowed.has(key) && /^(FIREBASE_|FIRESTORE_|GOOGLE_|GCLOUD_|CLOUDSDK_|VITE_|DATABASE_|DB_|BLOB_|GCS_|VERCEL_|AWS_|SUPABASE_)/i.test(key)) ||
        /^(NODE_OPTIONS|NODE_PATH|NODE_USE_ENV_PROXY|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|GRPC_PROXY_EXP|GRPC_DEFAULT_SSL_ROOTS_FILE_PATH)$/i.test(key)) {
      fail("ENVIRONMENT", "Cloud credentials, project overrides, proxies, and runtime injection are not accepted.");
    }
  }
}

export function assertBackupEmulatorEnvironment(env) {
  if (!object(env)) fail("ENVIRONMENT", "An explicit local emulator environment is required.");
  for (const [key, expected] of Object.entries(FIXED_ENV)) {
    if (env[key] !== expected) fail("ENVIRONMENT", "Backup requires the exact loopback emulator hosts and ports.");
  }
  if (env.GCLOUD_PROJECT !== SOURCE_PROJECT ||
      (env.GOOGLE_CLOUD_PROJECT !== undefined && env.GOOGLE_CLOUD_PROJECT !== SOURCE_PROJECT)) {
    fail("ENVIRONMENT", "The launcher project must be the fixed synthetic backup project.");
  }
  rejectAmbientOverrides(env);
}

function context(options = {}) {
  if (!object(options) || Object.keys(options).some(key => !["env", "request"].includes(key))) {
    fail("OPTIONS", "Only the local environment and controlled test request function are accepted.");
  }
  // Even tests cannot mask unsafe variables inherited by the running process.
  rejectAmbientOverrides(process.env);
  if (options.env !== undefined && !object(options.env)) fail("OPTIONS", "Local environment options must be an object.");
  const env = { ...process.env, ...(options.env ?? {}) };
  assertBackupEmulatorEnvironment(env);
  const request = options.request ?? globalThis.fetch;
  if (typeof request !== "function") fail("OPTIONS", "A request function is required.");
  return { request };
}

function project(role) {
  if (role === "source") return SOURCE_PROJECT;
  if (role === "restore") return RESTORE_PROJECT;
  fail("ROLE", "Only the fixed source or restore emulator role is accepted.");
}
const firestoreRoot = id => `http://127.0.0.1:8088/v1/projects/${id}/databases/(default)/documents`;
const authRoot = id => `http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/projects/${id}`;

async function json(ctx, url, method = "GET", body) {
  // All callers construct fixed URLs internally; this final check is defense in
  // depth against accidentally introducing a configurable transport later.
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
      !["4408", "8088", "9098"].includes(parsed.port) || parsed.username || parsed.password) {
    fail("ENDPOINT", "Only fixed loopback emulator endpoints are permitted.");
  }
  let response;
  try {
    response = await ctx.request(url, {
      method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", ...(parsed.port === "4408" ? {} : { Authorization: "Bearer owner" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    fail("REQUEST_FAILED", "A fixed local emulator request failed; outcome may be unknown for a write.");
  }
  if (!response?.ok) fail("HTTP_ERROR", `Local emulator returned HTTP ${Number(response?.status) || 0}.`);
  let text;
  try { text = await response.text(); } catch { fail("RESPONSE", "Local emulator response could not be read."); }
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) fail("LIMIT", "Local emulator response exceeds the bounded archive limit.");
  let data;
  try { data = JSON.parse(text); } catch { fail("RESPONSE", "Local emulator returned invalid JSON."); }
  if (!object(data)) fail("RESPONSE", "Local emulator response must be an object.");
  return data;
}

async function checkHub(ctx) {
  const hub = await json(ctx, "http://127.0.0.1:4408/emulators");
  if (hub.firestore?.host !== "127.0.0.1" || hub.firestore?.port !== 8088 ||
      hub.auth?.host !== "127.0.0.1" || hub.auth?.port !== 9098) {
    fail("EMULATOR_IDENTITY", "The emulator hub does not identify the exact local Auth and Firestore endpoints.");
  }
}

async function pages(load, key, tokenKey = "nextPageToken", limit = MAX_DOCUMENTS) {
  const items = [], seen = new Set();
  let token;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await load(token);
    if (data.error !== undefined || data.errors !== undefined) fail("RESPONSE", "Emulator list returned an error payload instead of metadata.");
    const entries = data[key] ?? [];
    if (!Array.isArray(entries) || entries.length > PAGE_SIZE) fail("RESPONSE", "Malformed or oversized emulator page.");
    items.push(...entries);
    if (items.length > limit) fail("LIMIT", "Local metadata exceeds the supported limit; no truncated archive was produced.");
    const next = data[tokenKey];
    if (next === undefined || next === "") return items;
    if (typeof next !== "string" || next.length > 4096 || seen.has(next)) fail("PAGINATION", "Invalid or repeated pagination token.");
    seen.add(next);
    token = next;
  }
  fail("LIMIT", "Emulator pagination exceeded its bounded limit.");
}

function validId(id, maximum = 100) {
  return typeof id === "string" && new RegExp(`^[A-Za-z0-9_-]{1,${maximum}}$`).test(id) && !/^__.*__$/.test(id);
}
function children(path) {
  if (path === "") return ["sparkUsers", "sparkUnits"];
  const p = path.split("/");
  if (p[0] === "sparkUsers" && p.length === 2 && validId(p[1], 128)) return [];
  if (p[0] !== "sparkUnits" || !validId(p[1])) fail("DOCUMENT_PATH", "Unexpected document path in local metadata.");
  if (p.length === 2) return ["classifications", "locations", "records"];
  if (p.length === 4 && ["classifications", "locations", "records"].includes(p[2]) && validId(p[3])) {
    return p[2] === "records" ? ["history"] : [];
  }
  if (p.length === 6 && p[2] === "records" && validId(p[3]) && p[4] === "history" && /^v[1-9][0-9]*$/.test(p[5])) return [];
  fail("DOCUMENT_PATH", "Unexpected document path in local metadata.");
}

async function collectionIds(ctx, id, parent) {
  return pages(token => json(ctx, `${firestoreRoot(id)}${parent ? `/${parent}` : ""}:listCollectionIds`, "POST", {
    pageSize: PAGE_SIZE, ...(token ? { pageToken: token } : {}),
  }), "collectionIds", "nextPageToken", MAX_DOCUMENTS);
}

async function readDocuments(ctx, id) {
  const documents = [], seenPaths = new Set();
  let bytes = 0;
  async function visit(parent) {
    const permitted = children(parent);
    const ids = await collectionIds(ctx, id, parent);
    if (new Set(ids).size !== ids.length || ids.some(value => typeof value !== "string" || !permitted.includes(value))) {
      fail("COLLECTION", "Unexpected or duplicate collection; full Spark export cannot be proven.");
    }
    for (const collectionId of ids.sort()) {
      const collection = parent ? `${parent}/${collectionId}` : collectionId;
      const docs = await pages(token => {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), showMissing: "true" });
        if (token) query.set("pageToken", token);
        // showMissing exposes orphan subcollections. Firestore forbids orderBy
        // with this mode; opaque pagination must be followed even on empty pages.
        return json(ctx, `${firestoreRoot(id)}/${collection}?${query}`);
      }, "documents");
      for (const doc of docs) {
        const prefix = `projects/${id}/databases/(default)/documents/${collection}/`;
        if (!object(doc) || typeof doc.name !== "string" || !doc.name.startsWith(prefix)) fail("DOCUMENT_PATH", "Emulator returned a document from an unexpected path.");
        const suffix = doc.name.slice(prefix.length);
        const path = `${collection}/${suffix}`;
        children(path);
        if (suffix.includes("/") || seenPaths.has(path)) fail("DOCUMENT_PATH", "Duplicate or mismatched document path.");
        // A missing parent is not an empty existing document. Never materialize
        // one during restore or silently ignore the orphan descendants.
        if (typeof doc.createTime !== "string" || typeof doc.updateTime !== "string") fail("MISSING_PARENT", "A missing document parent was detected; archive is incomplete.");
        const fields = doc.fields ?? {};
        if (!object(fields)) fail("RESPONSE", "Malformed Firestore fields.");
        seenPaths.add(path);
        documents.push({ path, fields });
        bytes += Buffer.byteLength(JSON.stringify({ path, fields }), "utf8");
        if (documents.length > MAX_DOCUMENTS || bytes > MAX_BYTES) fail("LIMIT", "Local metadata exceeds the supported archive limit.");
        await visit(path);
      }
    }
  }
  await visit("");
  return documents;
}

async function assertNoTenants(ctx, id) {
  const tenants = await pages(token => {
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (token) query.set("pageToken", token);
    return json(ctx, `http://127.0.0.1:9098/identitytoolkit.googleapis.com/v2/projects/${id}/tenants?${query}`);
  }, "tenants", "nextPageToken", MAX_ACCOUNTS);
  if (tenants.length) fail("AUTH_UNSUPPORTED", "Auth tenants are outside this metadata rehearsal and cannot be silently omitted.");
}

function authMetadata(user) {
  if (!object(user)) fail("RESPONSE", "Malformed Auth user.");
  if (user.tenantId || user.phoneNumber || user.photoUrl || user.photoURL ||
      (user.mfaInfo?.length) || (user.passkeyInfo?.length)) {
    fail("AUTH_UNSUPPORTED", "Tenant, phone, MFA, passkey, and account-photo metadata are not supported by this rehearsal.");
  }
  if (user.providerUserInfo !== undefined && !Array.isArray(user.providerUserInfo)) fail("RESPONSE", "Malformed Auth provider metadata.");
  const providerData = (user.providerUserInfo ?? []).map(provider => {
    if (!object(provider) || !["password", "google.com"].includes(provider.providerId) || typeof provider.rawId !== "string") {
      fail("AUTH_UNSUPPORTED", "An Auth provider binding cannot be represented exactly.");
    }
    return {
      providerId: provider.providerId, uid: provider.rawId,
      ...(provider.email === undefined ? {} : { email: provider.email }),
      ...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
      ...(provider.photoUrl === undefined ? {} : { photoURL: provider.photoUrl }),
    };
  });
  let customClaims;
  if (user.customAttributes !== undefined) {
    try { customClaims = JSON.parse(user.customAttributes); } catch { fail("AUTH_UNSUPPORTED", "Auth custom claims could not be represented exactly."); }
    if (!object(customClaims)) fail("AUTH_UNSUPPORTED", "Auth custom claims must be an object.");
  }
  // This allowlisted projection never copies passwordHash, salt, password,
  // tokens, validSince, session details, or credential material into an archive.
  return {
    uid: user.localId, email: user.email, emailVerified: user.emailVerified ?? false,
    disabled: user.disabled ?? false, displayName: user.displayName ?? "", providerData,
    ...(customClaims === undefined ? {} : { customClaims }),
  };
}

async function readAuth(ctx, id) {
  await assertNoTenants(ctx, id);
  const raw = await pages(token => {
    const query = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
    if (token) query.set("nextPageToken", token);
    return json(ctx, `${authRoot(id)}/accounts:batchGet?${query}`);
  }, "users", "nextPageToken", MAX_ACCOUNTS);
  return raw.map(authMetadata);
}

async function scan(ctx, id, capturedAt) {
  const documents = await readDocuments(ctx, id);
  const authUsers = await readAuth(ctx, id);
  // The archive describes the original source. For exact restore verification
  // only, the fixed destination's relative paths use the same schema identity.
  return validateSnapshot({ version: 1, sourceProject: SOURCE_PROJECT, database: "(default)", capturedAt, documents, authUsers });
}

async function stableScan(ctx, id, capturedAt) {
  const first = await scan(ctx, id, capturedAt);
  const second = await scan(ctx, id, capturedAt);
  if (snapshotDigest(first) !== snapshotDigest(second)) fail("CONCURRENT_WRITE", "Metadata changed between complete reads; stop writers and repeat with a fresh empty target.");
  // Two equal traversals detect many concurrent changes; they are NOT Firestore
  // snapshot isolation, a write lock, or proof that production was quiescent.
  return first;
}

export async function readSnapshot(options = {}) {
  const ctx = context(options);
  await checkHub(ctx);
  return stableScan(ctx, SOURCE_PROJECT, new Date().toISOString());
}

async function requireEmpty(ctx, id) {
  const collections = await collectionIds(ctx, id, "");
  await assertNoTenants(ctx, id);
  const auth = await pages(token => {
    const query = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
    if (token) query.set("nextPageToken", token);
    return json(ctx, `${authRoot(id)}/accounts:batchGet?${query}`);
  }, "users", "nextPageToken", MAX_ACCOUNTS);
  if (collections.length || auth.length) fail("TARGET_NOT_EMPTY", "The fixed emulator project is not empty; no overwrite or cleanup is allowed.");
}

export async function assertEmptyEmulatorProject(role, options = {}) {
  const id = project(role), ctx = context(options);
  await checkHub(ctx);
  await requireEmpty(ctx, id);
  return { project: id, empty: true };
}

function expectedRestored(snapshot) {
  return validateSnapshot({ ...snapshot, authUsers: snapshot.authUsers.map(user => ({
    ...user, disabled: true, providerData: user.providerData.filter(provider => provider.providerId !== "password"),
  })) });
}
function limitations(snapshot) {
  return {
    scope: "synthetic-local-maintenance-rehearsal-only",
    consistency: "two-equal-complete-reads-not-snapshot-isolation",
    allAccountsDisabled: true,
    passwordProviderBindingsOmitted: snapshot.authUsers.reduce((sum, user) => sum + user.providerData.filter(provider => provider.providerId === "password").length, 0),
    passwordsHashesTokensAndSessionMetadata: "not-exported-or-restored",
    accountCreationAndLastLoginTimes: "not-preserved",
    googleProviderBindingsAndCustomClaims: "preserved-and-compared",
  };
}

async function verify(ctx, snapshot) {
  const expected = expectedRestored(snapshot);
  const actual = await stableScan(ctx, RESTORE_PROJECT, snapshot.capturedAt);
  const expectedDigest = snapshotDigest(expected), actualDigest = snapshotDigest(actual);
  if (expectedDigest !== actualDigest) fail("RESTORE_MISMATCH", "Restored document or Auth metadata differs from the fully validated archive.");
  return {
    status: "verified", sourceProject: SOURCE_PROJECT, restoreProject: RESTORE_PROJECT,
    documentCount: actual.documents.length, accountCount: actual.authUsers.length,
    expectedDigest, actualDigest, limitations: limitations(snapshot),
  };
}

export async function verifyRestoredSnapshot(input, options = {}) {
  const snapshot = validateSnapshot(input), ctx = context(options);
  await checkHub(ctx);
  return verify(ctx, snapshot);
}

export async function restoreSnapshot(input, options = {}) {
  // Complete schema/closure/identity validation and construction of expected
  // output happen before even checking the target, and certainly before writes.
  const snapshot = validateSnapshot(input), expected = expectedRestored(snapshot);
  const ctx = context(options);
  await checkHub(ctx);
  await requireEmpty(ctx, RESTORE_PROJECT);
  let phase = "auth", createdAccounts = 0, createdDocuments = 0, attemptedAccounts = 0, attemptedDocuments = 0;
  try {
    for (const user of expected.authUsers) {
      attemptedAccounts++;
      const account = {
        localId: user.uid, email: user.email, emailVerified: user.emailVerified,
        disabled: true, displayName: user.displayName,
        providerUserInfo: user.providerData.map(provider => ({
          providerId: provider.providerId, rawId: provider.uid,
          ...(provider.email === undefined ? {} : { email: provider.email }),
          ...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
          ...(provider.photoURL === undefined ? {} : { photoUrl: provider.photoURL }),
        })),
        ...(user.customClaims === undefined ? {} : { customAttributes: JSON.stringify(user.customClaims) }),
      };
      const result = await json(ctx, `${authRoot(RESTORE_PROJECT)}/accounts:batchCreate`, "POST", {
        users: [account], allowOverwrite: false, sanityCheck: true,
      });
      // Auth batch import can return HTTP 200 with individual write failures.
      for (const key of ["error", "errors"]) {
        if (result[key] !== undefined && (!Array.isArray(result[key]) || result[key].length)) fail("AUTH_CREATE_FAILED", "Auth create-only import reported a per-account failure.");
      }
      createdAccounts++;
    }
    phase = "firestore";
    const ordered = [...snapshot.documents].sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    for (const doc of ordered) {
      const parts = doc.path.split("/"), documentId = parts.pop();
      const query = new URLSearchParams({ documentId });
      attemptedDocuments++;
      const result = await json(ctx, `${firestoreRoot(RESTORE_PROJECT)}/${parts.join("/")}?${query}`, "POST", { fields: doc.fields });
      if (result.name !== `projects/${RESTORE_PROJECT}/databases/(default)/documents/${doc.path}`) fail("DOCUMENT_CREATE_FAILED", "Firestore create response did not identify the expected new document.");
      createdDocuments++;
    }
    phase = "verification";
    return { ...await verify(ctx, snapshot), createdAccounts, createdDocuments };
  } catch (error) {
    throw new PartialRestoreError({
      status: "partial-or-unverified-restore", restoreProject: RESTORE_PROJECT, phase,
      createdAccounts, createdDocuments, attemptedAccounts, attemptedDocuments,
      writesMayHaveOccurred: attemptedAccounts + attemptedDocuments > 0,
      failureCode: error instanceof EmulatorBackupError ? error.code : "VALIDATION_OR_UNEXPECTED_FAILURE",
      cleanupAttempted: false,
    });
  }
}

export async function restoreArchive(bytes, key, options = {}) {
  // openArchive authenticates all ciphertext and validates the entire snapshot
  // before restoreSnapshot can perform its first emulator request.
  return restoreSnapshot(openArchive(bytes, key), options);
}
