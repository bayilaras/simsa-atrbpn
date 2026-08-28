import { describe, expect, it } from 'vitest';
import { formulirMetadata, getFormulirMetadata } from './formulir-metadata';

describe('formulir reference metadata', () => {
    it('labels all 33 empty templates and routes users to data-bound modules', () => {
        expect(formulirMetadata).toHaveLength(33);
        expect(formulirMetadata.every(form => form.path && form.label)).toBe(true);
        expect(getFormulirMetadata(1).path).toBe('/archive-lending');
        expect(getFormulirMetadata(27).path).toBe('/arsip-vital');
        expect(getFormulirMetadata(33).path).toBe('/arsip-terjaga');
    });
});
