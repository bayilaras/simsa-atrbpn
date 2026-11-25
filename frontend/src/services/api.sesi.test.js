import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sesi = vi.hoisted(() => ({
    catatKontakServer: vi.fn(),
    alamatMasukSetelahSesiDitolak: vi.fn(() => '/login?sesi=berakhir'),
    ingatHalamanKembali: vi.fn(),
}))
vi.mock('../lib/sesi-masuk', () => sesi)
vi.mock('../lib/offline-storage', () => ({ clearOfflineStorage: vi.fn().mockResolvedValue({}) }))

import { api } from './api'

function respond(status, body = {}) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue(body),
    }))
}

describe('API client and the server session', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => vi.unstubAllGlobals())

    it('records that the server accepted the session on every successful response', async () => {
        respond(200, { success: true })
        await expect(api.get('/api/surat-masuk')).resolves.toEqual({ success: true })
        expect(sesi.catatKontakServer).toHaveBeenCalledOnce()
    })

    it('chooses the login address that explains why the server refused the session', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        respond(401)
        await expect(api.get('/api/surat-masuk')).rejects.toThrow('Sesi telah berakhir')
        expect(sesi.alamatMasukSetelahSesiDitolak).toHaveBeenCalledOnce()
        expect(sesi.catatKontakServer).not.toHaveBeenCalled()
    })

    it('remembers the open page (path and query only) when the server refuses the session', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const before = window.location.pathname + window.location.search + window.location.hash
        window.history.pushState({}, '', '/surat/masuk/tambah?dari=daftar#bagian')
        try {
            respond(401)
            await expect(api.get('/api/surat-masuk')).rejects.toThrow('Sesi telah berakhir')
            expect(sesi.ingatHalamanKembali).toHaveBeenCalledOnce()
            expect(sesi.ingatHalamanKembali).toHaveBeenCalledWith('/surat/masuk/tambah?dari=daftar')
        } finally {
            window.history.pushState({}, '', before)
        }
    })

    it('does not touch the remembered page on a successful response', async () => {
        respond(200, { success: true })
        await api.get('/api/surat-masuk')
        expect(sesi.ingatHalamanKembali).not.toHaveBeenCalled()
    })
})
