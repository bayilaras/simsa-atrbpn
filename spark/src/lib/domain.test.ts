import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import {
  ArchivedRecordError,
  DomainValidationError,
  exportMetadataCsv,
  parseClassification,
  parseHistory,
  parseLocation,
  parseProfile,
  parseRecordRow,
  parseUnit,
  safeCsvCell,
  toRecordInput,
  validateActorUid,
  validateArchiveReason,
  validatePathId,
  validateRecordDate,
  validateRecordInput,
  validateReferenceFilter,
  type RecordInput,
} from "./domain";

const input: RecordInput = {
  title: "Arsip contoh",
  referenceNumber: "REF-001",
  recordDate: "2026-09-06",
  classificationId: "class-1",
  locationId: "rack-1",
  description: "Metadata sintetis",
  archiveReason: "",
  status: "draft",
};
const at = Timestamp.fromMillis(1780000000000);
const stored = {
  ...input,
  unitId: "unit-a",
  createdBy: "operator-a",
  createdAt: at,
  updatedBy: "operator-a",
  updatedAt: at,
  version: 1,
};

describe("strict Spark metadata validation", () => {
  it("normalizes form whitespace without accepting unknown or missing fields", () => {
    expect(
      validateRecordInput({
        ...input,
        title: "  Arsip contoh  ",
        description: " \nMetadata sintetis\n ",
      }),
    ).toEqual(input);
    expect(() =>
      validateRecordInput({ ...input, fileUrl: "https://example.test/file" }),
    ).toThrow(DomainValidationError);
    const missing = { ...input } as Partial<RecordInput>;
    delete missing.description;
    expect(() => validateRecordInput(missing)).toThrow(DomainValidationError);
    for (const value of [null, [], "record"])
      expect(() => validateRecordInput(value)).toThrow(DomainValidationError);
  });
  it("enforces each length, status, reason and unsafe control character boundary", () => {
    for (const patch of [
      { title: "" },
      { title: "x".repeat(201) },
      { referenceNumber: "x".repeat(101) },
      { referenceNumber: "one\ntwo" },
      { title: "nul\0value" },
      { description: "x".repeat(2001) },
      { status: "archived" },
      { status: "owner" },
      { archiveReason: "not yet" },
      { classificationId: "../other" },
      { locationId: "rack/path" },
      { description: 12 },
    ])
      expect(() => validateRecordInput({ ...input, ...patch })).toThrow();
    expect(
      validateRecordInput({
        ...input,
        title: "x".repeat(200),
        referenceNumber: "x".repeat(100),
        description: "x".repeat(2000),
        status: "active",
      }).status,
    ).toBe("active");
  });
  it("validates actual Gregorian dates, including leap years and year zero", () => {
    for (const date of ["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])
      expect(validateRecordDate(date)).toBe(date);
    for (const date of [
      "2025-02-29",
      "1900-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-01",
      "2026-01-00",
      "0000-01-01",
      "2026-1-01",
      "06/09/2026",
      "2026-09-06T01:00:00Z",
    ])
      expect(() => validateRecordDate(date)).toThrow();
  });
  it("rejects unsafe/reserved path IDs and bounds actor UID separately", () => {
    expect(validatePathId("unit_A-01")).toBe("unit_A-01");
    expect(validateActorUid("a".repeat(128))).toHaveLength(128);
    for (const id of [
      "",
      ".",
      "..",
      "a/b",
      "space id",
      "__reserved__",
      "x".repeat(101),
    ])
      expect(() => validatePathId(id)).toThrow();
    expect(() => validateActorUid("a".repeat(129))).toThrow();
  });
  it("validates exact-reference filter and required archive reason", () => {
    expect(validateReferenceFilter("  REF-001  ")).toBe("REF-001");
    expect(validateReferenceFilter(" ")).toBeUndefined();
    expect(validateReferenceFilter(undefined)).toBeUndefined();
    expect(() => validateReferenceFilter(null)).toThrow();
    expect(validateArchiveReason("  Selesai digunakan.  ")).toBe(
      "Selesai digunakan.",
    );
    for (const reason of ["", "  ", "ab", "x".repeat(501)])
      expect(() => validateArchiveReason(reason)).toThrow();
  });
  it("reads only exact trusted profile and catalogue shapes", () => {
    const profile = {
      displayName: "Contoh",
      unitId: "unit-a",
      role: "operator",
      active: true,
    };
    expect(parseProfile(profile)).toEqual(profile);
    expect(() => parseProfile({ ...profile, role: "owner" })).toThrow();
    expect(() => parseProfile({ ...profile, active: "true" })).toThrow();
    expect(() => parseProfile({ ...profile, extra: true })).toThrow();
    expect(parseUnit("unit-a", { name: "Unit A" })).toEqual({
      id: "unit-a",
      name: "Unit A",
    });
    expect(
      parseClassification("c1", { code: "C.1", name: "Umum", active: true }).id,
    ).toBe("c1");
    expect(
      parseLocation("l1", { name: "Rak A", description: "", active: false })
        .active,
    ).toBe(false);
  });
  it("requires canonical complete server records, safe version, timestamps and exact unit", () => {
    const row = parseRecordRow("record-1", stored, "unit-a");
    expect(toRecordInput(row)).toEqual(input);
    for (const patch of [
      { unitId: "unit-b" },
      { version: 0 },
      { version: 1.5 },
      { version: Number.MAX_SAFE_INTEGER },
      { createdAt: null },
      { updatedAt: Timestamp.fromMillis(at.toMillis() - 1000) },
      { fileUrl: "fake" },
      { title: " padded " },
    ]) {
      expect(() =>
        parseRecordRow("record-1", { ...stored, ...patch }, "unit-a"),
      ).toThrow();
    }
    expect(() =>
      parseRecordRow(
        "record-1",
        {
          ...stored,
          createdAt: new Timestamp(at.seconds, 2),
          updatedAt: new Timestamp(at.seconds, 1),
        },
        "unit-a",
      ),
    ).toThrow(DomainValidationError);
  });
  it("keeps archived rows read-only and checks complete history identity", () => {
    const row = parseRecordRow("record-1", {
      ...stored,
      status: "archived",
      archiveReason: "Selesai.",
    });
    expect(() => toRecordInput(row)).toThrow(ArchivedRecordError);
    expect(
      parseHistory(
        "v1",
        { snapshot: stored, actorUid: "operator-a", at },
        "record-1",
        "unit-a",
      ).snapshot.id,
    ).toBe("record-1");
    for (const event of [
      { snapshot: stored, actorUid: "other", at },
      {
        snapshot: stored,
        actorUid: "operator-a",
        at: Timestamp.fromMillis(at.toMillis() + 1000),
      },
    ]) {
      expect(() => parseHistory("v1", event, "record-1", "unit-a")).toThrow();
    }
    expect(() =>
      parseHistory(
        "v2",
        { snapshot: stored, actorUid: "operator-a", at },
        "record-1",
        "unit-a",
      ),
    ).toThrow();
  });
});

describe("safe metadata-only CSV", () => {
  it("neutralizes formula and hidden-whitespace prefixes while preserving literal text", () => {
    for (const value of [
      "=SUM(A1)",
      "+cmd",
      "-2+3",
      "@SUM(A1)",
      "  =formula",
      "\t=cmd",
      "\r@cmd",
      "\n+cmd",
      "\u200b=cmd",
      "\ufeff=cmd",
    ]) {
      expect(safeCsvCell(value).startsWith("\"'")).toBe(true);
    }
    expect(safeCsvCell("REF-001")).toBe('"REF-001"');
    expect(safeCsvCell('Judul "kutip", baris\nberikutnya')).toBe(
      '"Judul ""kutip"", baris\nberikutnya"',
    );
  });
  it("exports quoted headers and UTF-8 BOM without file/blob/auth fields", () => {
    const csv = exportMetadataCsv([
      parseRecordRow("record-1", {
        ...stored,
        title: "=CMD()",
        description: 'teks, "kutip"',
      }),
    ]);
    expect(csv.startsWith('\ufeff"ID","Unit"')).toBe(true);
    expect(csv).toContain('"\'=CMD()"');
    expect(csv).toContain('"teks, ""kutip"""');
    expect(csv).not.toMatch(/fileUrl|blob|password|token|operator-a/);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(exportMetadataCsv([])).toContain("Nomor Referensi");
  });
});
