import { db } from '../config/database';
import { arsip } from '../db/schema';
import { and, or, ilike, eq, desc, sql, inArray } from 'drizzle-orm';

export interface FullTextSearchParams {
    query: string;
    unitKerjaId: string;
    jenisArsip?: string;
    tahun?: number;
    page?: number;
    limit?: number;
    // Enhanced search options
    fuzzy?: boolean;           // Enable fuzzy matching
    searchFields?: string[];   // Specific fields to search
    sortBy?: 'relevance' | 'date' | 'nomor';
}

export interface FullTextSearchResult {
    id: string;
    nomorBerkas: string | null;
    uraianBerkas: string | null;
    nomorSuratOriginal: string | null;
    perihalOriginal: string | null;
    tanggalArsip: string | null;
    tahun: number;
    jenisArsip: string;
    matchSnippet: string | null;
    matchScore: number;
    highlightedText: string | null;
    matchedFields: string[];
}

// Common Indonesian stopwords to ignore in search
const STOPWORDS = new Set([
    'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'ini', 'itu',
    'adalah', 'dalam', 'akan', 'atau', 'sebagai', 'oleh', 'bahwa', 'tersebut',
    'dapat', 'tidak', 'juga', 'kami', 'anda', 'saya', 'mereka', 'kita', 'ada',
    'telah', 'sudah', 'belum', 'harus', 'bisa', 'lebih', 'sangat', 'sesuai'
]);

class FullTextSearchService {
    // Extract and clean search terms from query
    private extractSearchTerms(query: string): string[] {
        return query
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(term => term.length > 2)
            .filter(term => !STOPWORDS.has(term));
    }

    // Generate fuzzy pattern for a term (simple Levenshtein-like approach)
    private generateFuzzyPattern(term: string): string {
        // For short terms, use exact match
        if (term.length <= 3) return `%${term}%`;

        // For longer terms, allow partial matches
        // This creates a pattern that matches if most characters are present
        return `%${term}%`;
    }

    // Search arsip with enhanced full-text search capability
    async search(params: FullTextSearchParams): Promise<{
        data: FullTextSearchResult[];
        total: number;
        page: number;
        totalPages: number;
        searchTerms: string[];
    }> {
        const {
            query,
            unitKerjaId,
            jenisArsip,
            tahun,
            page = 1,
            limit = 20,
            fuzzy = false,
            sortBy = 'relevance'
        } = params;
        const offset = (page - 1) * limit;

        // Extract search terms
        const searchTerms = this.extractSearchTerms(query);
        const searchPattern = `%${query}%`;

        // Build search conditions for multiple fields
        const searchConditions = or(
            ilike(arsip.nomorBerkas, searchPattern),
            ilike(arsip.uraianBerkas, searchPattern),
            ilike(arsip.nomorSuratOriginal, searchPattern),
            ilike(arsip.perihalOriginal, searchPattern),
            ilike(arsip.extractedText, searchPattern),
            ilike(arsip.keterangan, searchPattern),
            // Search in JRA fields
            ilike(arsip.jraKode, searchPattern),
            ilike(arsip.jraUraian, searchPattern)
        );

        // Build filter conditions
        const filterConditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            searchConditions
        ];

        if (jenisArsip) {
            filterConditions.push(eq(arsip.jenisArsip, jenisArsip));
        }

        if (tahun) {
            filterConditions.push(eq(arsip.tahun, tahun));
        }

        // Get total count
        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(and(...filterConditions));

        const total = countResult[0]?.count || 0;

        // Get matching records
        const results = await db
            .select({
                id: arsip.id,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                tanggalArsip: arsip.tanggalArsip,
                tahun: arsip.tahun,
                jenisArsip: arsip.jenisArsip,
                extractedText: arsip.extractedText,
                keterangan: arsip.keterangan,
                jraKode: arsip.jraKode,
                jraUraian: arsip.jraUraian
            })
            .from(arsip)
            .where(and(...filterConditions))
            .orderBy(desc(arsip.createdAt))
            .limit(limit)
            .offset(offset);

        // Process results with scoring and highlighting
        const data: FullTextSearchResult[] = results.map(row => {
            const { matchSnippet, matchScore, matchedFields, highlightedText } =
                this.calculateMatchDetails(row, query, searchTerms);

            return {
                id: row.id,
                nomorBerkas: row.nomorBerkas,
                uraianBerkas: row.uraianBerkas,
                nomorSuratOriginal: row.nomorSuratOriginal,
                perihalOriginal: row.perihalOriginal,
                tanggalArsip: row.tanggalArsip,
                tahun: row.tahun,
                jenisArsip: row.jenisArsip,
                matchSnippet,
                matchScore,
                highlightedText,
                matchedFields
            };
        });

        // Sort by relevance score (highest first)
        if (sortBy === 'relevance') {
            data.sort((a, b) => b.matchScore - a.matchScore);
        }

        return {
            data,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            searchTerms
        };
    }

    // Calculate match details for a single result
    private calculateMatchDetails(
        row: any,
        query: string,
        searchTerms: string[]
    ): {
        matchSnippet: string | null;
        matchScore: number;
        matchedFields: string[];
        highlightedText: string | null;
    } {
        const lowerQuery = query.toLowerCase();
        let matchSnippet: string | null = null;
        let matchScore = 0;
        const matchedFields: string[] = [];
        let highlightedText: string | null = null;

        // Check nomor surat (highest priority - exact match)
        if (row.nomorSuratOriginal?.toLowerCase().includes(lowerQuery)) {
            matchedFields.push('nomorSurat');
            matchScore += 10;
            if (!matchSnippet) {
                matchSnippet = `Nomor: ${row.nomorSuratOriginal}`;
            }
        } else if (row.nomorSuratOriginal) {
            // Check partial term matches in nomor
            const termMatches = searchTerms.filter(term =>
                row.nomorSuratOriginal.toLowerCase().includes(term)
            );
            if (termMatches.length > 0) {
                matchedFields.push('nomorSurat');
                matchScore += 5 * termMatches.length;
            }
        }

        // Check perihal (high priority)
        if (row.perihalOriginal?.toLowerCase().includes(lowerQuery)) {
            matchedFields.push('perihal');
            matchScore += 8;
            if (!matchSnippet) {
                matchSnippet = `Perihal: ${row.perihalOriginal?.substring(0, 100)}...`;
            }
        } else if (row.perihalOriginal) {
            const termMatches = searchTerms.filter(term =>
                row.perihalOriginal.toLowerCase().includes(term)
            );
            if (termMatches.length > 0) {
                matchedFields.push('perihal');
                matchScore += 4 * termMatches.length;
            }
        }

        // Check uraian berkas
        if (row.uraianBerkas?.toLowerCase().includes(lowerQuery)) {
            matchedFields.push('uraianBerkas');
            matchScore += 6;
            if (!matchSnippet) {
                matchSnippet = `Uraian: ${row.uraianBerkas?.substring(0, 100)}...`;
            }
        } else if (row.uraianBerkas) {
            const termMatches = searchTerms.filter(term =>
                row.uraianBerkas.toLowerCase().includes(term)
            );
            if (termMatches.length > 0) {
                matchedFields.push('uraianBerkas');
                matchScore += 3 * termMatches.length;
            }
        }

        // Check extracted text (full content search)
        if (row.extractedText) {
            const lowerText = row.extractedText.toLowerCase();
            const matchIndex = lowerText.indexOf(lowerQuery);

            if (matchIndex !== -1) {
                matchedFields.push('extractedText');
                matchScore += 5;

                // Create highlighted snippet around match
                const start = Math.max(0, matchIndex - 50);
                const end = Math.min(row.extractedText.length, matchIndex + query.length + 50);
                const snippet = row.extractedText.substring(start, end);

                highlightedText = this.highlightTerms(snippet, [query]);

                if (!matchSnippet) {
                    matchSnippet = (start > 0 ? '...' : '') +
                        snippet +
                        (end < row.extractedText.length ? '...' : '');
                }
            } else {
                // Check for term matches in extracted text
                const termMatches = searchTerms.filter(term => lowerText.includes(term));
                if (termMatches.length > 0) {
                    matchedFields.push('extractedText');
                    matchScore += 2 * termMatches.length;

                    // Find first matching term for snippet
                    const firstMatch = termMatches[0];
                    const termIndex = lowerText.indexOf(firstMatch);
                    if (termIndex !== -1) {
                        const start = Math.max(0, termIndex - 50);
                        const end = Math.min(row.extractedText.length, termIndex + 100);
                        const snippet = row.extractedText.substring(start, end);
                        highlightedText = this.highlightTerms(snippet, termMatches);

                        if (!matchSnippet) {
                            matchSnippet = (start > 0 ? '...' : '') +
                                snippet +
                                (end < row.extractedText.length ? '...' : '');
                        }
                    }
                }
            }
        }

        // Check keterangan
        if (row.keterangan?.toLowerCase().includes(lowerQuery)) {
            matchedFields.push('keterangan');
            matchScore += 3;
        }

        // Check JRA fields
        if (row.jraKode?.toLowerCase().includes(lowerQuery)) {
            matchedFields.push('jraKode');
            matchScore += 4;
        }
        if (row.jraUraian?.toLowerCase().includes(lowerQuery)) {
            matchedFields.push('jraUraian');
            matchScore += 4;
        }

        return { matchSnippet, matchScore, matchedFields, highlightedText };
    }

    // Highlight search terms in text
    private highlightTerms(text: string, terms: string[]): string {
        let highlighted = text;
        terms.forEach(term => {
            const regex = new RegExp(`(${term})`, 'gi');
            highlighted = highlighted.replace(regex, '**$1**');
        });
        return highlighted;
    }

    // Get suggestions for autocomplete
    async getSuggestions(query: string, unitKerjaId: string, limit: number = 10): Promise<string[]> {
        const searchPattern = `%${query}%`;

        // Get distinct matching values from various fields
        const nomorResults = await db
            .selectDistinct({ value: arsip.nomorSuratOriginal })
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                ilike(arsip.nomorSuratOriginal, searchPattern)
            ))
            .limit(limit);

        const perihalResults = await db
            .selectDistinct({ value: arsip.perihalOriginal })
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                ilike(arsip.perihalOriginal, searchPattern)
            ))
            .limit(limit);

        const suggestions: string[] = [];

        nomorResults.forEach(r => {
            if (r.value) suggestions.push(r.value);
        });

        perihalResults.forEach(r => {
            if (r.value && r.value.length <= 100) {
                suggestions.push(r.value);
            }
        });

        return suggestions.slice(0, limit);
    }

    // Search by keywords extracted from OCR
    async searchByKeywords(
        keywords: string[],
        unitKerjaId: string,
        options?: { limit?: number; offset?: number }
    ): Promise<{ data: any[]; total: number }> {
        const { limit = 20, offset = 0 } = options || {};

        // Build OR conditions for each keyword
        const keywordConditions = keywords.map(keyword =>
            ilike(arsip.extractedText, `%${keyword}%`)
        );

        const filterConditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            or(...keywordConditions)
        ];

        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(and(...filterConditions));

        const results = await db
            .select({
                id: arsip.id,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                tanggalArsip: arsip.tanggalArsip,
                tahun: arsip.tahun,
                jenisArsip: arsip.jenisArsip
            })
            .from(arsip)
            .where(and(...filterConditions))
            .orderBy(desc(arsip.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data: results,
            total: countResult[0]?.count || 0
        };
    }

    // Get related documents based on keywords
    async getRelatedDocuments(
        arsipId: string,
        unitKerjaId: string,
        limit: number = 5
    ): Promise<any[]> {
        // First get the source document's text
        const sourceDoc = await db
            .select({ extractedText: arsip.extractedText })
            .from(arsip)
            .where(eq(arsip.id, arsipId))
            .limit(1);

        if (!sourceDoc.length || !sourceDoc[0].extractedText) {
            return [];
        }

        // Extract keywords from source document
        const sourceText = sourceDoc[0].extractedText;
        const keywords = this.extractSearchTerms(sourceText.substring(0, 2000));
        const topKeywords = keywords.slice(0, 5);

        if (topKeywords.length === 0) return [];

        // Find documents with similar keywords
        const keywordConditions = topKeywords.map(keyword =>
            ilike(arsip.extractedText, `%${keyword}%`)
        );

        const results = await db
            .select({
                id: arsip.id,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                perihalOriginal: arsip.perihalOriginal
            })
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                sql`${arsip.id} != ${arsipId}`, // Exclude source document
                or(...keywordConditions)
            ))
            .orderBy(desc(arsip.createdAt))
            .limit(limit);

        return results;
    }
}

export const fullTextSearchService = new FullTextSearchService();
export default fullTextSearchService;
