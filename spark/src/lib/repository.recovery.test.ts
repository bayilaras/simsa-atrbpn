import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type DocumentData, type Firestore } from "firebase/firestore";
import { SparkRepository } from "./repository";
import { DomainValidationError, RecordConflictError, parseRecordRow, type RecordCreateAttempt, type RecordInput } from "./domain";

const transport = vi.hoisted(() => ({
  documents: new Map<string, DocumentData>(),
  ids: 0,
  writes: 0,
  transactions: 0,
  reads: 0,
  afterCommit: null as Error | null,
  beforeTransaction: null as Error | null,
  readFailure: null as Error | null,
}));
type Reference = { path: string; id: string };
vi.mock("firebase/firestore", async (importOriginal) => {
  const original = await importOriginal<typeof import("firebase/firestore")>();
  const snapshot = (reference: Reference) => ({
    id: reference.id,
    exists: () => transport.documents.has(reference.path),
    data: () => transport.documents.get(reference.path),
  });
  return {
    ...original,
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
    doc: (base: { path?: string }, ...segments: string[]) => {
      const path = segments.length
        ? `${base.path ? `${base.path}/` : ""}${segments.join("/")}`
        : `${base.path}/auto-${++transport.ids}`;
      return { path, id: path.split("/").at(-1)! };
    },
    serverTimestamp: () => original.Timestamp.fromMillis(1780000000000),
    getDocFromServer: async (reference: Reference) => {
      transport.reads++;
      if (transport.readFailure) throw transport.readFailure;
      return snapshot(reference);
    },
    runTransaction: async (_db: unknown, operation: (transaction: unknown) => Promise<void>) => {
      transport.transactions++;
      if (transport.beforeTransaction) throw transport.beforeTransaction;
      const pending: [string, DocumentData][] = [];
      await operation({
        get: async (reference: Reference) => snapshot(reference),
        set: (reference: Reference, value: DocumentData) => pending.push([reference.path, value]),
      });
      for (const [path, value] of pending) transport.documents.set(path, value);
      transport.writes += pending.length;
      if (transport.afterCommit && pending.length) {
        const error = transport.afterCommit;
        transport.afterCommit = null;
        throw error;
      }
    },
  };
});

const unit = "unit-a", actor = "operator-a", root = `sparkUnits/${unit}/records`;
const input: RecordInput = {
  title: "Synthetic lost acknowledgement",
  referenceNumber: "SYN-ACK",
  recordDate: "2026-09-07",
  classificationId: "class-1",
  locationId: "rack-1",
  description: "",
  archiveReason: "",
  status: "draft",
};
const failure = (code: string) => Object.assign(new Error(`Synthetic ${code}`), { code });
const repository = () => new SparkRepository({} as Firestore, actor);
const recordPaths = () => [...transport.documents.keys()].filter((path) => path.startsWith(`${root}/`) && !path.includes("/history/"));
beforeEach(() => {
  transport.documents.clear();
  transport.ids = transport.writes = transport.transactions = transport.reads = 0;
  transport.afterCommit = transport.beforeTransaction = transport.readFailure = null;
  transport.documents.set(`sparkUnits/${unit}/classifications/class-1`, { code: "SYN", name: "Synthetic", active: true });
  transport.documents.set(`sparkUnits/${unit}/locations/rack-1`, { name: "Synthetic rack", description: "", active: true });
});

describe("new-record recovery with a stable, repository-owned create attempt", () => {
  it("retries an unacknowledged committed create without creating another ID or history", async () => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input), unavailable = failure("unavailable");
    transport.afterCommit = unavailable;
    transport.readFailure = failure("unavailable");
    await expect(repo.saveRecord(unit, input, undefined, attempt)).rejects.toBe(unavailable);
    expect(recordPaths()).toEqual([`${root}/auto-1`]);
    transport.readFailure = null;
    await expect(repo.saveRecord(unit, input, undefined, attempt)).resolves.toBe("auto-1");
    expect(recordPaths()).toEqual([`${root}/auto-1`]);
    expect(transport.ids).toBe(1);
    expect(transport.writes).toBe(2);
    expect([...transport.documents.keys()].filter((path) => path.includes("/history/"))).toEqual([`${root}/auto-1/history/v1`]);
  });

  it("can reconcile a lost acknowledgement immediately using both permitted server reads", async () => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input);
    transport.afterCommit = failure("unavailable");
    await expect(repo.saveRecord(unit, input, undefined, attempt)).resolves.toBe("auto-1");
    expect(transport.reads).toBe(2);
    expect(transport.writes).toBe(2);
  });

  it.each(["active", "archived"] as const)("does not overwrite a subsequently %s record when replaying its creation", async (status) => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input);
    await repo.saveRecord(unit, input, undefined, attempt);
    const path = `${root}/auto-1`, original = transport.documents.get(path)!;
    const later = {
      ...original,
      ...(status === "active" ? { title: "Updated by another operator" } : {}),
      status,
      archiveReason: status === "archived" ? "Synthetic closure." : "",
      version: 2,
      updatedBy: "operator-b",
      updatedAt: Timestamp.fromMillis(original.createdAt.toMillis() + 1000),
    };
    transport.documents.set(path, later);
    transport.documents.set(`${path}/history/v2`, { snapshot: later, actorUid: later.updatedBy, at: later.updatedAt });
    await expect(repo.saveRecord(unit, input, undefined, attempt)).resolves.toBe("auto-1");
    expect(transport.documents.get(path)).toBe(later);
    expect(transport.writes).toBe(2);
    expect(recordPaths()).toHaveLength(1);
  });

  it("binds attempts to normalized original input, unit and repository before any request", async () => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, { ...input, title: ` ${input.title} ` });
    for (const operation of [
      () => repo.saveRecord(unit, { ...input, title: "Changed after uncertain save" }, undefined, attempt),
      () => repo.saveRecord("unit-b", input, undefined, attempt),
      () => repository().saveRecord(unit, input, undefined, attempt),
      () => new SparkRepository({} as Firestore, "another-operator").saveRecord(unit, input, undefined, attempt),
      () => repo.saveRecord(unit, input, undefined, {} as RecordCreateAttempt),
      () => repo.saveRecord(unit, input, undefined, null as unknown as RecordCreateAttempt),
      () => repo.saveRecord(unit, input, undefined, "serialized-token" as unknown as RecordCreateAttempt),
      () => repo.saveRecord(unit, input, undefined, 0 as unknown as RecordCreateAttempt),
    ]) await expect(operation()).rejects.toBeInstanceOf(DomainValidationError);
    expect(transport.transactions).toBe(0);
    expect(transport.reads).toBe(0);
    expect(transport.writes).toBe(0);
    expect(transport.ids).toBe(1);
    await expect(repo.saveRecord(unit, input, undefined, attempt)).resolves.toBe("auto-1");
  });

  it("rejects combining a new-draft token with an existing-record edit before any request", async () => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input);
    const at = Timestamp.fromMillis(1780000000000);
    const existing = parseRecordRow("existing-record", {
      ...input, unitId: unit, createdBy: actor, updatedBy: actor,
      createdAt: at, updatedAt: at, version: 1,
    });
    await expect(repo.saveRecord(unit, input, existing, attempt)).rejects.toBeInstanceOf(DomainValidationError);
    await expect(repo.saveRecord(unit, input, existing, null as unknown as RecordCreateAttempt)).rejects.toBeInstanceOf(DomainValidationError);
    expect(transport.transactions).toBe(0);
    expect(transport.reads).toBe(0);
    expect(transport.writes).toBe(0);
  });

  it("keeps two intentional drafts distinct even when every metadata field is equal", async () => {
    const repo = repository(), first = repo.createRecordAttempt(unit, input), second = repo.createRecordAttempt(unit, input);
    await repo.saveRecord(unit, input, undefined, first);
    await repo.saveRecord(unit, input, undefined, second);
    expect(recordPaths()).toEqual([`${root}/auto-1`, `${root}/auto-2`]);
  });

  it.each(["record", "history", "creator", "payload", "createdAt", "v1-current", "malformed", "history-identity"])("rejects inconsistent existing %s state without overwriting it", async (variant) => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input);
    await repo.saveRecord(unit, input, undefined, attempt);
    const path = `${root}/auto-1`, row = transport.documents.get(path)!, history = transport.documents.get(`${path}/history/v1`)!;
    if (variant === "record") transport.documents.delete(path);
    if (variant === "history") transport.documents.delete(`${path}/history/v1`);
    if (variant === "creator") transport.documents.set(path, { ...row, createdBy: "other-actor" });
    if (variant === "payload") transport.documents.set(`${path}/history/v1`, { ...history, snapshot: { ...history.snapshot, title: "Another original payload" } });
    if (variant === "createdAt") transport.documents.set(path, { ...row, createdAt: Timestamp.fromMillis(row.createdAt.toMillis() - 1000) });
    if (variant === "v1-current") transport.documents.set(path, { ...row, title: "Changed without increment" });
    if (variant === "malformed") transport.documents.set(path, { ...row, version: 0 });
    if (variant === "history-identity") transport.documents.set(`${path}/history/v1`, { ...history, actorUid: "other-actor" });
    await expect(repo.saveRecord(unit, input, undefined, attempt)).rejects.toBeInstanceOf(Error);
    expect(transport.writes).toBe(2);
    expect(transport.ids).toBe(1);
  });

  it.each(["permission-denied", "unavailable"])("retains the original failure when server reads fail with %s", async (code) => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input), original = failure("permission-denied");
    transport.afterCommit = original;
    transport.readFailure = failure(code);
    await expect(repo.saveRecord(unit, input, undefined, attempt)).rejects.toBe(original);
    expect(transport.writes).toBe(2);
  });

  it.each(["missing-history", "malformed-history", "other-creator", "wrong-input"])("does not soften a permission failure with %s", async (variant) => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input);
    await repo.saveRecord(unit, input, undefined, attempt);
    const path = `${root}/auto-1`, history = transport.documents.get(`${path}/history/v1`)!;
    if (variant === "missing-history") transport.documents.delete(`${path}/history/v1`);
    if (variant === "malformed-history") transport.documents.set(`${path}/history/v1`, { invalid: true });
    if (variant === "other-creator") transport.documents.set(`${path}/history/v1`, { ...history, actorUid: "other-actor", snapshot: { ...history.snapshot, createdBy: "other-actor", updatedBy: "other-actor" } });
    if (variant === "wrong-input") transport.documents.set(`${path}/history/v1`, { ...history, snapshot: { ...history.snapshot, title: "Other draft" } });
    const original = failure("permission-denied");
    transport.beforeTransaction = original;
    await expect(repo.saveRecord(unit, input, undefined, attempt)).rejects.toBe(original);
    expect(transport.writes).toBe(2);
  });

  it("does not replace a validation conflict with an unnecessary reconciliation read", async () => {
    const repo = repository(), attempt = repo.createRecordAttempt(unit, input);
    await repo.saveRecord(unit, input, undefined, attempt);
    transport.documents.delete(`${root}/auto-1/history/v1`);
    await expect(repo.saveRecord(unit, input, undefined, attempt)).rejects.toBeInstanceOf(RecordConflictError);
    expect(transport.reads).toBe(0);
  });
});
