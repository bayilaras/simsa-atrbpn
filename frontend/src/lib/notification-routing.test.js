import { describe, expect, it } from 'vitest';
import {
    notificationMatchesFilter,
    notificationRoute,
    WORKFLOW_NOTIFICATION_CATEGORIES,
} from './notification-routing';

describe('notification routing', () => {
    it.each([
        ['distribusi', '/distribusi'],
        ['verifikasi-retensi', '/retention-governance'],
        ['appraisal', '/retention-governance'],
        ['penyusutan', '/penyusutan'],
        ['penyerahan-permanen', '/retention-governance'],
    ])('routes %s to an existing module', (category, expected) => {
        expect(notificationRoute({ category, referenceId: 'one' })).toBe(expected);
    });

    it('routes record-backed notifications to their details', () => {
        expect(notificationRoute({ category: 'surat-masuk', referenceId: 'surat-1' }))
            .toBe('/surat/masuk/surat-1');
        expect(notificationRoute({ category: 'arsip-retensi', referenceId: 'arsip-1' }))
            .toBe('/arsip/detail/arsip-1');
        expect(WORKFLOW_NOTIFICATION_CATEGORIES).toHaveLength(5);
    });

    it('groups every workflow category without swallowing primary categories', () => {
        for (const category of WORKFLOW_NOTIFICATION_CATEGORIES) {
            expect(notificationMatchesFilter({ category }, 'workflow')).toBe(true);
        }
        expect(notificationMatchesFilter({ category: 'surat-masuk' }, 'workflow')).toBe(false);
        expect(notificationMatchesFilter({ category: 'surat-masuk' }, 'all')).toBe(true);
    });
});
