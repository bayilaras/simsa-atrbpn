import { describe, expect, it } from 'vitest';
import {
    canDecideVerification,
    createElectronicRegistrationCode,
    evaluateScanQuality,
    identifyFileFormat,
    isPreservationAction,
} from '../services/electronic-archive-policy';

describe('electronic archive policy', () => {
    it('requires at least 300 DPI and 24-bit colour for paper scans', () => {
        const result = evaluateScanQuality({
            sourceType: 'digitized',
            scanCategory: 'paper',
            resolutionDpi: 299,
            colorDepth: 8,
        });
        expect(result.passed).toBe(false);
        expect(result.minimumDpi).toBe(300);
        expect(result.errors).toHaveLength(2);
    });

    it('uses the higher thresholds for cartographic and photographic scans', () => {
        expect(evaluateScanQuality({
            sourceType: 'digitized', scanCategory: 'cartographic', resolutionDpi: 400, colorDepth: 24,
        }).passed).toBe(true);
        expect(evaluateScanQuality({
            sourceType: 'digitized', scanCategory: 'photo', resolutionDpi: 599, colorDepth: 24,
        }).minimumDpi).toBe(600);
    });

    it('does not invent scanner requirements for born-digital records', () => {
        expect(evaluateScanQuality({ sourceType: 'born_digital' })).toEqual({
            passed: true,
            minimumDpi: null,
            errors: [],
        });
    });

    it('identifies the actual container format without falsely claiming PDF/A', () => {
        expect(identifyFileFormat('application/pdf', 'record.pdf')).toBe('PDF');
        expect(identifyFileFormat(null, 'scan.tiff')).toBe('TIFF');
    });

    it('creates a stable registration-code shape', () => {
        expect(createElectronicRegistrationCode('ditjen', 'abc-123', new Date('2026-01-01T00:00:00Z')))
            .toBe('AE-2026-DITJEN-ABC123');
    });

    it('accepts only controlled preservation actions', () => {
        expect(isPreservationAction('encapsulation')).toBe(true);
        expect(isPreservationAction('overwrite_original')).toBe(false);
    });

    it('makes a verification decision final for each version', () => {
        expect(canDecideVerification('pending')).toBe(true);
        expect(canDecideVerification('verified')).toBe(false);
        expect(canDecideVerification('rejected')).toBe(false);
    });
});
