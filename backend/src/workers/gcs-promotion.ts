import { isReleasableBitstream, promoteGcsBitstream } from '../services/gcs-malware-release.service.js';

// A parent owns exactly one copy. Disconnect/kill cannot roll back a remote GCS
// rewrite; the parent's timestamped scanning claim enables deterministic replay.
process.once('disconnect', () => process.exit(1));
process.once('message', async (message: unknown) => {
    const job = (message as { job?: unknown } | null)?.job;
    if (!isReleasableBitstream(job)) process.exit(1);
    try {
        const result = await promoteGcsBitstream(job);
        process.send?.({ ok: true, result }, () => process.exit(0));
    } catch {
        // Do not put SDK errors, URLs with credentials, or stack traces on IPC/stderr.
        process.send?.({ ok: false }, () => process.exit(1));
    }
});
