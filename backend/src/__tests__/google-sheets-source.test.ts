import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_SHEETS_LIMITS, GoogleSheetsSource, parseBoundedSheetCsv } from '../services/google-sheets-source.js';

const sourceUrl = 'https://docs.google.com/spreadsheets/d/synthetic-sheet/gviz/tq?tqx=out:csv';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('bounded public Google Sheets source', () => {
    it('reads UTF-8 streams with manual redirects and no credentials', async () => {
        const bytes = new TextEncoder().encode('No,Perihal\n1,Arsip é');
        const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
            controller.enqueue(bytes.slice(0, bytes.length - 1));
            controller.enqueue(bytes.slice(bytes.length - 1)); controller.close();
        } })));
        vi.stubGlobal('fetch', fetchMock);
        const source = new GoogleSheetsSource();
        try {
            expect(await source.text(sourceUrl)).toBe('No,Perihal\n1,Arsip é');
            expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
                redirect: 'manual', credentials: 'omit', signal: expect.any(AbortSignal),
            }));
        } finally { source.close(); }
    });

    it.each(['https://127.0.0.1/private', 'https://docs.google.com.evil.test/private',
        'http://docs.google.com/private', 'https://user:password@docs.google.com/private',
        'https://docs.google.com:8443/private', 'https://evil.googleusercontent.com/private'])('rejects redirect %s before a second fetch', async location => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 302, headers: { location } }));
        vi.stubGlobal('fetch', fetchMock);
        const source = new GoogleSheetsSource();
        try {
            await expect(source.text(sourceUrl)).rejects.toMatchObject({ statusCode: 400 });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally { source.close(); }
    });

    it('permits the Google Sheets export host and bounds redirect chains', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://doc-abc-sheets.googleusercontent.com/export' } }))
            .mockResolvedValueOnce(new Response('No\n1'));
        vi.stubGlobal('fetch', fetchMock);
        const source = new GoogleSheetsSource();
        try { expect(await source.text(sourceUrl)).toBe('No\n1'); }
        finally { source.close(); }
        fetchMock.mockReset().mockImplementation(() => Promise.resolve(new Response('', { status: 302, headers: { location: sourceUrl } })));
        const loop = new GoogleSheetsSource();
        try {
            await expect(loop.text(sourceUrl)).rejects.toMatchObject({ statusCode: 400 });
            expect(fetchMock).toHaveBeenCalledTimes(GOOGLE_SHEETS_LIMITS.redirects + 1);
        } finally { loop.close(); }
    });

    it('cancels an oversized stream without trusting a missing Content-Length', async () => {
        const cancel = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
            pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel,
        }))));
        const source = new GoogleSheetsSource();
        try {
            await expect(source.text(sourceUrl, 10)).rejects.toMatchObject({ statusCode: 413 });
            expect(cancel).toHaveBeenCalledOnce();
        } finally { source.close(); }
    });

    it('rejects a declared oversized body before reading it', async () => {
        const response = new Response('small', { headers: { 'content-length': String(GOOGLE_SHEETS_LIMITS.responseBytes + 1) } });
        const read = vi.spyOn(response.body!, 'getReader');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
        const source = new GoogleSheetsSource();
        try {
            await expect(source.text(sourceUrl)).rejects.toMatchObject({ statusCode: 413 });
            expect(read).not.toHaveBeenCalled();
        } finally { source.close(); }
    });

    it('shares one byte budget across all fallback probes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array(4 * 1024 * 1024)))));
        const source = new GoogleSheetsSource();
        try {
            await source.text(sourceUrl);
            await expect(source.text(sourceUrl)).rejects.toMatchObject({ statusCode: 413 });
        } finally { source.close(); }
    });

    it('ends a stalled response body at the total deadline', async () => {
        vi.useFakeTimers();
        const cancel = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
        vi.stubGlobal('fetch', fetchMock);
        const source = new GoogleSheetsSource();
        const promise = expect(source.text(sourceUrl)).rejects.toMatchObject({ statusCode: 504 });
        await vi.advanceTimersByTimeAsync(GOOGLE_SHEETS_LIMITS.deadlineMs);
        await promise;
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
        source.close();
    });

    it('does not reset the deadline for a subsequent probe', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(new Response('ok')), 9_000))));
        const source = new GoogleSheetsSource();
        const first = source.text(sourceUrl);
        await vi.advanceTimersByTimeAsync(9_000);
        await first;
        const second = expect(source.text(sourceUrl)).rejects.toMatchObject({ statusCode: 504 });
        await vi.advanceTimersByTimeAsync(6_000);
        await second;
        source.close();
    });

    it('cancels fetch when the caller disconnects and does not forward its reason', async () => {
        const caller = new AbortController();
        const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
        vi.stubGlobal('fetch', fetchMock);
        const source = new GoogleSheetsSource({ signal: caller.signal });
        const outcome = expect(source.text(sourceUrl)).rejects.toMatchObject({ statusCode: 499, message: 'Permintaan impor dibatalkan.' });
        caller.abort(new Error('SYNTHETIC_SECRET_DISCONNECT'));
        await outcome;
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        source.close();
    });

    it('sanitizes failed providers and never falls back to response.text()', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('SYNTHETIC_SECRET_PROVIDER')));
        const source = new GoogleSheetsSource();
        try {
            await expect(source.text(sourceUrl)).rejects.toMatchObject({ statusCode: 502, message: 'Google Sheets tidak dapat diambil atau dibaca.' });
        } finally { source.close(); }
    });
});

describe('bounded CSV parser', () => {
    it('preserves escaped quotes, multiline fields, BOM and CRLF', () => {
        expect(parseBoundedSheetCsv('\uFEFFNo,Perihal\r\n1,"a,b\n""kutip"""\r\n')).toEqual([['No', 'Perihal'], ['1', 'a,b\n"kutip"']]);
    });
    it.each(['No,Perihal\n1,"unfinished', 'No\ninvalid"quote', 'No\n"closed"x', 'No\n\u0000'])('rejects malformed CSV', value => {
        expect(() => parseBoundedSheetCsv(value)).toThrow();
    });
    it('bounds records, including empty records, and columns', () => {
        expect(() => parseBoundedSheetCsv('x\n'.repeat(GOOGLE_SHEETS_LIMITS.rows + 1))).toThrow(/baris/);
        expect(() => parseBoundedSheetCsv('\n'.repeat(GOOGLE_SHEETS_LIMITS.rows + 1))).toThrow(/baris/);
        expect(() => parseBoundedSheetCsv(Array(65).fill('x').join(','))).toThrow(/kolom/);
    });
    it('bounds UTF-8 field bytes and total CSV bytes', () => {
        expect(() => parseBoundedSheetCsv('x'.repeat(GOOGLE_SHEETS_LIMITS.fieldBytes + 1))).toThrow(/Field/);
        expect(() => parseBoundedSheetCsv('é'.repeat(GOOGLE_SHEETS_LIMITS.fieldBytes))).toThrow(/Field/);
        expect(() => parseBoundedSheetCsv('x'.repeat(GOOGLE_SHEETS_LIMITS.responseBytes + 1))).toThrow(/5 MiB/);
    });
});
