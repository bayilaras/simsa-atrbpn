import { useEffect, useCallback, useState } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Hook to warn users when they try to leave a page with unsaved changes.
 *
 * Features:
 * - Shows browser's native "Leave page?" dialog when closing/reloading tab
 * - Shows React Router blocker when navigating to another route
 * - Provides `isDirty` state and `setDirty` / `resetDirty` controls
 *
 * Usage:
 *   const { isDirty, setDirty, resetDirty } = useUnsavedChanges();
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
 */
export function useUnsavedChanges() {
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

    // React Router navigation blocker
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) =>
            isDirty && currentLocation.pathname !== nextLocation.pathname
    );

    // Auto-show browser confirm dialog when blocker triggers
    useEffect(() => {
        if (blocker.state === 'blocked') {
            const confirmed = window.confirm(
                'Anda memiliki perubahan yang belum disimpan. Yakin ingin meninggalkan halaman ini?'
            );
            if (confirmed) {
                blocker.proceed();
            } else {
                blocker.reset();
            }
        }
    }, [blocker]);

    const setDirty = useCallback(() => setIsDirty(true), []);
    const resetDirty = useCallback(() => setIsDirty(false), []);

    return { isDirty, setDirty, resetDirty };
}

export default useUnsavedChanges;
