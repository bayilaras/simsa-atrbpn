import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSave } from './useAutoSave'
import { clearOfflineStorage } from '../lib/offline-storage'
import { createAuthService } from '../services/auth.service'

describe('session-scoped drafts', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(async () => {
        cleanup()
        await clearOfflineStorage()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it.each([false, true])('does not expose a previous user draft after logout (network failure: %s)', async (fails) => {
        const key = `logout-${fails}`
        const firstUser = renderHook(() => useAutoSave(key, 100))
        act(() => {
            firstUser.result.current.saveDraft({ perihal: 'Data rahasia pengguna pertama' })
            vi.advanceTimersByTime(100)
        })
        expect(firstUser.result.current.hasDraft()).toBe(true)
        firstUser.unmount()

        vi.spyOn(console, 'error').mockImplementation(() => {})
        const auth = createAuthService({
            provider: 'better-auth',
            legacyClient: { signOut: fails ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue({}) },
        })
        await auth.signOut()
        const nextUser = renderHook(() => useAutoSave(key, 100))
        let draft
        act(() => { draft = nextUser.result.current.restoreDraft() })
        expect(draft).toBeNull()
    })

    it('discards queued writes when session cleanup runs before the autosave timer', async () => {
        const previousSession = renderHook(() => useAutoSave('pending-session', 100))
        act(() => previousSession.result.current.saveDraft({ perihal: 'Draf sesi yang berakhir' }))

        await clearOfflineStorage()
        act(() => vi.advanceTimersByTime(100))
        previousSession.unmount()

        const nextSession = renderHook(() => useAutoSave('pending-session', 100))
        let draft
        act(() => { draft = nextSession.result.current.restoreDraft() })
        expect(draft).toBeNull()
    })

    it('clears drafts immediately while the server is still processing logout', async () => {
        const firstUser = renderHook(() => useAutoSave('pending-logout', 100))
        act(() => {
            firstUser.result.current.saveDraft({ perihal: 'Draf sebelum logout' })
            vi.advanceTimersByTime(100)
        })
        firstUser.unmount()
        let finishLogout
        const remoteLogout = new Promise(resolve => { finishLogout = resolve })
        const auth = createAuthService({ provider: 'better-auth', legacyClient: { signOut: () => remoteLogout } })
        const logout = auth.signOut()

        const nextUser = renderHook(() => useAutoSave('pending-logout', 100))
        let draft
        act(() => { draft = nextUser.result.current.restoreDraft() })
        expect(draft).toBeNull()

        finishLogout()
        await logout
    })

    it('still restores a draft while the same authenticated session is active', () => {
        const firstVisit = renderHook(() => useAutoSave('same-session', 100))
        act(() => {
            firstVisit.result.current.saveDraft({ perihal: 'Draf aktif' })
            vi.advanceTimersByTime(100)
        })
        firstVisit.unmount()
        const secondVisit = renderHook(() => useAutoSave('same-session', 100))
        let draft
        act(() => { draft = secondVisit.result.current.restoreDraft() })
        expect(draft).toEqual({ perihal: 'Draf aktif' })
    })

    it('does not save pending edits into a different form after its draft key changes', () => {
        const page = renderHook(({ draftKey }) => useAutoSave(draftKey, 100), {
            initialProps: { draftKey: 'edit-letter-a' },
        })
        act(() => page.result.current.saveDraft({ perihal: 'Perubahan surat A' }))
        page.rerender({ draftKey: 'new-letter' })
        act(() => vi.advanceTimersByTime(100))

        let draft
        act(() => { draft = page.result.current.restoreDraft() })
        expect(draft).toBeNull()

        act(() => {
            page.result.current.saveDraft({ perihal: 'Surat baru' })
            vi.advanceTimersByTime(100)
            draft = page.result.current.restoreDraft()
        })
        expect(draft).toEqual({ perihal: 'Surat baru' })
    })
})
