import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth, User } from "firebase/auth";
import { Timestamp, type Firestore } from "firebase/firestore";
import { DomainValidationError, type RecordCreateAttempt, type RecordPage, type RecordRow, type SparkProfile } from "./lib/domain";
import App from "./App";

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  profile: null as SparkProfile | null,
  authObservers: new Set<(value: User | null) => void>(),
  profileObservers: new Set<(value: SparkProfile | null) => void>(),
  profileErrors: new Set<(error: Error) => void>(),
  actors: [] as string[],
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  reload: vi.fn(),
  getIdToken: vi.fn(),
  sendEmailVerification: vi.fn(),
  watchProfile: vi.fn(),
  getUnit: vi.fn(),
  listClassifications: vi.fn(),
  listLocations: vi.fn(),
  listRecords: vi.fn(),
  saveRecord: vi.fn(),
  createRecordAttempt: vi.fn(),
  archiveRecord: vi.fn(),
  listHistory: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class GoogleAuthProvider {},
  onAuthStateChanged: mocks.onAuthStateChanged,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signInWithPopup: mocks.signInWithPopup,
  signOut: mocks.signOut,
  reload: mocks.reload,
  getIdToken: mocks.getIdToken,
  sendEmailVerification: mocks.sendEmailVerification,
}));
vi.mock("./lib/repository", () => ({
  SparkRepository: class {
    constructor(_db: Firestore, actorUid: string) {
      mocks.actors.push(actorUid);
    }
    watchProfile = mocks.watchProfile;
    getUnit = mocks.getUnit;
    listClassifications = mocks.listClassifications;
    listLocations = mocks.listLocations;
    listRecords = mocks.listRecords;
    saveRecord = mocks.saveRecord;
    createRecordAttempt = mocks.createRecordAttempt;
    archiveRecord = mocks.archiveRecord;
    listHistory = mocks.listHistory;
  },
}));

const services = { auth: {} as Auth, db: {} as Firestore };
const operator: SparkProfile = {
  displayName: "Operator Sintetis",
  unitId: "unit-a",
  role: "operator",
  active: true,
};
const user = {
  uid: "user-a",
  emailVerified: true,
  email: "operator@example.invalid",
} as User;
const timestamp = Timestamp.fromDate(new Date("2026-09-06T02:00:00Z"));
function record(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: "record-a",
    title: "Berkas sintetis A",
    referenceNumber: "ARS/2026/001",
    recordDate: "2026-09-06",
    classificationId: "class-a",
    locationId: "loc-a",
    description: "Contoh metadata sintetis",
    archiveReason: "",
    status: "draft",
    unitId: "unit-a",
    createdBy: "user-a",
    updatedBy: "user-a",
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    ...overrides,
  };
}
function page(records: RecordRow[] = [record()]): RecordPage {
  return { records, cursor: null, hasMore: false };
}
function fillNewRecord(dialog: HTMLElement) {
  for (const [label, value] of [
    ["Judul arsip", "Metadata baru"],
    ["Nomor referensi", "ARS/002"],
    ["Tanggal arsip", "2026-09-06"],
    ["Klasifikasi", "class-a"],
    ["Lokasi fisik", "loc-a"],
  ])
    fireEvent.change(within(dialog).getByLabelText(label!), {
      target: { value },
    });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function signedIn(profile: SparkProfile | null = operator) {
  mocks.user = { ...user };
  mocks.profile = profile;
}
async function emitProfile(profile: SparkProfile | null) {
  await act(async () => {
    for (const observer of mocks.profileObservers) observer(profile);
  });
}
async function emitAuth(value: User | null) {
  await act(async () => {
    for (const observer of mocks.authObservers) observer(value);
  });
}

beforeEach(() => {
  mocks.user = null;
  mocks.profile = null;
  mocks.authObservers.clear();
  mocks.profileObservers.clear();
  mocks.profileErrors.clear();
  mocks.actors.length = 0;
  for (const value of Object.values(mocks))
    if (vi.isMockFunction(value)) value.mockReset();
  mocks.onAuthStateChanged.mockImplementation(
    (_auth: Auth, callback: (value: User | null) => void) => {
      mocks.authObservers.add(callback);
      callback(mocks.user);
      return () => mocks.authObservers.delete(callback);
    },
  );
  mocks.watchProfile.mockImplementation(
    (
      callback: (profile: SparkProfile | null) => void,
      onError: (error: Error) => void,
    ) => {
      mocks.profileObservers.add(callback);
      mocks.profileErrors.add(onError);
      callback(mocks.profile);
      return () => {
        mocks.profileObservers.delete(callback);
        mocks.profileErrors.delete(onError);
      };
    },
  );
  mocks.signInWithEmailAndPassword.mockResolvedValue({ user });
  mocks.signInWithPopup.mockResolvedValue({ user });
  mocks.signOut.mockResolvedValue(undefined);
  mocks.reload.mockResolvedValue(undefined);
  mocks.getIdToken.mockResolvedValue("test-only-token");
  mocks.sendEmailVerification.mockResolvedValue(undefined);
  mocks.getUnit.mockImplementation(async (unitId: string) => ({
    id: unitId,
    name: unitId === "unit-a" ? "Unit Sintetis A" : "Unit Sintetis B",
  }));
  mocks.listClassifications.mockResolvedValue([
    {
      id: "class-a",
      code: "KA.01",
      name: "Administrasi sintetis",
      active: true,
    },
  ]);
  mocks.listLocations.mockResolvedValue([
    {
      id: "loc-a",
      name: "Rak sintetis 01",
      description: "Lantai satu",
      active: true,
    },
  ]);
  mocks.listRecords.mockResolvedValue(page());
  mocks.saveRecord.mockResolvedValue("record-created");
  mocks.createRecordAttempt.mockImplementation(() => Object.freeze({}) as RecordCreateAttempt);
  mocks.archiveRecord.mockResolvedValue(undefined);
  mocks.listHistory.mockResolvedValue([
    { id: "v1", snapshot: record(), actorUid: "user-a", at: timestamp },
  ]);
});

describe("authentication and provisioning gates", () => {
  it("blocks invalid configuration without starting authentication or repository reads", () => {
    render(<App services={null} configError="internal config detail" />);
    expect(
      screen.getByRole("heading", { name: "SIMSA belum terhubung" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("internal config detail"),
    ).not.toBeInTheDocument();
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
    expect(mocks.watchProfile).not.toHaveBeenCalled();
  });

  it("provides accessible email/password and Google login, without self-registration", async () => {
    render(<App services={services} />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "operator@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Kata sandi"), {
      target: { value: "test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Masuk dengan email" }));
    await waitFor(() =>
      expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
        services.auth,
        "operator@example.invalid",
        "test-password",
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Kata sandi")).toHaveValue(""),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Masuk dengan Google" }),
    );
    await waitFor(() => expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: /daftar|registrasi|buat akun/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Pendaftaran mandiri tidak tersedia/),
    ).toBeInTheDocument();
  });

  it("does not read a profile or unit until email verification is confirmed", async () => {
    mocks.user = { ...user, emailVerified: false };
    mocks.profile = operator;
    render(<App services={services} />);
    expect(
      await screen.findByRole("heading", { name: "Verifikasi email Anda" }),
    ).toBeInTheDocument();
    expect(mocks.watchProfile).not.toHaveBeenCalled();
    expect(mocks.listRecords).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Kirim email verifikasi" }),
    );
    await waitFor(() =>
      expect(mocks.sendEmailVerification).toHaveBeenCalledWith(mocks.user),
    );
    expect(
      await screen.findByText(/Email verifikasi dikirim/),
    ).toBeInTheDocument();
  });

  it("shows unprovisioned and inactive states without exposing unit metadata", async () => {
    signedIn(null);
    render(<App services={services} />);
    expect(
      await screen.findByRole("heading", { name: "Akun belum diprovisikan" }),
    ).toBeInTheDocument();
    expect(screen.getByText("user-a")).toBeInTheDocument();
    expect(mocks.listRecords).not.toHaveBeenCalled();
    await emitProfile({ ...operator, active: false });
    expect(
      await screen.findByRole("heading", { name: "Akun belum aktif" }),
    ).toBeInTheDocument();
    expect(mocks.listRecords).not.toHaveBeenCalled();
  });
});

describe("metadata workspace", () => {
  it("shows own-unit metadata and reference catalogues with explicit pilot limits", async () => {
    signedIn();
    render(<App services={services} />);
    expect(await screen.findByText("Berkas sintetis A")).toBeInTheDocument();
    expect(screen.getByText("Unit Sintetis A")).toBeInTheDocument();
    expect(mocks.listRecords).toHaveBeenCalledWith("unit-a", {
      cursor: null,
      referenceNumber: undefined,
    });
    expect(screen.getByText(/Gunakan data sintetis saja/)).toBeInTheDocument();
    expect(
      screen.getByText(/Ekspor halaman bukan backup lengkap/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Klasifikasi" }));
    expect(
      await screen.findByRole("heading", { name: "Administrasi sintetis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hanya baca")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lokasi fisik" }));
    expect(
      await screen.findByRole("heading", { name: "Rak sintetis 01" }),
    ).toBeInTheDocument();
  });

  it("does not expose create/edit/archive controls to a viewer", async () => {
    signedIn({ ...operator, role: "viewer" });
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    expect(
      screen.queryByRole("button", { name: "Tambah arsip" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Berkas sintetis A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Arsipkan Berkas sintetis A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Riwayat Berkas sintetis A" }),
    ).toBeInTheDocument();
  });

  it("resets pagination for exact-reference searches and rejects late prior-page responses", async () => {
    signedIn();
    const firstCursor = {} as NonNullable<RecordPage["cursor"]>;
    const latePage = deferred<RecordPage>();
    mocks.listRecords
      .mockResolvedValueOnce({
        records: [record()],
        cursor: firstCursor,
        hasMore: true,
      })
      .mockImplementationOnce(() => latePage.promise)
      .mockResolvedValueOnce(
        page([record({ id: "found", title: "Hasil nomor persis" })]),
      );
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    await waitFor(() =>
      expect(mocks.listRecords).toHaveBeenNthCalledWith(2, "unit-a", {
        cursor: firstCursor,
        referenceNumber: undefined,
      }),
    );
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cari nomor referensi persis"), {
      target: { value: " ARS/2026/001 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cari" }));
    expect(await screen.findByText("Hasil nomor persis")).toBeInTheDocument();
    expect(mocks.listRecords).toHaveBeenLastCalledWith("unit-a", {
      cursor: null,
      referenceNumber: "ARS/2026/001",
    });
    await act(async () =>
      latePage.resolve(page([record({ title: "HASIL LAMA JANGAN TAMPIL" })])),
    );
    expect(
      screen.queryByText("HASIL LAMA JANGAN TAMPIL"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sebelumnya" })).toBeDisabled();
  });

  it("creates structured metadata without locators or owner/role editing", async () => {
    signedIn();
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    const dialog = screen.getByRole("dialog", {
      name: "Tambah metadata arsip",
    });
    fireEvent.change(within(dialog).getByLabelText("Judul arsip"), {
      target: { value: "Metadata baru" },
    });
    fireEvent.change(within(dialog).getByLabelText("Nomor referensi"), {
      target: { value: "ARS/002" },
    });
    fireEvent.change(within(dialog).getByLabelText("Tanggal arsip"), {
      target: { value: "2026-09-06" },
    });
    fireEvent.change(within(dialog).getByLabelText("Klasifikasi"), {
      target: { value: "class-a" },
    });
    fireEvent.change(within(dialog).getByLabelText("Lokasi fisik"), {
      target: { value: "loc-a" },
    });
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Simpan metadata" }),
    );
    await waitFor(() =>
      expect(mocks.saveRecord).toHaveBeenCalledWith(
        "unit-a",
        {
          title: "Metadata baru",
          referenceNumber: "ARS/002",
          recordDate: "2026-09-06",
          classificationId: "class-a",
          locationId: "loc-a",
          description: "",
          archiveReason: "",
          status: "draft",
        },
        undefined,
        expect.any(Object),
      ),
    );
    expect(
      await screen.findByText("Metadata tersimpan dan dikonfirmasi server."),
    ).toBeInTheDocument();
  });

  it("passes the exact displayed version for edits and does not call success before acknowledgement", async () => {
    signedIn();
    const saving = deferred<string>();
    mocks.saveRecord.mockImplementation(() => saving.promise);
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Berkas sintetis A" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Judul arsip"), {
      target: { value: "Judul diperbarui" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Simpan metadata" }),
    );
    await waitFor(() =>
      expect(mocks.saveRecord).toHaveBeenCalledWith(
        "unit-a",
        expect.objectContaining({ title: "Judul diperbarui" }),
        expect.objectContaining({ id: "record-a", version: 1 }),
      ),
    );
    expect(mocks.createRecordAttempt).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Metadata tersimpan dan dikonfirmasi server."),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Menyimpan…" }),
    ).toBeDisabled();
    await act(async () => saving.resolve("record-a"));
    expect(
      await screen.findByText("Metadata tersimpan dan dikonfirmasi server."),
    ).toBeInTheDocument();
  });

  it("keeps one create attempt across retries and clears it only when the editor finishes", async () => {
    signedIn();
    mocks.saveRecord.mockRejectedValueOnce({ code: "unavailable" });
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    let dialog = screen.getByRole("dialog");
    fillNewRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await within(dialog).findByText(/Koneksi ke database belum tersedia/);
    expect(mocks.createRecordAttempt).toHaveBeenCalledTimes(1);
    const firstToken = mocks.createRecordAttempt.mock.results[0]!.value;
    expect(mocks.saveRecord.mock.calls[0]?.[3]).toBe(firstToken);
    expect(within(dialog).getByText(/Menutup dialog atau memuat ulang halaman mengakhiri/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Judul arsip")).toBeDisabled();
    expect(within(dialog).getByLabelText("Status")).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await screen.findByText("Metadata tersimpan dan dikonfirmasi server.");
    expect(mocks.saveRecord.mock.calls[1]?.[3]).toBe(firstToken);
    expect(mocks.saveRecord.mock.calls[1]?.[1]).toEqual(mocks.saveRecord.mock.calls[0]?.[1]);
    expect(mocks.createRecordAttempt).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    dialog = screen.getByRole("dialog");
    fillNewRecord(dialog);
    mocks.saveRecord.mockRejectedValueOnce({ code: "unavailable" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await within(dialog).findByText(/Koneksi ke database belum tersedia/);
    const secondToken = mocks.saveRecord.mock.calls[2]?.[3];
    expect(secondToken).not.toBe(firstToken);
    expect(mocks.createRecordAttempt).toHaveBeenCalledTimes(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    dialog = screen.getByRole("dialog");
    fillNewRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await screen.findByText("Metadata tersimpan dan dikonfirmasi server.");
    expect(mocks.createRecordAttempt).toHaveBeenCalledTimes(3);
    expect(mocks.saveRecord.mock.calls[3]?.[3]).not.toBe(secondToken);
  });

  it("explains an invalid create attempt without silently replacing it", async () => {
    signedIn();
    mocks.saveRecord.mockRejectedValueOnce({ code: "unavailable" });
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    const dialog = screen.getByRole("dialog");
    fillNewRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await within(dialog).findByText(/Koneksi ke database belum tersedia/);
    expect(within(dialog).getByLabelText("Judul arsip")).toBeDisabled();
    mocks.saveRecord.mockRejectedValueOnce(new DomainValidationError(
      "createAttempt", "Percobaan ulang harus memakai draf, pengguna, unit, dan isi awal yang sama.",
    ));
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await within(dialog).findByText(/Percobaan ulang harus memakai draf/);
    expect(mocks.createRecordAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.saveRecord.mock.calls[1]?.[3]).toBe(mocks.saveRecord.mock.calls[0]?.[3]);
  });

  it("does not allocate a create attempt for invalid input", async () => {
    signedIn();
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(mocks.createRecordAttempt).not.toHaveBeenCalled();
    expect(mocks.saveRecord).not.toHaveBeenCalled();
  });

  it("never reuses a create attempt after the unit context changes", async () => {
    signedIn();
    mocks.saveRecord.mockRejectedValueOnce({ code: "unavailable" });
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    let dialog = screen.getByRole("dialog");
    fillNewRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await within(dialog).findByText(/Koneksi ke database belum tersedia/);
    const previousToken = mocks.saveRecord.mock.calls[0]?.[3];
    await emitProfile({ ...operator, unitId: "unit-b" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await screen.findByText("Unit Sintetis B");
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    dialog = screen.getByRole("dialog");
    fillNewRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await screen.findByText("Metadata tersimpan dan dikonfirmasi server.");
    expect(mocks.createRecordAttempt).toHaveBeenCalledTimes(2);
    expect(mocks.saveRecord.mock.calls[1]?.[0]).toBe("unit-b");
    expect(mocks.saveRecord.mock.calls[1]?.[3]).not.toBe(previousToken);
  });

  it("archives with a reason, preserves metadata and hides edits for archived rows", async () => {
    signedIn();
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(
      screen.getByRole("button", { name: "Arsipkan Berkas sintetis A" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Arsipkan metadata" });
    expect(
      within(dialog).getByText(/Tidak ada penghapusan data/),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Alasan pengarsipan"), {
      target: { value: "  Penataan ulang arsip fisik  " },
    });
    mocks.listRecords.mockResolvedValue(
      page([
        record({
          status: "archived",
          archiveReason: "Penataan ulang arsip fisik",
          version: 2,
        }),
      ]),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Konfirmasi pengarsipan" }),
    );
    await waitFor(() =>
      expect(mocks.archiveRecord).toHaveBeenCalledWith(
        "unit-a",
        expect.objectContaining({ version: 1 }),
        "Penataan ulang arsip fisik",
      ),
    );
    expect(await screen.findByText("Diarsipkan")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Berkas sintetis A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /hapus/i }),
    ).not.toBeInTheDocument();
  });

  it("shows bounded change history and closes the dialog with Escape", async () => {
    signedIn();
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(
      screen.getByRole("button", { name: "Riwayat Berkas sintetis A" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Riwayat metadata" });
    await within(dialog).findByText("Identitas pelaku");
    expect(mocks.listHistory).toHaveBeenCalledWith("unit-a", "record-a");
    expect(
      within(dialog).getByText(/Maksimal 25 versi terbaru/),
    ).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exports only the visible page and labels the CSV as not a complete backup", async () => {
    signedIn();
    mocks.listRecords.mockResolvedValue(
      page([record({ title: "Halaman terlihat" })]),
    );
    const createUrl = vi.fn(
      (_blob: Blob | MediaSource) => "blob:synthetic-csv",
    );
    const revokeUrl = vi.fn();
    const OriginalURL = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends OriginalURL {
        static createObjectURL = createUrl;
        static revokeObjectURL = revokeUrl;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      render(<App services={services} />);
      await screen.findByText("Halaman terlihat");
      fireEvent.click(
        screen.getByRole("button", { name: "Ekspor halaman (CSV)" }),
      );
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(createUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic-csv");
      expect(
        screen.getByText(
          /Ini bukan backup lengkap dan tidak mencakup seluruh riwayat/,
        ),
      ).toBeInTheDocument();
      expect(mocks.listRecords).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("stale data and access revocation", () => {
  it("allows reload after a failed create invalidates an unfinished initial list", async () => {
    signedIn();
    const old = deferred<RecordPage>();
    mocks.listRecords.mockImplementationOnce(() => old.promise);
    mocks.saveRecord.mockRejectedValueOnce({ code: "unavailable" });
    render(<App services={services} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tambah arsip" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tambah arsip" }));
    const dialog = screen.getByRole("dialog");
    for (const [label, value] of [
      ["Judul arsip", "Metadata baru"],
      ["Nomor referensi", "ARS/002"],
      ["Tanggal arsip", "2026-09-06"],
      ["Klasifikasi", "class-a"],
      ["Lokasi fisik", "loc-a"],
    ])
      fireEvent.change(within(dialog).getByLabelText(label!), {
        target: { value },
      });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan metadata" }));
    await within(dialog).findByText(/Koneksi ke database belum tersedia/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(screen.getByRole("button", { name: "Muat ulang" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }));
    await screen.findByText("Berkas sintetis A");
    await act(async () => old.resolve(page([record({ title: "DAFTAR LAMA" })])));
    expect(screen.queryByText("DAFTAR LAMA")).not.toBeInTheDocument();
  });

  it("blocks competing login and stale auth callbacks during and after logout", async () => {
    signedIn();
    const pending = deferred<void>();
    mocks.signOut.mockImplementation(() => pending.promise);
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }));
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Masuk dengan Google" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Masuk dengan Google" }));
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
    await emitAuth(user);
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    await act(async () => pending.resolve());
    await emitAuth(user);
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Masuk dengan Google" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Masuk dengan Google" }));
    await emitAuth(user);
    expect(await screen.findByText("Berkas sintetis A")).toBeInTheDocument();
  });

  it("keeps a failed logout closed and provides an explicit safe retry", async () => {
    signedIn();
    mocks.signOut.mockRejectedValueOnce(new Error("synthetic persistence failure"));
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }));
    const retry = await screen.findByRole("button", { name: "Coba keluar lagi" });
    await emitAuth(user);
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Masuk dengan Google" })).toBeDisabled();
    mocks.signOut.mockResolvedValueOnce(undefined);
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Coba keluar lagi" })).not.toBeInTheDocument();
  });

  it("retries a transient catalogue failure without treating it as access revocation", async () => {
    signedIn();
    mocks.listClassifications.mockRejectedValueOnce({ code: "unavailable" });
    render(<App services={services} />);
    const retry = await screen.findByRole("button", { name: "Coba muat referensi lagi" });
    expect(screen.queryByRole("heading", { name: "Akses belum tersedia" })).not.toBeInTheDocument();
    expect(mocks.listRecords).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Tambah arsip" })).toBeDisabled();
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText("Berkas sintetis A")).toBeInTheDocument();
    expect(mocks.getUnit).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Tambah arsip" })).toBeEnabled();
  });

  it("does not offer a catalogue retry after permission denial", async () => {
    signedIn();
    mocks.listLocations.mockRejectedValueOnce({ code: "permission-denied" });
    render(<App services={services} />);
    await screen.findByRole("heading", { name: "Akses belum tersedia" });
    expect(screen.queryByRole("button", { name: "Coba muat referensi lagi" })).not.toBeInTheDocument();
    expect(mocks.listRecords).not.toHaveBeenCalled();
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
  });

  it("clears the previous unit immediately and never displays its late response", async () => {
    signedIn();
    const old = deferred<RecordPage>();
    const next = deferred<RecordPage>();
    mocks.listRecords
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => next.promise);
    render(<App services={services} />);
    await screen.findByText("Unit Sintetis A");
    await emitProfile({ ...operator, unitId: "unit-b" });
    await waitFor(() =>
      expect(mocks.listRecords).toHaveBeenLastCalledWith("unit-b", {
        cursor: null,
        referenceNumber: undefined,
      }),
    );
    expect(screen.queryByText("Unit Sintetis A")).not.toBeInTheDocument();
    await act(async () =>
      old.resolve(page([record({ title: "RAHASIA UNIT LAMA" })])),
    );
    expect(screen.queryByText("RAHASIA UNIT LAMA")).not.toBeInTheDocument();
    await act(async () =>
      next.resolve(
        page([
          record({
            id: "unit-b-record",
            title: "Metadata unit B",
            unitId: "unit-b",
          }),
        ]),
      ),
    );
    expect(await screen.findByText("Metadata unit B")).toBeInTheDocument();
  });

  it("removes records, catalogues and dialogs as soon as the profile becomes inactive", async () => {
    signedIn();
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Berkas sintetis A" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await emitProfile({ ...operator, active: false });
    expect(
      await screen.findByRole("heading", { name: "Akun belum aktif" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Unit Sintetis A")).not.toBeInTheDocument();
  });

  it("clears all visible unit data on a permission-denied request", async () => {
    signedIn();
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    mocks.listRecords.mockRejectedValueOnce({ code: "permission-denied" });
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }));
    expect(
      await screen.findByRole("heading", { name: "Akses belum tersedia" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    expect(screen.queryByText("Unit Sintetis A")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tambah arsip" }),
    ).not.toBeInTheDocument();
  });

  it("ignores pending save acknowledgement and history responses after a unit change", async () => {
    signedIn();
    const pendingSave = deferred<string>();
    mocks.saveRecord.mockImplementation(() => pendingSave.promise);
    const pendingHistory = deferred<[]>();
    mocks.listHistory.mockImplementation(() => pendingHistory.promise);
    render(<App services={services} />);
    await screen.findByText("Berkas sintetis A");
    fireEvent.click(
      screen.getByRole("button", { name: "Riwayat Berkas sintetis A" }),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Berkas sintetis A" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Simpan metadata",
      }),
    );
    await waitFor(() => expect(mocks.saveRecord).toHaveBeenCalledTimes(1));
    mocks.listRecords.mockResolvedValue(
      page([
        record({
          id: "record-b",
          unitId: "unit-b",
          title: "Data unit berikutnya",
        }),
      ]),
    );
    await emitProfile({ ...operator, unitId: "unit-b" });
    expect(await screen.findByText("Data unit berikutnya")).toBeInTheDocument();
    await act(async () => {
      pendingSave.resolve("record-a");
      pendingHistory.resolve([]);
    });
    expect(
      screen.queryByText("Metadata tersimpan dan dikonfirmasi server."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Berkas sintetis A")).not.toBeInTheDocument();
    expect(screen.getByText("Data unit berikutnya")).toBeInTheDocument();
  });

  it("drops an old user response after sign-out and keeps data hidden while sign-out awaits acknowledgement", async () => {
    signedIn();
    const old = deferred<RecordPage>();
    mocks.listRecords.mockImplementation(() => old.promise);
    const pendingLogout = deferred<void>();
    mocks.signOut.mockImplementation(() => pendingLogout.promise);
    render(<App services={services} />);
    await screen.findByText("Unit Sintetis A");
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }));
    expect(
      await screen.findByRole("heading", { name: "Masuk ke ruang kerja" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unit Sintetis A")).not.toBeInTheDocument();
    await act(async () =>
      old.resolve(page([record({ title: "HASIL SESI LAMA" })])),
    );
    expect(screen.queryByText("HASIL SESI LAMA")).not.toBeInTheDocument();
    await act(async () => pendingLogout.resolve());
    await emitAuth(null);
  });
});
