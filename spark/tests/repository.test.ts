import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { SparkRepository } from "../src/lib/repository";
import {
  ArchivedRecordError,
  DomainValidationError,
  RecordConflictError,
  type RecordInput,
  type SparkProfile,
} from "../src/lib/domain";

const projectId = "demo-simsa-spark",
  unit = "repo-unit-a",
  uid = "repo-operator";
const input: RecordInput = {
  title: "Contoh sintetis",
  referenceNumber: "REF-001",
  recordDate: "2026-09-06",
  classificationId: "class-1",
  locationId: "rack-1",
  description: "",
  archiveReason: "",
  status: "draft",
};
let environment: RulesTestEnvironment;
const asDb = (value: unknown) => value as Firestore;
function client(actor = uid, verified = true) {
  const db = asDb(
    environment
      .authenticatedContext(actor, {
        email_verified: verified,
        email: `${actor}@example.test`,
      })
      .firestore(),
  );
  return { db, repo: new SparkRepository(db, actor) };
}
async function privileged(operation: (db: Firestore) => Promise<void>) {
  await environment.withSecurityRulesDisabled(async (context) =>
    operation(asDb(context.firestore())),
  );
}
async function seedRecords(count: number, reference = "BULK") {
  await privileged(async (db) => {
    const batch = writeBatch(db);
    for (let index = 0; index < count; index++) {
      const at = Timestamp.fromMillis(1780000000000 + index * 1000);
      const row = {
        ...input,
        title: `Synthetic ${index}`,
        referenceNumber: reference,
        unitId: unit,
        createdBy: uid,
        updatedBy: uid,
        createdAt: at,
        updatedAt: at,
        version: 1,
      };
      const record = doc(
        db,
        "sparkUnits",
        unit,
        "records",
        `fixture-${String(index).padStart(3, "0")}`,
      );
      batch.set(record, row);
      batch.set(doc(record, "history", "v1"), {
        snapshot: row,
        actorUid: uid,
        at,
      });
    }
    await batch.commit();
  });
}

beforeAll(async () => {
  if (
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8088" ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  )
    throw new Error(
      "Repository tests require only the exact local Firestore emulator.",
    );
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8088,
      rules: readFileSync(
        new URL("../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await privileged(async (db) => {
    const batch = writeBatch(db);
    for (const [actor, role, active, unitId] of [
      [uid, "operator", true, unit],
      ["repo-viewer", "viewer", true, unit],
      ["repo-inactive", "operator", false, unit],
      ["repo-other", "operator", true, "repo-unit-b"],
    ] as const) {
      batch.set(doc(db, "sparkUsers", actor), {
        displayName: actor,
        role,
        active,
        unitId,
      });
    }
    for (const unitId of [unit, "repo-unit-b"]) {
      batch.set(doc(db, "sparkUnits", unitId), { name: `Synthetic ${unitId}` });
      batch.set(doc(db, "sparkUnits", unitId, "classifications", "class-1"), {
        code: "DEMO.1",
        name: "Umum",
        active: true,
      });
      batch.set(doc(db, "sparkUnits", unitId, "locations", "rack-1"), {
        name: "Rak A",
        description: "",
        active: true,
      });
    }
    await batch.commit();
  });
});
afterAll(async () => {
  await environment?.cleanup();
});

describe("Firestore-only Spark repository against enforced emulator rules", () => {
  it("loads only own profile/unit/catalogues, with missing profile reported as null", async () => {
    const { repo } = client();
    const profile = await new Promise<SparkProfile | null>(
      (resolve, reject) => {
        let stop: (() => void) | undefined;
        stop = repo.watchProfile((value) => {
          stop?.();
          resolve(value);
        }, reject);
      },
    );
    expect(profile?.role).toBe("operator");
    expect((await repo.getUnit(unit))?.name).toContain(unit);
    expect((await repo.listClassifications(unit))[0]?.id).toBe("class-1");
    expect((await repo.listLocations(unit))[0]?.id).toBe("rack-1");
    await expect(repo.getUnit("repo-unit-b")).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(repo.listClassifications("repo-unit-b")).rejects.toMatchObject(
      { code: "permission-denied" },
    );
    const missing = client("repo-unprovisioned").repo;
    expect(
      await new Promise((resolve) => {
        const stop = missing.watchProfile((value) => {
          stop();
          resolve(value);
        }, resolve);
      }),
    ).toBeNull();
  });
  it("creates then edits atomically, preserving creator and server times with complete immutable snapshots", async () => {
    const { db, repo } = client();
    const id = await repo.saveRecord(unit, input);
    const created = (await repo.listRecords(unit)).records[0]!;
    expect(created.id).toBe(id);
    expect(created.version).toBe(1);
    expect(created.createdBy).toBe(uid);
    expect(created.createdAt.isEqual(created.updatedAt)).toBe(true);
    await repo.saveRecord(
      unit,
      { ...input, title: "Perbaikan metadata", status: "active" },
      created,
    );
    const history = await repo.listHistory(unit, id);
    expect(history.map((event) => event.snapshot.version)).toEqual([2, 1]);
    expect(history[0]!.snapshot.createdAt.isEqual(created.createdAt)).toBe(
      true,
    );
    const recordDoc = await getDoc(doc(db, "sparkUnits", unit, "records", id));
    const historyDoc = await getDoc(
      doc(db, "sparkUnits", unit, "records", id, "history", "v2"),
    );
    expect(historyDoc.data()?.snapshot).toEqual(recordDoc.data());
    await expect(
      updateDoc(doc(db, "sparkUnits", unit, "records", id, "history", "v1"), {
        actorUid: "forged",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("rejects stale edits and preserves the winning concurrent transaction", async () => {
    const { repo } = client();
    const id = await repo.saveRecord(unit, input),
      existing = (await repo.listRecords(unit)).records[0]!;
    const outcomes = await Promise.allSettled([
      repo.saveRecord(unit, { ...input, title: "Writer A" }, existing),
      client().repo.saveRecord(unit, { ...input, title: "Writer B" }, existing),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      RecordConflictError,
    );
    expect(
      (await repo.listHistory(unit, id)).map((event) => event.snapshot.version),
    ).toEqual([2, 1]);
    await expect(
      repo.archiveRecord(unit, existing, "Tidak boleh menimpa versi baru."),
    ).rejects.toBeInstanceOf(RecordConflictError);
  });
  it("requires active catalogues for create/edit but permits immutable closing after catalogue retirement", async () => {
    const { repo } = client();
    const id = await repo.saveRecord(unit, input),
      existing = (await repo.listRecords(unit)).records[0]!;
    await privileged(async (db) => {
      await updateDoc(
        doc(db, "sparkUnits", unit, "classifications", "class-1"),
        { active: false },
      );
    });
    await expect(repo.saveRecord(unit, input)).rejects.toBeInstanceOf(
      DomainValidationError,
    );
    await expect(
      repo.saveRecord(unit, { ...input, title: "Changed" }, existing),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await repo.archiveRecord(unit, existing, "Pekerjaan telah selesai.");
    const archived = (await repo.listRecords(unit)).records[0]!;
    expect(archived.status).toBe("archived");
    expect(archived.title).toBe(existing.title);
    expect((await repo.listHistory(unit, id))[0]!.snapshot.archiveReason).toBe(
      "Pekerjaan telah selesai.",
    );
    await expect(
      repo.archiveRecord(unit, archived, "Tidak dapat diulang."),
    ).rejects.toBeInstanceOf(ArchivedRecordError);
    await expect(repo.saveRecord(unit, input, archived)).rejects.toBeInstanceOf(
      ArchivedRecordError,
    );
  });
  it("supports full-unit exact-reference search, stable 25-row pagination and context-bound cursors", async () => {
    await seedRecords(53);
    const { repo } = client();
    const first = await repo.listRecords(unit, { referenceNumber: "BULK" });
    expect(first.records).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    const second = await repo.listRecords(unit, {
      referenceNumber: "BULK",
      cursor: first.cursor,
    });
    const third = await repo.listRecords(unit, {
      referenceNumber: "BULK",
      cursor: second.cursor,
    });
    expect(second.records).toHaveLength(25);
    expect(third.records).toHaveLength(3);
    expect(third.hasMore).toBe(false);
    expect(
      new Set(
        [...first.records, ...second.records, ...third.records].map(
          (row) => row.id,
        ),
      ).size,
    ).toBe(53);
    expect(
      (await repo.listRecords(unit, { referenceNumber: "BUL" })).records,
    ).toHaveLength(0);
    await expect(
      repo.listRecords(unit, {
        cursor: first.cursor,
        referenceNumber: "other",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      repo.listRecords("repo-unit-b", {
        cursor: first.cursor,
        referenceNumber: "BULK",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      client("repo-viewer").repo.listRecords(unit, {
        cursor: first.cursor,
        referenceNumber: "BULK",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });
  it("reads beyond the first catalogue page without cross-unit or unbounded queries", async () => {
    await privileged(async (db) => {
      const batch = writeBatch(db);
      for (let index = 0; index < 51; index++)
        batch.set(
          doc(db, "sparkUnits", unit, "classifications", `extra-${index}`),
          { code: `EX.${index}`, name: `Synthetic ${index}`, active: true },
        );
      await batch.commit();
    });
    expect(await client().repo.listClassifications(unit)).toHaveLength(52);
  });
  it("accepts exactly 1000 catalogue entries and explicitly rejects overflow", async () => {
    await privileged(async (db) => {
      for (let start = 0; start < 999; start += 250) {
        const batch = writeBatch(db);
        for (let index = start; index < Math.min(start + 250, 999); index++) {
          batch.set(
            doc(
              db,
              "sparkUnits",
              unit,
              "classifications",
              `boundary-${String(index).padStart(4, "0")}`,
            ),
            {
              code: `BOUND.${index}`,
              name: `Synthetic ${index}`,
              active: true,
            },
          );
        }
        await batch.commit();
      }
    });
    const { repo } = client();
    expect(await repo.listClassifications(unit)).toHaveLength(1000);
    await privileged(async (db) => {
      await setDoc(doc(db, "sparkUnits", unit, "classifications", "overflow"), {
        code: "OVER",
        name: "Synthetic overflow",
        active: true,
      });
    });
    await expect(repo.listClassifications(unit)).rejects.toBeInstanceOf(
      DomainValidationError,
    );
  }, 30000);
  it("blocks viewer/inactive/unverified/cross-unit writes and unknown payload fields", async () => {
    await expect(
      client("repo-viewer").repo.saveRecord(unit, input),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      client("repo-inactive").repo.listRecords(unit),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      client(uid, false).repo.saveRecord(unit, input),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      client("repo-other").repo.saveRecord(unit, input),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      client().repo.saveRecord(unit, {
        ...input,
        fileUrl: "fake",
      } as RecordInput),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect((await client().repo.listRecords(unit)).records).toHaveLength(0);
    await client().repo.saveRecord(unit, input);
    const existing = (await client("repo-viewer").repo.listRecords(unit))
      .records[0]!;
    await expect(
      client("repo-viewer").repo.saveRecord(unit, input, existing),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      client("repo-viewer").repo.archiveRecord(
        unit,
        existing,
        "Tidak memiliki hak tulis.",
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(await client().repo.listHistory(unit, existing.id)).toHaveLength(1);
  });
  it("limits history to the latest 25 complete snapshots", async () => {
    await privileged(async (db) => {
      const batch = writeBatch(db),
        record = doc(db, "sparkUnits", unit, "records", "history-fixture");
      const createdAt = Timestamp.fromMillis(1780000000000);
      for (let version = 1; version <= 30; version++) {
        const at = Timestamp.fromMillis(createdAt.toMillis() + version * 1000);
        const row = {
          ...input,
          unitId: unit,
          createdBy: uid,
          createdAt,
          updatedBy: uid,
          updatedAt: at,
          version,
        };
        batch.set(doc(record, "history", `v${version}`), {
          snapshot: row,
          actorUid: uid,
          at,
        });
        if (version === 30) batch.set(record, row);
      }
      await batch.commit();
    });
    const history = await client().repo.listHistory(unit, "history-fixture");
    expect(history).toHaveLength(25);
    expect(history[0]!.snapshot.version).toBe(30);
    expect(history.at(-1)!.snapshot.version).toBe(6);
  });
});
