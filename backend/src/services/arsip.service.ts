import { db } from '../config/database';
import { arsip, NewArsip, Arsip, arsipItems } from '../db/schema';
import { eq, and, desc, sql, lte, gte, ilike, or, isNotNull, isNull, ne, inArray } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';

export interface ArsipFilters {
    unitKerjaId?: string;
    jenisArsip?: string;
    tahun?: number;
    search?: string;
    page?: number;
    limit?: number;
    /** null means all classes (super_admin); [] fails closed. */
    securityClassifications?: string[] | null;
}

interface ArchiveRetentionMetadata {
    retentionTriggerType?: 'kegiatan_selesai' | 'berkas_ditutup' | 'serah_terima' | 'penetapan' | 'lainnya';
    retentionTriggerLabel?: string;
    retentionTriggerDate?: string;
    retentionTriggerEvidence?: string;
    jraVersion?: string;
    jraReference?: string;
}

function archiveSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(
        sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
        classes,
    );
}

const RETENTION_DECISION_FIELDS = new Set([
    'kodeKlasifikasi',
    'masaSimpanAktif',
    'masaSimpanInaktif',
    'hasilAkhir',
    'jraKode',
    'jraUraian',
    'jraVersion',
    'jraReference',
    'retensiAktif',
    'retensiInaktif',
    'retensiKeterangan',
    'retentionTriggerType',
    'retentionTriggerLabel',
    'retentionTriggerDate',
    'retentionTriggerEvidence',
    'tanggalKadaluarsa',
]);

const SYSTEM_MANAGED_RETENTION_FIELDS = new Set([
    'disposalStatus',
    'disposalBatchId',
    'legalHold',
    'legalHoldReason',
    'legalHoldPlacedAt',
    'legalHoldPlacedBy',
    'legalHoldReleasedAt',
    'legalHoldReleasedBy',
    'legalHoldReleaseReason',
]);

export class ArsipService {
    private assertRetentionTriggerDocumented(data: Record<string, any>) {
        if (!data.retentionTriggerDate) return;
        if (!data.retentionTriggerType || !data.retentionTriggerLabel?.trim() || !data.retentionTriggerEvidence?.trim()) {
            throw new ValidationError(
                'Pemicu retensi harus dilengkapi jenis, label, tanggal, dan bukti pendukung.',
            );
        }
    }

    async findAll(filters: ArsipFilters) {
        const {
            unitKerjaId,
            jenisArsip,
            tahun,
            search,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];

        if (unitKerjaId) {
            conditions.push(eq(arsip.unitKerjaId, unitKerjaId));
        }

        if (securityClassifications !== undefined && securityClassifications !== null) {
            conditions.push(securityClassifications.length > 0
                ? inArray(
                    sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
                    securityClassifications,
                )
                : sql`false`);
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

    private deriveRetentionFields<T extends Record<string, any>>(
        data: T,
        existing?: Pick<Arsip, 'retentionTriggerDate' | 'retensiAktif' | 'retensiInaktif'>,
    ): T & { tanggalKadaluarsa: string | null } {
        const triggerDate = data.retentionTriggerDate !== undefined
            ? data.retentionTriggerDate
            : existing?.retentionTriggerDate;
        const retensiAktif = data.retensiAktif !== undefined
            ? data.retensiAktif
            : existing?.retensiAktif;
        const retensiInaktif = data.retensiInaktif !== undefined
            ? data.retensiInaktif
            : existing?.retensiInaktif;

        const dates = this.calculateRetentionDates(
            triggerDate || null,
            retensiAktif || null,
            retensiInaktif || null,
        );

        return { ...data, tanggalKadaluarsa: dates.tanggalKadaluarsa };
    }

    async create(data: NewArsip) {
        // tanggalKadaluarsa is always derived from an explicit retention trigger.
        // A caller-provided expiry without a trigger is intentionally discarded.
        this.assertRetentionTriggerDocumented(data);
        const preparedData = this.deriveRetentionFields(data);
        const [result] = await db
            .insert(arsip)
            .values(preparedData)
            .returning();

        return result;
    }

    async update(id: string, data: Partial<Arsip>) {
        const requestedFields = Object.keys(data);
        const changesRetentionDecision = requestedFields.some(field =>
            RETENTION_DECISION_FIELDS.has(field),
        );
        const changesSystemManagedState = requestedFields.some(field =>
            SYSTEM_MANAGED_RETENTION_FIELDS.has(field),
        );
        if (changesSystemManagedState) {
            throw new ValidationError(
                'Status penyusutan dan legal hold hanya dapat diubah melalui workflow khusus.'
            );
        }

        return db.transaction(async (tx: any) => {
            const [existing] = await tx
                .select()
                .from(arsip)
                .where(eq(arsip.id, id))
                .limit(1)
                .for('update');

            if (!existing) return undefined;
            if (existing.disposalStatus === 'executed') {
                throw new ConflictError(
                    'Arsip yang penyusutannya telah dieksekusi bersifat immutable.'
                );
            }

            const isInDisposalWorkflow = existing.disposalStatus !== 'active'
                || Boolean(existing.disposalBatchId);
            if (changesRetentionDecision && (existing.legalHold || isInDisposalWorkflow)) {
                throw new ConflictError(
                    'Keputusan retensi/JRA tidak dapat diubah saat legal hold atau setelah arsip masuk workflow penyusutan.'
                );
            }

            let preparedData: Partial<Arsip> = data;
            if (changesRetentionDecision) {
                this.assertRetentionTriggerDocumented({ ...existing, ...data });
                preparedData = this.deriveRetentionFields(data, existing) as Partial<Arsip>;
            }

            const [result] = await tx
                .update(arsip)
                .set({ ...preparedData, updatedAt: new Date() })
                .where(eq(arsip.id, id))
                .returning();

            return result;
        });
    }

    async delete(id: string) {
        void id;
        throw new ConflictError(
            'Penghapusan langsung arsip dinonaktifkan. Gunakan workflow penyusutan sesuai JRA dan legal hold.'
        );
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
        retentionTriggerType?: ArchiveRetentionMetadata['retentionTriggerType'];
        retentionTriggerLabel?: string;
        retentionTriggerDate?: string;
        retentionTriggerEvidence?: string;
        jraVersion?: string;
        jraReference?: string;
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
        this.assertRetentionTriggerDocumented(metadata);

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

            // Retention starts only from the explicit business-event trigger supplied
            // by the archivist. tanggalSurat/tanggalArsip are descriptive dates, not JRA triggers.
            const retentionDates = this.calculateRetentionDates(
                metadata.retentionTriggerDate || null,
                metadata.retensiAktif || null,
                metadata.retensiInaktif || null,
            );

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
                    retentionTriggerType: metadata.retentionTriggerType,
                    retentionTriggerLabel: metadata.retentionTriggerLabel,
                    retentionTriggerDate: metadata.retentionTriggerDate,
                    retentionTriggerEvidence: metadata.retentionTriggerEvidence,
                    jraVersion: metadata.jraVersion,
                    jraReference: metadata.jraReference,
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
        retentionTriggerType?: ArchiveRetentionMetadata['retentionTriggerType'];
        retentionTriggerLabel?: string;
        retentionTriggerDate?: string;
        retentionTriggerEvidence?: string;
        jraVersion?: string;
        jraReference?: string;
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
        this.assertRetentionTriggerDocumented(metadata);

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

            // Do not infer a trigger from the letter/archive date. Missing explicit
            // trigger means missing expiry and therefore no disposal eligibility.
            const retentionDates = this.calculateRetentionDates(
                metadata.retentionTriggerDate || null,
                metadata.retensiAktif || null,
                metadata.retensiInaktif || null,
            );

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
                    retentionTriggerType: metadata.retentionTriggerType,
                    retentionTriggerLabel: metadata.retentionTriggerLabel,
                    retentionTriggerDate: metadata.retentionTriggerDate,
                    retentionTriggerEvidence: metadata.retentionTriggerEvidence,
                    jraVersion: metadata.jraVersion,
                    jraReference: metadata.jraReference,
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
    async getExpiring(
        unitKerjaId: string,
        daysAhead: number = 30,
        securityClassifications?: string[] | null,
    ) {
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + daysAhead);

        const data = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                archiveSecurityCondition(securityClassifications),
                eq(arsip.legalHold, false),
                isNotNull(arsip.retentionTriggerDate),
                gte(arsip.tanggalKadaluarsa, today.toISOString().split('T')[0]),
                lte(arsip.tanggalKadaluarsa, futureDate.toISOString().split('T')[0])
            ))
            .orderBy(arsip.tanggalKadaluarsa);

        return data;
    }

    async getLegalHolds(unitKerjaId: string, securityClassifications?: string[] | null) {
        return db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                archiveSecurityCondition(securityClassifications),
                eq(arsip.legalHold, true),
            ))
            .orderBy(desc(arsip.legalHoldPlacedAt), desc(arsip.updatedAt));
    }

    async placeLegalHold(id: string, unitKerjaId: string, reason: string, userId?: string) {
        if (reason.trim().length < 10) {
            throw new ValidationError('Alasan legal hold minimal 10 karakter.');
        }
        const [existing] = await db
            .select()
            .from(arsip)
            .where(and(eq(arsip.id, id), eq(arsip.unitKerjaId, unitKerjaId)))
            .limit(1);

        if (!existing) throw new NotFoundError('Arsip');
        if (existing.legalHold) throw new ConflictError('Arsip sudah dalam status legal hold.');
        if (existing.disposalStatus === 'executed') {
            throw new ConflictError('Legal hold tidak dapat diterapkan setelah penyusutan selesai dieksekusi.');
        }

        const [updated] = await db
            .update(arsip)
            .set({
                legalHold: true,
                legalHoldReason: reason.trim(),
                legalHoldPlacedAt: new Date(),
                legalHoldPlacedBy: userId || null,
                legalHoldReleasedAt: null,
                legalHoldReleasedBy: null,
                legalHoldReleaseReason: null,
                updatedAt: new Date(),
            })
            .where(and(
                eq(arsip.id, id),
                eq(arsip.unitKerjaId, unitKerjaId),
                eq(arsip.legalHold, false),
                or(
                    isNull(arsip.disposalStatus),
                    ne(arsip.disposalStatus, 'executed'),
                ),
            ))
            .returning();

        if (!updated) throw new ConflictError('Status legal hold berubah. Muat ulang data dan coba kembali.');
        return { before: existing, after: updated };
    }

    async releaseLegalHold(id: string, unitKerjaId: string, reason: string, userId?: string) {
        if (reason.trim().length < 10) {
            throw new ValidationError('Alasan pelepasan legal hold minimal 10 karakter.');
        }
        const [existing] = await db
            .select()
            .from(arsip)
            .where(and(eq(arsip.id, id), eq(arsip.unitKerjaId, unitKerjaId)))
            .limit(1);

        if (!existing) throw new NotFoundError('Arsip');
        if (!existing.legalHold) throw new ConflictError('Arsip tidak sedang dalam status legal hold.');

        const [updated] = await db
            .update(arsip)
            .set({
                legalHold: false,
                legalHoldReleasedAt: new Date(),
                legalHoldReleasedBy: userId || null,
                legalHoldReleaseReason: reason.trim(),
                updatedAt: new Date(),
            })
            .where(and(
                eq(arsip.id, id),
                eq(arsip.unitKerjaId, unitKerjaId),
                eq(arsip.legalHold, true),
            ))
            .returning();

        if (!updated) throw new ConflictError('Status legal hold berubah. Muat ulang data dan coba kembali.');
        return { before: existing, after: updated };
    }

    async getStats(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            archiveSecurityCondition(securityClassifications),
        ];
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

    calculateRetentionDates(retentionTriggerDate: string | null, retensiAktif: string | null, retensiInaktif: string | null) {
        if (!retentionTriggerDate) {
            return {
                tanggalAktifBerakhir: null,
                tanggalInaktifBerakhir: null,
                tanggalKadaluarsa: null,
            };
        }

        const triggerDate = new Date(`${retentionTriggerDate}T00:00:00.000Z`);
        if (Number.isNaN(triggerDate.getTime())) {
            return {
                tanggalAktifBerakhir: null,
                tanggalInaktifBerakhir: null,
                tanggalKadaluarsa: null,
            };
        }

        const aktifMonths = this.parseRetentionMonths(retensiAktif);
        const inaktifMonths = this.parseRetentionMonths(retensiInaktif);

        const addMonths = (source: Date, months: number) => {
            const year = source.getUTCFullYear();
            const month = source.getUTCMonth();
            const day = source.getUTCDate();
            const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
            const lastTargetDay = new Date(Date.UTC(
                targetMonthStart.getUTCFullYear(),
                targetMonthStart.getUTCMonth() + 1,
                0,
            )).getUTCDate();
            return new Date(Date.UTC(
                targetMonthStart.getUTCFullYear(),
                targetMonthStart.getUTCMonth(),
                Math.min(day, lastTargetDay),
            ));
        };

        const endAktif = addMonths(triggerDate, aktifMonths);

        const endInaktif = addMonths(endAktif, inaktifMonths);

        const totalMonths = aktifMonths + inaktifMonths;

        return {
            tanggalAktifBerakhir: aktifMonths > 0 ? endAktif.toISOString().split('T')[0] : null,
            tanggalInaktifBerakhir: totalMonths > 0 ? endInaktif.toISOString().split('T')[0] : null,
            // No parsable retention (JRA rows use '-') means no expiry, not "expired today"
            tanggalKadaluarsa: totalMonths > 0 ? endInaktif.toISOString().split('T')[0] : null,
        };
    }

    // Get archive lifecycle status
    getArchiveStatus(retentionTriggerDate: string | null, retensiAktif: string | null, retensiInaktif: string | null):
        'belum_ditentukan' | 'aktif' | 'akan_inaktif' | 'inaktif' | 'akan_kadaluarsa' | 'kadaluarsa' {
        if (!retentionTriggerDate) return 'belum_ditentukan';

        const today = new Date();
        const dates = this.calculateRetentionDates(retentionTriggerDate, retensiAktif, retensiInaktif);

        if (!dates.tanggalKadaluarsa) return 'aktif';

        const aktifEnd = dates.tanggalAktifBerakhir
            ? new Date(dates.tanggalAktifBerakhir)
            : new Date(retentionTriggerDate);
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
    async getLifecycleNotifications(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ) {
        // Keep held/missing-trigger counts visible, but never mix them into actionable
        // lifecycle collections.
        const allArchives = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                archiveSecurityCondition(securityClassifications),
            ));

        const notifications = {
            willBeInactive: [] as typeof allArchives,      // Akan memasuki masa inaktif
            alreadyInactive: [] as typeof allArchives,     // Sudah inaktif
            willExpire: [] as typeof allArchives,          // Akan kadaluarsa (30 hari)
            expired: [] as typeof allArchives,             // Sudah kadaluarsa, perlu action
        };
        let held = 0;
        let missingTrigger = 0;

        for (const arch of allArchives) {
            if (arch.legalHold) {
                held += 1;
                continue;
            }
            if (!arch.retentionTriggerDate) {
                missingTrigger += 1;
                continue;
            }

            const status = this.getArchiveStatus(
                arch.retentionTriggerDate,
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
                held,
                missingTrigger,
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
        /** null means all classes (super_admin); [] fails closed. */
        securityClassifications?: string[] | null;
    }) {
        const {
            hasilAkhir,
            status,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters || {};
        const offset = (page - 1) * limit;

        const conditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            eq(arsip.disposalStatus, 'active'),
            eq(arsip.legalHold, false),
            isNotNull(arsip.retentionTriggerDate),
            archiveSecurityCondition(securityClassifications),
        ];
        if (hasilAkhir) {
            conditions.push(eq(arsip.hasilAkhir, hasilAkhir));
        }

        const allArchives = await db
            .select()
            .from(arsip)
            .where(and(...conditions))
            .orderBy(arsip.tanggalKadaluarsa);

        // Recalculate from the explicit trigger so stale legacy tanggalKadaluarsa values
        // can never make a record eligible.
        const evaluatedArchives = allArchives.flatMap(arch => {
            if (arch.legalHold || !arch.retentionTriggerDate) return [];
            const retentionStatus = this.getArchiveStatus(
                arch.retentionTriggerDate,
                arch.retensiAktif,
                arch.retensiInaktif,
            );
            const dates = this.calculateRetentionDates(
                arch.retentionTriggerDate,
                arch.retensiAktif,
                arch.retensiInaktif,
            );
            return [{ ...arch, retentionStatus, tanggalKadaluarsa: dates.tanggalKadaluarsa }];
        });

        // Filter by lifecycle status
        let filteredArchives = evaluatedArchives;
        if (status) {
            filteredArchives = evaluatedArchives.filter(arch => arch.retentionStatus === status);
        } else {
            filteredArchives = evaluatedArchives.filter(arch =>
                arch.retentionStatus === 'kadaluarsa' || arch.retentionStatus === 'akan_kadaluarsa',
            );
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
    async getRetentionSummary(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ) {
        const lifecycle = await this.getLifecycleNotifications(
            unitKerjaId,
            securityClassifications,
        );

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
    async generateDisposalReportData(
        unitKerjaId: string,
        archiveIds?: string[],
        securityClassifications?: string[] | null,
    ) {
        const requestedIds = archiveIds && archiveIds.length > 0
            ? [...new Set(archiveIds)]
            : undefined;
        const allArchives = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                archiveSecurityCondition(securityClassifications),
            ));

        const selectedArchives = requestedIds
            ? allArchives.filter(a => requestedIds.includes(a.id))
            : allArchives;

        if (requestedIds) {
            const foundIds = new Set(selectedArchives.map(a => a.id));
            const missingIds = requestedIds.filter(id => !foundIds.has(id));
            if (missingIds.length > 0) {
                throw new ValidationError('Sebagian arsip tidak ditemukan pada unit kerja yang dipilih.');
            }
        }

        const isEligibleForDestruction = (arch: Arsip) =>
            !arch.legalHold &&
            Boolean(arch.retentionTriggerDate) &&
            arch.disposalStatus === 'active' &&
            arch.hasilAkhir === 'Musnah' &&
            this.getArchiveStatus(
                arch.retentionTriggerDate,
                arch.retensiAktif,
                arch.retensiInaktif,
            ) === 'kadaluarsa';

        const archives = selectedArchives.filter(isEligibleForDestruction);
        if (requestedIds && archives.length !== selectedArchives.length) {
            throw new ValidationError(
                'Berita acara hanya dapat dibuat untuk arsip Musnah yang retensinya telah berakhir, memiliki pemicu, tidak di-hold, dan belum masuk proses penyusutan.',
            );
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
                retentionTriggerType: arch.retentionTriggerType || '-',
                retentionTriggerLabel: arch.retentionTriggerLabel || '-',
                retentionTriggerDate: arch.retentionTriggerDate || '-',
                retentionTriggerEvidence: arch.retentionTriggerEvidence || '-',
                jraVersion: arch.jraVersion || '-',
                jraReference: arch.jraReference || '-',
                hasilAkhir: arch.hasilAkhir || '-',
                keterangan: arch.keterangan || '-',
            })),
        };
    }
}

export const arsipService = new ArsipService();


