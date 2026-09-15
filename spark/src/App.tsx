import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  getIdToken,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { SparkRepository } from "./lib/repository";
import {
  DomainValidationError,
  exportMetadataCsv,
  toRecordInput,
  validateRecordInput,
  type Classification,
  type HistoryEntry,
  type RecordCursor,
  type RecordCreateAttempt,
  type RecordInput,
  type RecordRow,
  type SparkProfile,
  type SparkUnit,
  type StorageLocation,
} from "./lib/domain";
import "./styles.css";

type Services = { auth: Auth; db: Firestore };
type Session = { user: User; verified: boolean };
type View = "records" | "classifications" | "locations";
type Editor = { record?: RecordRow } | null;
const emptyInput: RecordInput = {
  title: "",
  referenceNumber: "",
  recordDate: "",
  classificationId: "",
  locationId: "",
  description: "",
  archiveReason: "",
  status: "draft",
};
const labels = { draft: "Draf", active: "Aktif", archived: "Diarsipkan" };
const roleLabels = {
  operator: "Operator",
  viewer: "Pembaca",
  admin: "Administrator",
};
function codeOf(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}
function isPermissionError(error: unknown) {
  return [
    "permission-denied",
    "unauthenticated",
    "firestore/permission-denied",
  ].includes(codeOf(error));
}
function operationMessage(error: unknown, creating = false) {
  if (error instanceof DomainValidationError && error.field === "createAttempt")
    return `${error.message} Jangan membuat ulang metadata sebelum memeriksa daftar dan riwayat.`;
  if (
    error instanceof Error &&
    ["RecordConflictError", "ArchivedRecordError"].includes(error.name)
  )
    return "Data sudah berubah atau diarsipkan oleh pengguna lain. Muat ulang halaman, lalu periksa versi terbaru.";
  if (codeOf(error) === "unavailable")
    return creating
      ? "Koneksi ke database belum tersedia. Hasil simpan belum dikonfirmasi; periksa koneksi lalu coba simpan lagi di dialog ini."
      : "Koneksi ke database belum tersedia. Perubahan belum dikonfirmasi; periksa koneksi dan muat ulang.";
  if (creating)
    return "Hasil simpan belum dikonfirmasi. Coba simpan lagi dengan isian awal di dialog ini sebelum membuat ulang metadata.";
  return "Operasi belum berhasil. Tidak ada konfirmasi penyimpanan. Muat ulang data sebelum mencoba kembali.";
}
function dateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
function timestampLabel(value: { toDate(): Date } | null | undefined) {
  return value
    ? value
        .toDate()
        .toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : "Menunggu konfirmasi server";
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        S
      </span>
      <span>
        SIMSA <small>SPARK EDITION</small>
      </span>
    </div>
  );
}
function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "error" | "success";
}) {
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = `modal-${title.toLowerCase().replace(/[^a-z]/g, "-")}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = savedOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key === "Tab") {
            const nodes = [
              ...(ref.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
              ) ?? []),
            ];
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (!first) {
              event.preventDefault();
              return;
            }
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === ref.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === ref.current)
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <h2 id={headingId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Tutup dialog"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RecordEditor({
  record,
  classifications,
  locations,
  busy,
  error,
  retryInput,
  onClose,
  onSave,
}: {
  record?: RecordRow;
  classifications: Classification[];
  locations: StorageLocation[];
  busy: boolean;
  error: string;
  retryInput?: RecordInput;
  onClose(): void;
  onSave(input: RecordInput): Promise<void>;
}) {
  const [input, setInput] = useState<RecordInput>(() =>
    record ? toRecordInput(record) : { ...emptyInput },
  );
  const [validation, setValidation] = useState("");
  const retryLocked = Boolean(!record && error && retryInput);
  const field = (name: keyof RecordInput, value: string) =>
    setInput((current) => ({ ...current, [name]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    try {
      const parsed = validateRecordInput(input);
      if (
        !classifications.some(
          (row) => row.id === parsed.classificationId && row.active,
        ) ||
        !locations.some((row) => row.id === parsed.locationId && row.active)
      )
        throw new Error("Pilih klasifikasi dan lokasi yang aktif.");
      await onSave(parsed);
    } catch (cause) {
      setValidation(
        cause instanceof Error
          ? cause.message
          : "Periksa kembali isian metadata.",
      );
    }
  }
  return (
    <Modal
      title={record ? "Edit metadata arsip" : "Tambah metadata arsip"}
      onClose={onClose}
      busy={busy}
    >
      <p className="muted">
        Catat informasi arsip fisik. Edisi ini tidak menyimpan atau mengunggah
        berkas.
      </p>
      {record && (
        <p className="version-note">
          Mengedit versi {record.version}. Perubahan bersamaan akan diperiksa
          sebelum disimpan.
        </p>
      )}
      {(error || validation) && (
        <Notice kind="error">{error || validation}</Notice>
      )}
      {!record && error && retryInput && (
        <Notice>
          <p>
            Isian percobaan awal dikunci. Coba simpan kembali di dialog ini untuk
            memeriksa hasil dengan identitas percobaan yang sama. Menutup dialog
            atau memuat ulang halaman mengakhiri identitas percobaan, bukan
            membatalkan data yang mungkin sudah tersimpan. Periksa daftar dan
            riwayat sebelum membuat ulang metadata.
          </p>
        </Notice>
      )}
      <form onSubmit={submit} className="record-form">
        <fieldset disabled={busy || retryLocked}>
          <label>
            Judul arsip
            <input
              required
              maxLength={200}
              value={input.title}
              onChange={(event) => field("title", event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="form-grid">
            <label>
              Nomor referensi
              <input
                required
                maxLength={100}
                value={input.referenceNumber}
                onChange={(event) =>
                  field("referenceNumber", event.target.value)
                }
                autoComplete="off"
              />
            </label>
            <label>
              Tanggal arsip
              <input
                required
                type="date"
                value={input.recordDate}
                onChange={(event) => field("recordDate", event.target.value)}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Klasifikasi
              <select
                required
                value={input.classificationId}
                onChange={(event) =>
                  field("classificationId", event.target.value)
                }
              >
                <option value="">Pilih klasifikasi</option>
                {classifications.map((row) => (
                  <option key={row.id} value={row.id} disabled={!row.active}>
                    {row.code} · {row.name}
                    {!row.active ? " (nonaktif)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lokasi fisik
              <select
                required
                value={input.locationId}
                onChange={(event) => field("locationId", event.target.value)}
              >
                <option value="">Pilih lokasi</option>
                {locations.map((row) => (
                  <option key={row.id} value={row.id} disabled={!row.active}>
                    {row.name}
                    {!row.active ? " (nonaktif)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Deskripsi <span className="optional">opsional</span>
            <textarea
              maxLength={2000}
              rows={4}
              value={input.description}
              onChange={(event) => field("description", event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={input.status}
              onChange={(event) => field("status", event.target.value)}
            >
              <option value="draft">Draf</option>
              <option value="active">Aktif</option>
            </select>
          </label>
        </fieldset>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Batal
          </button>
          <button className="button primary" disabled={busy} type="submit">
            {busy ? "Menyimpan…" : "Simpan metadata"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ArchiveDialog({
  record,
  busy,
  error,
  onClose,
  onArchive,
}: {
  record: RecordRow;
  busy: boolean;
  error: string;
  onClose(): void;
  onArchive(reason: string): Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState("");
  return (
    <Modal title="Arsipkan metadata" onClose={onClose} busy={busy}>
      <p>
        <strong>{record.title}</strong>
      </p>
      <p className="muted">
        Metadata yang diarsipkan menjadi hanya-baca. Tidak ada penghapusan data;
        alasan dan versi baru akan dicatat dalam riwayat.
      </p>
      {(error || validation) && (
        <Notice kind="error">{error || validation}</Notice>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 3) {
            setValidation("Tuliskan alasan minimal 3 karakter.");
            return;
          }
          setValidation("");
          void onArchive(reason.trim());
        }}
      >
        <label>
          Alasan pengarsipan
          <textarea
            required
            minLength={3}
            maxLength={500}
            rows={4}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Batal
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Mengarsipkan…" : "Konfirmasi pengarsipan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function App({
  services,
  configError,
}: {
  services: Services | null;
  configError?: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [logoutStatus, setLogoutStatus] = useState<
    "idle" | "pending" | "failed"
  >("idle");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<SparkProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [contextVersion, setContextVersion] = useState(0);
  const [unit, setUnit] = useState<SparkUnit | null>(null);
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [nextCursor, setNextCursor] = useState<RecordCursor | null>(null);
  const [cursorStack, setCursorStack] = useState<(RecordCursor | null)[]>([
    null,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<View>("records");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [accessError, setAccessError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [archive, setArchive] = useState<RecordRow | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [historyRecord, setHistoryRecord] = useState<RecordRow | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const contextEpoch = useRef(0);
  const recordRequest = useRef(0);
  const historyRequest = useRef(0);
  const authRequest = useRef(0);
  const logoutIntent = useRef(false);
  const logoutPhase = useRef<"idle" | "pending" | "failed">("idle");
  const createAttempt = useRef<{
    token: RecordCreateAttempt;
    input: RecordInput;
  } | null>(null);
  const repository = useMemo(
    () =>
      services && !configError && session
        ? new SparkRepository(services.db, session.user.uid)
        : null,
    [services, configError, session?.user.uid],
  );
  const active = Boolean(
    session?.verified && profile?.active && repository && !accessError,
  );
  const canManage = active && profile?.role !== "viewer";
  const writable = canManage && catalogReady;
  const loginDisabled = authBusy || logoutStatus !== "idle";

  const clearPage = useCallback(() => {
    recordRequest.current++;
    setRecords([]);
    setRecordsLoading(false);
    setNextCursor(null);
    setHasMore(false);
    setDataError("");
    setNotice("");
  }, []);
  const clearContext = useCallback(() => {
    contextEpoch.current++;
    historyRequest.current++;
    clearPage();
    setUnit(null);
    setClassifications([]);
    setLocations([]);
    setCursorStack([null]);
    setPageIndex(0);
    setFilter("");
    setSearch("");
    setEditor(null);
    createAttempt.current = null;
    setArchive(null);
    setHistoryRecord(null);
    setHistory([]);
    setHistoryError("");
    setOperationError("");
    setOperationBusy(false);
    setCatalogLoading(false);
    setCatalogReady(false);
    setCatalogError("");
    setRecordsLoading(false);
    setHistoryLoading(false);
    setAccessError("");
  }, [clearPage]);
  const accessFailure = useCallback(() => {
    clearContext();
    setAccessError(
      "Akses unit tidak lagi tersedia. Data di layar telah dibersihkan. Hubungi pengelola untuk memeriksa akun Anda.",
    );
  }, [clearContext]);

  useEffect(() => {
    clearContext();
    setProfile(null);
    setProfileReady(false);
    setSession(null);
    setAuthReady(false);
    logoutIntent.current = false;
    logoutPhase.current = "idle";
    setLogoutStatus("idle");
    setAuthBusy(false);
    if (!services || configError) return;
    let mounted = true;
    const unsubscribe = onAuthStateChanged(
      services.auth,
      (user) => {
        if (!mounted || logoutIntent.current) return;
        authRequest.current++;
        clearContext();
        setProfile(null);
        setProfileReady(false);
        setPassword("");
        setAuthError("");
        setAuthNotice("");
        setSession(user ? { user, verified: user.emailVerified } : null);
        setAuthReady(true);
        setAuthBusy(false);
      },
      () => {
        if (mounted && !logoutIntent.current) {
          clearContext();
          setProfile(null);
          setProfileReady(false);
          setSession(null);
          setAuthReady(true);
          setAuthError("Sesi tidak dapat diperiksa. Muat ulang aplikasi.");
        }
      },
    );
    return () => {
      mounted = false;
      authRequest.current++;
      contextEpoch.current++;
      recordRequest.current++;
      historyRequest.current++;
      unsubscribe();
    };
  }, [services, configError, clearContext]);

  useEffect(() => {
    if (!session?.verified || !repository) return;
    let mounted = true;
    setProfileReady(false);
    const unsubscribe = repository.watchProfile(
      (value) => {
        if (!mounted) return;
        clearContext();
        setProfile(value);
        setProfileReady(true);
        setContextVersion((version) => version + 1);
      },
      () => {
        if (mounted) {
          clearContext();
          setProfile(null);
          setProfileReady(true);
          setAccessError(
            "Profil tidak dapat diakses. Hubungi pengelola atau masuk kembali.",
          );
        }
      },
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [repository, session?.verified, clearContext]);

  useEffect(() => {
    if (!active || !profile || !repository) return;
    const epoch = contextEpoch.current;
    let mounted = true;
    setCatalogLoading(true);
    setCatalogReady(false);
    setCatalogError("");
    Promise.all([
      repository.getUnit(profile.unitId),
      repository.listClassifications(profile.unitId),
      repository.listLocations(profile.unitId),
    ])
      .then(([nextUnit, nextClassifications, nextLocations]) => {
        if (!mounted || epoch !== contextEpoch.current) return;
        if (!nextUnit) {
          accessFailure();
          return;
        }
        setUnit(nextUnit);
        setClassifications(nextClassifications);
        setLocations(nextLocations);
        setCatalogReady(true);
      })
      .catch((error) => {
        if (!mounted || epoch !== contextEpoch.current) return;
        if (isPermissionError(error)) accessFailure();
        else {
          clearPage();
          setUnit(null);
          setClassifications([]);
          setLocations([]);
          setCatalogError(
            "Referensi unit belum dapat dimuat. Periksa koneksi dan coba lagi. Jika masalah berulang, hubungi pengelola.",
          );
        }
      })
      .finally(() => {
        if (mounted && epoch === contextEpoch.current) setCatalogLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [
    active,
    profile?.unitId,
    repository,
    contextVersion,
    accessFailure,
    clearPage,
  ]);

  useEffect(() => {
    if (!active || !profile || !repository || !catalogReady) return;
    const epoch = contextEpoch.current,
      request = ++recordRequest.current;
    let mounted = true;
    setRecords([]);
    setNextCursor(null);
    setHasMore(false);
    setRecordsLoading(true);
    setDataError("");
    repository
      .listRecords(profile.unitId, {
        cursor: cursorStack[pageIndex] ?? null,
        referenceNumber: filter || undefined,
      })
      .then((page) => {
        if (
          mounted &&
          epoch === contextEpoch.current &&
          request === recordRequest.current
        ) {
          setRecords(page.records);
          setNextCursor(page.cursor);
          setHasMore(page.hasMore);
        }
      })
      .catch((error) => {
        if (
          mounted &&
          epoch === contextEpoch.current &&
          request === recordRequest.current
        ) {
          if (isPermissionError(error)) accessFailure();
          else {
            setRecords([]);
            setDataError(
              "Daftar arsip belum dapat dimuat. Periksa koneksi, lalu coba lagi.",
            );
          }
        }
      })
      .finally(() => {
        if (
          mounted &&
          epoch === contextEpoch.current &&
          request === recordRequest.current
        )
          setRecordsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [
    active,
    catalogReady,
    profile?.unitId,
    repository,
    contextVersion,
    filter,
    cursorStack,
    pageIndex,
    refresh,
    accessFailure,
  ]);

  async function authenticate(kind: "email" | "google", event?: FormEvent) {
    event?.preventDefault();
    if (!services || authBusy || logoutPhase.current !== "idle") return;
    logoutIntent.current = false;
    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    const request = ++authRequest.current;
    try {
      if (kind === "google")
        await signInWithPopup(services.auth, new GoogleAuthProvider());
      else
        await signInWithEmailAndPassword(services.auth, email.trim(), password);
    } catch (error) {
      if (request === authRequest.current)
        setAuthError(
          codeOf(error) === "auth/popup-blocked"
            ? "Popup diblokir browser. Izinkan popup untuk situs ini atau gunakan email dan kata sandi."
            : codeOf(error) === "auth/popup-closed-by-user"
              ? "Jendela Google ditutup. Silakan coba kembali."
              : "Tidak dapat masuk. Periksa akun, kata sandi, dan koneksi Anda.",
        );
    } finally {
      if (request === authRequest.current) {
        setAuthBusy(false);
        setPassword("");
      }
    }
  }
  async function logout() {
    if (!services || logoutPhase.current === "pending") return;
    const request = ++authRequest.current;
    // Clear immediately and fence observer callbacks until an explicit new login.
    // A rejected signOut must never revive the old session or race another login.
    logoutIntent.current = true;
    logoutPhase.current = "pending";
    setLogoutStatus("pending");
    setAuthBusy(false);
    clearContext();
    setProfile(null);
    setProfileReady(false);
    setSession(null);
    setPassword("");
    setAuthError("");
    setAuthNotice("");
    try {
      await signOut(services.auth);
      if (request !== authRequest.current) return;
      logoutPhase.current = "idle";
      setLogoutStatus("idle");
    } catch {
      if (request !== authRequest.current) return;
      logoutPhase.current = "failed";
      setLogoutStatus("failed");
      setAuthError(
        "Keluar dari akun belum berhasil. Data tetap disembunyikan. Coba keluar lagi sebelum masuk ke akun lain, atau tutup tab ini.",
      );
    }
  }
  async function verify(action: "send" | "refresh") {
    if (!session || authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    const request = ++authRequest.current;
    const user = session.user;
    try {
      if (action === "send") {
        await sendEmailVerification(user);
        if (request === authRequest.current)
          setAuthNotice("Email verifikasi dikirim. Periksa juga folder spam.");
      } else {
        await reload(user);
        await getIdToken(user, true);
        if (request === authRequest.current) {
          setSession({ user, verified: user.emailVerified });
          if (!user.emailVerified)
            setAuthNotice(
              "Email belum terverifikasi. Buka tautan verifikasi, lalu periksa kembali.",
            );
        }
      }
    } catch {
      if (request === authRequest.current)
        setAuthError(
          "Verifikasi belum berhasil. Tunggu sebentar dan coba kembali.",
        );
    } finally {
      if (request === authRequest.current) setAuthBusy(false);
    }
  }
  function reloadRecords() {
    clearPage();
    setCursorStack([null]);
    setPageIndex(0);
    setRefresh((value) => value + 1);
  }
  async function save(input: RecordInput) {
    if (!repository || !profile || !editor || !writable || operationBusy) return;
    const epoch = contextEpoch.current;
    setOperationBusy(true);
    setOperationError("");
    try {
      if (editor.record) {
        await repository.saveRecord(profile.unitId, input, editor.record);
      } else {
        createAttempt.current ??= {
          token: repository.createRecordAttempt(profile.unitId, input),
          input: { ...input },
        };
        await repository.saveRecord(
          profile.unitId,
          input,
          undefined,
          createAttempt.current.token,
        );
      }
      if (epoch !== contextEpoch.current) return;
      createAttempt.current = null;
      setEditor(null);
      reloadRecords();
      setNotice("Metadata tersimpan dan dikonfirmasi server.");
    } catch (error) {
      if (epoch === contextEpoch.current) {
        if (isPermissionError(error)) accessFailure();
        else {
          setOperationError(operationMessage(error, !editor.record));
          clearPage();
          setDataError(
            "Daftar perlu dimuat ulang setelah operasi yang belum berhasil.",
          );
        }
      }
    } finally {
      if (epoch === contextEpoch.current) setOperationBusy(false);
    }
  }
  async function archiveRecord(reason: string) {
    if (!repository || !profile || !archive || !writable || operationBusy)
      return;
    const epoch = contextEpoch.current;
    setOperationBusy(true);
    setOperationError("");
    try {
      await repository.archiveRecord(profile.unitId, archive, reason);
      if (epoch !== contextEpoch.current) return;
      setArchive(null);
      reloadRecords();
      setNotice("Metadata diarsipkan. Data tetap tersedia sebagai hanya-baca.");
    } catch (error) {
      if (epoch === contextEpoch.current) {
        if (isPermissionError(error)) accessFailure();
        else {
          setOperationError(operationMessage(error));
          clearPage();
          setDataError(
            "Daftar perlu dimuat ulang setelah operasi yang belum berhasil.",
          );
        }
      }
    } finally {
      if (epoch === contextEpoch.current) setOperationBusy(false);
    }
  }
  async function showHistory(record: RecordRow) {
    if (!repository || !profile || !active) return;
    const epoch = contextEpoch.current,
      request = ++historyRequest.current;
    setHistoryRecord(record);
    setHistory([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const rows = await repository.listHistory(profile.unitId, record.id);
      if (epoch === contextEpoch.current && request === historyRequest.current)
        setHistory(rows);
    } catch (error) {
      if (
        epoch === contextEpoch.current &&
        request === historyRequest.current
      ) {
        if (isPermissionError(error)) accessFailure();
        else
          setHistoryError(
            "Riwayat belum dapat dimuat. Tutup dialog dan coba kembali.",
          );
      }
    } finally {
      if (epoch === contextEpoch.current && request === historyRequest.current)
        setHistoryLoading(false);
    }
  }
  function exportPage() {
    if (!active || !records.length || recordsLoading) return;
    const objectUrl = URL.createObjectURL(
      new Blob([exportMetadataCsv(records)], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `simsa-metadata-halaman-${pageIndex + 1}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setNotice(
      "CSV halaman yang sedang ditampilkan telah diekspor. Ini bukan backup lengkap dan tidak mencakup seluruh riwayat.",
    );
  }

  if (configError || !services)
    return (
      <div className="entry-page">
        <Brand />
        <section className="entry-card">
          <span className="eyebrow">KONFIGURASI DIPERLUKAN</span>
          <h1>SIMSA belum terhubung</h1>
          <Notice kind="error">
            Konfigurasi Firebase belum lengkap atau tidak sesuai. Hubungi
            pengelola aplikasi.
          </Notice>
          <p className="muted">
            Tidak ada akses ke data atau penyimpanan lokal sementara.
          </p>
        </section>
      </div>
    );
  if (!authReady)
    return (
      <div className="entry-page">
        <Brand />
        <p role="status" className="loading-text">
          Memeriksa sesi aman…
        </p>
      </div>
    );
  if (!session)
    return (
      <div className="entry-page login-layout">
        <section className="login-story">
          <Brand />
          <span className="eyebrow">RUANG KERJA ARSIP FISIK</span>
          <h1>
            Arsip tertata.
            <br />
            <em>Informasi terjaga.</em>
          </h1>
          <p>
            Kelola metadata arsip unit Anda, temukan lokasinya, dan ikuti setiap
            perubahan yang tercatat.
          </p>
          <div className="story-chips">
            <span>Metadata terstruktur</span>
            <span>Akses per unit</span>
            <span>Riwayat versi</span>
          </div>
          <div className="pilot-note">
            PILOT · Data sintetis saja. Belum disetujui untuk arsip nyata. Tidak
            ada unggah berkas.
          </div>
        </section>
        <section className="entry-card login-card">
          <span className="eyebrow">SELAMAT DATANG</span>
          <h2>Masuk ke ruang kerja</h2>
          <p className="muted">
            Gunakan akun yang sudah disiapkan oleh pengelola.
          </p>
          {authError && <Notice kind="error">{authError}</Notice>}
          {logoutStatus === "pending" && (
            <Notice>Sedang keluar dari akun…</Notice>
          )}
          {logoutStatus === "failed" && (
            <button
              className="button secondary full"
              type="button"
              onClick={() => void logout()}
            >
              Coba keluar lagi
            </button>
          )}
          <form onSubmit={(event) => void authenticate("email", event)}>
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="username"
                maxLength={254}
                value={email}
                disabled={loginDisabled}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Kata sandi
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                disabled={loginDisabled}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              className="button primary full"
              type="submit"
              disabled={loginDisabled}
            >
              {authBusy ? "Memproses…" : "Masuk dengan email"}
            </button>
          </form>
          <div className="divider">
            <span>atau</span>
          </div>
          <button
            type="button"
            className="button secondary full"
            onClick={() => void authenticate("google")}
            disabled={loginDisabled}
          >
            <span className="google-mark" aria-hidden="true">
              G
            </span>
            Masuk dengan Google
          </button>
          <p className="entry-footnote">
            Pendaftaran mandiri tidak tersedia. Akses diberikan oleh pengelola
            sesuai unit kerja.
          </p>
        </section>
      </div>
    );

  if (!session.verified || !profileReady || !profile?.active || accessError)
    return (
      <div className="entry-page">
        <Brand />
        <section className="entry-card access-card">
          <span className="eyebrow">AKSES TERKENDALI</span>
          {!session.verified ? (
            <>
              <h1>Verifikasi email Anda</h1>
              <p className="muted">
                Akses metadata baru tersedia setelah email terverifikasi dan
                akun Anda diaktifkan oleh pengelola.
              </p>
              {authError && <Notice kind="error">{authError}</Notice>}
              {authNotice && <Notice>{authNotice}</Notice>}
              <div className="button-stack">
                <button
                  className="button primary"
                  onClick={() => void verify("refresh")}
                  disabled={authBusy}
                >
                  Saya sudah verifikasi
                </button>
                <button
                  className="button secondary"
                  onClick={() => void verify("send")}
                  disabled={authBusy}
                >
                  Kirim email verifikasi
                </button>
              </div>
            </>
          ) : !profileReady ? (
            <p role="status">Memeriksa akses unit…</p>
          ) : accessError ? (
            <>
              <h1>Akses belum tersedia</h1>
              <Notice kind="error">{accessError}</Notice>
            </>
          ) : profile && !profile.active ? (
            <>
              <h1>Akun belum aktif</h1>
              <p>
                Hubungi pengelola untuk mengaktifkan akses unit Anda. Tidak ada
                metadata yang ditampilkan.
              </p>
            </>
          ) : (
            <>
              <h1>Akun belum diprovisikan</h1>
              <p>
                Anda sudah masuk, tetapi profil unit belum tersedia. Minta
                pengelola menyiapkan akun dengan identitas berikut.
              </p>
              <code className="identity-code">{session.user.uid}</code>
            </>
          )}
          <button
            className="text-button access-signout"
            onClick={() => void logout()}
          >
            Keluar dari akun
          </button>
          <p className="entry-footnote">
            SIMSA Spark · Pilot metadata, tanpa penyimpanan berkas.
          </p>
        </section>
      </div>
    );

  const classificationName = (id: string) =>
    classifications.find((row) => row.id === id)?.code ?? id;
  const locationName = (id: string) =>
    locations.find((row) => row.id === id)?.name ?? id;
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">RUANG KERJA</div>
        <nav aria-label="Menu utama">
          {(
            [
              ["records", "Daftar arsip", "▤"],
              ["classifications", "Klasifikasi", "◈"],
              ["locations", "Lokasi fisik", "⌖"],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              className={`nav-button ${view === key ? "selected" : ""}`}
              aria-current={view === key ? "page" : undefined}
              onClick={() => setView(key)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="edition-badge">SPARK · METADATA ONLY</div>
          <p>Ringkas, terstruktur, dan terpisah per unit.</p>
          <span className="sidebar-caption">Tanpa unggah berkas</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="small-label">UNIT KERJA</span>
            <strong>
              {unit?.name ?? (catalogLoading ? "Memuat unit…" : "Unit Anda")}
            </strong>
          </div>
          <div className="account">
            <span className="avatar" aria-hidden="true">
              {profile.displayName.slice(0, 1).toUpperCase() || "U"}
            </span>
            <div>
              <strong>{profile.displayName}</strong>
              <span>{roleLabels[profile.role]}</span>
            </div>
            <button className="text-button" onClick={() => void logout()}>
              Keluar
            </button>
          </div>
        </header>
        <main id="main-content">
          <div className="pilot-banner">
            <span className="pilot-pill">PILOT</span>
            <p>
              Gunakan data sintetis saja. Belum disetujui untuk arsip nyata.{" "}
              <strong>Tidak ada unggah atau penyimpanan berkas.</strong>
            </p>
          </div>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {view === "records" ? "ARSIP UNIT ANDA" : "REFERENSI UNIT"}
              </span>
              <h1>
                {view === "records"
                  ? "Daftar arsip"
                  : view === "classifications"
                    ? "Klasifikasi arsip"
                    : "Lokasi penyimpanan fisik"}
              </h1>
              <p>
                {view === "records"
                  ? "Kelola informasi arsip dan lokasi fisiknya dalam satu ruang kerja."
                  : "Referensi dikelola oleh pengelola. Perubahan tidak tersedia dari aplikasi ini."}
              </p>
            </div>
            {view === "records" && canManage && (
              <button
                className="button primary"
                disabled={
                  !catalogReady ||
                  catalogLoading ||
                  !classifications.some((row) => row.active) ||
                  !locations.some((row) => row.active)
                }
                onClick={() => {
                  setOperationError("");
                  createAttempt.current = null;
                  setEditor({});
                }}
              >
                <span aria-hidden="true">＋</span>Tambah arsip
              </button>
            )}
          </div>
          {notice && <Notice kind="success">{notice}</Notice>}
          {catalogError && (
            <Notice kind="error">
              <p>{catalogError}</p>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  clearContext();
                  setContextVersion((version) => version + 1);
                }}
              >
                Coba muat referensi lagi
              </button>
            </Notice>
          )}
          {view === "records" ? (
            <>
              <div className="summary-strip">
                <div>
                  <span>Terlihat di halaman ini</span>
                  <strong>
                    {recordsLoading ? "—" : records.length}
                    <small>metadata</small>
                  </strong>
                </div>
                <div>
                  <span>Hak akses Anda</span>
                  <strong className="summary-word">
                    {canManage ? "Kelola metadata" : "Hanya baca"}
                  </strong>
                </div>
                <div>
                  <span>Penyimpanan</span>
                  <strong className="summary-word">
                    Arsip fisik <span className="status-dot" />
                  </strong>
                </div>
              </div>
              <section
                className="panel records-panel"
                aria-label="Metadata arsip"
              >
                <div className="panel-toolbar">
                  <form
                    className="search-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      clearPage();
                      setCursorStack([null]);
                      setPageIndex(0);
                      setFilter(search.trim());
                      setRefresh((value) => value + 1);
                    }}
                  >
                    <label htmlFor="reference-search">
                      Cari nomor referensi persis
                    </label>
                    <div className="search-controls">
                      <input
                        id="reference-search"
                        type="search"
                        maxLength={100}
                        placeholder="Contoh: ARS/2026/001"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      <button className="button secondary" type="submit">
                        Cari
                      </button>
                      {filter && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setSearch("");
                            setFilter("");
                            reloadRecords();
                          }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </form>
                  <div className="toolbar-actions">
                    <button
                      className="button secondary"
                      disabled={recordsLoading || !catalogReady}
                      onClick={reloadRecords}
                    >
                      Muat ulang
                    </button>
                    <button
                      className="button secondary"
                      disabled={!records.length || recordsLoading}
                      onClick={exportPage}
                    >
                      Ekspor halaman (CSV)
                    </button>
                  </div>
                </div>
                <p className="table-caption">
                  Urut berdasarkan pembaruan terbaru · Maksimal 25 metadata per
                  halaman. Ekspor halaman bukan backup lengkap.
                </p>
                {filter && (
                  <p className="filter-label">
                    Nomor referensi persis: <strong>{filter}</strong>
                  </p>
                )}
                {!catalogReady ? (
                  <div className="empty-state" role="status">
                    <h2>
                      {catalogLoading
                        ? "Memuat referensi unit…"
                        : "Referensi unit belum tersedia"}
                    </h2>
                    <p>
                      Daftar arsip akan dimuat setelah referensi unit berhasil
                      diperiksa.
                    </p>
                  </div>
                ) : dataError ? (
                  <div className="panel-message">
                    <Notice kind="error">{dataError}</Notice>
                  </div>
                ) : recordsLoading ? (
                  <div className="empty-state" role="status">
                    <span className="loading-orbit" aria-hidden="true" />
                    <h2>Memuat metadata…</h2>
                    <p>Memeriksa informasi terbaru dari database.</p>
                  </div>
                ) : records.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon" aria-hidden="true">
                      ▤
                    </span>
                    <h2>
                      {filter
                        ? "Nomor referensi tidak ditemukan"
                        : "Belum ada metadata arsip"}
                    </h2>
                    <p>
                      {filter
                        ? "Pencarian menggunakan nomor lengkap yang sama persis. Coba periksa ejaan atau reset pencarian."
                        : "Metadata akan muncul di sini setelah dicatat untuk unit Anda."}
                    </p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Arsip / referensi</th>
                          <th scope="col">Tanggal</th>
                          <th scope="col">Klasifikasi / lokasi</th>
                          <th scope="col">Status</th>
                          <th scope="col">Tindakan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record) => (
                          <tr key={record.id}>
                            <td>
                              <strong className="record-title">
                                {record.title}
                              </strong>
                              <span className="record-reference">
                                {record.referenceNumber}
                              </span>
                              <small>Versi {record.version}</small>
                            </td>
                            <td className="date-cell">
                              {dateLabel(record.recordDate)}
                            </td>
                            <td>
                              <span className="classification-code">
                                {classificationName(record.classificationId)}
                              </span>
                              <span className="record-reference">
                                {locationName(record.locationId)}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`status-badge status-${record.status}`}
                              >
                                {labels[record.status]}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className="text-button"
                                  aria-label={`Riwayat ${record.title}`}
                                  onClick={() => void showHistory(record)}
                                >
                                  Riwayat
                                </button>
                                {writable && record.status !== "archived" && (
                                  <>
                                    <button
                                      className="text-button"
                                      aria-label={`Edit ${record.title}`}
                                      onClick={() => {
                                        setOperationError("");
                                        createAttempt.current = null;
                                        setEditor({ record });
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="text-button archive-action"
                                      aria-label={`Arsipkan ${record.title}`}
                                      onClick={() => {
                                        setOperationError("");
                                        setArchive(record);
                                      }}
                                    >
                                      Arsipkan
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="pagination">
                  <span>
                    Halaman {pageIndex + 1} · {records.length} metadata
                    ditampilkan
                  </span>
                  <div>
                    <button
                      className="button secondary compact"
                      disabled={pageIndex === 0 || recordsLoading}
                      onClick={() => {
                        clearPage();
                        setPageIndex((index) => index - 1);
                      }}
                    >
                      Sebelumnya
                    </button>
                    <button
                      className="button secondary compact"
                      disabled={!hasMore || !nextCursor || recordsLoading}
                      onClick={() => {
                        if (!nextCursor) return;
                        const cursor = nextCursor;
                        clearPage();
                        setCursorStack((stack) => [
                          ...stack.slice(0, pageIndex + 1),
                          cursor,
                        ]);
                        setPageIndex((index) => index + 1);
                      }}
                    >
                      Berikutnya
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section className="panel catalog-panel">
              <div className="catalog-heading">
                <h2>
                  {view === "classifications"
                    ? "Referensi klasifikasi"
                    : "Referensi lokasi fisik"}
                </h2>
                <span className="read-only-badge">Hanya baca</span>
              </div>
              {catalogLoading ? (
                <p role="status">Memuat referensi…</p>
              ) : (
                <div className="catalog-grid">
                  {view === "classifications"
                    ? classifications.map((row) => (
                        <article className="catalog-card" key={row.id}>
                          <span className="catalog-code">{row.code}</span>
                          <h3>{row.name}</h3>
                          <span
                            className={`status-badge ${row.active ? "status-active" : "status-archived"}`}
                          >
                            {row.active ? "Aktif" : "Nonaktif"}
                          </span>
                        </article>
                      ))
                    : locations.map((row) => (
                        <article className="catalog-card" key={row.id}>
                          <span className="catalog-symbol" aria-hidden="true">
                            ⌖
                          </span>
                          <h3>{row.name}</h3>
                          <p>
                            {row.description || "Tidak ada deskripsi tambahan."}
                          </p>
                          <span
                            className={`status-badge ${row.active ? "status-active" : "status-archived"}`}
                          >
                            {row.active ? "Aktif" : "Nonaktif"}
                          </span>
                        </article>
                      ))}
                </div>
              )}
              {!catalogLoading &&
                (view === "classifications"
                  ? classifications.length
                  : locations.length) === 0 && (
                  <div className="empty-state">
                    <h2>Referensi belum tersedia</h2>
                    <p>Hubungi pengelola untuk menyiapkan referensi unit.</p>
                  </div>
                )}
            </section>
          )}
          <footer className="workspace-footer">
            <span>SIMSA Spark Edition</span>
            <span>
              Metadata & arsip fisik · Riwayat perubahan terbatas, bukan audit
              keamanan independen.
            </span>
          </footer>
        </main>
      </div>
      {editor && writable && (
        <RecordEditor
          record={editor.record}
          classifications={classifications}
          locations={locations}
          busy={operationBusy}
          error={operationError}
          retryInput={createAttempt.current?.input}
          onClose={() => {
            createAttempt.current = null;
            setEditor(null);
          }}
          onSave={save}
        />
      )}
      {archive && writable && (
        <ArchiveDialog
          record={archive}
          busy={operationBusy}
          error={operationError}
          onClose={() => setArchive(null)}
          onArchive={archiveRecord}
        />
      )}
      {historyRecord && (
        <Modal
          title="Riwayat metadata"
          onClose={() => {
            historyRequest.current++;
            setHistoryRecord(null);
            setHistory([]);
          }}
        >
          <p>
            <strong>{historyRecord.title}</strong>
          </p>
          <p className="muted">
            Maksimal 25 versi terbaru. Catatan perubahan metadata ini bukan
            audit keamanan independen.
          </p>
          {historyLoading ? (
            <p role="status">Memuat riwayat…</p>
          ) : historyError ? (
            <Notice kind="error">{historyError}</Notice>
          ) : history.length ? (
            <ol className="history-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <div className="history-meta">
                    <strong>Versi {entry.snapshot.version}</strong>
                    <span
                      className={`status-badge status-${entry.snapshot.status}`}
                    >
                      {labels[entry.snapshot.status]}
                    </span>
                  </div>
                  <time>{timestampLabel(entry.at)}</time>
                  <h3>{entry.snapshot.title}</h3>
                  <dl>
                    <div>
                      <dt>Nomor referensi</dt>
                      <dd>{entry.snapshot.referenceNumber}</dd>
                    </div>
                    <div>
                      <dt>Tanggal arsip</dt>
                      <dd>{dateLabel(entry.snapshot.recordDate)}</dd>
                    </div>
                    <div>
                      <dt>Klasifikasi / lokasi</dt>
                      <dd>
                        {classificationName(entry.snapshot.classificationId)} ·{" "}
                        {locationName(entry.snapshot.locationId)}
                      </dd>
                    </div>
                    {entry.snapshot.description && (
                      <div>
                        <dt>Deskripsi</dt>
                        <dd>{entry.snapshot.description}</dd>
                      </div>
                    )}
                    {entry.snapshot.archiveReason && (
                      <div>
                        <dt>Alasan pengarsipan</dt>
                        <dd>{entry.snapshot.archiveReason}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Identitas pelaku</dt>
                      <dd className="actor-id">{entry.actorUid}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Belum ada riwayat yang dapat ditampilkan.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
