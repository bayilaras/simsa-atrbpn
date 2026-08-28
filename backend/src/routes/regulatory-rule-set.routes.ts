import { Router, type NextFunction, type Response } from 'express';
import multer from 'multer';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware';
import {
    validateBody,
    validateParams,
    validateQuery,
    uuidParamValidator,
} from '../middlewares/validate.middleware';
import auditLogService from '../services/audit-log.service';
import regulatoryRuleSetService, {
    RegulatoryRuleSetValidationError,
} from '../services/regulatory-rule-set.service';
import {
    cloneActiveRuleSetSchema,
    emptyRegulatoryRuleSetActionSchema,
    importRegulatoryRuleItemsSchema,
    listRegulatoryRuleSetsQuerySchema,
    listRegulatoryEventsQuerySchema,
    regulatoryCompletenessManifestSchema,
    regulatoryInstrumentTypeParamSchema,
    regulatoryWorkflowActionSchema,
    verifyRegulatorySourceBlobSchema,
    type ListRegulatoryRuleSetsQuery,
    type RegulatoryInstrumentType,
} from '../validators/regulatory-rule-set.schemas';

const router = Router();
const superAdminOnly = roleMiddleware(['super_admin']);
const governanceReviewer = roleMiddleware(['super_admin', 'admin_dirjen', 'admin_sesditjen']);
const governanceReader = roleMiddleware(['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor']);
const sourceDocumentUpload = multer({
    storage: multer.memoryStorage(),
    // Large PDFs use the rule-set-bound direct private Blob path. Keeping this
    // fallback below Vercel's request-body limit avoids a misleading 50 MB API.
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        if (file.mimetype !== 'application/pdf' || !file.originalname.toLowerCase().endsWith('.pdf')) {
            callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
            return;
        }
        callback(null, true);
    },
});

function receiveSourceDocument(req: AuthRequest, res: Response, next: NextFunction) {
    sourceDocumentUpload.single('file')(req, res, (error: any) => {
        if (!error) return next();
        if (error instanceof multer.MulterError) {
            const tooLarge = error.code === 'LIMIT_FILE_SIZE';
            res.status(tooLarge ? 413 : 400).json({
                success: false,
                error: tooLarge
                    ? 'PDF melebihi batas fallback 4 MB; gunakan unggah langsung private Blob.'
                    : 'Hanya satu file PDF sumber yang dapat diunggah.',
            });
            return;
        }
        next(error);
    });
}

router.use(authMiddleware);
router.param('id', uuidParamValidator);

function ipAddress(req: AuthRequest): string | undefined {
    return Array.isArray(req.ip) ? req.ip[0] : req.ip;
}

function auditContext(req: AuthRequest, reason?: string) {
    return {
        actorEmail: req.user?.email,
        ipAddress: ipAddress(req),
        ...(reason ? { reason } : {}),
    };
}

function sourceContentDisposition(fileName: string, download: boolean): string {
    const asciiName = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const encodedName = encodeURIComponent(fileName).replace(/['()*]/g, (character) => (
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
    return `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

router.get(
    '/',
    validateQuery(listRegulatoryRuleSetsQuerySchema),
    async (_req: AuthRequest, res: Response, next) => {
        try {
            const filters = (res.locals.validatedQuery || {}) as ListRegulatoryRuleSetsQuery;
            const data = await regulatoryRuleSetService.list(filters);
            res.json({ success: true, data, total: data.length });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/active/:instrumentType',
    validateParams(regulatoryInstrumentTypeParamSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.getActive(
                req.params.instrumentType as RegulatoryInstrumentType,
            );
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/:id/source-document',
    governanceReader,
    async (req: AuthRequest, res: Response, next) => {
        try {
            const download = req.query.download === '1';
            const source = await regulatoryRuleSetService.getSourceDocumentStream(
                req.params.id as string,
            );
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: download ? 'download' : 'view',
                entityType: 'regulatory_rule_set' as any,
                entityId: req.params.id as string,
                changes: { after: { evidence: 'source_document' } },
                ipAddress: ipAddress(req),
            });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', String(source.sizeBytes));
            res.setHeader('Content-Disposition', sourceContentDisposition(source.fileName, download));
            res.setHeader('Cache-Control', 'private, no-store, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            source.stream.on('error', (error: Error) => {
                if (!res.headersSent) next(error);
                else res.destroy(error);
            });
            source.stream.pipe(res);
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:instrumentType/clone-active',
    superAdminOnly,
    validateParams(regulatoryInstrumentTypeParamSchema),
    validateBody(cloneActiveRuleSetSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await regulatoryRuleSetService.cloneActive(
                req.params.instrumentType as RegulatoryInstrumentType,
                req.body,
                req.user?.id,
                auditContext(req, req.body.changeSummary),
            );

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/validate',
    superAdminOnly,
    validateBody(emptyRegulatoryRuleSetActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.validateDraft(req.params.id as string);
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/items/import',
    superAdminOnly,
    validateBody(importRegulatoryRuleItemsSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await regulatoryRuleSetService.replaceDraftItems(
                req.params.id as string,
                req.body,
                req.user?.id,
                auditContext(req, 'Mengganti isi draft melalui manifest terstruktur.'),
            );
            res.json({ success: true, data: result });
        } catch (error) {
            if (error instanceof RegulatoryRuleSetValidationError) {
                return res.status(400).json({
                    success: false,
                    error: error.message,
                    details: error.report,
                });
            }
            next(error);
        }
    },
);

router.post(
    '/:id/source-document/verify',
    superAdminOnly,
    uploadLimiter,
    receiveSourceDocument,
    async (req: AuthRequest, res: Response, next) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'File PDF sumber wajib diunggah.' });
            }
            const data = await regulatoryRuleSetService.verifySourceDocument(
                req.params.id as string,
                req.file,
                req.user?.id,
                auditContext(req),
            );
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/source-document/verify-blob',
    superAdminOnly,
    uploadLimiter,
    validateBody(verifyRegulatorySourceBlobSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.verifySourceDocumentFromBlob(
                req.params.id as string,
                req.body,
                req.user?.id,
                auditContext(req),
            );
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.put(
    '/:id/completeness-manifest',
    superAdminOnly,
    validateBody(regulatoryCompletenessManifestSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.verifyCompletenessManifest(
                req.params.id as string,
                req.body,
                req.user?.id,
                auditContext(req, req.body.verificationStatement),
            );
            res.json({ success: true, data });
        } catch (error) {
            if (error instanceof RegulatoryRuleSetValidationError) {
                return res.status(400).json({ success: false, error: error.message, details: error.report });
            }
            next(error);
        }
    },
);

router.post(
    '/:id/impact-report',
    superAdminOnly,
    validateBody(emptyRegulatoryRuleSetActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.generateImpactReport(
                req.params.id as string,
                req.user?.id,
                auditContext(req),
            );
            res.json({ success: true, data });
        } catch (error) {
            if (error instanceof RegulatoryRuleSetValidationError) {
                return res.status(400).json({ success: false, error: error.message, details: error.report });
            }
            next(error);
        }
    },
);

router.post(
    '/:id/submit',
    superAdminOnly,
    validateBody(regulatoryWorkflowActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.submit(
                req.params.id as string,
                req.user!.id,
                req.body.note,
                auditContext(req, req.body.note),
            );
            res.json({ success: true, data });
        } catch (error) {
            if (error instanceof RegulatoryRuleSetValidationError) {
                return res.status(400).json({ success: false, error: error.message, details: error.report });
            }
            next(error);
        }
    },
);

router.post(
    '/:id/review',
    governanceReviewer,
    validateBody(regulatoryWorkflowActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.review(
                req.params.id as string,
                req.user!.id,
                req.body.note,
                auditContext(req, req.body.note),
            );
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/approve',
    governanceReviewer,
    validateBody(regulatoryWorkflowActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.approve(
                req.params.id as string,
                req.user!.id,
                req.body.note,
                auditContext(req, req.body.note),
            );
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/return-to-draft',
    governanceReviewer,
    validateBody(regulatoryWorkflowActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.returnToDraft(
                req.params.id as string,
                req.user!.id,
                req.body.note,
                auditContext(req, req.body.note),
            );
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/:id/events/integrity',
    governanceReader,
    async (req: AuthRequest, res: Response, next) => {
        try {
            const data = await regulatoryRuleSetService.verifyEventIntegrity(req.params.id as string);
            // A broken chain is a successful inspection with a negative domain
            // result, not a transport conflict. Returning 200 preserves the
            // precise broken event/hash details for the audit UI.
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/:id/events',
    governanceReader,
    validateQuery(listRegulatoryEventsQuerySchema),
    async (_req: AuthRequest, res: Response, next) => {
        try {
            const { page, limit } = res.locals.validatedQuery;
            const data = await regulatoryRuleSetService.listEvents(
                _req.params.id as string,
                page,
                limit,
            );
            res.json({ success: true, ...data });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/activate',
    superAdminOnly,
    validateBody(emptyRegulatoryRuleSetActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await regulatoryRuleSetService.activate(
                req.params.id as string,
                req.user?.id,
                auditContext(req, 'Mengaktifkan edisi aturan yang telah disetujui.'),
            );

            res.json({ success: true, data: result });
        } catch (error) {
            if (error instanceof RegulatoryRuleSetValidationError) {
                return res.status(400).json({
                    success: false,
                    error: error.message,
                    details: error.report,
                });
            }
            next(error);
        }
    },
);

router.get('/:id', async (req: AuthRequest, res: Response, next) => {
    try {
        const data = await regulatoryRuleSetService.getById(req.params.id as string);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

export default router;
