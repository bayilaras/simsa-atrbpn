import assert from 'node:assert/strict';
import { isIPv4 } from 'node:net';

// Docker's published loopback endpoint and the server's bridge address differ.
// Derive the latter from the exact CI service container, never from the SQL
// response being checked or an arbitrary caller-supplied expected IP.
export function expectedContainerServer(metadata, { containerId, image, hostPort }) {
    assert.match(containerId || '', /^[a-f0-9]{64}$/, 'Exact service container ID required');
    assert.match(image || '', /^postgres:(16|17|18)[^@]*@sha256:[a-f0-9]{64}$/, 'Pinned PostgreSQL image required');
    assert.equal(metadata?.id, containerId, 'Inspected service container differs');
    assert.equal(metadata?.image, image, 'Inspected PostgreSQL image differs');
    assert.equal(metadata?.running, true, 'Service container is not running');
    const bindings = metadata?.ports?.['5432/tcp'];
    assert(Array.isArray(bindings) && bindings.length > 0, 'PostgreSQL published port required');
    assert(bindings.every(binding => String(binding.HostPort) === String(hostPort)
        && ['0.0.0.0', '127.0.0.1', '::', '::1'].includes(binding.HostIp)), 'Published endpoint differs');
    assert(bindings.some(binding => ['0.0.0.0', '127.0.0.1'].includes(binding.HostIp)), 'IPv4 loopback endpoint required');
    const networks = Object.values(metadata?.networks || {});
    assert.equal(networks.length, 1, 'Exactly one service network required');
    assert.match(networks[0].NetworkID || '', /^[a-f0-9]{64}$/, 'Concrete Docker network required');
    assert(isIPv4(networks[0].IPAddress), 'Concrete container IPv4 address required');
    return { host: networks[0].IPAddress, port: 5432 };
}

export function assertUpgradeTestIdentity(identity, { database, server }) {
    assert.equal(identity.database, database, 'Connected test database differs');
    assert.equal(identity.host, server.host, 'Connected test server address differs');
    assert.equal(Number(identity.port), server.port, 'Connected test server port differs');
}
