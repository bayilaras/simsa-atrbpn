import { createElement, useEffect, useCallback, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { DialogKonfirmasi } from '@/components/DialogKonfirmasi';
import { tandaiBelumDisimpan } from '@/lib/perubahan-belum-disimpan';

const PERMINTAAN_TINGGALKAN = Object.freeze({
    judul: 'Tinggalkan halaman ini?',
    pesan: 'Anda memiliki perubahan yang belum disimpan. Bila halaman ini ditinggalkan, perubahan tersebut hilang.',
    aksi: 'Tinggalkan halaman',
    batal: 'Tetap di halaman',
    berbahaya: true,
});

/**
 * Hook to warn users when they try to leave a page with unsaved changes.
 *
 * Features:
 * - Shows browser's native "Leave page?" dialog when closing/reloading tab
 * - Shows the application dialog when navigating to another route; render
 *   the returned `dialogTinggalkan` element in the page
 * - Provides `isDirty` state and `setDirty` / `resetDirty` controls
 * - `onTinggalkan` runs when the user confirms leaving (e.g. to drop a draft)
 * - Marks the page as holding unsaved input (lib/perubahan-belum-disimpan) so
 *   an application update never reloads it on its own
 *
 * Usage:
 *   const { isDirty, setDirty, resetDirty, dialogTinggalkan } = useUnsavedChanges();
 *
 *   // Mark form as modified when any field changes
 *   const handleFieldChange = (value) => {
 *     setFormData({ ...formData, field: value });
 *     setDirty();
 *   };
 *
 *   // Reset after successful save
 *   const handleSubmit = async () => {
 *     await api.post('/api/...', formData);
 *     resetDirty();
 *   };
 *
 *   return <>{...}{dialogTinggalkan}</>;
 */
export function useUnsavedChanges({ onTinggalkan } = {}) {
    const [isDirty, setIsDirty] = useState(false);

    // Browser tab close / reload warning
    useEffect(() => {
        if (!isDirty) return;

        const handler = (e) => {
            e.preventDefault();
            e.returnValue = ''; // Chrome requires this
        };

        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    useEffect(() => {
        if (!isDirty) return undefined;
        const token = {};
        tandaiBelumDisimpan(token, true);
        return () => tandaiBelumDisimpan(token, false);
    }, [isDirty]);

    // React Router navigation blocker
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) =>
            isDirty && currentLocation.pathname !== nextLocation.pathname
    );

    const jawabTinggalkan = useCallback((tinggalkan) => {
        if (blocker.state !== 'blocked') return;
        if (tinggalkan) {
            onTinggalkan?.();
            blocker.proceed();
        } else {
            blocker.reset();
        }
    }, [blocker, onTinggalkan]);

    const setDirty = useCallback(() => setIsDirty(true), []);
    const resetDirty = useCallback(() => setIsDirty(false), []);

    const dialogTinggalkan = createElement(DialogKonfirmasi, {
        key: 'dialog-tinggalkan-halaman',
        terbuka: blocker.state === 'blocked',
        permintaan: PERMINTAAN_TINGGALKAN,
        onJawab: jawabTinggalkan,
    });

    return { isDirty, setDirty, resetDirty, dialogTinggalkan };
}

export default useUnsavedChanges;
