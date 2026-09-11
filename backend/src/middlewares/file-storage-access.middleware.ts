import type { RequestHandler } from 'express';

export const FILE_STORAGE_DISABLED_CODE = 'FILE_STORAGE_DISABLED';

/** Mount before domain routers/Multer. Disabled storage is not a demo mode. */
export function createFileStorageAccessMiddleware(disabled: boolean): RequestHandler {
    return (req, res, next) => {
        if (!disabled) { next(); return; }
        const method = req.method.toUpperCase();
        const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
        const multipart = /^multipart\/form-data(?:;|$)/i.test(req.get('content-type') || '');
        const body = req.body || {};
        const suratWrite = mutation && /^\/surat-(?:masuk|keluar)(?:\/[^/]+)?$/.test(path);
        const fileOperation = /^\/(?:files|blob-test)(?:\/|$)/.test(path)
            || (mutation && /^\/(?:upload|client-upload|object-uploads|bulk-upload)(?:\/|$)/.test(path))
            || (suratWrite && (multipart || Boolean(body.filePath)))
            || (path === '/autentikasi' && method === 'POST')
            || path === '/autentikasi/verify'
            || /^\/autentikasi\/[^/]+\/pdf$/.test(path)
            || /^\/regulatory-rule-sets\/[^/]+\/source-document(?:\/|$)/.test(path)
            || (mutation && /^\/regulatory-rule-sets\/[^/]+\/(?:submit|activate)$/.test(path))
            || (mutation && /^\/regulatory-rule-sets\/[^/]+\/clone-active$/.test(path) && body.reuseVerifiedSource === true)
            || (method === 'POST' && path === '/arsip-elektronik')
            || (mutation && /^\/arsip-elektronik\/[^/]+\/preservasi$/.test(path))
            || (mutation && /^\/arsip-elektronik\/[^/]+\/verify$/.test(path) && body.status === 'verified')
            || (mutation && /^\/penyusutan\/[^/]+\/evidence$/.test(path))
            || (mutation && /^\/penyusutan\/[^/]+\/status$/.test(path) && Boolean(body.executionEvidence))
            || (mutation && /^\/arsip-terjaga\/[^/]+\/reports\/[^/]+\/transitions$/.test(path) && body.action !== 'cancel');
        if (!fileOperation) { next(); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.status(503).json({ success: false, code: FILE_STORAGE_DISABLED_CODE,
            error: 'Penyimpanan berkas digital dinonaktifkan pada layanan ini. Metadata arsip tetap tersedia.' });
    };
}
