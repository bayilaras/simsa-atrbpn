// A rate-limited later part is sent again automatically, a few times at most.
const MAX_RATE_LIMIT_WAITS = 5;

export function rateLimitSeconds(error) {
    if ((error?.status || error?.response?.status) !== 429) return 0;
    const reported = Number(error.data?.retryAfterSeconds ?? error.response?.data?.retryAfterSeconds
        ?? error.response?.headers?.get?.('Retry-After'));
    return Number.isFinite(reported) && reported > 0 ? Math.ceil(reported) : 60;
}

/**
 * Send the parts of a resumable import until the server reports the end.
 * The server stops starting rows after a time budget and returns nextRow and
 * prefixHash; a response without nextRow is the whole import. (An older CSV
 * endpoint ignores startRow and answers that way; an older Sheets endpoint
 * rejects startRow with 400, so the backend must be released first.)
 *
 * The first part is the user's own request, so its failure is thrown as
 * before. A later part's failure ends the run with `interruptedAt` (the first
 * row of that part); earlier parts are already saved.
 *
 * @returns {Promise<{ finished: true } | { stoppedAt: number } | { interruptedAt: number, error: unknown } | { cancelled: true }>}
 */
export async function runResumableImport({ sendPart, onPart, onWait = () => {}, shouldStop = () => false, isCurrent = () => true }) {
    let position = { startRow: 0 };
    let started = false;
    let waits = 0;
    for (;;) {
        let part;
        try {
            part = await sendPart(position);
        } catch (error) {
            if (!started) throw error;
            if (!isCurrent()) return { cancelled: true };
            const seconds = rateLimitSeconds(error);
            if (seconds && waits < MAX_RATE_LIMIT_WAITS && !shouldStop()) {
                waits += 1;
                onWait(Date.now() + seconds * 1000);
                await new Promise(resolve => setTimeout(resolve, seconds * 1000));
                onWait(0);
                if (!isCurrent()) return { cancelled: true };
                if (!shouldStop()) continue;
            }
            return shouldStop() ? { stoppedAt: position.startRow } : { interruptedAt: position.startRow, error };
        }
        if (!isCurrent()) return { cancelled: true };
        started = true;
        waits = 0;
        onPart(part);
        if (part?.nextRow === undefined || part.nextRow === null) return { finished: true };
        position = { startRow: part.nextRow, prefixHash: part.prefixHash };
        if (shouldStop()) return { stoppedAt: position.startRow };
    }
}

/** True when a failed request may still have saved rows (the server's outcome is unknown). */
export function outcomeUnknown(error) {
    return Boolean(error?.mutationOutcomeUnknown || error?.code === 'REQUEST_TIMEOUT');
}

const CONTINUE_LATER = 'Jalankan impor lagi untuk melanjutkan; baris yang sudah tersimpan akan dikenali sebagai duplikat.';

/** Why a resumable import of data rows ended early; empty when it finished. Row numbers count data rows from 1. */
export function unfinishedImportNotice(outcome, totals) {
    if (outcome.stoppedAt !== undefined) return `Impor dihentikan sebelum baris data ke-${outcome.stoppedAt + 1}. ${CONTINUE_LATER}`;
    if (outcome.interruptedAt === undefined) return '';
    // Rows of earlier parts are saved; the failed part's own outcome may be unknown.
    const part = `Bagian mulai baris data ke-${outcome.interruptedAt + 1}`;
    const result = outcomeUnknown(outcome.error)
        ? `${part} belum terkonfirmasi; sebagian barisnya mungkin sudah tersimpan.`
        : `${part} gagal: ${outcome.error?.message || 'permintaan tidak berhasil.'}`;
    return `${result} ${totals.importedRows} baris dari bagian sebelumnya sudah tersimpan. ${CONTINUE_LATER}`;
}
