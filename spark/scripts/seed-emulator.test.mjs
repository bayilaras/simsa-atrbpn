import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLocalEmulators,
  createFixture,
  fixtureCreateRequest,
} from "./seed-emulator.mjs";

const local = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
  GCLOUD_PROJECT: "demo-simsa-spark",
};

test("seed refuses any live/changed endpoint, project or real credential", () => {
  assert.doesNotThrow(() => assertLocalEmulators(local));
  for (const patch of [
    { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com" },
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    { FIREBASE_AUTH_EMULATOR_HOST: "localhost:9098" },
    { GCLOUD_PROJECT: "arsip-d16d3" },
    { GOOGLE_CLOUD_PROJECT: "other-project" },
    { GOOGLE_APPLICATION_CREDENTIALS: "must-not-be-read.json" },
  ]) {
    assert.throws(
      () => assertLocalEmulators({ ...local, ...patch }),
      /exact local demo/,
    );
  }
});

test("Firestore fixture request is fixed loopback create-only with no ADC discovery", () => {
  const { url, options } = fixtureCreateRequest(
    "sparkUsers/spark-demo-viewer",
    { displayName: "Contoh", active: true },
  );
  assert.equal(
    url,
    "http://127.0.0.1:8088/v1/projects/demo-simsa-spark/databases/(default)/documents/sparkUsers?documentId=spark-demo-viewer",
  );
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, "Bearer owner");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), {
    fields: {
      displayName: { stringValue: "Contoh" },
      active: { booleanValue: true },
    },
  });
  assert.throws(
    () => fixtureCreateRequest("sparkUsers/unapproved", {}),
    /Unknown/,
  );
  assert.throws(
    () => fixtureCreateRequest("sparkUsers/spark-demo-viewer", { number: 1 }),
    /strings or booleans/,
  );
});

test("fixture never overwrites or retries; skips only exact already-exists response", async () => {
  let calls = 0;
  const invoke = (response) =>
    createFixture("sparkUnits/unit-demo", { name: "Unit contoh" }, async () => {
      calls++;
      return response;
    });
  assert.equal(await invoke(new Response("{}", { status: 200 })), "created");
  assert.equal(
    await invoke(
      new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), {
        status: 409,
      }),
    ),
    "preserved",
  );
  await assert.rejects(
    invoke(
      new Response(JSON.stringify({ error: { status: "ABORTED" } }), {
        status: 409,
      }),
    ),
    /create failed/,
  );
  await assert.rejects(
    invoke(new Response("{}", { status: 403 })),
    /create failed/,
  );
  await assert.rejects(
    invoke(new Response("{}", { status: 302 })),
    /create failed/,
  );
  assert.equal(calls, 5);
});
