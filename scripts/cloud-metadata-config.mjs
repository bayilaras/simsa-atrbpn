/** Fixed backend profile for the Vercel metadata-only deployment (storage disabled). */
export const cloudMetadataEnvironment = Object.freeze({
    NODE_ENV: 'production',
    APP_PROFILE: 'internal',
    SIMSA_APP_MODE: 'full',
    SIMSA_CLOUD_PLATFORM: 'local',
    AUTH_PROVIDER: 'better-auth',
    OBJECT_STORAGE_PROVIDER: 'disabled',
    GOOGLE_OAUTH_ENABLED: 'false',
    MALWARE_SCANNER_MODE: 'disabled',
    MALWARE_SCAN_WORKER_ENABLED: 'false',
    SRIKANDI_ENABLED: 'false',
});
