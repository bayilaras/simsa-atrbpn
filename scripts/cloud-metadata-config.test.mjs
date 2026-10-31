import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudMetadataEnvironment } from './cloud-metadata-config.mjs';

test('metadata profile is frozen to a full operational build with storage, OAuth, scanner and SRIKANDI disabled', () => {
    assert.equal(Object.isFrozen(cloudMetadataEnvironment), true);
    assert.deepEqual({ ...cloudMetadataEnvironment }, {
        NODE_ENV: 'production', APP_PROFILE: 'internal', SIMSA_APP_MODE: 'full', SIMSA_CLOUD_PLATFORM: 'local',
        AUTH_PROVIDER: 'better-auth', OBJECT_STORAGE_PROVIDER: 'disabled', GOOGLE_OAUTH_ENABLED: 'false',
        MALWARE_SCANNER_MODE: 'disabled', MALWARE_SCAN_WORKER_ENABLED: 'false', SRIKANDI_ENABLED: 'false',
    });
});
