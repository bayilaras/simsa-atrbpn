import { isMetadataDemo } from './demo.js';
import { buildCloudPlatformConfig } from './cloud-platform.js';
import { getObjectStorageConfigurationStatus } from './blob-storage.js';
import { loadMalwareScanConfig, validateMalwareScanConfig } from './malware-scanner.js';
import { buildGoogleOAuthConfig } from './google-oauth.js';

/** Existing installs stay enabled only when the flag is absent. Typos fail closed. */
export function getOptionalModuleCapabilities(source: NodeJS.ProcessEnv = process.env) {
    const enabled = (value: string | undefined) => value === undefined || value.trim().toLowerCase() === 'true';
    const full = !isMetadataDemo(source);
    return {
        bulkOcr: full && enabled(source.SIMSA_BULK_OCR_ENABLED),
        advancedArchiveWorkflows: full && enabled(source.SIMSA_ADVANCED_ARCHIVE_WORKFLOWS_ENABLED),
    };
}

/** Configuration availability only; no credentials or claims of live service health. */
export function getPublicCapabilities(source: NodeJS.ProcessEnv = process.env) {
    const demo = isMetadataDemo(source);
    const cloud = buildCloudPlatformConfig(source);
    const files = !demo && cloud.validationErrors.length === 0 && getObjectStorageConfigurationStatus(source).ready;
    let fileUploads = false;
    if (files) {
        try {
            const scanner = loadMalwareScanConfig(source);
            validateMalwareScanConfig(scanner, source.NODE_ENV || 'development', source, {
                requireScannerConnection: scanner.worker.runtime !== 'external',
            });
            fileUploads = scanner.mode === 'clamav' && scanner.workerEnabled;
        } catch { /* Invalid scanner settings must never advertise usable uploads. */ }
    }
    const googleSignIn = cloud.authProvider === 'firebase'
        ? Boolean(cloud.firebaseProjectId) && !cloud.validationErrors.some(error => /Firebase|FIREBASE|project authority|AUTH_PROVIDER/.test(error))
        : !demo && buildGoogleOAuthConfig(source).configured;
    return {
        mode: demo ? 'metadata-demo' : 'full',
        syntheticDataOnly: demo,
        capabilities: {
            metadata: true, files, fileUploads,
            ...getOptionalModuleCapabilities(source),
            // Public Sheets metadata imports and source links do not require
            // the separate SRIKANDI connector or its credentials.
            externalIntegrations: !demo,
        },
        authentication: { provider: cloud.authProvider, googleSignIn },
    } as const;
}
