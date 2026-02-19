import { describe, it, expect } from 'vitest';
import {
    AppError,
    NotFoundError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    ConflictError,
    RateLimitError,
} from '../utils/errors';

describe('AppError', () => {
    it('should create error with correct status code', () => {
        const error = new AppError('Test error', 418);
        expect(error.message).toBe('Test error');
        expect(error.statusCode).toBe(418);
        expect(error.isOperational).toBe(true);
        expect(error instanceof Error).toBe(true);
    });

    it('should support non-operational errors', () => {
        const error = new AppError('Critical', 500, false);
        expect(error.isOperational).toBe(false);
    });
});

describe('NotFoundError', () => {
    it('should have 404 status code', () => {
        const error = new NotFoundError('Surat');
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe('Surat tidak ditemukan.');
    });

    it('should use default resource name', () => {
        const error = new NotFoundError();
        expect(error.message).toBe('Resource tidak ditemukan.');
    });
});

describe('ValidationError', () => {
    it('should have 400 status code', () => {
        const error = new ValidationError('Nomor surat wajib diisi.');
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Nomor surat wajib diisi.');
    });
});

describe('UnauthorizedError', () => {
    it('should have 401 status code', () => {
        const error = new UnauthorizedError();
        expect(error.statusCode).toBe(401);
    });
});

describe('ForbiddenError', () => {
    it('should have 403 status code', () => {
        const error = new ForbiddenError();
        expect(error.statusCode).toBe(403);
    });
});

describe('ConflictError', () => {
    it('should have 409 status code', () => {
        const error = new ConflictError();
        expect(error.statusCode).toBe(409);
    });
});

describe('RateLimitError', () => {
    it('should have 429 status code', () => {
        const error = new RateLimitError();
        expect(error.statusCode).toBe(429);
    });
});
