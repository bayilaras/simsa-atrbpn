import { db } from '../config/database';
import {
    penyusutanArsip, NewPenyusutanArsip, PenyusutanArsip,
    penyusutanItems, NewPenyusutanItem,
    arsip
} from '../db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { arsipService } from './arsip.service';

// Types
interface PenyusutanFilters {
    unitKerjaId: string;
    jenisPenyusutan?: 'pemindahan' | 'pemusnahan' | 'penyerahan';
    status?: string;
    page?: number;
    limit?: number;
}

interface CreatePenyusutanData {
    unitKerjaId: string;
    jenisPenyusutan: 'pemindahan' | 'pemusnahan' | 'penyerahan' | 'alih_media';
    nomorBA?: string;
    keterangan?: string;
    arsipIds: string[];
    createdBy?: string;
}

type PenyusutanStatus = 'draft' | 'proposed' | 'reviewed' | 'approved' | 'executed';

const STATUS_FLOW: Record<PenyusutanStatus, PenyusutanStatus | null> = {
    draft: 'proposed',
    proposed: 'reviewed',
    reviewed: 'approved',
    approved: 'executed',
    executed: null, // Terminal state
};

const JENIS_TO_DISPOSAL_STATUS: Record<string, string> = {
    pemindahan: 'proposed_pindah',
    pemusnahan: 'proposed_musnah',
    penyerahan: 'proposed_serah',
    alih_media: 'proposed_alih_media',
};

class PenyusutanService {
    /**
     * List all penyusutan batches with pagination
     */
    async findAll(filters: PenyusutanFilters) {
        const { unitKerjaId, jenisPenyusutan, status, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(penyusutanArsip.unitKerjaId, unitKerjaId)];
        if (jenisPenyusutan) conditions.push(eq(penyusutanArsip.jenisPenyusutan, jenisPenyusutan));
        if (status) conditions.push(eq(penyusutanArsip.status, status));

        const [data, countResult] = await Promise.all([
            db.select()
                .from(penyusutanArsip)
                .where(and(...conditions))
                .orderBy(desc(penyusutanArsip.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)` })
                .from(penyusutanArsip)
                .where(and(...conditions)),
        ]);

        const total = Number(countResult[0]?.count || 0);

        return {
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * Get single batch with its items and arsip details
     */
    async findById(id: string) {
        const batch = await db.select().from(penyusutanArsip).where(eq(penyusutanArsip.id, id));
        if (!batch[0]) return null;

        const items = await db.select({
            item: penyusutanItems,
            arsip: arsip,
        })
            .from(penyusutanItems)
            .leftJoin(arsip, eq(penyusutanItems.arsipId, arsip.id))
            .where(eq(penyusutanItems.penyusutanId, id))
            .orderBy(penyusutanItems.nomorUrut);

        return {
            ...batch[0],
            items: items.map(i => ({
                ...i.item,
                arsip: i.arsip,
            })),
        };
    }

    /**
     * Create a new penyusutan batch with arsip items
     */
    async create(data: CreatePenyusutanData) {
        const { arsipIds, ...batchData } = data;

        // Generate nomor BA
        const now = new Date();
        const nomorBA = data.nomorBA ||
            `BA-${data.jenisPenyusutan.toUpperCase().substring(0, 3)}-${data.unitKerjaId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Create batch
        const [batch] = await db.insert(penyusutanArsip).values({
            unitKerjaId: batchData.unitKerjaId,
            jenisPenyusutan: batchData.jenisPenyusutan,
            nomorBA,
            keterangan: batchData.keterangan,
            totalBerkas: arsipIds.length,
            createdBy: batchData.createdBy,
            status: 'draft',
        }).returning();

        // Add items
        if (arsipIds.length > 0) {
            const itemsToInsert = arsipIds.map((arsipId, index) => ({
                penyusutanId: batch.id,
                arsipId,
                nomorUrut: index + 1,
            }));
            await db.insert(penyusutanItems).values(itemsToInsert);

            // Update arsip disposalStatus
            const disposalStatus = JENIS_TO_DISPOSAL_STATUS[data.jenisPenyusutan] || 'active';
            await db.update(arsip)
                .set({
                    disposalStatus,
                    disposalBatchId: batch.id,
                    updatedAt: new Date(),
                })
                .where(inArray(arsip.id, arsipIds));
        }

        return batch;
    }

    /**
     * Advance the workflow status of a batch
     */
    async updateStatus(id: string, metadata?: { catatan?: string; user?: { id: string; role: string; unitKerjaId: string } }) {
        const batch = await db.select().from(penyusutanArsip).where(eq(penyusutanArsip.id, id));
        if (!batch[0]) throw new Error('Penyusutan batch not found');

        const currentStatus = batch[0].status as PenyusutanStatus;
        const nextStatus = STATUS_FLOW[currentStatus];
        if (!nextStatus) throw new Error(`Cannot advance from status: ${currentStatus}`);

        // Role-based validation
        if (metadata?.user) {
            const { role, unitKerjaId } = metadata.user;

            // 1. Draft -> Proposed: Must be creator or admin of same unit
            if (currentStatus === 'draft' && nextStatus === 'proposed') {
                if (batch[0].unitKerjaId !== unitKerjaId && role !== 'super_admin') {
                    throw new Error('Unauthorized: You can only propose for your own unit');
                }
            }

            // 2. Proposed -> Reviewed: Requires verifier role
            if (currentStatus === 'proposed' && nextStatus === 'reviewed') {
                if (!['super_admin', 'admin_kementerian', 'admin_dirjen', 'admin_sesditjen'].includes(role)) {
                    throw new Error('Unauthorized: Insufficient role to review');
                }
            }

            // 3. Reviewed -> Approved: Requires approval role
            if (currentStatus === 'reviewed' && nextStatus === 'approved') {
                if (!['super_admin', 'admin_kementerian', 'pejabat_eselon_1'].includes(role)) {
                    // For simplification allowing admin_kementerian/super_admin
                    throw new Error('Unauthorized: Insufficient role to approve');
                }
            }

            // 4. Approved -> Executed: Requires execution role (usually archives center)
            if (currentStatus === 'approved' && nextStatus === 'executed') {
                if (!['super_admin', 'admin_kementerian'].includes(role)) {
                    throw new Error('Unauthorized: Insufficient role to execute');
                }
            }
        }

        const updateData: Record<string, any> = {
            status: nextStatus,
            updatedAt: new Date(),
        };

        // Set dates based on status transition
        if (nextStatus === 'proposed') updateData.tanggalUsul = new Date().toISOString().split('T')[0];
        if (nextStatus === 'reviewed') updateData.tanggalReview = new Date().toISOString().split('T')[0];
        if (nextStatus === 'approved') {
            updateData.tanggalPersetujuan = new Date().toISOString().split('T')[0];
            updateData.approvedBy = metadata?.user?.id;
        }
        if (nextStatus === 'executed') updateData.tanggalPelaksanaan = new Date().toISOString().split('T')[0];
        if (metadata?.catatan) updateData.catatanPanitia = metadata.catatan;

        const [updated] = await db.update(penyusutanArsip)
            .set(updateData)
            .where(eq(penyusutanArsip.id, id))
            .returning();

        // When executed, update arsip status to 'executed'
        if (nextStatus === 'executed') {
            const items = await db.select({ arsipId: penyusutanItems.arsipId })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, id));

            const arsipIds = items.map(i => i.arsipId);
            if (arsipIds.length > 0) {
                await db.update(arsip)
                    .set({ disposalStatus: 'executed', updatedAt: new Date() })
                    .where(inArray(arsip.id, arsipIds));
            }
        }

        // When approved, update arsip status to 'approved'
        if (nextStatus === 'approved') {
            const items = await db.select({ arsipId: penyusutanItems.arsipId })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, id));

            const arsipIds = items.map(i => i.arsipId);
            if (arsipIds.length > 0) {
                await db.update(arsip)
                    .set({ disposalStatus: 'approved', updatedAt: new Date() })
                    .where(inArray(arsip.id, arsipIds));
            }
        }

        return updated;
    }

    /**
     * Add arsip items to an existing draft batch
     */
    async addItems(batchId: string, arsipIds: string[]) {
        const batch = await db.select().from(penyusutanArsip).where(eq(penyusutanArsip.id, batchId));
        if (!batch[0]) throw new Error('Batch not found');
        if (batch[0].status !== 'draft') throw new Error('Can only add items to draft batches');

        // Get current max nomorUrut
        const existingItems = await db.select({ nomorUrut: penyusutanItems.nomorUrut })
            .from(penyusutanItems)
            .where(eq(penyusutanItems.penyusutanId, batchId))
            .orderBy(desc(penyusutanItems.nomorUrut))
            .limit(1);
        const startNum = (existingItems[0]?.nomorUrut || 0) + 1;

        const itemsToInsert = arsipIds.map((arsipId, index) => ({
            penyusutanId: batchId,
            arsipId,
            nomorUrut: startNum + index,
        }));

        await db.insert(penyusutanItems).values(itemsToInsert);

        // Update arsip disposal status
        const disposalStatus = JENIS_TO_DISPOSAL_STATUS[batch[0].jenisPenyusutan] || 'active';
        await db.update(arsip)
            .set({ disposalStatus, disposalBatchId: batchId, updatedAt: new Date() })
            .where(inArray(arsip.id, arsipIds));

        // Update totals
        const countResult = await db.select({ count: sql<number>`count(*)` })
            .from(penyusutanItems)
            .where(eq(penyusutanItems.penyusutanId, batchId));

        await db.update(penyusutanArsip)
            .set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: new Date() })
            .where(eq(penyusutanArsip.id, batchId));

        return { added: arsipIds.length };
    }

    /**
     * Remove items from a draft batch
     */
    async removeItems(batchId: string, arsipIds: string[]) {
        const batch = await db.select().from(penyusutanArsip).where(eq(penyusutanArsip.id, batchId));
        if (!batch[0]) throw new Error('Batch not found');
        if (batch[0].status !== 'draft') throw new Error('Can only remove items from draft batches');

        await db.delete(penyusutanItems)
            .where(and(
                eq(penyusutanItems.penyusutanId, batchId),
                inArray(penyusutanItems.arsipId, arsipIds),
            ));

        // Reset arsip disposal status
        await db.update(arsip)
            .set({ disposalStatus: 'active', disposalBatchId: null, updatedAt: new Date() })
            .where(inArray(arsip.id, arsipIds));

        // Update totals
        const countResult = await db.select({ count: sql<number>`count(*)` })
            .from(penyusutanItems)
            .where(eq(penyusutanItems.penyusutanId, batchId));

        await db.update(penyusutanArsip)
            .set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: new Date() })
            .where(eq(penyusutanArsip.id, batchId));

        return { removed: arsipIds.length };
    }

    /**
     * Delete a draft batch
     */
    async deleteBatch(id: string) {
        const batch = await db.select().from(penyusutanArsip).where(eq(penyusutanArsip.id, id));
        if (!batch[0]) throw new Error('Batch not found');
        if (batch[0].status !== 'draft') throw new Error('Can only delete draft batches');

        // Get items to reset arsip status
        const items = await db.select({ arsipId: penyusutanItems.arsipId })
            .from(penyusutanItems)
            .where(eq(penyusutanItems.penyusutanId, id));

        const arsipIds = items.map(i => i.arsipId);
        if (arsipIds.length > 0) {
            await db.update(arsip)
                .set({ disposalStatus: 'active', disposalBatchId: null, updatedAt: new Date() })
                .where(inArray(arsip.id, arsipIds));
        }

        // cascade delete handles penyusutanItems
        await db.delete(penyusutanArsip).where(eq(penyusutanArsip.id, id));
        return { deleted: true };
    }

    /**
     * Get disposal candidates based on type using existing arsipService logic
     */
    async getCandidates(unitKerjaId: string, jenisPenyusutan: string) {
        // Only get arsip that are not already in a batch
        const allArchives = await db.select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                eq(arsip.disposalStatus, 'active'),
            ));

        // Filter based on lifecycle status and hasilAkhir
        const candidates = allArchives.filter(arch => {
            if (!arch.tanggalArsip) return false;
            const status = arsipService.getArchiveStatus(
                arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif
            );

            switch (jenisPenyusutan) {
                case 'pemindahan':
                    // Archives where aktif period has expired, should be moved to Unit Kearsipan
                    return status === 'inaktif' || status === 'akan_kadaluarsa';
                case 'pemusnahan':
                    // Archives with hasilAkhir 'Musnah' that are kadaluarsa
                    return (status === 'kadaluarsa' || status === 'akan_kadaluarsa') &&
                        arch.hasilAkhir === 'Musnah';
                case 'penyerahan':
                    // Archives with hasilAkhir 'Permanen' that are kadaluarsa (to be submitted to ANRI)
                    return (status === 'kadaluarsa') && arch.hasilAkhir === 'Permanen';
                default:
                    return false;
            }
        });

        return candidates;
    }

    /**
     * Generate Daftar Arsip Aktif data (Formulir 4)
     */
    async generateDaftarArsipAktif(unitKerjaId: string, tahun?: number) {
        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (tahun) conditions.push(eq(arsip.tahun, tahun));

        const allArchives = await db.select()
            .from(arsip)
            .where(and(...conditions))
            .orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);

        // Filter to aktif status only
        const aktifArchives = allArchives.filter(arch => {
            if (!arch.tanggalArsip) return true; // If no date, assume aktif
            const status = arsipService.getArchiveStatus(
                arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif
            );
            return status === 'aktif' || status === 'akan_inaktif';
        });

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalCetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            totalBerkas: aktifArchives.length,
            daftarArsip: aktifArchives.map((arch, index) => ({
                no: index + 1,
                nomorBerkas: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraianBerkas: arch.uraianBerkas || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                nomorItem: arch.nomorItem || '-',
                uraianItem: arch.uraianItem || '-',
                tanggalArsip: arch.tanggalArsip || '-',
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join('/') || '-',
                klasifikasiKeamanan: arch.klasifikasiKeamanan || 'Biasa',
                keterangan: arch.keterangan || '-',
            })),
        };
    }

    /**
     * Generate Daftar Arsip Inaktif data (Formulir 6)
     */
    async generateDaftarArsipInaktif(unitKerjaId: string, tahun?: number) {
        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (tahun) conditions.push(eq(arsip.tahun, tahun));

        const allArchives = await db.select()
            .from(arsip)
            .where(and(...conditions))
            .orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);

        // Filter to inaktif status
        const inaktifArchives = allArchives.filter(arch => {
            if (!arch.tanggalArsip) return false;
            const status = arsipService.getArchiveStatus(
                arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif
            );
            return status === 'inaktif' || status === 'akan_kadaluarsa' || status === 'kadaluarsa';
        });

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalCetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            totalBerkas: inaktifArchives.length,
            daftarArsip: inaktifArchives.map((arch, index) => ({
                no: index + 1,
                nomorArsip: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraianInformasiArsip: arch.uraianBerkas || arch.uraianItem || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join('/') || '-',
                klasifikasiKeamanan: arch.klasifikasiKeamanan || 'Biasa',
                jangkaSimpan: `${arch.retensiAktif || '-'} / ${arch.retensiInaktif || '-'}`,
                nasibAkhir: arch.hasilAkhir || '-',
                kategoriArsip: arch.jraKode || '-',
                keterangan: arch.keterangan || '-',
            })),
        };
    }
}

export const penyusutanService = new PenyusutanService();
