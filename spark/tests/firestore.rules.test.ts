import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

// Never infer a project from an authenticated CLI or use production defaults.
const PROJECT = "demo-simsa-spark";
const HOST = "127.0.0.1:8088";
const OLD_TIME = Timestamp.fromMillis(Date.UTC(2026, 0, 2, 3, 4, 5));
let environment: RulesTestEnvironment;

// Rules testing v5 exposes the official compat facade. Modular Firestore APIs
// unwrap that facade at runtime; this one type-only interop boundary does not
// replace a client, bypass rules or manufacture a successful test response.
function database(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore;
}

function dbFor(uid = "alice", emailVerified = true): Firestore {
  return database(
    environment.authenticatedContext(uid, {
      email: `${uid}@example.test`,
      email_verified: emailVerified,
    }),
  );
}

function path(unit = "unit-a", id = "new-record"): string {
  return `sparkUnits/${unit}/records/${id}`;
}

function record(overrides: DocumentData = {}): DocumentData {
  return {
    title: "Synthetic archive metadata",
    referenceNumber: "TEST-2026-001",
    recordDate: "2026-01-02",
    classificationId: "classification-a",
    locationId: "location-a",
    description: "Synthetic physical location only",
    status: "draft",
    archiveReason: "",
    unitId: "unit-a",
    createdBy: "alice",
    createdAt: serverTimestamp(),
    updatedBy: "alice",
    updatedAt: serverTimestamp(),
    version: 1,
    ...overrides,
  };
}

function existing(overrides: DocumentData = {}): DocumentData {
  return record({ createdAt: OLD_TIME, updatedAt: OLD_TIME, ...overrides });
}

function edited(overrides: DocumentData = {}): DocumentData {
  return existing({
    title: "Updated synthetic metadata",
    updatedAt: serverTimestamp(),
    version: 2,
    ...overrides,
  });
}

function commit(
  db: Firestore,
  data = record(),
  options: {
    unit?: string;
    id?: string;
    eventId?: string;
    event?: DocumentData;
    noHistory?: boolean;
  } = {},
) {
  const recordPath = path(options.unit, options.id);
  const batch = writeBatch(db);
  batch.set(doc(db, recordPath), data);
  if (!options.noHistory) {
    batch.set(
      doc(db, `${recordPath}/history/${options.eventId ?? `v${data.version}`}`),
      {
        snapshot: data,
        actorUid: data.updatedBy,
        at: serverTimestamp(),
        ...options.event,
      },
    );
  }
  return batch.commit();
}

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = database(context);
    const batch = writeBatch(db);
    for (const [uid, unitId, role, active] of [
      ["alice", "unit-a", "operator", true],
      ["bob", "unit-b", "operator", true],
      ["viewer", "unit-a", "viewer", true],
      ["admin", "unit-a", "admin", true],
      ["inactive", "unit-a", "operator", false],
      ["invalid-role", "unit-a", "owner", true],
    ] as const) {
      batch.set(doc(db, "sparkUsers", uid), {
        displayName: `Synthetic ${uid}`,
        unitId,
        role,
        active,
      });
    }
    for (const unit of ["unit-a", "unit-b"]) {
      batch.set(doc(db, `sparkUnits/${unit}`), { name: `Synthetic ${unit}` });
      batch.set(
        doc(db, `sparkUnits/${unit}/classifications/classification-a`),
        { code: "A", name: "Active classification", active: true },
      );
      batch.set(doc(db, `sparkUnits/${unit}/classifications/inactive`), {
        code: "I",
        name: "Inactive classification",
        active: false,
      });
      batch.set(doc(db, `sparkUnits/${unit}/locations/location-a`), {
        name: "Active location",
        description: "Synthetic shelf",
        active: true,
      });
      batch.set(doc(db, `sparkUnits/${unit}/locations/inactive`), {
        name: "Inactive location",
        description: "",
        active: false,
      });
    }
    const fixtures = [
      ["unit-a", "existing", existing()],
      [
        "unit-a",
        "archived",
        existing({
          status: "archived",
          archiveReason: "Closed for synthetic test",
        }),
      ],
      [
        "unit-b",
        "existing",
        existing({ unitId: "unit-b", createdBy: "bob", updatedBy: "bob" }),
      ],
    ] as const;
    for (const [unit, id, data] of fixtures) {
      batch.set(doc(db, path(unit, id)), data);
      batch.set(doc(db, `${path(unit, id)}/history/v1`), {
        snapshot: data,
        actorUid: data.updatedBy,
        at: OLD_TIME,
      });
    }
    await batch.commit();
  });
}

async function assertNewAbsent(id = "new-record") {
  await environment.withSecurityRulesDisabled(async (context) => {
    expect(
      (await getDoc(doc(database(context), path("unit-a", id)))).exists(),
    ).toBe(false);
    expect(
      (
        await getDoc(doc(database(context), `${path("unit-a", id)}/history/v1`))
      ).exists(),
    ).toBe(false);
  });
}

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== HOST) {
    throw new Error(
      `Rules tests require the isolated ${PROJECT} Firestore emulator at ${HOST}; no live fallback`,
    );
  }
  environment = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      host: "127.0.0.1",
      port: 8088,
      rules: readFileSync(
        new URL("../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
}, 30_000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed();
});

afterAll(async () => {
  await environment?.cleanup();
});

describe("verified profiles, trusted provisioning and unit isolation", () => {
  it("allows own verified profile even when inactive or missing, but not another profile", async () => {
    await assertSucceeds(getDoc(doc(dbFor(), "sparkUsers/alice")));
    await assertSucceeds(getDoc(doc(dbFor("inactive"), "sparkUsers/inactive")));
    expect(
      (
        await assertSucceeds(
          getDoc(doc(dbFor("unknown"), "sparkUsers/unknown")),
        )
      ).exists(),
    ).toBe(false);
    await assertFails(getDoc(doc(dbFor(), "sparkUsers/bob")));
    await assertFails(getDoc(doc(dbFor("alice", false), "sparkUsers/alice")));
    await assertFails(
      getDoc(
        doc(database(environment.unauthenticatedContext()), "sparkUsers/alice"),
      ),
    );
  });

  it("denies all client profile provisioning, privilege changes, deletion and listing, including admin", async () => {
    for (const uid of ["alice", "admin", "unknown"]) {
      const db = dbFor(uid);
      await assertFails(
        setDoc(doc(db, "sparkUsers/new-user"), {
          displayName: "X",
          unitId: "unit-a",
          role: "admin",
          active: true,
        }),
      );
      await assertFails(
        updateDoc(doc(db, `sparkUsers/${uid}`), {
          role: "admin",
          unitId: "unit-b",
          active: true,
        }),
      );
      await assertFails(deleteDoc(doc(db, "sparkUsers/alice")));
      await assertFails(getDocs(query(collection(db, "sparkUsers"), limit(1))));
    }
  });

  it("does not trust role/unit claims instead of the operator-provisioned profile", async () => {
    const db = database(
      environment.authenticatedContext("viewer", {
        email_verified: true,
        role: "admin",
        unitId: "unit-b",
        active: true,
      }),
    );
    await assertFails(
      commit(db, record({ createdBy: "viewer", updatedBy: "viewer" })),
    );
    await assertFails(getDoc(doc(db, path("unit-b", "existing"))));
    const batch = writeBatch(db);
    batch.update(doc(db, "sparkUsers/viewer"), { role: "admin" });
    const data = record({ createdBy: "viewer", updatedBy: "viewer" });
    batch.set(doc(db, path()), data);
    batch.set(doc(db, `${path()}/history/v1`), {
      snapshot: data,
      actorUid: "viewer",
      at: serverTimestamp(),
    });
    await assertFails(batch.commit());
    await assertNewAbsent();
  });

  it.each(["alice", "viewer", "admin"])(
    "allows own-unit reads and bounded catalogues for %s",
    async (uid) => {
      const db = dbFor(uid);
      await assertSucceeds(getDoc(doc(db, "sparkUnits/unit-a")));
      await assertSucceeds(
        getDoc(doc(db, "sparkUnits/unit-a/classifications/classification-a")),
      );
      await assertSucceeds(
        getDocs(
          query(collection(db, "sparkUnits/unit-a/classifications"), limit(50)),
        ),
      );
      await assertSucceeds(
        getDocs(
          query(collection(db, "sparkUnits/unit-a/locations"), limit(50)),
        ),
      );
      await assertSucceeds(getDoc(doc(db, path("unit-a", "existing"))));
      await assertSucceeds(
        getDoc(doc(db, `${path("unit-a", "existing")}/history/v1`)),
      );
      await assertSucceeds(
        getDocs(
          query(
            collection(db, path("unit-a", "existing"), "history"),
            orderBy("at", "desc"),
            limit(25),
          ),
        ),
      );
    },
  );

  it.each(["inactive", "unknown", "invalid-role"])(
    "denies every unit operation to %s",
    async (uid) => {
      const db = dbFor(uid);
      await assertFails(getDoc(doc(db, "sparkUnits/unit-a")));
      await assertFails(getDoc(doc(db, path("unit-a", "existing"))));
      await assertFails(
        getDocs(query(collection(db, "sparkUnits/unit-a/records"), limit(25))),
      );
      await assertFails(
        getDocs(
          query(collection(db, "sparkUnits/unit-a/classifications"), limit(25)),
        ),
      );
      await assertFails(
        getDoc(doc(db, `${path("unit-a", "existing")}/history/v1`)),
      );
      await assertFails(commit(db, record({ createdBy: uid, updatedBy: uid })));
    },
  );

  it("denies unverified and unauthenticated record reads, lists and writes", async () => {
    for (const db of [
      dbFor("alice", false),
      database(environment.unauthenticatedContext()),
    ]) {
      await assertFails(getDoc(doc(db, path("unit-a", "existing"))));
      await assertFails(
        getDocs(query(collection(db, "sparkUnits/unit-a/records"), limit(25))),
      );
      await assertFails(commit(db));
    }
  });

  it.each(["alice", "viewer", "admin"])(
    "denies all cross-unit access to %s, including guessed IDs",
    async (uid) => {
      const db = dbFor(uid);
      await assertFails(getDoc(doc(db, "sparkUnits/unit-b")));
      await assertFails(getDoc(doc(db, path("unit-b", "existing"))));
      await assertFails(
        getDoc(doc(db, `${path("unit-b", "existing")}/history/v1`)),
      );
      await assertFails(
        getDocs(
          query(collection(db, "sparkUnits/unit-b/classifications"), limit(25)),
        ),
      );
      await assertFails(
        getDocs(query(collection(db, "sparkUnits/unit-b/records"), limit(25))),
      );
      await assertFails(
        commit(
          db,
          record({ unitId: "unit-b", createdBy: uid, updatedBy: uid }),
          { unit: "unit-b" },
        ),
      );
    },
  );

  it("denies client unit/catalogue writes and unit enumeration, including admin", async () => {
    const db = dbFor("admin");
    for (const target of [
      "sparkUnits/unit-a",
      "sparkUnits/unit-a/classifications/classification-a",
      "sparkUnits/unit-a/locations/location-a",
    ]) {
      await assertFails(
        setDoc(doc(db, target), { name: "Tampered", active: true }),
      );
      await assertFails(deleteDoc(doc(db, target)));
    }
    await assertFails(getDocs(query(collection(db, "sparkUnits"), limit(1))));
  });

  it("revokes unit reads/writes immediately when a trusted operator deactivates or moves the profile", async () => {
    const db = dbFor();
    await assertSucceeds(getDoc(doc(db, path("unit-a", "existing"))));
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(database(context), "sparkUsers/alice"), {
        active: false,
      });
    });
    await assertFails(getDoc(doc(db, path("unit-a", "existing"))));
    await assertFails(commit(db));
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(database(context), "sparkUsers/alice"), {
        active: true,
        unitId: "unit-b",
      });
    });
    await assertFails(getDoc(doc(db, path("unit-a", "existing"))));
    await assertSucceeds(getDoc(doc(db, path("unit-b", "existing"))));
  });
});

describe("bounded, unit-specific queries and deny-default paths", () => {
  it("allows bounded exact-reference queries, ordered pages and boundary limit 50", async () => {
    const db = dbFor();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "sparkUnits/unit-a/records"),
          where("referenceNumber", "==", "TEST-2026-001"),
          orderBy("updatedAt", "desc"),
          limit(26),
        ),
      ),
    );
    await assertSucceeds(
      getDocs(query(collection(db, "sparkUnits/unit-a/records"), limit(50))),
    );
  });

  it("denies missing or oversized limits for records, history and both catalogues", async () => {
    const db = dbFor();
    for (const target of [
      "sparkUnits/unit-a/records",
      `${path("unit-a", "existing")}/history`,
      "sparkUnits/unit-a/classifications",
      "sparkUnits/unit-a/locations",
    ]) {
      await assertFails(getDocs(collection(db, target)));
      await assertFails(getDocs(query(collection(db, target), limit(51))));
    }
  });

  it("denies collection-group queries even with a matching unit filter and limit", async () => {
    const db = dbFor("admin");
    await assertFails(
      getDocs(
        query(
          collectionGroup(db, "records"),
          where("unitId", "==", "unit-a"),
          limit(25),
        ),
      ),
    );
    for (const name of ["history", "classifications", "locations"]) {
      await assertFails(getDocs(query(collectionGroup(db, name), limit(25))));
    }
  });

  it("denies legacy collections and arbitrary nested fields/subcollections", async () => {
    const db = dbFor("admin");
    for (const target of [
      "users/alice",
      "archives/one",
      "sparkUnits/unit-a/secrets/one",
      `${path("unit-a", "existing")}/files/one`,
    ]) {
      await assertFails(getDoc(doc(db, target)));
      await assertFails(
        setDoc(doc(db, target), {
          role: "admin",
          fileUrl: "https://example.test/file",
        }),
      );
    }
  });
});

describe("record schema, writer roles and catalogue boundaries", () => {
  it.each(["alice", "admin"])(
    "allows atomic draft/active creation by %s",
    async (uid) => {
      const db = dbFor(uid);
      for (const status of ["draft", "active"]) {
        await assertSucceeds(
          commit(db, record({ createdBy: uid, updatedBy: uid, status }), {
            id: status,
          }),
        );
        const saved = (await getDoc(doc(db, path("unit-a", status)))).data()!;
        const event = (
          await getDoc(doc(db, `${path("unit-a", status)}/history/v1`))
        ).data()!;
        expect(saved.createdAt).toBeInstanceOf(Timestamp);
        expect(saved.createdAt.isEqual(saved.updatedAt)).toBe(true);
        expect(event.snapshot).toEqual(saved);
        expect(event.at.isEqual(saved.updatedAt)).toBe(true);
      }
    },
  );

  it("prevents viewer creation, editing, archiving and hard deletion", async () => {
    const db = dbFor("viewer");
    await assertFails(
      commit(db, record({ createdBy: "viewer", updatedBy: "viewer" })),
    );
    await assertFails(
      commit(db, edited({ updatedBy: "viewer" }), { id: "existing" }),
    );
    await assertFails(
      commit(
        db,
        edited({
          title: existing().title,
          updatedBy: "viewer",
          status: "archived",
          archiveReason: "Finished test",
        }),
        { id: "existing" },
      ),
    );
    await assertFails(deleteDoc(doc(db, path("unit-a", "existing"))));
  });

  it.each([
    ["empty title", { title: "" }],
    ["whitespace title", { title: "  " }],
    ["untrimmed title", { title: " title " }],
    ["multiline title", { title: "first\nsecond\nthird" }],
    ["control character title", { title: "bad\u0000title" }],
    ["oversized title", { title: "x".repeat(201) }],
    ["non-string title", { title: 1 }],
    ["empty reference", { referenceNumber: "" }],
    ["oversized reference", { referenceNumber: "x".repeat(101) }],
    ["oversized description", { description: "x".repeat(2001) }],
    ["null description", { description: null }],
    ["untrimmed description", { description: " value " }],
    [
      "control character description",
      { description: "first\nsecond\u0000third\nfourth" },
    ],
    ["bad status", { status: "destroyed" }],
    [
      "archived create",
      { status: "archived", archiveReason: "Not allowed at create" },
    ],
    ["reason before archive", { archiveReason: "Cannot be supplied yet" }],
    ["file URL field", { fileUrl: "https://example.test/file" }],
    ["blob field", { blob: "gs://bucket/file" }],
    ["privilege field", { role: "admin" }],
    ["unknown field", { extra: true }],
    ["wrong unit field", { unitId: "unit-b" }],
    ["spoofed creator", { createdBy: "admin" }],
    ["spoofed updater", { updatedBy: "admin" }],
    ["past creation timestamp", { createdAt: OLD_TIME }],
    ["past update timestamp", { updatedAt: OLD_TIME }],
    ["string creation time", { createdAt: "2026-01-02" }],
    ["string version", { version: "1" }],
    ["zero version", { version: 0 }],
    ["skipped initial version", { version: 2 }],
    ["fractional version", { version: 1.5 }],
    ["missing classification", { classificationId: "missing" }],
    ["inactive classification", { classificationId: "inactive" }],
    ["missing location", { locationId: "missing" }],
    ["inactive location", { locationId: "inactive" }],
    [
      "path traversal classification",
      { classificationId: "../classification-a" },
    ],
    ["path traversal location", { locationId: "a/b" }],
    ["oversized ID", { classificationId: "x".repeat(101) }],
    ["reserved classification ID", { classificationId: "__reserved__" }],
    ["invalid calendar day", { recordDate: "2026-04-31" }],
    ["non-leap day", { recordDate: "2026-02-29" }],
    ["century non-leap", { recordDate: "1900-02-29" }],
    ["invalid month", { recordDate: "2026-13-01" }],
    ["invalid date shape", { recordDate: "2026-1-2" }],
    ["non-string date", { recordDate: 20260102 }],
    ["year zero", { recordDate: "0000-01-01" }],
  ])("denies %s atomically", async (_name, overrides) => {
    await assertFails(commit(dbFor(), record(overrides)));
    await assertNewAbsent();
  });

  it("requires every exact record field", async () => {
    for (const name of Object.keys(record())) {
      const data = record();
      delete data[name];
      await assertFails(
        commit(dbFor(), data, { eventId: "v1", event: { actorUid: "alice" } }),
      );
    }
    await assertNewAbsent();
  });

  it("rejects non-canonical record document IDs", async () => {
    await assertFails(commit(dbFor(), record(), { id: "not.a.safe.id" }));
    await assertFails(commit(dbFor(), record(), { id: "x".repeat(101) }));
  });

  it("accepts maximum text bounds, empty description and Gregorian leap dates", async () => {
    for (const [index, date] of [
      "2024-02-29",
      "2000-02-29",
      "2026-12-31",
    ].entries()) {
      await assertSucceeds(
        commit(
          dbFor(),
          record({
            title: "x".repeat(200),
            referenceNumber: "x".repeat(100),
            description: index ? "" : "x".repeat(2000),
            recordDate: date,
          }),
          { id: `valid-${index}` },
        ),
      );
    }
  });
});

describe("versioned atomic history and terminal archival", () => {
  it("requires history in the same commit and matching canonical version ID", async () => {
    await assertFails(commit(dbFor(), record(), { noHistory: true }));
    await assertFails(commit(dbFor(), record(), { eventId: "v01" }));
    await assertFails(commit(dbFor(), record(), { eventId: "v2" }));
    await assertNewAbsent();
  });

  it("requires every exact history field", async () => {
    const db = dbFor();
    for (const field of ["snapshot", "actorUid", "at"]) {
      const data = record();
      const event: DocumentData = {
        snapshot: data,
        actorUid: "alice",
        at: serverTimestamp(),
      };
      delete event[field];
      const batch = writeBatch(db);
      batch.set(doc(db, path()), data);
      batch.set(doc(db, `${path()}/history/v1`), event);
      await assertFails(batch.commit());
    }
    await assertNewAbsent();
  });

  it.each([
    ["spoofed actor", { actorUid: "admin" }],
    ["forged event timestamp", { at: OLD_TIME }],
    ["extra history field", { admin: true }],
    ["wrong snapshot", { snapshot: record({ title: "Forged snapshot" }) }],
    ["incomplete snapshot", { snapshot: { version: 1 } }],
    ["non-map snapshot", { snapshot: "bad" }],
  ])(
    "rejects %s in accompanying history and rolls back record",
    async (_name, event) => {
      await assertFails(commit(dbFor(), record(), { event }));
      await assertNewAbsent();
    },
  );

  it("rejects orphan, backfilled, extra-version and standalone history events", async () => {
    const db = dbFor();
    await assertFails(
      setDoc(doc(db, `${path("unit-a", "missing")}/history/v1`), {
        snapshot: record(),
        actorUid: "alice",
        at: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, `${path("unit-a", "existing")}/history/v2`), {
        snapshot: edited(),
        actorUid: "alice",
        at: serverTimestamp(),
      }),
    );
    await environment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(
        doc(database(context), `${path("unit-a", "existing")}/history/v1`),
      );
    });
    await assertFails(
      setDoc(doc(db, `${path("unit-a", "existing")}/history/v1`), {
        snapshot: existing(),
        actorUid: "alice",
        at: serverTimestamp(),
      }),
    );
    const batch = writeBatch(db);
    const data = record();
    batch.set(doc(db, path()), data);
    batch.set(doc(db, `${path()}/history/v1`), {
      snapshot: data,
      actorUid: "alice",
      at: serverTimestamp(),
    });
    batch.set(doc(db, `${path()}/history/v2`), {
      snapshot: { ...data, version: 2 },
      actorUid: "alice",
      at: serverTimestamp(),
    });
    await assertFails(batch.commit());
    await assertNewAbsent();
  });

  it("rejects atomic deletion of an old history event alongside an otherwise valid edit", async () => {
    const db = dbFor();
    const data = edited();
    const batch = writeBatch(db);
    batch.set(doc(db, path("unit-a", "existing")), data);
    batch.set(doc(db, `${path("unit-a", "existing")}/history/v2`), {
      snapshot: data,
      actorUid: "alice",
      at: serverTimestamp(),
    });
    batch.delete(doc(db, `${path("unit-a", "existing")}/history/v1`));
    await assertFails(batch.commit());
    expect(
      (await getDoc(doc(db, path("unit-a", "existing")))).data()!.version,
    ).toBe(1);
    expect(
      (
        await getDoc(doc(db, `${path("unit-a", "existing")}/history/v1`))
      ).exists(),
    ).toBe(true);
  });

  it("allows one-version edits with immutable creation metadata and whole matching snapshot", async () => {
    const db = dbFor();
    await assertSucceeds(commit(db, edited(), { id: "existing" }));
    const saved = (await getDoc(doc(db, path("unit-a", "existing")))).data()!;
    const event = (
      await getDoc(doc(db, `${path("unit-a", "existing")}/history/v2`))
    ).data()!;
    expect(saved.createdAt.isEqual(OLD_TIME)).toBe(true);
    expect(saved.version).toBe(2);
    expect(event.snapshot).toEqual(saved);
    await assertFails(commit(db, edited(), { id: "existing" }));
  });

  it.each([
    ["unchanged version", { version: 1 }],
    ["skipped version", { version: 3 }],
    ["creator changed", { createdBy: "admin" }],
    ["creation time changed", { createdAt: serverTimestamp() }],
    ["unit changed", { unitId: "unit-b" }],
    ["actor changed", { updatedBy: "bob" }],
    ["inactive catalogue edit", { classificationId: "inactive" }],
  ])("denies an edit with %s", async (_name, overrides) => {
    await assertFails(commit(dbFor(), edited(overrides), { id: "existing" }));
    expect(
      (await getDoc(doc(dbFor(), path("unit-a", "existing")))).data()!.version,
    ).toBe(1);
  });

  it("rejects updates without new history, history rewrites and deletion for operators/admins", async () => {
    for (const uid of ["alice", "admin"]) {
      const db = dbFor(uid);
      await assertFails(
        commit(db, edited({ updatedBy: uid }), {
          id: "existing",
          noHistory: true,
        }),
      );
      await assertFails(
        updateDoc(doc(db, `${path("unit-a", "existing")}/history/v1`), {
          actorUid: uid,
        }),
      );
      await assertFails(
        deleteDoc(doc(db, `${path("unit-a", "existing")}/history/v1`)),
      );
      await assertFails(deleteDoc(doc(db, path("unit-a", "existing"))));
    }
  });

  it("archives unchanged metadata with reason, then prevents edit/unarchive/delete", async () => {
    const db = dbFor();
    const data = edited({
      title: existing().title,
      status: "archived",
      archiveReason: "Closed synthetic record",
    });
    await assertSucceeds(commit(db, data, { id: "existing" }));
    const stored = (await getDoc(doc(db, path("unit-a", "existing")))).data()!;
    for (const status of ["draft", "active", "archived"]) {
      await assertFails(
        commit(
          db,
          {
            ...stored,
            status,
            archiveReason: status === "archived" ? "Changed reason" : "",
            version: 3,
            updatedAt: serverTimestamp(),
          },
          { id: "existing" },
        ),
      );
    }
    await assertFails(deleteDoc(doc(db, path("unit-a", "existing"))));
  });

  it.each(["", "ab", "   ", "x".repeat(501)])(
    "requires a bounded meaningful archive reason (%j)",
    async (archiveReason) => {
      await assertFails(
        commit(
          dbFor(),
          edited({
            title: existing().title,
            status: "archived",
            archiveReason,
          }),
          { id: "existing" },
        ),
      );
    },
  );

  it("permits archival after catalogue retirement but not metadata changes disguised as archival", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = database(context);
      await updateDoc(
        doc(db, "sparkUnits/unit-a/classifications/classification-a"),
        { active: false },
      );
      await updateDoc(doc(db, "sparkUnits/unit-a/locations/location-a"), {
        active: false,
      });
    });
    await assertFails(commit(dbFor(), edited(), { id: "existing" }));
    await assertFails(
      commit(
        dbFor(),
        edited({
          status: "archived",
          archiveReason: "Disguised metadata edit",
        }),
        { id: "existing" },
      ),
    );
    await assertSucceeds(
      commit(
        dbFor(),
        edited({
          title: existing().title,
          status: "archived",
          archiveReason: "Catalogue retired",
        }),
        { id: "existing" },
      ),
    );
  });

  it("prevents any mutation of seeded archived records and their history", async () => {
    const db = dbFor("admin");
    await assertFails(
      commit(
        db,
        edited({
          updatedBy: "admin",
          status: "archived",
          archiveReason: "Changed",
        }),
        { id: "archived" },
      ),
    );
    await assertFails(deleteDoc(doc(db, path("unit-a", "archived"))));
    await assertFails(
      deleteDoc(doc(db, `${path("unit-a", "archived")}/history/v1`)),
    );
  });
});
