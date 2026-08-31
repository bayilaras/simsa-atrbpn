import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';

// Mock dependencies
vi.mock('../config/auth', () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

vi.mock('../config/database', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(),
    },
}));

vi.mock('../db/schema', () => ({
    users: { id: 'id', email: 'email', name: 'name', role: 'role', unitKerjaId: 'unitKerjaId' },
}));

// Import after mocking
const { authMiddleware, optionalAuthMiddleware } = await import('../middlewares/auth.middleware');
const { auth } = await import('../config/auth');
const { db } = await import('../config/database');

// Helpers
function createMockReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
    return {
        headers: { authorization: 'Bearer test-token' },
        ...overrides,
    } as AuthRequest;
}

function createMockRes(): Response {
    const res: Partial<Response> = {
        status: vi.fn().mockReturnThis() as any,
        json: vi.fn().mockReturnThis() as any,
    };
    return res as Response;
}

const mockNext: NextFunction = vi.fn();

const mockUser = {
    id: 'user-1',
    email: 'admin@atrbpn.go.id',
    name: 'Admin User',
    role: 'admin_dirjen',
    unitKerjaId: 'dirjen-ptpp',
};

describe('authMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should attach user to req and call next() when session is valid', async () => {
        // Arrange
        (auth.api.getSession as any).mockResolvedValue({ user: { id: 'user-1' } });
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([mockUser]),
                }),
            }),
        });

        const req = createMockReq();
        const res = createMockRes();

        // Act
        await authMiddleware(req, res, mockNext);

        // Assert
        expect(mockNext).toHaveBeenCalled();
        expect(req.user).toEqual({ ...mockUser, unitKerjaId: 'ditjen' });
    });

    it('should return 401 when no session exists', async () => {
        // Arrange
        (auth.api.getSession as any).mockResolvedValue(null);

        const req = createMockReq();
        const res = createMockRes();

        // Act
        await authMiddleware(req, res, mockNext);

        // Assert
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: No valid session' });
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when user not found in database', async () => {
        // Arrange
        (auth.api.getSession as any).mockResolvedValue({ user: { id: 'unknown-user' } });
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        });

        const req = createMockReq();
        const res = createMockRes();

        // Act
        await authMiddleware(req, res, mockNext);

        // Assert
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: User not found' });
    });

    it('should return 500 when an unexpected error occurs', async () => {
        // Arrange
        (auth.api.getSession as any).mockRejectedValue(new Error('DB connection lost'));

        const req = createMockReq();
        const res = createMockRes();

        // Act
        await authMiddleware(req, res, mockNext);

        // Assert
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('should deny an unprovisioned default user', async () => {
        (auth.api.getSession as any).mockResolvedValue({ user: { id: 'user-1' } });
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ ...mockUser, role: 'user', unitKerjaId: null }]),
                }),
            }),
        });

        const req = createMockReq();
        const res = createMockRes();

        await authMiddleware(req, res, mockNext);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access pending' }));
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('should fail closed for an unknown database role', async () => {
        (auth.api.getSession as any).mockResolvedValue({ user: { id: 'user-1' } });
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ ...mockUser, role: 'legacy_admin' }]),
                }),
            }),
        });

        const req = createMockReq();
        const res = createMockRes();

        await authMiddleware(req, res, mockNext);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access pending' }));
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('should deny staff without an assigned unit kerja', async () => {
        (auth.api.getSession as any).mockResolvedValue({ user: { id: 'user-1' } });
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ ...mockUser, role: 'staff', unitKerjaId: null }]),
                }),
            }),
        });

        const req = createMockReq();
        const res = createMockRes();

        await authMiddleware(req, res, mockNext);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unit kerja required' }));
        expect(mockNext).not.toHaveBeenCalled();
    });
});

describe('optionalAuthMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should attach user when session exists', async () => {
        // Arrange
        (auth.api.getSession as any).mockResolvedValue({ user: { id: 'user-1' } });
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([mockUser]),
                }),
            }),
        });

        const req = createMockReq();
        const res = createMockRes();

        // Act
        await optionalAuthMiddleware(req, res, mockNext);

        // Assert
        expect(mockNext).toHaveBeenCalled();
        expect(req.user).toEqual({ ...mockUser, unitKerjaId: 'ditjen' });
    });

    it('should call next() without user when no session exists', async () => {
        // Arrange
        (auth.api.getSession as any).mockResolvedValue(null);

        const req = createMockReq();
        const res = createMockRes();

        // Act
        await optionalAuthMiddleware(req, res, mockNext);

        // Assert
        expect(mockNext).toHaveBeenCalled();
        expect(req.user).toBeUndefined();
    });

    it('does not attach an incomplete archival role through optional auth', async () => {
        (auth.api.getSession as any).mockResolvedValue({ user: { id: 'user-1' } });
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{
                        ...mockUser,
                        role: 'auditor',
                        unitKerjaId: null,
                    }]),
                }),
            }),
        });

        const req = createMockReq();
        const res = createMockRes();
        await optionalAuthMiddleware(req, res, mockNext);

        expect(mockNext).toHaveBeenCalledOnce();
        expect(req.user).toBeUndefined();
    });

    it('should silently continue on errors', async () => {
        // Arrange
        (auth.api.getSession as any).mockRejectedValue(new Error('Network timeout'));

        const req = createMockReq();
        const res = createMockRes();

        // Act
        await optionalAuthMiddleware(req, res, mockNext);

        // Assert
        expect(mockNext).toHaveBeenCalled();
        expect(req.user).toBeUndefined();
    });
});
