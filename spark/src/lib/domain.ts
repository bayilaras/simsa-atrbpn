import { Timestamp } from "firebase/firestore";

export type SparkRole = "operator" | "viewer" | "admin";
export interface SparkProfile {
  displayName: string;
  unitId: string;
  role: SparkRole;
  active: boolean;
}
export interface SparkUnit {
  id: string;
  name: string;
}
export interface Classification {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
export interface StorageLocation {
  id: string;
  name: string;
  description: string;
  active: boolean;
}
export interface RecordInput {
  title: string;
  referenceNumber: string;
  recordDate: string;
  classificationId: string;
  locationId: string;
  description: string;
  archiveReason: "";
  status: "draft" | "active";
}
export interface RecordRow
  extends Omit<RecordInput, "status" | "archiveReason"> {
  id: string;
  status: "draft" | "active" | "archived";
  archiveReason: string;
  unitId: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  version: number;
}
declare const cursorBrand: unique symbol;
/** Opaque, repository-owned cursor. Never serialize or reuse across unit/auth/filter changes. */
export interface RecordCursor {
  readonly [cursorBrand]: true;
}
export interface RecordPage {
  records: RecordRow[];
  cursor: RecordCursor | null;
  hasMore: boolean;
}
export interface HistoryEntry {
  id: string;
  snapshot: RecordRow;
  actorUid: string;
  at: Timestamp;
}

export class DomainValidationError extends Error {
  readonly code = "validation-error";
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainValidationError";
  }
}
export class RecordConflictError extends Error {
  readonly code = "record-conflict";
  constructor() {
    super("Data sudah berubah. Muat ulang rekaman sebelum menyimpan lagi.");
    this.name = "RecordConflictError";
  }
}
export class ArchivedRecordError extends Error {
  readonly code = "record-archived";
  constructor() {
    super("Rekaman yang sudah diarsipkan tidak dapat diubah.");
    this.name = "ArchivedRecordError";
  }
}

const editableKeys = [
  "title",
  "referenceNumber",
  "recordDate",
  "classificationId",
  "locationId",
  "description",
  "archiveReason",
  "status",
];
const recordKeys = [
  ...editableKeys,
  "unitId",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updatedAt",
  "version",
];

function fail(field: string, message: string): never {
  throw new DomainValidationError(field, message);
}
function object(
  value: unknown,
  keys: readonly string[],
  field = "record",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(field, "Format data tidak valid.");
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(candidate, key))
  ) {
    fail(
      field,
      "Data memuat kolom yang tidak dikenal atau kolom wajib belum lengkap.",
    );
  }
  return candidate;
}
function text(
  value: unknown,
  field: string,
  min: number,
  max: number,
  multiline = false,
  trim = true,
): string {
  if (typeof value !== "string") fail(field, `${field} harus berupa teks.`);
  const result = trim ? value.trim() : value;
  if (
    result.length < min ||
    result.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result) ||
    (!multiline && /[\r\n\t]/.test(result))
  )
    fail(field, `${field} harus berisi ${min}–${max} karakter yang valid.`);
  return result;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field, `${field} tidak valid.`);
  return value;
}
export function validatePathId(
  value: unknown,
  field = "id",
  maximum = 100,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    /^__.*__$/.test(value)
  )
    fail(field, `${field} tidak valid.`);
  return value;
}
export function validateActorUid(value: unknown): string {
  return validatePathId(value, "uid", 128);
}
export function validateRecordDate(value: unknown): string {
  const result = text(value, "recordDate", 10, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!match)
    fail("recordDate", "Tanggal harus menggunakan format YYYY-MM-DD.");
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]!
  ) {
    fail("recordDate", "Tanggal kalender tidak valid.");
  }
  return result;
}
export function validateReferenceFilter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const result = text(value, "referenceNumber", 0, 100);
  return result || undefined;
}
export function validateArchiveReason(value: unknown): string {
  return text(value, "archiveReason", 3, 500, true);
}

export function validateRecordInput(value: unknown): RecordInput {
  const input = object(value, editableKeys);
  if (input.status !== "draft" && input.status !== "active")
    fail("status", "Status baru harus draft atau active.");
  if (input.archiveReason !== "")
    fail(
      "archiveReason",
      "Alasan arsip harus kosong untuk rekaman yang belum diarsipkan.",
    );
  return {
    title: text(input.title, "title", 1, 200),
    referenceNumber: text(input.referenceNumber, "referenceNumber", 1, 100),
    recordDate: validateRecordDate(input.recordDate),
    classificationId: validatePathId(
      input.classificationId,
      "classificationId",
    ),
    locationId: validatePathId(input.locationId, "locationId"),
    description: text(input.description, "description", 0, 2000, true),
    archiveReason: "",
    status: input.status,
  };
}
function timestamp(value: unknown, field: string): Timestamp {
  if (!(value instanceof Timestamp))
    fail(field, "Waktu server belum tersedia atau tidak valid.");
  return value;
}
export function parseProfile(value: unknown): SparkProfile {
  const item = object(
    value,
    ["displayName", "unitId", "role", "active"],
    "profile",
  );
  if (
    typeof item.role !== "string" ||
    !["operator", "viewer", "admin"].includes(item.role)
  )
    fail("role", "Peran pengguna tidak dikenal.");
  return {
    displayName: text(item.displayName, "displayName", 1, 200),
    unitId: validatePathId(item.unitId, "unitId"),
    role: item.role as SparkRole,
    active: boolean(item.active, "active"),
  };
}
export function parseUnit(id: string, value: unknown): SparkUnit {
  const item = object(value, ["name"], "unit");
  return {
    id: validatePathId(id, "unitId"),
    name: text(item.name, "name", 1, 200),
  };
}
export function parseClassification(
  id: string,
  value: unknown,
): Classification {
  const item = object(value, ["code", "name", "active"], "classification");
  return {
    id: validatePathId(id),
    code: text(item.code, "code", 1, 100),
    name: text(item.name, "name", 1, 200),
    active: boolean(item.active, "active"),
  };
}
export function parseLocation(id: string, value: unknown): StorageLocation {
  const item = object(value, ["name", "description", "active"], "location");
  return {
    id: validatePathId(id),
    name: text(item.name, "name", 1, 200),
    description: text(item.description, "description", 0, 2000, true),
    active: boolean(item.active, "active"),
  };
}
export function parseRecordRow(
  id: string,
  value: unknown,
  expectedUnitId?: string,
): RecordRow {
  const item = object(value, recordKeys);
  const archived = item.status === "archived";
  const fields = validateRecordInput(
    Object.fromEntries(
      editableKeys.map((key) => [
        key,
        key === "status" && archived
          ? "active"
          : key === "archiveReason" && archived
            ? ""
            : item[key],
      ]),
    ),
  );
  for (const key of [
    "title",
    "referenceNumber",
    "recordDate",
    "classificationId",
    "locationId",
    "description",
  ] as const) {
    if (item[key] !== fields[key])
      fail(
        key,
        "Data tersimpan tidak dalam format kanonis. Hubungi pengelola.",
      );
  }
  const archiveReason = archived
    ? validateArchiveReason(item.archiveReason)
    : "";
  if (item.archiveReason !== archiveReason)
    fail("archiveReason", "Alasan arsip tersimpan tidak kanonis.");
  const unitId = validatePathId(item.unitId, "unitId");
  if (expectedUnitId !== undefined && unitId !== expectedUnitId)
    fail("unitId", "Unit rekaman tidak sesuai.");
  if (
    !Number.isSafeInteger(item.version) ||
    Number(item.version) < 1 ||
    Number(item.version) >= Number.MAX_SAFE_INTEGER
  ) {
    fail("version", "Versi rekaman tidak valid.");
  }
  const createdAt = timestamp(item.createdAt, "createdAt"),
    updatedAt = timestamp(item.updatedAt, "updatedAt");
  if (
    updatedAt.seconds < createdAt.seconds ||
    (updatedAt.seconds === createdAt.seconds &&
      updatedAt.nanoseconds < createdAt.nanoseconds)
  ) {
    fail("updatedAt", "Urutan waktu rekaman tidak valid.");
  }
  return {
    ...fields,
    id: validatePathId(id, "recordId"),
    unitId,
    status: archived ? "archived" : fields.status,
    archiveReason,
    createdBy: validateActorUid(item.createdBy),
    updatedBy: validateActorUid(item.updatedBy),
    createdAt,
    updatedAt,
    version: Number(item.version),
  };
}
export function parseHistory(
  id: string,
  value: unknown,
  recordId: string,
  unitId: string,
): HistoryEntry {
  const item = object(value, ["snapshot", "actorUid", "at"], "history");
  const snapshot = parseRecordRow(recordId, item.snapshot, unitId);
  const actorUid = validateActorUid(item.actorUid),
    at = timestamp(item.at, "at");
  if (
    id !== `v${snapshot.version}` ||
    actorUid !== snapshot.updatedBy ||
    !at.isEqual(snapshot.updatedAt)
  ) {
    fail("history", "Riwayat tidak cocok dengan versi rekaman.");
  }
  return { id, snapshot, actorUid, at };
}
export function toRecordInput(row: RecordRow): RecordInput {
  if (row.status === "archived") throw new ArchivedRecordError();
  return validateRecordInput(
    Object.fromEntries(
      editableKeys.map((key) => [key, row[key as keyof RecordRow]]),
    ),
  );
}

/** Quote every field and neutralize spreadsheet formula prefixes, including hidden whitespace. */
export function safeCsvCell(value: unknown): string {
  let cell = String(value ?? "");
  if (
    /^[\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+\-@]/u.test(
      cell,
    ) ||
    /^[\t\r\n]/.test(cell)
  )
    cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}
export function exportMetadataCsv(records: readonly RecordRow[]): string {
  if (!Array.isArray(records) || records.length > 5000)
    fail("records", "Ekspor metadata dibatasi hingga 5.000 rekaman.");
  const rows: unknown[][] = [
    [
      "ID",
      "Unit",
      "Nomor Referensi",
      "Judul",
      "Tanggal",
      "Klasifikasi",
      "Lokasi Fisik",
      "Deskripsi",
      "Status",
      "Alasan Arsip",
      "Versi",
      "Diperbarui (UTC)",
    ],
  ];
  for (const row of records)
    rows.push([
      row.id,
      row.unitId,
      row.referenceNumber,
      row.title,
      row.recordDate,
      row.classificationId,
      row.locationId,
      row.description,
      row.status,
      row.archiveReason,
      row.version,
      row.updatedAt.toDate().toISOString(),
    ]);
  return (
    "\ufeff" +
    rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
