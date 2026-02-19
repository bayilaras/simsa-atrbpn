import { useEffect, useCallback, useRef, useState } from 'react';

/**
 * Hook to auto-save form data to localStorage as a draft.
 *
 * Features:
 * - Auto-saves form state every `intervalMs` milliseconds (default 30s)
 * - Provides status indicator ("Draft tersimpan", "Menyimpan...")
 * - Restores saved draft when component mounts
 * - Clears draft after successful form submission
 *
 * Usage:
 *   const { saveDraft, clearDraft, restoreDraft, saveStatus } = useAutoSave('tambah-surat-masuk');
 *
 *   // On mount, check for existing draft
 *   useEffect(() => {
 *     const draft = restoreDraft();
 *     if (draft) setFormData(draft);
 *   }, []);
 *
 *   // Auto-save whenever form data changes
 *   useEffect(() => {
 *     saveDraft(formData);
 *   }, [formData]);
 *
 *   // Clear draft after successful submit
 *   const handleSubmit = async () => {
 *     await api.post('/api/...', formData);
 *     clearDraft();
 *   };
 *
 * @param {string} key - Unique key to identify this form's draft in localStorage
 * @param {number} intervalMs - Auto-save interval in milliseconds (default: 30000)
 */
export function useAutoSave(key, intervalMs = 30000) {
    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'restored'
    const pendingDataRef = useRef(null);
    const timerRef = useRef(null);
    const storageKey = `simsa-draft-${key}`;

    // Save data to localStorage
    const writeDraft = useCallback((data) => {
        try {
            const payload = {
                data,
                timestamp: Date.now(),
            };
            localStorage.setItem(storageKey, JSON.stringify(payload));
            setSaveStatus('saved');

            // Auto-clear status after 3 seconds
            setTimeout(() => setSaveStatus(null), 3000);
        } catch (err) {
            console.warn('[AutoSave] Failed to save draft:', err);
        }
    }, [storageKey]);

    // Queue data for next auto-save cycle
    const saveDraft = useCallback((data) => {
        pendingDataRef.current = data;
    }, []);

    // Auto-save timer
    useEffect(() => {
        timerRef.current = setInterval(() => {
            if (pendingDataRef.current) {
                setSaveStatus('saving');
                writeDraft(pendingDataRef.current);
                pendingDataRef.current = null;
            }
        }, intervalMs);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [intervalMs, writeDraft]);

    // Restore draft from localStorage
    const restoreDraft = useCallback(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return null;

            const { data, timestamp } = JSON.parse(raw);

            // Ignore drafts older than 24 hours
            const MAX_AGE_MS = 24 * 60 * 60 * 1000;
            if (Date.now() - timestamp > MAX_AGE_MS) {
                localStorage.removeItem(storageKey);
                return null;
            }

            setSaveStatus('restored');
            setTimeout(() => setSaveStatus(null), 3000);
            return data;
        } catch (err) {
            console.warn('[AutoSave] Failed to restore draft:', err);
            return null;
        }
    }, [storageKey]);

    // Clear draft from localStorage
    const clearDraft = useCallback(() => {
        localStorage.removeItem(storageKey);
        pendingDataRef.current = null;
        setSaveStatus(null);
    }, [storageKey]);

    // Check if a draft exists
    const hasDraft = useCallback(() => {
        return localStorage.getItem(storageKey) !== null;
    }, [storageKey]);

    return {
        saveDraft,
        clearDraft,
        restoreDraft,
        hasDraft,
        saveStatus, // null | 'saving' | 'saved' | 'restored'
    };
}

export default useAutoSave;
