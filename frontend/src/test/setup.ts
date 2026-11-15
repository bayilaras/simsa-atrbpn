import '@testing-library/jest-dom';
import { afterEach, expect } from 'vitest';

// Tests must not reach the network. An unmocked service call used to fail with
// ECONNREFUSED; ApiClient retried it after 1 s, and the retry's setState could
// land after jsdom was torn down ("window is not defined"), failing the run at
// random although every test passed. This default fetch rejects at once, and
// the hook below fails the test that sent the request. A test that needs fetch
// replaces it with vi.stubGlobal('fetch', ...); vi.unstubAllGlobals() restores
// this guard.
const unmockedRequests: string[] = [];

globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const request = `${method} ${url}`;
    unmockedRequests.push(`${request} (${expect.getState().currentTestName ?? 'outside a test'})`);
    // ApiClient does not retry a cancelled request, so an AbortError leaves no
    // retry timer running after the test. The afterEach hook reports it.
    throw new DOMException(`Unmocked network request in a test: ${request}`, 'AbortError');
};

afterEach(() => {
    // Draf isian formulir disimpan di sessionStorage; jangan bocor ke tes berikutnya.
    try {
        globalThis.sessionStorage?.clear();
    } catch {
        // Penyimpanan tidak tersedia pada lingkungan tes ini.
    }
    const requests = unmockedRequests.splice(0);
    expect(requests, 'Unmocked network request: mock the service that sends it').toEqual([]);
});
