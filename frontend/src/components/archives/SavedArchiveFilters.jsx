import { useId, useState } from 'react';
import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const MAX_FILTERS = 20;
const MAX_NAME_LENGTH = 60;

function validatedFilters(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { tab, search, tahun, unitKerjaId, pageSize } = value;
    if (!['masuk', 'keluar'].includes(tab)
        || typeof search !== 'string' || search.length > 255
        || typeof tahun !== 'string'
        || (tahun !== 'all' && (!/^\d{4}$/.test(tahun) || Number(tahun) < 2000 || Number(tahun) > 2100))
        || typeof unitKerjaId !== 'string' || unitKerjaId.length > 100
        || ![10, 25, 50].includes(pageSize)) return null;
    // Copy only filter fields: archive records and other page state never enter storage.
    return { tab, search, tahun, unitKerjaId, pageSize };
}

function nameKey(name) {
    return name.toLocaleLowerCase('id-ID');
}

function readFilters(storageKey) {
    let raw;
    try {
        raw = window.localStorage.getItem(storageKey);
    } catch {
        return { entries: [], error: 'Penyimpanan browser tidak dapat diakses. Filter belum disimpan.', unavailable: true };
    }
    if (!raw) return { entries: [], error: '', unavailable: false };
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Invalid saved filters');
        const entries = [];
        const names = new Set();
        for (const entry of parsed) {
            const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
            const filters = validatedFilters(entry?.filters);
            if (!name || name.length > MAX_NAME_LENGTH || !filters || names.has(nameKey(name))) continue;
            names.add(nameKey(name));
            if (entries.length < MAX_FILTERS) entries.push({ name, filters });
        }
        return {
            entries,
            error: entries.length !== parsed.length ? 'Sebagian filter tersimpan tidak valid dan tidak ditampilkan.' : '',
            unavailable: false,
        };
    } catch {
        return { entries: [], error: 'Data filter tersimpan rusak. Simpan filter baru untuk menggantinya.', unavailable: false };
    }
}

function SavedArchiveFiltersForUser({ userId, filters, onApply }) {
    const storageKey = userId ? `simsa:archive-filters:v1:${userId}` : null;
    const [saved, setSaved] = useState(() => storageKey
        ? readFilters(storageKey)
        : { entries: [], error: '', unavailable: false });
    const [saveOpen, setSaveOpen] = useState(false);
    const [listOpen, setListOpen] = useState(false);
    const [name, setName] = useState('');
    const [nameError, setNameError] = useState('');
    const [message, setMessage] = useState('');
    const nameId = useId();
    const noteId = useId();
    const errorId = useId();

    const refreshSaved = () => {
        if (!storageKey) return null;
        const current = readFilters(storageKey);
        setSaved(current);
        return current;
    };

    const persist = (entries, successMessage) => {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(entries));
            setSaved({ entries, error: '', unavailable: false });
            setMessage(successMessage);
            return true;
        } catch {
            setMessage('');
            setSaved((current) => ({
                ...current,
                error: 'Perubahan filter gagal disimpan. Periksa izin atau ruang penyimpanan browser.',
            }));
            return false;
        }
    };

    const saveFilter = (event) => {
        event.preventDefault();
        setMessage('');
        const trimmedName = name.trim();
        if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
            setNameError(`Isi nama filter, maksimal ${MAX_NAME_LENGTH} karakter.`);
            return;
        }
        setNameError('');
        const nextFilters = validatedFilters(filters);
        if (!nextFilters) {
            setSaved((current) => ({ ...current, error: 'Filter saat ini tidak valid dan belum disimpan.' }));
            return;
        }
        const current = refreshSaved();
        if (!current || current.unavailable) return;
        const existingIndex = current.entries.findIndex((entry) => nameKey(entry.name) === nameKey(trimmedName));
        if (existingIndex === -1 && current.entries.length >= MAX_FILTERS) {
            setSaved({ ...current, error: 'Maksimal 20 filter tersimpan. Hapus salah satu atau gunakan nama yang sudah ada.' });
            return;
        }
        const entries = [...current.entries];
        const nextEntry = { name: trimmedName, filters: nextFilters };
        if (existingIndex === -1) entries.push(nextEntry);
        else entries[existingIndex] = nextEntry;
        if (persist(entries, `Filter “${trimmedName}” tersimpan.`)) {
            setSaveOpen(false);
            setName('');
        }
    };

    const deleteFilter = (entry) => {
        setMessage('');
        const current = refreshSaved();
        if (!current || current.unavailable) return;
        persist(current.entries.filter((item) => nameKey(item.name) !== nameKey(entry.name)), `Filter “${entry.name}” dihapus.`);
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Popover open={saveOpen} onOpenChange={(open) => {
                setSaveOpen(open);
                if (open) {
                    setListOpen(false);
                    setNameError('');
                    setMessage('');
                }
            }}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={!storageKey}>
                        <BookmarkPlus aria-hidden="true" />
                        Simpan filter
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]" aria-label="Simpan filter arsip">
                    <form onSubmit={saveFilter} className="space-y-3">
                        <label htmlFor={nameId} className="text-sm font-medium">Nama filter</label>
                        <Input id={nameId} value={name} onChange={(event) => {
                            setName(event.target.value);
                            setNameError('');
                        }} maxLength={MAX_NAME_LENGTH} placeholder="Contoh: Surat masuk tahun ini"
                        aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${noteId} ${errorId}` : noteId} />
                        <p id={noteId} className="text-xs text-muted-foreground">Tersimpan di browser ini. Nama yang sama akan memperbarui filter.</p>
                        {nameError && <p id={errorId} role="alert" className="text-sm text-destructive">{nameError}</p>}
                        <Button type="submit" size="sm">Simpan</Button>
                    </form>
                </PopoverContent>
            </Popover>
            <Popover open={listOpen} onOpenChange={(open) => {
                setListOpen(open);
                if (open) {
                    setSaveOpen(false);
                    setMessage('');
                    refreshSaved();
                }
            }}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={!storageKey}>
                        <Bookmark aria-hidden="true" />
                        Filter tersimpan{saved.entries.length > 0 ? ` (${saved.entries.length})` : ''}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]" aria-label="Filter arsip tersimpan">
                    <p className="text-sm font-medium">Filter tersimpan</p>
                    <p className="mt-1 text-xs text-muted-foreground">Tersimpan di browser ini.</p>
                    {saved.entries.length === 0 ? (
                        <p className="mt-4 text-sm text-muted-foreground">Belum ada filter tersimpan. Atur filter arsip, lalu pilih Simpan filter.</p>
                    ) : (
                        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto" aria-label="Daftar filter tersimpan">
                            {saved.entries.map((entry) => (
                                <li key={nameKey(entry.name)} className="flex items-center gap-2 rounded-md border p-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="break-words text-sm font-medium">{entry.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {entry.filters.tab === 'masuk' ? 'Surat masuk' : 'Surat keluar'} · {entry.filters.tahun === 'all' ? 'Semua tahun' : entry.filters.tahun}
                                        </p>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" aria-label={`Terapkan filter ${entry.name}`} onClick={() => {
                                        onApply({ ...entry.filters });
                                        setListOpen(false);
                                        setMessage(`Filter “${entry.name}” diterapkan.`);
                                    }}>Terapkan</Button>
                                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Hapus filter ${entry.name}`} onClick={() => deleteFilter(entry)}>
                                        <Trash2 aria-hidden="true" />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </PopoverContent>
            </Popover>
            {saved.error && <p role="alert" className="w-full text-sm text-destructive">{saved.error}</p>}
            {message && <p role="status" className="w-full text-sm text-muted-foreground">{message}</p>}
        </div>
    );
}

export function SavedArchiveFilters({ userId, filters, onApply }) {
    const identity = (typeof userId === 'string' || typeof userId === 'number') ? String(userId).trim() : '';
    // Remount synchronously on identity changes, including an open popover and its draft name.
    return <SavedArchiveFiltersForUser key={identity} userId={identity} filters={filters} onApply={onApply} />;
}

export default SavedArchiveFilters;
