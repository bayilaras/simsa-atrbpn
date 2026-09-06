import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectId = "demo-simsa-spark";
const fixturePaths = new Set([
  "sparkUsers/spark-demo-operator",
  "sparkUsers/spark-demo-viewer",
  "sparkUnits/unit-demo",
  "sparkUnits/unit-demo/classifications/umum",
  "sparkUnits/unit-demo/locations/rak-a",
]);

export function assertLocalEmulators(env) {
  if (
    env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8088" ||
    env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9098" ||
    env.GCLOUD_PROJECT !== projectId ||
    (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== projectId) ||
    env.GOOGLE_APPLICATION_CREDENTIALS
  )
    throw new Error("Seed is permitted only on the exact local demo emulator.");
}

export function fixtureCreateRequest(docPath, data) {
  if (!fixturePaths.has(docPath))
    throw new Error("Unknown synthetic fixture path");
  const segments = docPath.split("/"),
    documentId = segments.pop();
  const fields = Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (typeof value === "string") return [key, { stringValue: value }];
      if (typeof value === "boolean") return [key, { booleanValue: value }];
      throw new Error("Synthetic fixture fields must be strings or booleans");
    }),
  );
  return {
    url: `http://127.0.0.1:8088/v1/projects/${projectId}/databases/(default)/documents/${segments.join("/")}?documentId=${documentId}`,
    options: {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer owner",
      },
      body: JSON.stringify({ fields }),
    },
  };
}

export async function createFixture(docPath, data, request = fetch) {
  // Admin Firestore 14 requires certificate/ADC even with an emulator. Use its
  // fixed local REST endpoint instead; the emulator-only owner token is not a
  // Google credential. POST createDocument never replaces an existing document.
  const { url, options } = fixtureCreateRequest(docPath, data);
  const response = await request(url, options);
  if (response.ok) return "created";
  if (response.status === 409) {
    const body = await response.json();
    if (body.error?.status === "ALREADY_EXISTS") return "preserved";
  }
  throw new Error(
    `Synthetic fixture create failed (${response.status}) for ${docPath}`,
  );
}

export async function seedEmulator() {
  assertLocalEmulators(process.env);
  // Verify both local emulator surfaces before any synthetic write. Never
  // delete data or promote this fixture into a live bootstrap operation.
  const hub = await fetch("http://127.0.0.1:4408/emulators", {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  }).then((r) => {
    if (!r.ok) throw new Error("Emulator hub unavailable");
    return r.json();
  });
  if (
    hub.firestore?.host !== "127.0.0.1" ||
    hub.firestore?.port !== 8088 ||
    hub.auth?.host !== "127.0.0.1" ||
    hub.auth?.port !== 9098
  )
    throw new Error("Emulator inventory mismatch");
  const app = initializeApp({
    projectId,
    credential: {
      getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }),
    },
  });
  try {
    const auth = getAuth(app);
    for (const [uid, email, role] of [
      ["spark-demo-operator", "operator@example.test", "operator"],
      ["spark-demo-viewer", "viewer@example.test", "viewer"],
    ]) {
      try {
        await auth.createUser({
          uid,
          email,
          password: "Local-Spark-Only-2026!",
          emailVerified: true,
        });
      } catch (error) {
        if (error.code !== "auth/uid-already-exists") throw error;
      }
      await createFixture(`sparkUsers/${uid}`, {
        displayName: `Pengguna ${role} lokal`,
        unitId: "unit-demo",
        role,
        active: true,
      });
    }
    const docs = {
      "sparkUnits/unit-demo": { name: "Unit Contoh — Data Sintetis" },
      "sparkUnits/unit-demo/classifications/umum": {
        code: "DEMO.01",
        name: "Administrasi Contoh",
        active: true,
      },
      "sparkUnits/unit-demo/locations/rak-a": {
        name: "Rak A / Kotak 01",
        description: "Lokasi fiktif untuk pengujian",
        active: true,
      },
    };
    for (const [docPath, data] of Object.entries(docs)) {
      await createFixture(docPath, data);
    }
    console.log(
      "Synthetic emulator users/catalogues ready. No live project accessed. See README for local-only credentials.",
    );
  } finally {
    await deleteApp(app);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await seedEmulator();
