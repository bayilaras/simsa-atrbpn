import { db } from '../config/database';
import { arsip, NewArsip, Arsip, arsipItems } from '../db/schema';
import { eq, and, desc, sql, lte, gte, ilike, or } from 'drizzle-orm';
import { ConflictError } from '../utils/errors';

export interface ArsipFilters {
    unitKerjaId?: string;
    jenisArsip?: string;
    tahun?: number;
    search?: string;
    page?: number;
    limit?: number;
}

export class ArsipService {
    async findAll(filters: ArsipFilters) {
        const { unitKerjaId, jenisArsip, tahun, search, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];

        if (unitKerjaId) {
            conditions.push(eq(arsip.unitKerjaId, unitKerjaId));
        }

        if (jenisArsip) {
            conditions.push(eq(arsip.jenisArsip, jenisArsip));
        }
        if (tahun) {
            conditions.push(eq(arsip.tahun, tahun));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(arsip.nomorBerkas, `%${search}%`),
                    ilike(arsip.uraianBerkas, `%${search}%`),
                    ilike(arsip.nomorSuratOriginal, `%${search}%`),
                    ilike(arsip.perihalOriginal, `%${search}%`)
                )!
            );
        }


        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(and(...conditions));

        const data = await db
            .select()
            .from(arsip)
            .where(and(...conditions))
            .orderBy(desc(arsip.createdAt))
            .limit(limit)
            .offset(offset);


        return {
            data,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    async findById(id: string) {
        const [result] = await db
            .select()
            .from(arsip)
            .where(eq(arsip.id, id))
            .limit(1);

        if (!result) return null;

        // Fetch related items from arsip_items table
        const items = await db
            .select()
            .from(arsipItems)
            .where(eq(arsipItems.arsipId, id))
            .orderBy(arsipItems.nomorItem);

        return { ...result, items };
    }

    async create(data: NewArsip) {
        const [result] = await db
            .insert(arsip)
            .values(data)
            .returning();

        return result;
    }

    async update(id: string, data: Partial<Arsip>) {
        const [result] = await db
            .update(arsip)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(arsip.id, id))
            .returning();

        return result;
    }

    async delete(id: string) {
        const {
            archiveLending, layananArsip, arsipVital, arsipTerjaga,
            penyusutanItems, fileAttachments, suratMasuk, suratKeluar,
        } = await import('../db/schema');

        const [existing] = await db
            .select()
            .from(arsip)
            .where(eq(arsip.id, id))
            .limit(1);

        if (!existing) return undefined;

        if (existing.lendingStatus === 'borrowed') {
            throw new ConflictError('Arsip sedang dipinjam sehingga tidak dapat dihapus.');
        }

        // These tables reference arsip with ON DELETE RESTRICT / NO ACTION, so without
        // this check the delete surfaces as a raw foreign key violation.
        const blockers: string[] = [];

        const [lending] = await db.select({ id: archiveLending.id }).from(archiveLending)
            .where(eq(archiveLending.arsipId, id)).limit(1);
        if (lending) blockers.push('riwayat peminjaman');

        const [layanan] = await db.select({ id: layananArsip.id }).from(layananArsip)
            .where(eq(layananArsip.arsipId, id)).limit(1);
        if (layanan) blockers.push('permintaan layanan arsip');

        const [vital] = await db.select({ id: arsipVital.id }).from(arsipVital)
            .where(eq(arsipVital.arsipId, id)).limit(1);
        if (vital) blockers.push('penetapan arsip vital');

        const [terjaga] = await db.select({ id: arsipTerjaga.id }).from(arsipTerjaga)
            .where(eq(arsipTerjaga.arsipId, id)).limit(1);
        if (terjaga) blockers.push('penetapan arsip terjaga');

        const [penyusutan] = await db.select({ id: penyusutanItems.id }).from(penyusutanItems)
            .where(eq(penyusutanItems.arsipId, id)).limit(1);
        if (penyusutan) blockers.push('daftar penyusutan');

        if (blockers.length > 0) {
            throw new ConflictError(`Arsip tidak dapat dihapus karena masih terkait dengan ${blockers.join(', ')}.`);
        }

        const attachments = await db
            .select()
            .from(fileAttachments)
            .where(and(
                eq(fileAttachments.entityType, 'arsip'),
                eq(fileAttachments.entityId, id)
            ));

        const result = await db.transaction(async (tx: any) => {
            await tx
                .delete(fileAttachments)
                .where(and(
                    eq(fileAttachments.entityType, 'arsip'),
                    eq(fileAttachments.entityId, id)
                ));

            const [deleted] = await tx
                .delete(arsip)
                .where(eq(arsip.id, id))
                .returning();

            // Release the source surat so it can be archived again
            if (existing.sourceSuratId && existing.jenisArsip === 'masuk') {
                await tx
                    .update(suratMasuk)
                    .set({ isArchived: false, updatedAt: new Date() })
                    .where(eq(suratMasuk.id, existing.sourceSuratId));
            } else if (existing.sourceSuratId && existing.jenisArsip === 'keluar') {
                await tx
                    .update(suratKeluar)
                    .set({ isArchived: false, updatedAt: new Date() })
                    .where(eq(suratKeluar.id, existing.sourceSuratId));
            }

            return deleted;
        });

        // Blobs live outside the database, so they are cleaned up after the commit
        if (attachments.length > 0) {
            const { blobStorageService } = await import('./blob-storage.service');
            for (const attachment of attachments) {
                if (attachment.driveFileId) {
                    await blobStorageService.deleteFile(attachment.driveFileId);
                }
            }
        }

        return result;
    }

    // Create arsip from surat masuk
    async archiveFromSuratMasuk(suratMasukId: string, metadata: {
        nomorBerkas?: string;
        kodeKlasifikasi?: string;
        uraianBerkas?: string;
        lokasiFc?: string;
        lokasiLaci?: string;
        lokasiFolder?: string;
        jraKode?: string;
        jraUraian?: string;
        retensiAktif?: string;
        retensiInaktif?: string;
        hasilAkhir?: string;
        keterangan?: string;
        klasifikasiKeamanan?: string;
        personInCharge?: string;
        unitPengolah?: string;
        kurunWaktu?: string;
        nomorItem?: string;
        uraianItem?: string;
        tingkatPerkembangan?: string;
        tanggalArsip?: string;
        jumlah?: number;
        createdBy?: string;
    }) {
        const { suratMasuk } = await import('../db/schema');

        return await db.transaction(async (tx: any) => {
            // Get the surat masuk — locked so concurrent requests cannot both pass the
            // "already archived" check below and create duplicate arsip rows
            const [surat] = await tx
                .select()
                .from(suratMasuk)
                .where(eq(suratMasuk.id, suratMasukId))
                .limit(1)
                .for('update');

            if (!surat) {
                throw new Error('Surat masuk not found');
            }

            // Check if already archived
            const [existing] = await tx
                .select()
                .from(arsip)
                .where(and(
                    eq(arsip.sourceSuratId, suratMasukId),
                    eq(arsip.jenisArsip, 'masuk')
                ))
                .limit(1);

            if (existing) {
                throw new Error('Surat masuk sudah diarsipkan');
            }

            // Calculate retention dates
            const retentionDates = metadata.retensiAktif || metadata.retensiInaktif
                ? this.calculateRetentionDates(
                    surat.tanggalSurat || new Date().toISOString().split('T')[0],
                    metadata.retensiAktif || null,
                    metadata.retensiInaktif || null
                )
                : { tanggalKadaluarsa: null };

            // Create arsip entry
            const [arsipEntry] = await tx
                .insert(arsip)
                .values({
                    unitKerjaId: surat.unitKerjaId,
                    jenisArsip: 'masuk',
                    sourceSuratId: suratMasukId,
                    tahun: surat.tahun,
                    nomorBerkas: metadata.nomorBerkas,
                    kodeKlasifikasi: metadata.kodeKlasifikasi || surat.klasifikasiKode,
                    uraianBerkas: metadata.uraianBerkas || surat.perihal,
                    tanggalArsip: metadata.tanggalArsip || surat.tanggalSurat,
                    lokasiFc: metadata.lokasiFc,
                    lokasiLaci: metadata.lokasiLaci,
                    lokasiFolder: metadata.lokasiFolder,
                    jraKode: metadata.jraKode,
                    jraUraian: metadata.jraUraian,
                    retensiAktif: metadata.retensiAktif,
                    retensiInaktif: metadata.retensiInaktif,
                    hasilAkhir: metadata.hasilAkhir,
                    klasifikasiKeamanan: metadata.klasifikasiKeamanan,
                    personInCharge: metadata.personInCharge,
                    unitPengolah: metadata.unitPengolah,
                    kurunWaktu: metadata.kurunWaktu,
                    nomorItem: metadata.nomorItem,
                    uraianItem: metadata.uraianItem,
                    tingkatPerkembangan: metadata.tingkatPerkembangan,
                    jumlah: metadata.jumlah,
                    keterangan: metadata.keterangan,
                    nomorSuratOriginal: surat.nomorSurat,
                    tanggalSuratOriginal: surat.tanggalSurat,
                    perihalOriginal: surat.perihal,
                    tanggalKadaluarsa: retentionDates.tanggalKadaluarsa,
                    createdBy: metadata.createdBy,
                })
                .returning();

            // Insert items into arsip_items table
            if ((metadata as any).items && Array.isArray((metadata as any).items) && (metadata as any).items.length > 0) {
                const itemsToInsert = (metadata as any).items.map((item: any) => ({
                    arsipId: arsipEntry.id,
                    nomorItem: item.nomor || item.nomorItem || '',
                    uraianItem: item.uraian || item.uraianItem || '',
                    tingkatPerkembangan: item.perkembangan || item.tingkatPerkembangan || '',
                    tanggalItem: item.tanggal || item.tanggalItem || null,
                    jumlah: item.jumlah || 1,
                    mediaType: item.mediaType || 'kertas',
                    lokasiFc: item.lokasiFc || '',
                    lokasiLaci: item.lokasiLaci || '',
                    lokasiFolder: item.lokasiFolder || '',
                }));
                await tx.insert(arsipItems).values(itemsToInsert);
            }

            // Update surat masuk isArchived flag
            await tx
                .update(suratMasuk)
                .set({ isArchived: true, updatedAt: new Date() })
                .where(eq(suratMasuk.id, suratMasukId));

            return arsipEntry;
        });
    }

    // Create arsip from surat keluar
    async archiveFromSuratKeluar(suratKeluarId: string, metadata: {
        nomorBerkas?: string;
        kodeKlasifikasi?: string;
        uraianBerkas?: string;
        lokasiFc?: string;
        lokasiLaci?: string;
        lokasiFolder?: string;
        jraKode?: string;
        jraUraian?: string;
        retensiAktif?: string;
        retensiInaktif?: string;
        hasilAkhir?: string;
        keterangan?: string;
        klasifikasiKeamanan?: string;
        personInCharge?: string;
        unitPengolah?: string;
        kurunWaktu?: string;
        nomorItem?: string;
        uraianItem?: string;
        tingkatPerkembangan?: string;
        tanggalArsip?: string;
        jumlah?: number;
        createdBy?: string;
    }) {
        const { suratKeluar } = await import('../db/schema');

        return await db.transaction(async (tx: any) => {
            // Get the surat keluar — locked so concurrent requests cannot both pass the
            // "already archived" check below and create duplicate arsip rows
            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(eq(suratKeluar.id, suratKeluarId))
                .limit(1)
                .for('update');

            if (!surat) {
                throw new Error('Surat keluar not found');
            }

            // Check if already archived
            const [existing] = await tx
                .select()
                .from(arsip)
                .where(and(
                    eq(arsip.sourceSuratId, suratKeluarId),
                    eq(arsip.jenisArsip, 'keluar')
                ))
                .limit(1);

            if (existing) {
                throw new Error('Surat keluar sudah diarsipkan');
            }

            // Calculate retention dates
            const retentionDates = metadata.retensiAktif || metadata.retensiInaktif
                ? this.calculateRetentionDates(
                    surat.tanggalSurat || new Date().toISOString().split('T')[0],
                    metadata.retensiAktif || null,
                    metadata.retensiInaktif || null
                )
                : { tanggalKadaluarsa: null };

            // Create arsip entry
            const [arsipEntry] = await tx
                .insert(arsip)
                .values({
                    unitKerjaId: surat.unitKerjaId,
                    jenisArsip: 'keluar',
                    sourceSuratId: suratKeluarId,
                    tahun: surat.tahun,
                    nomorBerkas: metadata.nomorBerkas,
                    kodeKlasifikasi: metadata.kodeKlasifikasi || surat.klasifikasiFasilitatifKode || surat.klasifikasiSubstantifKode,
                    uraianBerkas: metadata.uraianBerkas || surat.perihal,
                    tanggalArsip: metadata.tanggalArsip || surat.tanggalSurat,
                    lokasiFc: metadata.lokasiFc,
                    lokasiLaci: metadata.lokasiLaci,
                    lokasiFolder: metadata.lokasiFolder,
                    jraKode: metadata.jraKode,
                    jraUraian: metadata.jraUraian,
                    retensiAktif: metadata.retensiAktif,
                    retensiInaktif: metadata.retensiInaktif,
                    hasilAkhir: metadata.hasilAkhir,
                    klasifikasiKeamanan: metadata.klasifikasiKeamanan,
                    personInCharge: metadata.personInCharge,
                    unitPengolah: metadata.unitPengolah,
                    kurunWaktu: metadata.kurunWaktu,
                    nomorItem: metadata.nomorItem,
                    uraianItem: metadata.uraianItem,
                    tingkatPerkembangan: metadata.tingkatPerkembangan,
                    jumlah: metadata.jumlah,
                    keterangan: metadata.keterangan,
                    nomorSuratOriginal: surat.nomorSurat,
                    tanggalSuratOriginal: surat.tanggalSurat,
                    perihalOriginal: surat.perihal,
                    tanggalKadaluarsa: retentionDates.tanggalKadaluarsa,
                    createdBy: metadata.createdBy,
                })
                .returning();

            // Insert items into arsip_items table
            if ((metadata as any).items && Array.isArray((metadata as any).items) && (metadata as any).items.length > 0) {
                const itemsToInsert = (metadata as any).items.map((item: any) => ({
                    arsipId: arsipEntry.id,
                    nomorItem: item.nomor || item.nomorItem || '',
                    uraianItem: item.uraian || item.uraianItem || '',
                    tingkatPerkembangan: item.perkembangan || item.tingkatPerkembangan || '',
                    tanggalItem: item.tanggal || item.tanggalItem || null,
                    jumlah: item.jumlah || 1,
                    mediaType: item.mediaType || 'kertas',
                    lokasiFc: item.lokasiFc || '',
                    lokasiLaci: item.lokasiLaci || '',
                    lokasiFolder: item.lokasiFolder || '',
                }));
                await tx.insert(arsipItems).values(itemsToInsert);
            }

            // Update surat keluar isArchived flag
            await tx
                .update(suratKeluar)
                .set({ isArchived: true, updatedAt: new Date() })
                .where(eq(suratKeluar.id, suratKeluarId));

            return arsipEntry;
        });
    }

    // Find arsip by source surat id
    async findBySourceSurat(sourceSuratId: string) {
        const [result] = await db
            .select()
            .from(arsip)
            .where(eq(arsip.sourceSuratId, sourceSuratId))
            .limit(1);

        return result || null;
    }

    // Get arsip with source surat details
    async findByIdWithSourceSurat(id: string) {
        const arsipEntry = await this.findById(id);
        if (!arsipEntry || !arsipEntry.sourceSuratId) return arsipEntry;

        let sourceSurat = null;

        if (arsipEntry.jenisArsip === 'masuk') {
            const { suratMasuk } = await import('../db/schema');
            const [surat] = await db
                .select()
                .from(suratMasuk)
                .where(eq(suratMasuk.id, arsipEntry.sourceSuratId))
                .limit(1);
            sourceSurat = surat || null;
        } else if (arsipEntry.jenisArsip === 'keluar') {
            const { suratKeluar } = await import('../db/schema');
            const [surat] = await db
                .select()
                .from(suratKeluar)
                .where(eq(suratKeluar.id, arsipEntry.sourceSuratId))
                .limit(1);
            sourceSurat = surat || null;
        }

        return {
            ...arsipEntry,
            sourceSurat,
        };
    }

    // Get arsip that will expire within N days
    async getExpiring(unitKerjaId: string, daysAhead: number = 30) {
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + daysAhead);

        const data = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                gte(arsip.tanggalKadaluarsa, today.toISOString().split('T')[0]),
                lte(arsip.tanggalKadaluarsa, futureDate.toISOString().split('T')[0])
            ))
            .orderBy(arsip.tanggalKadaluarsa);

        return data;
    }

    async getStats(unitKerjaId: string, tahun?: number) {
        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (tahun) {
            conditions.push(eq(arsip.tahun, tahun));
        }

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                arsipMasuk: sql<number>`count(*) filter (where ${arsip.jenisArsip} = 'masuk')::int`,
                arsipKeluar: sql<number>`count(*) filter (where ${arsip.jenisArsip} = 'keluar')::int`,
            })
            .from(arsip)
            .where(and(...conditions));

        return stats[0];
    }

    // Calculate retention end dates
    parseRetentionPeriod(retention: string | null): number {
        if (!retention) return 0;
        // Parse "2 tahun", "5 tahun", "1 tahun", etc.
        const match = retention.match(/(\d+)\s*tahun/i);
        return match ? parseInt(match[1], 10) : 0;
    }

    // Retention expressed in months, so "6 bulan" is not silently treated as no retention
    parseRetentionMonths(retention: string | null): number {
        const years = this.parseRetentionPeriod(retention);
        if (years > 0) return years * 12;

        const match = retention ? retention.match(/(\d+)\s*bulan/i) : null;
        return match ? parseInt(match[1], 10) : 0;
    }

    calculateRetentionDates(tanggalArsip: string, retensiAktif: string | null, retensiInaktif: string | null) {
        const arsipDate = new Date(tanggalArsip);
        const aktifMonths = this.parseRetentionMonths(retensiAktif);
        const inaktifMonths = this.parseRetentionMonths(retensiInaktif);

        const endAktif = new Date(arsipDate);
        endAktif.setMonth(endAktif.getMonth() + aktifMonths);

        const endInaktif = new Date(endAktif);
        endInaktif.setMonth(endInaktif.getMonth() + inaktifMonths);

        const totalMonths = aktifMonths + inaktifMonths;

        return {
            tanggalAktifBerakhir: aktifMonths > 0 ? endAktif.toISOString().split('T')[0] : null,
            tanggalInaktifBerakhir: totalMonths > 0 ? endInaktif.toISOString().split('T')[0] : null,
            // No parsable retention (JRA rows use '-') means no expiry, not "expired today"
            tanggalKadaluarsa: totalMonths > 0 ? endInaktif.toISOString().split('T')[0] : null,
        };
    }

    // Get archive lifecycle status
    getArchiveStatus(tanggalArsip: string, retensiAktif: string | null, retensiInaktif: string | null):
        'aktif' | 'akan_inaktif' | 'inaktif' | 'akan_kadaluarsa' | 'kadaluarsa' {
        const today = new Date();
        const dates = this.calculateRetentionDates(tanggalArsip, retensiAktif, retensiInaktif);

        if (!dates.tanggalAktifBerakhir) return 'aktif';

        const aktifEnd = new Date(dates.tanggalAktifBerakhir);
        const inaktifEnd = dates.tanggalInaktifBerakhir ? new Date(dates.tanggalInaktifBerakhir) : aktifEnd;

        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        if (today > inaktifEnd) return 'kadaluarsa';
        if (today > aktifEnd && inaktifEnd <= thirtyDaysFromNow) return 'akan_kadaluarsa';
        if (today > aktifEnd) return 'inaktif';
        if (aktifEnd <= thirtyDaysFromNow) return 'akan_inaktif';
        return 'aktif';
    }

    // Get lifecycle notifications for all archives in unit
    async getLifecycleNotifications(unitKerjaId: string) {
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        const todayStr = today.toISOString().split('T')[0];
        const thirtyDaysStr = thirtyDaysFromNow.toISOString().split('T')[0];

        // Get all archives with expiry dates
        const allArchives = await db
            .select()
            .from(arsip)
            .where(eq(arsip.unitKerjaId, unitKerjaId));

        const notifications = {
            willBeInactive: [] as typeof allArchives,      // Akan memasuki masa inaktif
            alreadyInactive: [] as typeof allArchives,     // Sudah inaktif
            willExpire: [] as typeof allArchives,          // Akan kadaluarsa (30 hari)
            expired: [] as typeof allArchives,             // Sudah kadaluarsa, perlu action
        };

        for (const arch of allArchives) {
            if (!arch.tanggalArsip) continue;

            const status = this.getArchiveStatus(
                arch.tanggalArsip,
                arch.retensiAktif,
                arch.retensiInaktif
            );

            switch (status) {
                case 'akan_inaktif':
                    notifications.willBeInactive.push(arch);
                    break;
                case 'inaktif':
                    notifications.alreadyInactive.push(arch);
                    break;
                case 'akan_kadaluarsa':
                    notifications.willExpire.push(arch);
                    break;
                case 'kadaluarsa':
                    notifications.expired.push(arch);
                    break;
            }
        }

        return {
            ...notifications,
            summary: {
                willBeInactive: notifications.willBeInactive.length,
                alreadyInactive: notifications.alreadyInactive.length,
                willExpire: notifications.willExpire.length,
                expired: notifications.expired.length,
                total: allArchives.length,
            }
        };
    }

    // Get disposal candidates grouped by hasilAkhir
    async getDisposalCandidates(unitKerjaId: string, filters?: {
        hasilAkhir?: 'Musnah' | 'Permanen' | 'Dinilai Kembali';
        status?: 'kadaluarsa' | 'akan_kadaluarsa' | 'inaktif';
        page?: number;
        limit?: number;
    }) {
        const { hasilAkhir, status, page = 1, limit = 20 } = filters || {};
        const offset = (page - 1) * limit;

        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (hasilAkhir) {
            conditions.push(eq(arsip.hasilAkhir, hasilAkhir));
        }

        const allArchives = await db
            .select()
            .from(arsip)
            .where(and(...conditions))
            .orderBy(arsip.tanggalKadaluarsa);

        // Filter by lifecycle status
        let filteredArchives = allArchives;
        if (status) {
            filteredArchives = allArchives.filter(arch => {
                if (!arch.tanggalArsip) return false;
                const archStatus = this.getArchiveStatus(arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif);
                return archStatus === status;
            });
        } else {
            filteredArchives = allArchives.filter(arch => {
                if (!arch.tanggalArsip) return false;
                const archStatus = this.getArchiveStatus(arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif);
                return archStatus === 'kadaluarsa' || archStatus === 'akan_kadaluarsa';
            });
        }

        const grouped = {
            musnah: filteredArchives.filter(a => a.hasilAkhir === 'Musnah'),
            permanen: filteredArchives.filter(a => a.hasilAkhir === 'Permanen'),
            dinilaiKembali: filteredArchives.filter(a => a.hasilAkhir === 'Dinilai Kembali'),
            belumDitentukan: filteredArchives.filter(a => !a.hasilAkhir),
        };

        const paginatedData = filteredArchives.slice(offset, offset + limit);

        return {
            data: paginatedData,
            grouped,
            pagination: { page, limit, total: filteredArchives.length, totalPages: Math.ceil(filteredArchives.length / limit) },
            summary: {
                totalMusnah: grouped.musnah.length,
                totalPermanen: grouped.permanen.length,
                totalDinilaiKembali: grouped.dinilaiKembali.length,
                totalBelumDitentukan: grouped.belumDitentukan.length,
            }
        };
    }

    // Get monthly retention summary for dashboard
    async getRetentionSummary(unitKerjaId: string) {
        const lifecycle = await this.getLifecycleNotifications(unitKerjaId);

        const expiredByHasilAkhir = {
            musnah: lifecycle.expired.filter(a => a.hasilAkhir === 'Musnah').length,
            permanen: lifecycle.expired.filter(a => a.hasilAkhir === 'Permanen').length,
            dinilaiKembali: lifecycle.expired.filter(a => a.hasilAkhir === 'Dinilai Kembali').length,
            belumDitentukan: lifecycle.expired.filter(a => !a.hasilAkhir).length,
        };

        const currentMonth = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

        return {
            bulan: currentMonth,
            summary: lifecycle.summary,
            expiredByHasilAkhir,
            message: lifecycle.summary.expired > 0
                ? `Bulan ini ada ${lifecycle.summary.expired} berkas yang sudah habis masa retensinya dan perlu ditindaklanjuti.`
                : 'Tidak ada arsip yang kadaluarsa bulan ini.',
            alertLevel: lifecycle.summary.expired > 50 ? 'high' : lifecycle.summary.expired > 20 ? 'medium' : lifecycle.summary.expired > 0 ? 'low' : 'none',
        };
    }

    // Generate disposal report data
    async generateDisposalReportData(unitKerjaId: string, archiveIds?: string[]) {
        let archives;

        if (archiveIds && archiveIds.length > 0) {
            archives = await db.select().from(arsip).where(eq(arsip.unitKerjaId, unitKerjaId));
            archives = archives.filter(a => archiveIds.includes(a.id));
        } else {
            const allArchives = await db.select().from(arsip).where(and(eq(arsip.unitKerjaId, unitKerjaId), eq(arsip.hasilAkhir, 'Musnah')));
            archives = allArchives.filter(arch => {
                if (!arch.tanggalArsip) return false;
                return this.getArchiveStatus(arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif) === 'kadaluarsa';
            });
        }

        const now = new Date();
        const reportNumber = `BA-${unitKerjaId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

        return {
            reportNumber,
            tanggal: now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            unitKerja: unitKerjaId,
            totalBerkas: archives.length,
            daftarArsip: archives.map((arch, index) => ({
                no: index + 1,
                nomorBerkas: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraian: arch.uraianBerkas || arch.uraianItem || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                jraKode: arch.jraKode || '-',
                retensiAktif: arch.retensiAktif || '-',
                retensiInaktif: arch.retensiInaktif || '-',
                hasilAkhir: arch.hasilAkhir || '-',
                keterangan: arch.keterangan || '-',
            })),
        };
    }
}

export const arsipService = new ArsipService();


