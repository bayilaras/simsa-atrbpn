import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }
const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    transaction: async (fn: any) => {
        try {
            const result = await fn(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({ default: auditMocks }));

const { settingsService } = await import('../services/settings.service');

describe('SettingsService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset();
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
    });

    // ==================== Pure Functions (no DB) ====================

    describe('generateSuratNumber', () => {
        it('should generate basic surat masuk number', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/SM/{tahun}', {
                noUrut: 1,
                tahun: 2025,
            });
            expect(result).toBe('001/SM/2025');
        });

        it('should pad noUrut to 3 digits', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/SM/{tahun}', {
                noUrut: 42,
                tahun: 2025,
            });
            expect(result).toBe('042/SM/2025');
        });

        it('should handle already 3+ digit noUrut', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/SM/{tahun}', {
                noUrut: 1234,
                tahun: 2025,
            });
            expect(result).toBe('1234/SM/2025');
        });

        it('should replace bulan placeholder', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/{bulan}/{tahun}', {
                noUrut: 5,
                tahun: 2025,
                bulan: 3,
            });
            expect(result).toBe('005/03/2025');
        });

        it('should handle missing bulan gracefully', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/{naskahDinas}/{bulan}/{tahun}', {
                noUrut: 1,
                tahun: 2025,
                naskahDinas: 'ND',
            });
            // bulan undefined → empty, double slash cleaned
            expect(result).not.toContain('//');
        });

        it('should replace unitKerja placeholder', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/SM-{unitKerja}/{tahun}', {
                noUrut: 10,
                tahun: 2025,
                unitKerja: 'DIRJEN',
            });
            expect(result).toBe('010/SM-DIRJEN/2025');
        });

        it('should replace naskahDinas placeholder', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/{naskahDinas}/{unitKerja}/{tahun}', {
                noUrut: 7,
                tahun: 2025,
                naskahDinas: 'ND',
                unitKerja: 'SESDITJEN',
            });
            expect(result).toBe('007/ND/SESDITJEN/2025');
        });

        it('should clean up trailing slashes', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/{naskahDinas}/{tahun}/', {
                noUrut: 1,
                tahun: 2025,
                naskahDinas: 'ND',
            });
            expect(result).not.toMatch(/\/$/);
        });

        it('should clean up double slashes from empty values', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/{unitKerja}/{tahun}', {
                noUrut: 1,
                tahun: 2025,
                // unitKerja not provided
            });
            expect(result).not.toContain('//');
        });

        it('replaces repeated supported placeholders', () => {
            const result = settingsService.generateSuratNumber('{noUrut}/{tahun}/{noUrut}', {
                noUrut: 7,
                tahun: 2026,
            });
            expect(result).toBe('007/2026/007');
        });

        it('rejects unsupported placeholders and control characters', () => {
            expect(() => settingsService.generateSuratNumber('{noUrut}/{rahasia}/{tahun}', {
                noUrut: 1,
                tahun: 2026,
            })).toThrow('placeholder tambahan');
            expect(() => settingsService.generateSuratNumber('{noUrut}/\n/{tahun}', {
                noUrut: 1,
                tahun: 2026,
            })).toThrow('placeholder tambahan');
        });

        it('rejects unmatched or nested braces around supported placeholders', () => {
            for (const template of [
                '{{noUrut}}/SM/{tahun}',
                '{noUrut/SM/{tahun}',
                '{noUrut}/SM/{tahun}}',
            ]) {
                expect(() => settingsService.generateSuratNumber(template, {
                    noUrut: 1,
                    tahun: 2026,
                }), template).toThrow('placeholder tambahan');
            }
        });
    });

    // ==================== Surat Templates (in-memory) ====================

    describe('getSuratTemplates', () => {
        it('should return default templates for unknown unitKerja', async () => {
            const templates = await settingsService.getSuratTemplates('unknown-unit');
            expect(templates).toHaveProperty('unitKerjaId', 'unknown-unit');
            expect(templates).toHaveProperty('masukFormat');
            expect(templates).toHaveProperty('keluarFormat');
            expect(templates.masukFormat).toContain('{noUrut}');
            expect(templates.masukFormat).toContain('{tahun}');
        });
    });

    describe('lockSuratTemplates', () => {
        it('creates the durable mutex row before taking a row lock', async () => {
            const operations: string[] = [];
            const stored = {
                unitKerjaId: 'lock-unit',
                masukFormat: '{noUrut}/SM/{tahun}',
                keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
            };
            const executor = {
                insert: () => ({
                    values: () => ({
                        onConflictDoNothing: async () => {
                            operations.push('ensure');
                        },
                    }),
                }),
                select: () => ({
                    from: () => ({
                        where: () => ({
                            limit: () => ({
                                for: async (mode: string) => {
                                    operations.push(`lock:${mode}`);
                                    return [stored];
                                },
                            }),
                        }),
                    }),
                }),
            };

            await expect(settingsService.lockSuratTemplates(executor, 'lock-unit'))
                .resolves.toMatchObject(stored);
            expect(operations).toEqual(['ensure', 'lock:update']);
        });
    });

    describe('updateSuratTemplates', () => {
        it('should update and return merged templates', async () => {
            enqueue([], [{
                unitKerjaId: 'test-unit',
                masukFormat: '{noUrut}/CUSTOM/{tahun}',
                keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
            }]);
            const updated = await settingsService.updateSuratTemplates('test-unit', {
                masukFormat: '{noUrut}/CUSTOM/{tahun}',
            });
            expect(updated.masukFormat).toBe('{noUrut}/CUSTOM/{tahun}');
            expect(updated.keluarFormat).toBeDefined(); // default retained
        });

        it('should persist updated templates', async () => {
            const stored = {
                unitKerjaId: 'persist-unit',
                masukFormat: 'PERSISTED/{noUrut}/{tahun}',
                keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
            };
            enqueue([], [stored], [stored]);
            await settingsService.updateSuratTemplates('persist-unit', {
                masukFormat: 'PERSISTED/{noUrut}/{tahun}',
            });
            const fetched = await settingsService.getSuratTemplates('persist-unit');
            expect(fetched.masukFormat).toBe('PERSISTED/{noUrut}/{tahun}');
        });
    });

    // ==================== User Preferences (in-memory) ====================

    describe('getUserPreferences', () => {
        it('should return defaults for new user', async () => {
            const prefs = await settingsService.getUserPreferences('new-user-id');
            expect(prefs).toHaveProperty('theme', 'light');
            expect(prefs).toHaveProperty('language', 'id');
            expect(prefs).toHaveProperty('notificationsEnabled', true);
            expect(prefs).toHaveProperty('emailNotifications', false);
        });
    });

    describe('updateUserPreferences', () => {
        it('should merge preferences and return updated', async () => {
            enqueue([], [{
                userId: 'pref-user', theme: 'dark', language: 'id',
                notificationsEnabled: true, emailNotifications: false, updatedAt: new Date(),
            }]);
            const updated = await settingsService.updateUserPreferences('pref-user', {
                theme: 'dark',
            });
            expect(updated.theme).toBe('dark');
            expect(updated.language).toBe('id'); // default retained
        });

        it('should persist preferences across calls', async () => {
            const stored = {
                userId: 'persist-user', theme: 'dark', language: 'id',
                notificationsEnabled: true, emailNotifications: false, updatedAt: new Date(),
            };
            enqueue([], [stored], [stored]);
            await settingsService.updateUserPreferences('persist-user', { theme: 'dark' });
            const prefs = await settingsService.getUserPreferences('persist-user');
            expect(prefs.theme).toBe('dark');
        });

        it('should allow overriding multiple fields', async () => {
            enqueue([], [{
                userId: 'multi-user', theme: 'dark', language: 'en',
                notificationsEnabled: true, emailNotifications: true, updatedAt: new Date(),
            }]);
            const updated = await settingsService.updateUserPreferences('multi-user', {
                theme: 'dark',
                language: 'en',
                emailNotifications: true,
            });
            expect(updated.theme).toBe('dark');
            expect(updated.language).toBe('en');
            expect(updated.emailNotifications).toBe(true);
        });
    });

    // ==================== DB-dependent methods ====================

    describe('getProfile', () => {
        it('should return user when found', async () => {
            const mockUser = { id: 'user-1', name: 'Test', email: 'test@x.com' };
            enqueue([mockUser]);
            const result = await settingsService.getProfile('user-1');
            expect(result).toEqual(mockUser);
        });

        it('should return null when user not found', async () => {
            enqueue([]);
            const result = await settingsService.getProfile('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('updateProfile', () => {
        it('should return updated user', async () => {
            const updated = { id: 'user-1', name: 'New Name' };
            enqueue([{ id: 'user-1', name: 'Old Name' }], [updated]);
            const result = await settingsService.updateProfile('user-1', { name: 'New Name' });
            expect(result).toEqual(updated);
        });

        it('should return null when user not found', async () => {
            enqueue([]);
            const result = await settingsService.updateProfile('nonexistent', { name: 'X' });
            expect(result).toBeNull();
        });

        it('rolls back a profile update when critical audit storage fails', async () => {
            enqueue([{ id: 'user-1', name: 'Old Name' }], [{ id: 'user-1', name: 'New Name' }]);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(settingsService.updateProfile(
                'user-1',
                { name: 'New Name' },
                { userId: 'user-1' },
            )).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
        });
    });

    describe('getAllUnitKerja', () => {
        it('should return array of unit kerja', async () => {
            const units = [
                { id: 'ditjen', name: 'Ditjen PTPP' },
                { id: 'sesditjen', name: 'Sesditjen' },
            ];
            enqueue(units);
            const result = await settingsService.getAllUnitKerja();
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('ditjen');
        });

        it('should return empty array when no units', async () => {
            enqueue([]);
            const result = await settingsService.getAllUnitKerja();
            expect(result).toHaveLength(0);
        });
    });
});
