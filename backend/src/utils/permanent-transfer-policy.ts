import { ConflictError } from './errors';

export const LEGACY_PERMANENT_TRANSFER_READ_ONLY_MESSAGE =
    'Workflow penyerahan lama dinonaktifkan. Batch penyerahan lama hanya dapat dibaca dan dicetak. Gunakan Tata Kelola Retensi pada /retention-governance atau API /api/retention-governance/permanent-transfers untuk penyerahan arsip permanen.';

export function assertLegacyPermanentTransferMutationAllowed(jenisPenyusutan: string): void {
    if (jenisPenyusutan === 'penyerahan') {
        throw new ConflictError(LEGACY_PERMANENT_TRANSFER_READ_ONLY_MESSAGE);
    }
}
