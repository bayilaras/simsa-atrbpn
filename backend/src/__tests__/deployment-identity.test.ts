import { describe, expect, it } from 'vitest';
import { vercelDeploymentId } from '../utils/deployment-identity.js';

describe('vercelDeploymentId', () => {
    it('returns the immutable Vercel deployment id exposed to the function', () => {
        expect(vercelDeploymentId({ VERCEL_DEPLOYMENT_ID: 'dpl_31FvsRbDVi5KTYkBmkVTNxKZApmw' })).toBe('dpl_31FvsRbDVi5KTYkBmkVTNxKZApmw');
    });
    it.each([undefined, '', 'dpl_', 'prj_31FvsRbDVi5KTYkBmkVTNxKZApmw', 'dpl_abc def', `dpl_${'a'.repeat(65)}`])(
        'ignores a missing or malformed value (%j)', value => {
            expect(vercelDeploymentId({ VERCEL_DEPLOYMENT_ID: value })).toBeUndefined();
        });
});
