import { z } from 'zod';

// Query parameters must be scalar decimal strings. Number coercion alone also
// accepts repeated query arrays and can pass enormous/unsafe offsets to SQL.
const queryInteger = (min: number, max: number) => z.string().regex(/^\d+$/)
    .transform(Number).pipe(z.number().int().min(min).max(max));
const unitKerjaId = z.string().trim().min(1).max(50).optional();
const queryText = z.string().trim().min(1).max(200);
const page = queryInteger(1, 1_000_000).optional().default(1);
const limit = (fallback: number) => queryInteger(1, 100).optional().default(fallback);

export const archiveFulltextQuerySchema = z.object({
    unitKerjaId,
    q: queryText,
    jenisArsip: z.string().trim().min(1).max(50).optional(),
    tahun: queryInteger(2000, 2100).optional(),
    page,
    limit: limit(20),
});

export const archiveSuggestionsQuerySchema = z.object({
    unitKerjaId, q: queryText, limit: limit(10),
});

export const archiveKeywordsQuerySchema = z.object({
    unitKerjaId,
    keywords: z.string().max(2019)
        .transform(value => value.split(',').map(term => term.trim()).filter(Boolean))
        .pipe(z.array(z.string().min(1).max(100)).min(1).max(20)),
    page,
    limit: limit(20),
});

export const archiveRelatedQuerySchema = z.object({ unitKerjaId, limit: limit(5) });
