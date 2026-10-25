import { describe, expect, it } from 'vitest';
import { AppError, DatabaseError, ForbiddenError, ServiceUnavailableError, ValidationError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

describe('public error boundary', () => {
    it.each([new Error('private-canary'), new DatabaseError('private-canary'),
        new ServiceUnavailableError('private-canary'), new AppError('private-canary', 400, false),
        { message: 'private-canary', statusCode: 400 }, 'private-canary'])(
        'hides provider/internal details while retaining a correlation ID', error => {
            expect(JSON.stringify(publicErrorResponse(error, 'request-123'))).not.toContain('private-canary');
            expect(publicErrorResponse(error, 'request-123').requestId).toBe('request-123');
            expect(publicErrorStatus(error)).toBe(error instanceof ServiceUnavailableError ? 503 : 500);
        },
    );
    it('preserves classified validation and authorization messages and statuses', () => {
        const validation = new ValidationError('Nomor surat wajib diisi.');
        expect(publicErrorStatus(validation)).toBe(400);
        expect(publicErrorResponse(validation)).toMatchObject({ message: validation.message, code: 'VALIDATION_ERROR' });
        expect(publicErrorStatus(new ForbiddenError())).toBe(403);
        expect(publicErrorResponse(new ForbiddenError()).code).toBe('FORBIDDEN');
    });
});
