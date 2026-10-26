import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase/firestore";
import {
  ArchivedRecordError,
  DomainValidationError,
  RecordConflictError,
  parseClassification,
  parseHistory,
  parseLocation,
  parseProfile,
  parseRecordRow,
  parseUnit,
  validateActorUid,
  validateArchiveReason,
  validatePathId,
  validateRecordInput,
  validateReferenceFilter,
  type Classification,
  type HistoryEntry,
  type RecordCursor,
  type RecordCreateAttempt,
  type RecordInput,
  type RecordPage,
  type RecordRow,
  type SparkProfile,
  type SparkUnit,
  type StorageLocation,
} from "./domain";

export { ArchivedRecordError, RecordConflictError } from "./domain";
interface CursorState {
  unitId: string;
  referenceNumber?: string;
  snapshot: QueryDocumentSnapshot<DocumentData>;
}
interface CreateAttemptState {
  unitId: string;
  input: Readonly<RecordInput>;
  record: DocumentReference<DocumentData>;
}
export interface RecordListOptions {
  cursor?: RecordCursor | null;
  referenceNumber?: string;
}

/** All edition data is Firestore-only; transactions require a server acknowledgement. */
export class SparkRepository {
  private readonly actorUid: string;
  private readonly cursors = new WeakMap<RecordCursor, CursorState>();
  private readonly createAttempts = new WeakMap<
    RecordCreateAttempt,
    CreateAttemptState
  >();
  constructor(
    private readonly db: Firestore,
    actorUid: string,
  ) {
    this.actorUid = validateActorUid(actorUid);
  }

  /** Retain this token for retries. A new token or page reload is a new draft. */
  createRecordAttempt(unitId: string, value: RecordInput): RecordCreateAttempt {
    const id = validatePathId(unitId, "unitId"),
      input = Object.freeze(validateRecordInput(value)),
      attempt = Object.freeze({}) as RecordCreateAttempt;
    this.createAttempts.set(attempt, {
      unitId: id,
      input,
      record: doc(collection(this.db, "sparkUnits", id, "records")),
    });
    return attempt;
  }

  private sameInput(left: RecordInput, right: Readonly<RecordInput>): boolean {
    return (Object.keys(right) as (keyof RecordInput)[]).every(
      (key) => left[key] === right[key],
    );
  }

  private confirmedCreate(
    state: CreateAttemptState,
    record: DocumentSnapshot<DocumentData>,
    history: DocumentSnapshot<DocumentData>,
  ): boolean {
    if (!record.exists() || !history.exists()) return false;
    const current = parseRecordRow(record.id, record.data(), state.unitId),
      initial = parseHistory(
        "v1", history.data(), state.record.id, state.unitId,
      ).snapshot;
    if (
      record.id !== state.record.id ||
      history.id !== "v1" ||
      initial.version !== 1 ||
      initial.status === "archived" ||
      !this.sameInput(initial as RecordInput, state.input) ||
      initial.createdBy !== this.actorUid ||
      initial.updatedBy !== this.actorUid ||
      !initial.createdAt.isEqual(initial.updatedAt) ||
      current.createdBy !== initial.createdBy ||
      !current.createdAt.isEqual(initial.createdAt)
    )
      return false;
    // A later edit/closure is not overwritten. Its immutable origin still proves
    // this exact draft committed; a v1 current record must match every v1 field.
    return (
      current.version > 1 ||
      (current.status !== "archived" &&
        this.sameInput(current as RecordInput, state.input) &&
        current.updatedBy === this.actorUid &&
        current.updatedAt.isEqual(initial.updatedAt))
    );
  }

  private async reconcileCreateFailure(
    error: unknown,
    state: CreateAttemptState,
  ): Promise<void> {
    // Do not reinterpret validation errors, or accept a locally cached write as
    // proof. Both documents must remain readable from the server under Rules.
    if (
      error instanceof DomainValidationError ||
      error instanceof RecordConflictError ||
      error === null ||
      typeof error !== "object" ||
      !("code" in error)
    )
      throw error;
    try {
      const [record, history] = await Promise.all([
        getDocFromServer(state.record),
        getDocFromServer(doc(state.record, "history", "v1")),
      ]);
      if (this.confirmedCreate(state, record, history)) return;
    } catch {
      // Preserve the original denial/failure when permitted reads cannot prove
      // the complete atomic record/history pair. No retry or replacement ID.
    }
    throw error;
  }

  watchProfile(
    onProfile: (profile: SparkProfile | null) => void,
    onError: (error: Error) => void,
  ): () => void {
    return onSnapshot(
      doc(this.db, "sparkUsers", this.actorUid),
      (snapshot) => {
        try {
          onProfile(snapshot.exists() ? parseProfile(snapshot.data()) : null);
        } catch (error) {
          onProfile(null);
          onError(
            error instanceof Error ? error : new Error("Profil tidak valid."),
          );
        }
      },
      onError,
    );
  }
  async getUnit(unitId: string): Promise<SparkUnit | null> {
    const id = validatePathId(unitId, "unitId");
    const result = await getDocFromServer(doc(this.db, "sparkUnits", id));
    return result.exists() ? parseUnit(result.id, result.data()) : null;
  }
  private async catalogue<T>(
    unitId: string,
    name: "classifications" | "locations",
    parse: (id: string, data: unknown) => T,
  ): Promise<T[]> {
    const id = validatePathId(unitId, "unitId");
    const result: T[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
    // Paginate instead of silently showing only the first 50 catalogue rows.
    // Return up to 1,000 documents; a final one-document probe distinguishes
    // exactly 1,000 from overflow without silently truncating a larger catalogue.
    for (let page = 0; page < 20; page++) {
      const constraints: QueryConstraint[] = [orderBy(documentId()), limit(50)];
      if (cursor) constraints.push(startAfter(cursor));
      const snapshot = await getDocsFromServer(
        query(collection(this.db, "sparkUnits", id, name), ...constraints),
      );
      result.push(...snapshot.docs.map((row) => parse(row.id, row.data())));
      if (snapshot.size < 50) return result;
      cursor = snapshot.docs.at(-1);
    }
    const overflow = await getDocsFromServer(
      query(
        collection(this.db, "sparkUnits", id, name),
        orderBy(documentId()),
        startAfter(cursor!),
        limit(1),
      ),
    );
    if (overflow.empty) return result;
    throw new DomainValidationError(
      name,
      "Katalog melebihi batas pilot 1.000 entri. Hubungi pengelola.",
    );
  }
  listClassifications(unitId: string): Promise<Classification[]> {
    return this.catalogue(unitId, "classifications", parseClassification);
  }
  listLocations(unitId: string): Promise<StorageLocation[]> {
    return this.catalogue(unitId, "locations", parseLocation);
  }

  async listRecords(
    unitId: string,
    options: RecordListOptions = {},
  ): Promise<RecordPage> {
    const id = validatePathId(unitId, "unitId"),
      referenceNumber = validateReferenceFilter(options.referenceNumber);
    const constraints: QueryConstraint[] = [
      orderBy("updatedAt", "desc"),
      orderBy(documentId(), "desc"),
      limit(26),
    ];
    if (referenceNumber)
      constraints.push(where("referenceNumber", "==", referenceNumber));
    if (options.cursor) {
      const state = this.cursors.get(options.cursor);
      if (
        !state ||
        state.unitId !== id ||
        state.referenceNumber !== referenceNumber
      ) {
        throw new DomainValidationError(
          "cursor",
          "Halaman harus diulang setelah pengguna, unit, atau pencarian berubah.",
        );
      }
      constraints.push(startAfter(state.snapshot));
    }
    const snapshot = await getDocsFromServer(
      query(collection(this.db, "sparkUnits", id, "records"), ...constraints),
    );
    const selected = snapshot.docs.slice(0, 25),
      hasMore = snapshot.size > 25;
    let cursor: RecordCursor | null = null;
    if (hasMore && selected.length) {
      cursor = Object.freeze({}) as RecordCursor;
      this.cursors.set(cursor, {
        unitId: id,
        referenceNumber,
        snapshot: selected.at(-1)!,
      });
    }
    return {
      records: selected.map((row) => parseRecordRow(row.id, row.data(), id)),
      cursor,
      hasMore,
    };
  }
  private async requireActiveCatalogues(
    transaction: Transaction,
    unitId: string,
    input: RecordInput,
  ): Promise<void> {
    const classification = await transaction.get(
      doc(
        this.db,
        "sparkUnits",
        unitId,
        "classifications",
        input.classificationId,
      ),
    );
    const location = await transaction.get(
      doc(this.db, "sparkUnits", unitId, "locations", input.locationId),
    );
    if (
      !classification.exists() ||
      !parseClassification(classification.id, classification.data()).active
    ) {
      throw new DomainValidationError(
        "classificationId",
        "Klasifikasi tidak ditemukan atau tidak aktif.",
      );
    }
    if (
      !location.exists() ||
      !parseLocation(location.id, location.data()).active
    ) {
      throw new DomainValidationError(
        "locationId",
        "Lokasi fisik tidak ditemukan atau tidak aktif.",
      );
    }
  }
  private async rethrowWriteFailure(
    error: unknown,
    record: DocumentReference<DocumentData>,
    unitId: string,
    expectedVersion?: number,
  ): Promise<never> {
    if (
      expectedVersion !== undefined &&
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "permission-denied"
    ) {
      // Rules can reject the losing transaction's immutable history collision
      // before the SDK retries its optimistic precondition. Never retry a write
      // or reinterpret an authorization failure without a permitted server read.
      let conflict = false;
      try {
        const current = await getDocFromServer(record);
        conflict =
          !current.exists() ||
          parseRecordRow(current.id, current.data(), unitId).version !==
            expectedVersion;
      } catch {
        /* Unreadable/malformed data must preserve the original denial. */
      }
      if (conflict) throw new RecordConflictError();
    }
    throw error;
  }
  async saveRecord(
    unitId: string,
    value: RecordInput,
    existing?: RecordRow,
    createAttempt?: RecordCreateAttempt,
  ): Promise<string> {
    const id = validatePathId(unitId, "unitId"),
      input = validateRecordInput(value);
    if (existing && createAttempt !== undefined)
      throw new DomainValidationError(
        "createAttempt", "Draf baru tidak dapat dipakai untuk menyunting rekaman.",
      );
    let attempt: CreateAttemptState | undefined;
    if (!existing) {
      const token = createAttempt === undefined
        ? this.createRecordAttempt(id, input)
        : createAttempt;
      attempt = this.createAttempts.get(token);
      if (
        !attempt || attempt.unitId !== id ||
        !this.sameInput(input, attempt.input)
      )
        throw new DomainValidationError(
          "createAttempt",
          "Percobaan ulang harus memakai draf, pengguna, unit, dan isi awal yang sama. Periksa penyimpanan awal sebelum mengganti isi draf.",
        );
    }
    if (existing && existing.unitId !== id)
      throw new DomainValidationError("unitId", "Unit rekaman tidak sesuai.");
    if (
      existing &&
      (!Number.isSafeInteger(existing.version) || existing.version < 1)
    )
      throw new DomainValidationError("version", "Versi rekaman tidak valid.");
    const record = existing
      ? doc(
          this.db,
          "sparkUnits",
          id,
          "records",
          validatePathId(existing.id, "recordId"),
        )
      : attempt!.record;
    await runTransaction(this.db, async (transaction) => {
      let current: RecordRow | undefined;
      if (existing) {
        const snapshot = await transaction.get(record);
        if (!snapshot.exists()) throw new RecordConflictError();
        current = parseRecordRow(snapshot.id, snapshot.data(), id);
        if (current.version !== existing.version)
          throw new RecordConflictError();
        if (current.status === "archived") throw new ArchivedRecordError();
      } else {
        const [created, history] = await Promise.all([
          transaction.get(record),
          transaction.get(doc(record, "history", "v1")),
        ]);
        if (created.exists() || history.exists()) {
          if (this.confirmedCreate(attempt!, created, history)) return;
          throw new RecordConflictError();
        }
      }
      await this.requireActiveCatalogues(transaction, id, input);
      const version = current ? current.version + 1 : 1;
      const next = {
        ...input,
        unitId: id,
        createdBy: current?.createdBy ?? this.actorUid,
        createdAt: current?.createdAt ?? serverTimestamp(),
        updatedBy: this.actorUid,
        updatedAt: serverTimestamp(),
        version,
      };
      transaction.set(record, next);
      transaction.set(doc(record, "history", `v${version}`), {
        snapshot: next,
        actorUid: this.actorUid,
        at: serverTimestamp(),
      });
    }).catch((error) =>
      attempt
        ? this.reconcileCreateFailure(error, attempt)
        : this.rethrowWriteFailure(error, record, id, existing?.version),
    );
    return record.id;
  }
  async archiveRecord(
    unitId: string,
    existing: RecordRow,
    value: string,
  ): Promise<void> {
    const id = validatePathId(unitId, "unitId"),
      reason = validateArchiveReason(value);
    if (existing.unitId !== id)
      throw new DomainValidationError("unitId", "Unit rekaman tidak sesuai.");
    if (!Number.isSafeInteger(existing.version) || existing.version < 1)
      throw new DomainValidationError("version", "Versi rekaman tidak valid.");
    const record = doc(
      this.db,
      "sparkUnits",
      id,
      "records",
      validatePathId(existing.id, "recordId"),
    );
    await runTransaction(this.db, async (transaction) => {
      const snapshot = await transaction.get(record);
      if (!snapshot.exists()) throw new RecordConflictError();
      const current = parseRecordRow(snapshot.id, snapshot.data(), id);
      if (current.version !== existing.version) throw new RecordConflictError();
      if (current.status === "archived") throw new ArchivedRecordError();
      const { id: _documentId, ...fields } = current;
      const next = {
        ...fields,
        status: "archived",
        archiveReason: reason,
        updatedBy: this.actorUid,
        updatedAt: serverTimestamp(),
        version: current.version + 1,
      };
      // Closing a record preserves metadata even if a catalogue was later disabled.
      transaction.set(record, next);
      transaction.set(doc(record, "history", `v${next.version}`), {
        snapshot: next,
        actorUid: this.actorUid,
        at: serverTimestamp(),
      });
    }).catch((error) =>
      this.rethrowWriteFailure(error, record, id, existing.version),
    );
  }
  async listHistory(unitId: string, recordId: string): Promise<HistoryEntry[]> {
    const unit = validatePathId(unitId, "unitId"),
      record = validatePathId(recordId, "recordId");
    const snapshot = await getDocsFromServer(
      query(
        collection(this.db, "sparkUnits", unit, "records", record, "history"),
        orderBy("snapshot.version", "desc"),
        limit(25),
      ),
    );
    return snapshot.docs.map((row) =>
      parseHistory(row.id, row.data(), record, unit),
    );
  }
}
