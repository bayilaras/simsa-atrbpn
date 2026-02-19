/**
 * Custom Error Classes for SIMSA Backend
 * Provides structured error handling with HTTP status codes
 */

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(message: string, statusCode: number, isOperational = true) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string = 'Resource') {
        super(`${resource} tidak ditemukan.`, 404);
    }
}

export class ValidationError extends AppError {
    constructor(message: string = 'Data yang diberikan tidak valid.') {
        super(message, 400);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = 'Sesi tidak valid. Silakan login kembali.') {
        super(message, 401);
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = 'Anda tidak memiliki izin untuk mengakses sumber ini.') {
        super(message, 403);
    }
}

export class ConflictError extends AppError {
    constructor(message: string = 'Data yang sama sudah ada.') {
        super(message, 409);
    }
}

export class RateLimitError extends AppError {
    constructor(message: string = 'Terlalu banyak permintaan. Coba lagi nanti.') {
        super(message, 429);
    }
}

export class DatabaseError extends AppError {
    constructor(message: string = 'Terjadi kesalahan pada database. Silakan coba lagi.') {
        super(message, 500);
    }
}
