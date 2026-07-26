import { db } from '../config/database';
import { suratMasuk, suratKeluar, arsip, dosir } from '../db/schema';
import { sql, or, ilike, desc, and, eq, isNull } from 'drizzle-orm';

export interface GlobalSearchParams {
    query: string;
    unitKerjaId?: string;
    modules?: ('surat_masuk' | 'surat_keluar' | 'arsip' | 'dosir')[];
    tahun?: number;
    limit?: number;
    page?: number;
}

export interface GlobalSearchResult {
    type: 'surat_masuk' | 'surat_keluar' | 'arsip' | 'dosir';
    id: string;
    title: string;
    subtitle: string;
    excerpt: string;
    matchedIn: string[];
    createdAt: Date;
    metadata: Record<string, any>;
}

export interface GlobalSearchResponse {
    results: GlobalSearchResult[];
    counts: {
        surat_masuk: number;
        surat_keluar: number;
        arsip: number;
        dosir: number;
        total: number;
    };
    pagination: {
        page: number;
        limit: number;
        total: number;
    };
}

interface ModuleSearchResult {
    items: GlobalSearchResult[];
    total: number;
}

class GlobalSearchService {
    private readonly DEFAULT_LIMIT = 20;
    private readonly MAX_LIMIT = 100;
    // Upper bound on rows pulled per module before merging; caps the cost of deep paging
    private readonly MAX_SCAN = 1000;

    /**
     * Search across all modules
     */
    async search(params: GlobalSearchParams): Promise<GlobalSearchResponse> {
        const {
            query,
            unitKerjaId,
            modules = ['surat_masuk', 'surat_keluar', 'arsip', 'dosir'],
            tahun,
            limit = this.DEFAULT_LIMIT,
            page = 1
        } = params;

        if (!query || query.trim().length < 2) {
            return this.emptyResponse();
        }

        const searchTerms = this.extractSearchTerms(query);
        const results: GlobalSearchResult[] = [];
        const counts = { surat_masuk: 0, surat_keluar: 0, arsip: 0, dosir: 0, total: 0 };

        const effectiveLimit = Math.min(Math.max(Math.trunc(limit) || this.DEFAULT_LIMIT, 1), this.MAX_LIMIT);
        const effectivePage = Math.max(Math.trunc(page) || 1, 1);
        // Every module must contribute enough rows to cover the requested page after merging
        const fetchLimit = Math.min(effectivePage * effectiveLimit, this.MAX_SCAN);

        // Search each module in parallel
        const searchPromises: Promise<void>[] = [];

        if (modules.includes('surat_masuk')) {
            searchPromises.push(
                this.searchSuratMasuk(searchTerms, unitKerjaId, tahun, fetchLimit).then(({ items, total }) => {
                    counts.surat_masuk = total;
                    results.push(...items);
                })
            );
        }

        if (modules.includes('surat_keluar')) {
            searchPromises.push(
                this.searchSuratKeluar(searchTerms, unitKerjaId, tahun, fetchLimit).then(({ items, total }) => {
                    counts.surat_keluar = total;
                    results.push(...items);
                })
            );
        }

        if (modules.includes('arsip')) {
            searchPromises.push(
                this.searchArsip(searchTerms, unitKerjaId, fetchLimit).then(({ items, total }) => {
                    counts.arsip = total;
                    results.push(...items);
                })
            );
        }

        if (modules.includes('dosir')) {
            searchPromises.push(
                this.searchDosir(searchTerms, unitKerjaId, fetchLimit).then(({ items, total }) => {
                    counts.dosir = total;
                    results.push(...items);
                })
            );
        }

        await Promise.all(searchPromises);

        // Sort by relevance (most recent first for now)
        results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        counts.total = counts.surat_masuk + counts.surat_keluar + counts.arsip + counts.dosir;

        // Paginate
        const offset = (effectivePage - 1) * effectiveLimit;
        const paginatedResults = results.slice(offset, offset + effectiveLimit);

        return {
            results: paginatedResults,
            counts,
            pagination: {
                page: effectivePage,
                limit: effectiveLimit,
                total: counts.total
            }
        };
    }

    /**
     * Search in file content (OCR extracted text)
     */
    async searchByContent(query: string, unitKerjaId?: string): Promise<GlobalSearchResult[]> {
        const searchTerms = this.extractSearchTerms(query);
        if (searchTerms.length === 0) return [];

        const likePattern = `%${searchTerms.join('%')}%`;

        const arsipResults = await db
            .select()
            .from(arsip)
            .where(and(
                ilike(arsip.extractedText, likePattern),
                unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined
            ))
            .limit(50);

        return arsipResults.map(row => ({
            type: 'arsip' as const,
            id: row.id,
            title: row.nomorSuratOriginal || 'Arsip',
            subtitle: row.uraianBerkas || '',
            excerpt: this.highlightExcerpt(row.extractedText || '', searchTerms),
            matchedIn: ['content'],
            createdAt: row.createdAt,
            metadata: {
                kodeKlasifikasi: row.kodeKlasifikasi,
                jenisArsip: row.jenisArsip
            }
        }));
    }

    /**
     * Search Surat Masuk
     */
    private async searchSuratMasuk(
        terms: string[],
        unitKerjaId: string | undefined,
        tahun: number | undefined,
        fetchLimit: number
    ): Promise<ModuleSearchResult> {
        const conditions: any[] = [
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),  // Exclude soft-deleted records (NULL-safe)
        ];

        // Build search conditions
        for (const term of terms) {
            conditions.push(
                or(
                    ilike(suratMasuk.nomorSurat, `%${term}%`),
                    ilike(suratMasuk.perihal, `%${term}%`),
                    ilike(suratMasuk.dari, `%${term}%`),
                    ilike(suratMasuk.kepada, `%${term}%`),
                    ilike(suratMasuk.keterangan, `%${term}%`)
                )
            );
        }

        if (unitKerjaId) {
            conditions.push(eq(suratMasuk.unitKerjaId, unitKerjaId));
        }
        if (tahun) {
            conditions.push(eq(suratMasuk.tahun, tahun));
        }

        const whereClause = and(...conditions);

        const [countResult, rows] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(suratMasuk)
                .where(whereClause),
            db
                .select()
                .from(suratMasuk)
                .where(whereClause)
                .orderBy(desc(suratMasuk.createdAt))
                .limit(fetchLimit),
        ]);

        const items = rows.map(row => {
            const matchedIn: string[] = [];
            const searchText = terms.join(' ').toLowerCase();

            if (row.nomorSurat?.toLowerCase().includes(searchText)) matchedIn.push('nomor');
            if (row.perihal?.toLowerCase().includes(searchText)) matchedIn.push('perihal');
            if (row.dari?.toLowerCase().includes(searchText)) matchedIn.push('dari');

            return {
                type: 'surat_masuk' as const,
                id: row.id,
                title: row.nomorSurat || `SM-${row.noUrut}/${row.tahun}`,
                subtitle: row.dari || '',
                excerpt: row.perihal || '',
                matchedIn: matchedIn.length > 0 ? matchedIn : ['perihal'],
                createdAt: row.createdAt,
                metadata: {
                    tanggalSurat: row.tanggalSurat,
                    status: row.status,
                    jenisSurat: row.jenisSurat
                }
            };
        });

        return { items, total: countResult[0]?.count ?? 0 };
    }

    /**
     * Search Surat Keluar
     */
    private async searchSuratKeluar(
        terms: string[],
        unitKerjaId: string | undefined,
        tahun: number | undefined,
        fetchLimit: number
    ): Promise<ModuleSearchResult> {
        const conditions: any[] = [
            or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted)),  // Exclude soft-deleted records (NULL-safe)
        ];

        for (const term of terms) {
            conditions.push(
                or(
                    ilike(suratKeluar.nomorSurat, `%${term}%`),
                    ilike(suratKeluar.perihal, `%${term}%`),
                    ilike(suratKeluar.kepada, `%${term}%`)
                )
            );
        }

        if (unitKerjaId) {
            conditions.push(eq(suratKeluar.unitKerjaId, unitKerjaId));
        }
        if (tahun) {
            conditions.push(eq(suratKeluar.tahun, tahun));
        }

        const whereClause = and(...conditions);

        const [countResult, rows] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(suratKeluar)
                .where(whereClause),
            db
                .select()
                .from(suratKeluar)
                .where(whereClause)
                .orderBy(desc(suratKeluar.createdAt))
                .limit(fetchLimit),
        ]);

        const items = rows.map(row => ({
            type: 'surat_keluar' as const,
            id: row.id,
            title: row.nomorSurat || `SK-${row.noUrut}/${row.tahun}`,
            subtitle: row.kepada || '',
            excerpt: row.perihal || '',
            matchedIn: ['perihal'],
            createdAt: row.createdAt,
            metadata: {
                tanggalSurat: row.tanggalSurat,
                naskahDinas: row.naskahDinas
            }
        }));

        return { items, total: countResult[0]?.count ?? 0 };
    }

    /**
     * Search Arsip
     */
    private async searchArsip(
        terms: string[],
        unitKerjaId: string | undefined,
        fetchLimit: number
    ): Promise<ModuleSearchResult> {
        const conditions = [];

        for (const term of terms) {
            conditions.push(
                or(
                    ilike(arsip.nomorSuratOriginal, `%${term}%`),
                    ilike(arsip.perihalOriginal, `%${term}%`),
                    ilike(arsip.uraianBerkas, `%${term}%`),
                    ilike(arsip.kodeKlasifikasi, `%${term}%`),
                    ilike(arsip.keterangan, `%${term}%`)
                )
            );
        }

        if (unitKerjaId) {
            conditions.push(eq(arsip.unitKerjaId, unitKerjaId));
        }

        const whereClause = and(...conditions);

        const [countResult, rows] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(arsip)
                .where(whereClause),
            db
                .select()
                .from(arsip)
                .where(whereClause)
                .orderBy(desc(arsip.createdAt))
                .limit(fetchLimit),
        ]);

        const items = rows.map(row => ({
            type: 'arsip' as const,
            id: row.id,
            title: row.nomorSuratOriginal || row.kodeKlasifikasi || 'Arsip',
            subtitle: row.kodeKlasifikasi || '',
            excerpt: row.uraianBerkas || row.perihalOriginal || '',
            matchedIn: ['uraian'],
            createdAt: row.createdAt,
            metadata: {
                jenisArsip: row.jenisArsip,
                tingkatPerkembangan: row.tingkatPerkembangan,
            }
        }));

        return { items, total: countResult[0]?.count ?? 0 };
    }

    /**
     * Search Dosir
     */
    private async searchDosir(
        terms: string[],
        unitKerjaId: string | undefined,
        fetchLimit: number
    ): Promise<ModuleSearchResult> {
        const conditions = [];

        for (const term of terms) {
            conditions.push(
                or(
                    ilike(dosir.judul, `%${term}%`),
                    ilike(dosir.kode, `%${term}%`),
                    ilike(dosir.deskripsi, `%${term}%`)
                )
            );
        }

        if (unitKerjaId) {
            conditions.push(eq(dosir.unitKerjaId, unitKerjaId));
        }

        const whereClause = and(...conditions);

        const [countResult, rows] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(dosir)
                .where(whereClause),
            db
                .select()
                .from(dosir)
                .where(whereClause)
                .orderBy(desc(dosir.createdAt))
                .limit(fetchLimit),
        ]);

        const items = rows.map(row => ({
            type: 'dosir' as const,
            id: row.id,
            title: row.judul,
            subtitle: row.kode || '',
            excerpt: row.deskripsi || '',
            matchedIn: ['judul'],
            createdAt: row.createdAt,
            metadata: {
                kategori: row.kategori,
                status: row.status
            }
        }));

        return { items, total: countResult[0]?.count ?? 0 };
    }

    /**
     * Extract search terms from query
     */
    private extractSearchTerms(query: string): string[] {
        return query
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(term => term.length > 1);
    }

    /**
     * Highlight matching text in excerpt
     */
    private highlightExcerpt(text: string, terms: string[]): string {
        if (!text) return '';

        let excerpt = text.substring(0, 200);

        terms.forEach(term => {
            const regex = new RegExp(`(${term})`, 'gi');
            excerpt = excerpt.replace(regex, '**$1**');
        });

        return excerpt + (text.length > 200 ? '...' : '');
    }

    /**
     * Empty response helper
     */
    private emptyResponse(): GlobalSearchResponse {
        return {
            results: [],
            counts: { surat_masuk: 0, surat_keluar: 0, arsip: 0, dosir: 0, total: 0 },
            pagination: { page: 1, limit: 20, total: 0 }
        };
    }
}

export const globalSearchService = new GlobalSearchService();
