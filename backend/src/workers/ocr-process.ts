import { OCR_PROCESS_LIMITS, parseOcrProcessResult } from '../services/ocr-process.service.js';
import { startChildLifetimeGuard } from '../utils/child-lifetime-guard.js';

// The child receives only one already-verified PDF over stdin. No archive is
// written to disk and no database/storage credentials are passed to this process.
process.once('disconnect', () => process.exit(1));
const deadlineAtMs = Number(process.env.SIMSA_OCR_DEADLINE_AT_MS);
if (!Number.isSafeInteger(deadlineAtMs)) process.exit(1);
await startChildLifetimeGuard({ deadlineAtMs });
// The independent guard must be running before imports can execute native or
// CPU-heavy work. An IPC disconnect handler alone cannot stop a blocked loop.
const { ocrService } = await import('../services/ocr.service.js');
const chunks: Buffer[] = [];
let size = 0;
process.stdin.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > OCR_PROCESS_LIMITS.maxPdfBytes) process.exit(1);
    chunks.push(chunk);
});
process.stdin.once('error', () => process.exit(1));
process.stdin.once('end', async () => {
    try {
        const buffer = Buffer.concat(chunks, size);
        chunks.length = 0;
        const result = await ocrService.processPDF(buffer);
        if (!parseOcrProcessResult(result)) process.exit(1);
        process.send?.({ ok: true, result }, () => process.exit(0));
    } catch {
        process.send?.({ ok: false }, () => process.exit(1));
    }
});
