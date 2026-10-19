import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_SHEETS_LIMITS, extractSheetGid, parseSheetTabs } from '../services/google-sheets-source.js';

vi.mock('../services/surat-masuk.service.js', () => ({ suratMasukService: { createImported: vi.fn() } }));
vi.mock('../services/surat-keluar.service.js', () => ({ suratKeluarService: { createImported: vi.fn() } }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
import { GoogleDriveImportService } from '../services/google-drive-import.service.js';

// Shape of the editor bootstrap Google serves for a public spreadsheet: each
// tab is a JSON array encoded as a string inside the bootstrapData object.
const tab = (index: number, gid: string, name: string) => JSON.stringify([21350203,
    JSON.stringify([index, 0, gid, [{ 1: [[0, 0, name], [{ 1: 6, 2: 0, 9: 0 }]] }], 1000, 27])]);
const editorHtml = (...tabs: string[]) => '<html><body><div class="docs-sheet-tab-caption">ignored</div>'
    + `<script nonce="n">var bootstrapData = {"changes":{"topsnapshot":[[55992331,"[{\\"1\\":99}]"],${tabs.join(',')}]}};</script></body></html>`;
const csvUrl = (call: unknown[]) => new URL(String(call[0]));

afterEach(() => { vi.unstubAllGlobals(); });

describe('Google Sheets tabs are identified by gid', () => {
    it('reads every tab name with its gid in workbook order, decoding escaped names', () => {
        const html = editorHtml(tab(0, '0', 'Database_2022'), tab(1, '234636572', '2026'),
            tab(2, '1835987035', 'Surat "Dinas" & Nota é'));
        expect(parseSheetTabs(html)).toEqual([
            { gid: '0', name: 'Database_2022' },
            { gid: '234636572', name: '2026' },
            { gid: '1835987035', name: 'Surat "Dinas" & Nota é' },
        ]);
    });

    it('ignores malformed snapshots and duplicate gids', () => {
        const html = editorHtml(tab(0, '7', 'Data A'), tab(1, '7', 'Data A copy'), tab(2, 'x1', 'Bad gid'),
            JSON.stringify([21350203, '[3,0,"9",[{"1":[[0,0,"Unclosed"]]}],10,2']));
        expect(parseSheetTabs(html)).toEqual([{ gid: '7', name: 'Data A' }]);
    });

    it('does not start a tab at an escaped quote inside another string', () => {
        const html = '<script>var s = "a\\"[1,0,\\"5\\",[{\\"1\\":[[0,0,\\"Fake\\"]]}],1,1]";</script>' + editorHtml(tab(0, '7', 'Data A'));
        expect(parseSheetTabs(html)).toEqual([{ gid: '7', name: 'Data A' }]);
    });

    it('returns no tabs for an editor page above the size limit, so the linked tab can still be used', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(GOOGLE_SHEETS_LIMITS.htmlBytes + 1))));
        expect(await new GoogleDriveImportService().listSheets('synthetic-sheet')).toEqual([]);
    });

    it('takes the gid of the tab the user linked, from the fragment or the query', () => {
        expect(extractSheetGid('https://docs.google.com/spreadsheets/d/abc/edit?gid=11#gid=234636572')).toBe('234636572');
        expect(extractSheetGid('https://docs.google.com/spreadsheets/d/abc/edit?usp=sharing&gid=42')).toBe('42');
        expect(extractSheetGid('https://docs.google.com/spreadsheets/d/abc/edit')).toBeNull();
        expect(extractSheetGid('https://docs.google.com/spreadsheets/d/abc/edit#gid=12x')).toBeNull();
        expect(extractSheetGid('not a url')).toBeNull();
    });

    it('lists real tabs from one editor request', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(editorHtml(tab(0, '0', 'Database_2022'), tab(1, '234636572', '2026'))));
        vi.stubGlobal('fetch', fetchMock);
        expect(await new GoogleDriveImportService().listSheets('synthetic-sheet')).toEqual([
            { gid: '0', name: 'Database_2022' }, { gid: '234636572', name: '2026' },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not guess tab names when none are detected, because Google answers unknown names with the first tab', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('<html><body>no bootstrap</body></html>'))
            .mockResolvedValue(new Response('"No","Tanggal Dibuat"'));
        vi.stubGlobal('fetch', fetchMock);
        expect(await new GoogleDriveImportService().listSheets('synthetic-sheet')).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['preview', 'surat-masuk', 'surat-keluar'] as const)('fetches the selected tab by gid for %s', async action => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('Nomor Surat,Tanggal Surat,Hal,Dari,Kepada\n'));
        vi.stubGlobal('fetch', fetchMock);
        const service = new GoogleDriveImportService();
        const sheet = { gid: '234636572' };
        await (action === 'preview' ? service.previewData('synthetic-sheet', sheet)
            : action === 'surat-masuk' ? service.importSuratMasuk('synthetic-sheet', sheet, 'unit-a', { userId: 'u' })
                : service.importSuratKeluar('synthetic-sheet', sheet, 'unit-a', { userId: 'u' }));
        const url = csvUrl(fetchMock.mock.calls[0]);
        expect(url.searchParams.get('gid')).toBe('234636572');
        expect(url.searchParams.has('sheet')).toBe(false);
    });
});
