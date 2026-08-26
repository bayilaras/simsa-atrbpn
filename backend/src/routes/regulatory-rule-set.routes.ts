import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
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
    regulatoryInstrumentTypeParamSchema,
    type ListRegulatoryRuleSetsQuery,
    type RegulatoryInstrumentType,
} from '../validators/regulatory-rule-set.schemas';

const router = Router();
const superAdminOnly = roleMiddleware(['super_admin']);

router.use(authMiddleware);
router.param('id', uuidParamValidator);

function ipAddress(req: AuthRequest): string | undefined {
    return Array.isArray(req.ip) ? req.ip[0] : req.ip;
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
            );

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'create',
                entityType: 'regulatory_rule_set' as any,
                entityId: result.ruleSet.id,
                changes: {
                    after: {
                        instrumentType: result.ruleSet.instrumentType,
                        version: result.ruleSet.version,
                        status: result.ruleSet.status,
                        clonedFromId: result.clonedFrom.id,
                        itemCount: result.itemCount,
                    },
                },
                ipAddress: ipAddress(req),
            });

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
            );
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'update',
                entityType: 'regulatory_rule_set' as any,
                entityId: req.params.id as string,
                changes: {
                    after: {
                        importedItems: result.imported,
                        contentHash: result.validation.contentHash,
                        warnings: result.validation.warnings.length,
                    },
                },
                ipAddress: ipAddress(req),
            });
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
    '/:id/activate',
    superAdminOnly,
    validateBody(emptyRegulatoryRuleSetActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await regulatoryRuleSetService.activate(
                req.params.id as string,
                req.user?.id,
            );

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'status_change',
                entityType: 'regulatory_rule_set' as any,
                entityId: result.ruleSet.id,
                changes: {
                    before: {
                        status: 'draft',
                        supersedesId: result.supersededRuleSet?.id || null,
                    },
                    after: {
                        status: 'active',
                        contentHash: result.ruleSet.contentHash,
                        effectiveFrom: result.ruleSet.effectiveFrom,
                    },
                },
                ipAddress: ipAddress(req),
            });

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
