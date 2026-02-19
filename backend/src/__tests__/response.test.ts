import { describe, it, expect, vi } from 'vitest';
import {
    sendSuccess,
    sendCreated,
    sendPaginated,
    sendError,
    sendBadRequest,
    sendNotFound,
    sendConflict,
    sendValidationError,
} from '../utils/response';

// Mock Express Response
function mockResponse() {
    const res: any = {
        statusCode: 200,
        body: null,
    };
    res.status = vi.fn((code: number) => {
        res.statusCode = code;
        return res;
    });
    res.json = vi.fn((data: any) => {
        res.body = data;
        return res;
    });
    return res;
}

describe('Response Helpers', () => {
    describe('sendSuccess', () => {
        it('should return 200 with success: true and data', () => {
            const res = mockResponse();
            sendSuccess(res, { id: '1' });
            expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: '1' } });
        });

        it('should include message when provided', () => {
            const res = mockResponse();
            sendSuccess(res, { id: '1' }, 'Berhasil');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: { id: '1' },
                message: 'Berhasil',
            });
        });

        it('should omit message when not provided', () => {
            const res = mockResponse();
            sendSuccess(res, []);
            const call = res.json.mock.calls[0][0];
            expect(call).not.toHaveProperty('message');
        });
    });

    describe('sendCreated', () => {
        it('should return 201 with success: true', () => {
            const res = mockResponse();
            sendCreated(res, { id: 'new' });
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'new' } });
        });
    });

    describe('sendPaginated', () => {
        it('should return data with pagination', () => {
            const res = mockResponse();
            const pagination = { page: 1, limit: 20, total: 50, totalPages: 3 };
            sendPaginated(res, [{ id: '1' }], pagination);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: [{ id: '1' }],
                pagination,
            });
        });
    });

    describe('sendError', () => {
        it('should return error with status code and success: false', () => {
            const res = mockResponse();
            sendError(res, 400, 'Bad Request');
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Bad Request' });
        });

        it('should include details when provided', () => {
            const res = mockResponse();
            sendError(res, 422, 'Validation', [{ field: 'name', message: 'required' }]);
            const call = res.json.mock.calls[0][0];
            expect(call.details).toEqual([{ field: 'name', message: 'required' }]);
        });
    });

    describe('sendBadRequest', () => {
        it('should return 400', () => {
            const res = mockResponse();
            sendBadRequest(res, 'Invalid input');
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.error).toBe('Invalid input');
        });
    });

    describe('sendNotFound', () => {
        it('should return 404 with resource name', () => {
            const res = mockResponse();
            sendNotFound(res, 'Surat masuk');
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.body.error).toBe('Surat masuk tidak ditemukan');
        });

        it('should use default resource name', () => {
            const res = mockResponse();
            sendNotFound(res);
            expect(res.body.error).toBe('Resource tidak ditemukan');
        });
    });

    describe('sendConflict', () => {
        it('should return 409', () => {
            const res = mockResponse();
            sendConflict(res, 'Sudah ada');
            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.body.error).toBe('Sudah ada');
        });
    });

    describe('sendValidationError', () => {
        it('should return 400 with field-level details', () => {
            const res = mockResponse();
            const details = [
                { field: 'email', message: 'Email wajib diisi' },
                { field: 'nama', message: 'Nama terlalu pendek' },
            ];
            sendValidationError(res, details);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe('Validasi gagal');
            expect(res.body.details).toEqual(details);
        });
    });
});
