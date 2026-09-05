import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const DEMO_FEATURE_UNAVAILABLE_CODE = 'DEMO_FEATURE_UNAVAILABLE' as const;

export type DemoBlockedCapability =
    | 'file_storage'
    | 'ocr'
    | 'external_import'
    | 'external_delivery'
    | 'operational_admin'
    | 'unsupported_route';

interface AllowedRoute {
    methods: ReadonlySet<string>;
    path: RegExp;
}

const methods = (...values: string[]) => new Set(values);
const GET = methods('GET');
const POST = methods('POST');
const PUT = methods('PUT');
const DELETE = methods('DELETE');
const PATCH = methods('PATCH');
const READ_WRITE = methods('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const POSITIVE_INTEGER = '[1-9][0-9]*';
const SEGMENT = '[^/]+';

function exact(expression: string): RegExp {
    return new RegExp(`^(?:${expression})$`);
}

/**
 * Metadata-only demo routes are deliberately enumerated instead of inferred
 * from a broad module prefix. A new endpoint therefore remains unavailable
 * until its storage, network, and mutation behaviour has been reviewed.
 */
const ALLOWED_METADATA_ROUTES: readonly AllowedRoute[] = [
    { methods: GET, path: exact('/(?:health|capabilities)') },
    // Better Auth has provider-owned subpaths; Firebase uses the same bounded
    // namespace. This exception is only for authentication, never domain APIs.
    { methods: READ_WRITE, path: exact('/auth(?:/[^/]+)*') },

    { methods: GET, path: exact(`/surat-masuk(?:/(?:stats|next-number|pending-for-reply|${UUID}(?:/(?:balasan|with-links))?))?`) },
    { methods: POST, path: exact(`/surat-masuk(?:/${UUID}/(?:archive|archive-full))?`) },
    { methods: PUT, path: exact(`/surat-masuk/${UUID}`) },
    { methods: DELETE, path: exact(`/surat-masuk/${UUID}`) },

    { methods: GET, path: exact(`/surat-keluar(?:/(?:stats|next-number|${UUID}(?:/(?:source|with-links))?))?`) },
    { methods: POST, path: exact(`/surat-keluar(?:/${UUID}/(?:archive|archive-full))?`) },
    { methods: PUT, path: exact(`/surat-keluar/${UUID}`) },
    { methods: DELETE, path: exact(`/surat-keluar/${UUID}`) },

    { methods: GET, path: exact(`/arsip(?:/(?:expiring|stats|search/(?:fulltext|suggestions|keywords)|${UUID}(?:/(?:related|rule-history))?))?`) },
    { methods: POST, path: exact(`/arsip(?:/${UUID}/reconcile-rules)?`) },
    { methods: PUT, path: exact(`/arsip/${UUID}`) },
    { methods: DELETE, path: exact(`/arsip/${UUID}`) },

    { methods: GET, path: exact('/unit-kerja') },
    { methods: GET, path: exact(`/approval/(?:pending|approvers/${UUID}|history/${UUID})`) },
    { methods: POST, path: exact('/approval/(?:submit|approve|reject|sign)') },
    { methods: GET, path: exact('/dashboard/(?:stats|recent|expiring|comparison|widgets)') },
    { methods: GET, path: exact('/export/(?:surat-masuk|surat-keluar|arsip)/(?:excel|pdf)') },

    { methods: GET, path: exact('/notifications(?:/(?:count|surat-masuk|arsip))?') },
    { methods: PATCH, path: exact(`/notifications/(?:${SEGMENT}/read|read-all)`) },

    { methods: GET, path: exact(`/users(?:/(?:roles|unit-kerja|${UUID}))?`) },
    { methods: POST, path: exact('/users') },
    { methods: PUT, path: exact(`/users/${UUID}`) },
    { methods: DELETE, path: exact(`/users/${UUID}`) },
    { methods: GET, path: exact(`/audit-log(?:/${SEGMENT}/${UUID})?`) },

    { methods: GET, path: exact(`/klasifikasi(?:/(?:stats|${SEGMENT}))?`) },
    { methods: POST, path: exact('/klasifikasi') },
    { methods: PUT, path: exact(`/klasifikasi/(?:items/${POSITIVE_INTEGER}|${SEGMENT})`) },
    { methods: DELETE, path: exact(`/klasifikasi/(?:items/${POSITIVE_INTEGER}|${SEGMENT})`) },
    { methods: GET, path: exact(`/jra(?:/${SEGMENT})?`) },
    { methods: POST, path: exact('/jra') },
    { methods: PUT, path: exact(`/jra/(?:items/${POSITIVE_INTEGER}|${SEGMENT})`) },
    { methods: DELETE, path: exact(`/jra/(?:items/${POSITIVE_INTEGER}|${SEGMENT})`) },

    { methods: GET, path: exact(`/regulatory-rule-sets(?:/(?:active/${SEGMENT}|${UUID}(?:/events(?:/integrity)?)?))?`) },
    { methods: POST, path: exact(`/regulatory-rule-sets/(?:${SEGMENT}/clone-active|${UUID}/(?:validate|items/import|impact-report|submit|review|approve|return-to-draft|activate))`) },
    { methods: PUT, path: exact(`/regulatory-rule-sets/${UUID}/completeness-manifest`) },

    { methods: GET, path: exact('/arsip-picker/(?:klasifikasi/tree|jra/[^/]+|lifecycle)') },
    { methods: POST, path: exact('/arsip-picker/calculate-dates') },

    { methods: GET, path: exact(`/storage-locations(?:/(?:tree|${UUID}(?:/qr)?))?`) },
    { methods: POST, path: exact('/storage-locations') },
    { methods: PUT, path: exact(`/storage-locations/${UUID}`) },
    { methods: DELETE, path: exact(`/storage-locations/${UUID}`) },

    { methods: GET, path: exact(`/archive-lending(?:/(?:overdue|stats|arsip/${UUID}|location/${UUID}|${UUID}|qr/arsip/${UUID}))?`) },
    { methods: POST, path: exact('/archive-lending/borrow') },
    { methods: PUT, path: exact(`/archive-lending/${UUID}/(?:return|extend)`) },

    { methods: GET, path: exact(`/dosir(?:/(?:stats|generate-kode|${UUID}(?:/timeline)?))?`) },
    { methods: POST, path: exact(`/dosir(?:/${UUID}/surat)?`) },
    { methods: PUT, path: exact(`/dosir/${UUID}`) },
    { methods: DELETE, path: exact(`/dosir/${UUID}(?:/surat/(?:masuk|keluar)/${UUID})?`) },

    { methods: GET, path: exact('/retention/(?:summary|candidates|lifecycle|holds)') },
    { methods: POST, path: exact('/retention/disposal-report') },
    { methods: PUT, path: exact(`/retention/${UUID}/(?:hold|release)`) },

    { methods: GET, path: exact(`/distributions(?:/(?:units|inbox|outbox|stats|surat/${UUID}|${UUID}))?`) },
    { methods: POST, path: exact('/distributions') },
    { methods: PUT, path: exact(`/distributions/${UUID}/(?:receive|process|reject)`) },

    { methods: GET, path: exact('/reports/(?:surat-masuk|surat-keluar|arsip|lending|summary|export/[^/]+/[^/]+)') },
    { methods: GET, path: exact('/search(?:/suggestions)?') },

    { methods: GET, path: exact(`/penyusutan(?:/(?:candidates|print/(?:daftar-arsip-aktif|daftar-arsip-inaktif)|${UUID}(?:/print/(?:usul-musnah|usul-pindah|usul-serah|berita-acara|berita-acara-pemindahan|berita-acara-pemusnahan|berita-acara-alih-media|berita-acara-penyerahan|surat-permohonan-penyerahan))?))?`) },
    { methods: POST, path: exact(`/penyusutan(?:/${UUID}/items)?`) },
    { methods: PUT, path: exact(`/penyusutan/${UUID}/status`) },
    { methods: DELETE, path: exact(`/penyusutan/${UUID}(?:/items)?`) },

    { methods: GET, path: exact(`/arsip-vital(?:/(?:print/daftar|stats|due-review|${UUID}))?`) },
    { methods: POST, path: exact('/arsip-vital') },
    { methods: PUT, path: exact(`/arsip-vital/${UUID}`) },
    { methods: DELETE, path: exact(`/arsip-vital/${UUID}`) },
    { methods: GET, path: exact(`/arsip-terjaga(?:/(?:print/daftar|stats|due-reporting|laporan-anri|${UUID}))?`) },
    { methods: POST, path: exact('/arsip-terjaga') },
    { methods: PUT, path: exact(`/arsip-terjaga/${UUID}(?:/report)?`) },
    { methods: DELETE, path: exact(`/arsip-terjaga/${UUID}`) },

    { methods: GET, path: exact(`/tunjuk-silang(?:/(?:stats|${SEGMENT}/${UUID}))?`) },
    { methods: POST, path: exact('/tunjuk-silang') },
    { methods: DELETE, path: exact(`/tunjuk-silang/${UUID}`) },

    { methods: GET, path: exact(`/layanan-arsip(?:/${UUID})?`) },
    { methods: POST, path: exact(`/layanan-arsip(?:/${UUID}/status)?`) },
    { methods: GET, path: exact('/supervision/stats/(?:activity|users|compliance|compliance/issues)') },
    { methods: GET, path: exact('/mapping/(?:klasifikasi-jra|suggest-jra/[^/]+)') },
    { methods: POST, path: exact('/security/check-password') },

    { methods: GET, path: exact(`/settings/(?:profile|unit-kerja(?:/${SEGMENT})?|surat-templates|preferences)`) },
    { methods: POST, path: exact('/settings/unit-kerja') },
    { methods: PUT, path: exact(`/settings/(?:profile|unit-kerja/${SEGMENT}|surat-templates|preferences)`) },

    { methods: GET, path: exact(`/retention-governance/(?:appraisals(?:/${UUID})?|retention-events|archives/${UUID}/retention-events|permanent-transfers(?:/${UUID})?)`) },
    { methods: POST, path: exact(`/retention-governance/(?:appraisals|appraisals/${UUID}/(?:submit|approve|reject)|retention-events/${UUID}/verify|permanent-transfers/${UUID}/cancellations(?:/${UUID}/review)?)`) },

    { methods: POST, path: exact('/record-access-grants') },
    { methods: GET, path: exact('/record-access-grants/(?:mine|review)') },
    { methods: POST, path: exact(`/record-access-grants/${UUID}/(?:approve|deny|revoke)`) },
];

const FILE_CLAIM_KEYS = new Set([
    'attachment',
    'attachmentid',
    'attachmentids',
    'attachments',
    'avatar',
    'avatarurl',
    'bloburl',
    'document',
    'documents',
    'documenturi',
    'drivefileid',
    'evidenceuri',
    'evidenceattachmentid',
    'file',
    'fileattachmentids',
    'fileattachmentid',
    'fileid',
    'fileids',
    'filename',
    'files',
    'fileoriginalname',
    'filepath',
    'fileurl',
    'image',
    'lampiran',
    'lampiranurl',
    'linkdokumen',
    'locator',
    'objectgeneration',
    'objecturi',
    'pdf',
    'resumablesessionuri',
    'reuseverifiedsource',
    'sourcedocumentbloburl',
    'sourcedocumentmimetype',
    'sourcedocumentname',
    'sourcedocumentobjectgeneration',
    'sourcedocumentpagecount',
    'sourcedocumentsha256',
    'sourcedocumentsizebytes',
    'sourcedocumentverifiedat',
    'sourcedocumentverifiedby',
    'sourceurl',
]);

const FILE_LOCATOR_VALUE = /^(?:blob:)?(?:gs:\/\/|file:\/\/|data:(?:application|image)\/|https:\/\/(?:storage\.googleapis\.com|storage\.cloud\.google\.com|firebasestorage\.googleapis\.com|[^/]+\.private\.blob\.vercel-storage\.com)\/|attachment:)/i;
const INTERNAL_FILE_ENDPOINT_VALUE = /^\/api\/(?:files|upload|client-upload|object-uploads)(?:\/|$)/i;
const OBJECT_NAMESPACE_VALUE = /^(?:surat-masuk|surat-keluar|regulatory-sources)\//i;

function hasMeaningfulValue(root: unknown): boolean {
    const pending = [root];
    const seen = new WeakSet<object>();
    let inspected = 0;
    while (pending.length > 0) {
        if (++inspected > 10_000) return true;
        const value = pending.pop();
        if (value === undefined || value === null || value === false) continue;
        if (typeof value === 'string') {
            if (value.trim().length > 0) return true;
            continue;
        }
        if (typeof value !== 'object') return true;
        if (seen.has(value)) return true;
        seen.add(value);
        pending.push(...Object.values(value as Record<string, unknown>));
    }
    return false;
}

function isFileLocator(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const candidate = value.trim();
    return FILE_LOCATOR_VALUE.test(candidate)
        || INTERNAL_FILE_ENDPOINT_VALUE.test(candidate)
        || OBJECT_NAMESPACE_VALUE.test(candidate);
}

/** Recursively reject claims hidden inside nested arrays or free-form metadata. */
export function containsDemoFileClaim(value: unknown): boolean {
    const pending = [value];
    const seen = new WeakSet<object>();
    let inspected = 0;
    while (pending.length > 0) {
        if (++inspected > 10_000) return true;
        const candidate = pending.pop();
        if (isFileLocator(candidate)) return true;
        if (!candidate || typeof candidate !== 'object') continue;
        if (seen.has(candidate)) return true;
        seen.add(candidate);

        for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
            const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
            const locatorKey = FILE_CLAIM_KEYS.has(normalizedKey)
                || normalizedKey.endsWith('url')
                || normalizedKey.endsWith('uri');
            if (locatorKey && hasMeaningfulValue(nested)) return true;
            pending.push(nested);
        }
    }
    return false;
}

function normalizedApiPath(req: Request): string | null {
    const raw = `${req.baseUrl || ''}${req.path || ''}`;
    if (!raw.startsWith('/') || raw.includes('\\') || raw.includes('//') || raw.includes('\0')) return null;
    const withoutApiPrefix = raw === '/api' ? '/' : raw.startsWith('/api/') ? raw.slice(4) : raw;
    if (withoutApiPrefix.length > 1 && withoutApiPrefix.endsWith('/')) {
        return withoutApiPrefix.slice(0, -1);
    }
    return withoutApiPrefix;
}

function isAllowedMetadataRoute(method: string, path: string): boolean {
    return ALLOWED_METADATA_ROUTES.some((route) => (
        route.methods.has(method) && route.path.test(path)
    ));
}

function blockedCapability(path: string): DemoBlockedCapability {
    if (/^\/(?:upload|files|client-upload|object-uploads|blob-test|drive-file)(?:\/|$)/.test(path)) {
        return 'file_storage';
    }
    if (/^\/(?:arsip-elektronik|autentikasi)(?:\/|$)/.test(path)) {
        return 'file_storage';
    }
    if (/^\/bulk-upload(?:\/|$)/.test(path) || path === '/search/content') {
        return 'ocr';
    }
    if (/^\/regulatory-rule-sets\/(?:[^/]+\/)?source-document(?:\/|$)/.test(path)) {
        return 'file_storage';
    }
    if (path.startsWith('/import/')) return 'external_import';
    if (path.startsWith('/integrations/srikandi')) return 'external_delivery';
    if (path.startsWith('/migration/')) return 'operational_admin';
    if (
        /^\/retention-governance\/(?:appraisals\/[^/]+\/evidence|retention-events|permanent-transfers(?:$|\/[^/]+\/(?:handover|acknowledge)))/.test(path)
    ) {
        return 'file_storage';
    }
    return 'unsupported_route';
}

function rejectDemoFeature(res: Response, capability: DemoBlockedCapability): void {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({
        success: false,
        error: 'Fitur ini tidak tersedia pada demo metadata-only.',
        code: DEMO_FEATURE_UNAVAILABLE_CODE,
        capability,
    });
}

/**
 * This guard is intentionally configuration-independent. Its caller must pass
 * the result of the authoritative deployment-mode parser; false is a complete
 * no-op so Production behaviour does not change.
 *
 * Mount after the existing JSON/urlencoded, CSRF, and App Check middleware and
 * before domain routers. Multipart is rejected here before any route-local
 * Multer middleware can allocate or persist bytes.
 */
export function createDemoAccessMiddleware(metadataOnlyDemo: boolean): RequestHandler {
    return function metadataOnlyDemoAccess(
        req: Request,
        res: Response,
        next: NextFunction,
    ): void {
        if (!metadataOnlyDemo) {
            next();
            return;
        }

        const path = normalizedApiPath(req);
        if (!path || !isAllowedMetadataRoute(req.method.toUpperCase(), path)) {
            rejectDemoFeature(res, blockedCapability(path || '/'));
            return;
        }

        if (/^multipart\/form-data(?:;|$)/i.test(req.get('content-type') || '')) {
            rejectDemoFeature(res, 'file_storage');
            return;
        }

        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase()) && containsDemoFileClaim(req.body)) {
            rejectDemoFeature(res, 'file_storage');
            return;
        }

        next();
    };
}
