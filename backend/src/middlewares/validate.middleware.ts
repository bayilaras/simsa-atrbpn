import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { createLogger } from '../utils/logger';

const log = createLogger('Validation');

/**
 * Validation middleware factory
 * Creates middleware that validates request body, query, or params against a Zod schema
 */
export function validate<T>(schema: ZodSchema<T>, source: 'body' | 'query' | 'params' = 'body') {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = schema.parse(req[source]);
            // Store validated/transformed data
            // For 'query', req.query is read-only in Express, so we use res.locals
            if (source === 'query') {
                res.locals.validatedQuery = data;
            } else if (source === 'body') {
                req.body = data as any;
            } else if (source === 'params') {
                // req.params can be extended
                Object.assign(req.params, data as any);
            }
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const errors = error.issues.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                }));

                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: errors,
                });
            }
            // Log unexpected errors for debugging
            log.error({ err: error }, 'Validation middleware error:');
            next(error);
        }
    };
}

/**
 * Validate request body
 */
export function validateBody<T>(schema: ZodSchema<T>) {
    return validate(schema, 'body');
}

/**
 * Validate request query parameters
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
    return validate(schema, 'query');
}

/**
 * Validate request URL params
 */
export function validateParams<T>(schema: ZodSchema<T>) {
    return validate(schema, 'params');
}

/**
 * Validate that the :id route parameter is a valid UUID.
 * Returns 400 if the ID is not a valid UUID format.
 * This prevents invalid IDs from reaching the database layer.
 */
export function validateIdParam(paramName: string = 'id') {
    return (req: Request, res: Response, next: NextFunction) => {
        const id = req.params[paramName] as string;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!id || !uuidRegex.test(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid ID format',
                message: `Parameter '${paramName}' must be a valid UUID`,
            });
        }
        next();
    };
}

/**
 * UUID param validator for use with router.param().
 * Usage: router.param('id', uuidParamValidator);
 * Automatically validates all routes using :id parameter on this router.
 */
export function uuidParamValidator(req: Request, res: Response, next: NextFunction, value: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!value || !uuidRegex.test(value)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid ID format',
            message: 'Parameter must be a valid UUID',
        });
    }
    next();
}

