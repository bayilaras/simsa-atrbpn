import { useEffect, useCallback, useRef, useState } from 'react';

// Draft metadata can contain personal or classified information. Keep it only in
// the running tab's JavaScript memory; never persist it to browser storage.
const memoryDrafts = new Map();

/**
 * Hook to auto-save form data in volatile browser memory as a draft.
 *
 * Features:
 * - Auto-saves form state every `intervalMs` milliseconds (default 30s)
 * - Provides status indicator ("Draft tersimpan", "Menyimpan...")
 * - Restores a saved draft while the same application tab remains open
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
 * @param {string} key - Unique key to identify this in-memory form draft
 * @param {number} intervalMs - Auto-save interval in milliseconds (default: 30000)
 */
export function useAutoSave(key, intervalMs = 30000) {
    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'restored'
    const pendingDataRef = useRef(null);
    const timerRef = useRef(null);
    const draftKey = `simsa-draft-${key}`;

    // Save data only in memory. A refresh intentionally clears the draft.
    const writeDraft = useCallback((data) => {
        try {
            const payload = {
                data,
                timestamp: Date.now(),
            };
            memoryDrafts.set(draftKey, payload);
            setSaveStatus('saved');

            // Auto-clear status after 3 seconds
            setTimeout(() => setSaveStatus(null), 3000);
        } catch (err) {
            console.warn('[AutoSave] Failed to save draft:', err);
        }
    }, [draftKey]);

    // Remove plaintext drafts created by older releases.
    useEffect(() => {
        try {
            window.localStorage?.removeItem(draftKey);
        } catch {
            // Storage can be unavailable under hardened browser policies.
        }
    }, [draftKey]);

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

    // Restore a draft retained by this tab's current application session.
    const restoreDraft = useCallback(() => {
        try {
            const draft = memoryDrafts.get(draftKey);
            if (!draft) return null;

            const { data, timestamp } = draft;

            // Ignore drafts older than 24 hours
            const MAX_AGE_MS = 24 * 60 * 60 * 1000;
            if (Date.now() - timestamp > MAX_AGE_MS) {
                memoryDrafts.delete(draftKey);
                return null;
            }

            setSaveStatus('restored');
            setTimeout(() => setSaveStatus(null), 3000);
            return data;
        } catch (err) {
            console.warn('[AutoSave] Failed to restore draft:', err);
            return null;
        }
    }, [draftKey]);

    // Clear the in-memory draft and any legacy plaintext copy.
    const clearDraft = useCallback(() => {
        memoryDrafts.delete(draftKey);
        try {
            window.localStorage?.removeItem(draftKey);
        } catch {
            // Storage can be unavailable under hardened browser policies.
        }
        pendingDataRef.current = null;
        setSaveStatus(null);
    }, [draftKey]);

    // Check if a draft exists
    const hasDraft = useCallback(() => {
        return memoryDrafts.has(draftKey);
    }, [draftKey]);

    return {
        saveDraft,
        clearDraft,
        restoreDraft,
        hasDraft,
        saveStatus, // null | 'saving' | 'saved' | 'restored'
    };
}

export default useAutoSave;
