import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedContainerServer, assertUpgradeTestIdentity } from './backup-upgrade-target.mjs';

const settings = { containerId: 'a'.repeat(64), image: `postgres:17-bookworm@sha256:${'b'.repeat(64)}`, hostPort: 5432 };
const metadata = () => ({ id: settings.containerId, image: settings.image, running: true,
    ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }, { HostIp: '::', HostPort: '5432' }] },
    networks: { ci: { NetworkID: 'c'.repeat(64), IPAddress: '172.18.0.2' } } });

test('Docker bridge identity matches independently inspected service metadata', () => {
    const server = expectedContainerServer(metadata(), settings);
    assert.deepEqual(server, { host: '172.18.0.2', port: 5432 });
    assert.doesNotThrow(() => assertUpgradeTestIdentity({ database: 'simsa_test', ...server }, { database: 'simsa_test', server }));
});

test('wrong container, image, state or unpinned metadata is rejected', () => {
    for (const change of [{ id: 'd'.repeat(64) }, { image: 'postgres:17' }, { running: false }]) {
        assert.throws(() => expectedContainerServer({ ...metadata(), ...change }, settings));
    }
    assert.throws(() => expectedContainerServer(metadata(), { ...settings, containerId: 'short' }));
    assert.throws(() => expectedContainerServer(metadata(), { ...settings, image: 'postgres:17' }));
});

test('wrong published port or a non-loopback host binding cannot authorize the server', () => {
    for (const binding of [{ HostIp: '127.0.0.1', HostPort: '5433' }, { HostIp: '192.0.2.8', HostPort: '5432' }]) {
        assert.throws(() => expectedContainerServer({ ...metadata(), ports: { '5432/tcp': [binding] } }, settings));
    }
    assert.throws(() => expectedContainerServer({ ...metadata(), ports: {} }, settings));
});

test('ambiguous or missing container networks fail closed', () => {
    assert.throws(() => expectedContainerServer({ ...metadata(), networks: {} }, settings));
    assert.throws(() => expectedContainerServer({ ...metadata(), networks: { ...metadata().networks, extra: metadata().networks.ci } }, settings));
    assert.throws(() => expectedContainerServer({ ...metadata(), networks: { ci: { NetworkID: 'c'.repeat(64), IPAddress: '' } } }, settings));
});

test('SQL identity must match the exact inspected container, database and internal port', () => {
    const server = expectedContainerServer(metadata(), settings);
    for (const change of [{ host: '172.18.0.3' }, { host: '127.0.0.1' }, { database: 'other' }, { port: 5433 }]) {
        assert.throws(() => assertUpgradeTestIdentity({ database: 'simsa_test', ...server, ...change }, { database: 'simsa_test', server }));
    }
});

test('native local PostgreSQL retains its exact loopback address and selected port', () => {
    const server = { host: '127.0.0.1', port: 55436 };
    assert.doesNotThrow(() => assertUpgradeTestIdentity({ database: 'simsa_gate_test', ...server }, { database: 'simsa_gate_test', server }));
    assert.throws(() => assertUpgradeTestIdentity({ database: 'simsa_gate_test', host: '172.18.0.2', port: 55436 }, { database: 'simsa_gate_test', server }));
});
