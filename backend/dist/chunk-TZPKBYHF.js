import {
  db
} from "./chunk-IAYKVWKA.js";
import {
  arsipVital
} from "./chunk-F55GPJUN.js";
import {
  arsip
} from "./chunk-MR7OZFZ4.js";

// src/services/arsip-vital.service.ts
import { eq, and, desc, sql, lte, ilike, or } from "drizzle-orm";
var ArsipVitalService = class {
  // List all arsip vital with pagination and filters
  async findAll(filters) {
    const {
      unitKerjaId,
      kategoriVital,
      tingkatKekritisan,
      statusProteksi,
      search,
      page = 1,
      limit = 20
    } = filters;
    const conditions = [];
    if (unitKerjaId) {
      conditions.push(eq(arsipVital.unitKerjaId, unitKerjaId));
    }
    if (kategoriVital) {
      conditions.push(eq(arsipVital.kategoriVital, kategoriVital));
    }
    if (tingkatKekritisan) {
      conditions.push(eq(arsipVital.tingkatKekritisan, tingkatKekritisan));
    }
    if (statusProteksi) {
      conditions.push(eq(arsipVital.statusProteksi, statusProteksi));
    }
    if (search) {
      conditions.push(
        or(
          ilike(arsipVital.alasanPenetapan, `%${search}%`),
          ilike(arsipVital.penanggungJawab, `%${search}%`),
          ilike(arsipVital.lokasiBackup, `%${search}%`)
        )
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
    const [data, countResult] = await Promise.all([
      db.select({
        id: arsipVital.id,
        arsipId: arsipVital.arsipId,
        unitKerjaId: arsipVital.unitKerjaId,
        kategoriVital: arsipVital.kategoriVital,
        tingkatKekritisan: arsipVital.tingkatKekritisan,
        alasanPenetapan: arsipVital.alasanPenetapan,
        metodeProteksi: arsipVital.metodeProteksi,
        lokasiBackup: arsipVital.lokasiBackup,
        mediaBackup: arsipVital.mediaBackup,
        jadwalBackup: arsipVital.jadwalBackup,
        tanggalPenetapan: arsipVital.tanggalPenetapan,
        tanggalReviewSelanjutnya: arsipVital.tanggalReviewSelanjutnya,
        statusProteksi: arsipVital.statusProteksi,
        penanggungJawab: arsipVital.penanggungJawab,
        createdAt: arsipVital.createdAt,
        // Joined arsip info
        nomorBerkas: arsip.nomorBerkas,
        kodeKlasifikasi: arsip.kodeKlasifikasi,
        uraianBerkas: arsip.uraianBerkas,
        nomorSuratOriginal: arsip.nomorSuratOriginal,
        perihalOriginal: arsip.perihalOriginal,
        kurunWaktu: arsip.kurunWaktu
      }).from(arsipVital).leftJoin(arsip, eq(arsipVital.arsipId, arsip.id)).where(whereClause).orderBy(desc(arsipVital.createdAt)).limit(limit).offset((page - 1) * limit),
      db.select({ count: sql`count(*)::int` }).from(arsipVital).where(whereClause)
    ]);
    const total = countResult[0]?.count ?? 0;
    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }
  // Get single arsip vital with arsip details
  async findById(id) {
    const [result] = await db.select({
      id: arsipVital.id,
      arsipId: arsipVital.arsipId,
      unitKerjaId: arsipVital.unitKerjaId,
      kategoriVital: arsipVital.kategoriVital,
      tingkatKekritisan: arsipVital.tingkatKekritisan,
      alasanPenetapan: arsipVital.alasanPenetapan,
      metodeProteksi: arsipVital.metodeProteksi,
      lokasiBackup: arsipVital.lokasiBackup,
      mediaBackup: arsipVital.mediaBackup,
      jadwalBackup: arsipVital.jadwalBackup,
      tanggalPenetapan: arsipVital.tanggalPenetapan,
      tanggalReviewSelanjutnya: arsipVital.tanggalReviewSelanjutnya,
      statusProteksi: arsipVital.statusProteksi,
      penanggungJawab: arsipVital.penanggungJawab,
      createdBy: arsipVital.createdBy,
      createdAt: arsipVital.createdAt,
      updatedAt: arsipVital.updatedAt,
      // Joined arsip info
      nomorBerkas: arsip.nomorBerkas,
      kodeKlasifikasi: arsip.kodeKlasifikasi,
      uraianBerkas: arsip.uraianBerkas,
      uraianItem: arsip.uraianItem,
      nomorSuratOriginal: arsip.nomorSuratOriginal,
      tanggalSuratOriginal: arsip.tanggalSuratOriginal,
      perihalOriginal: arsip.perihalOriginal,
      jenisArsip: arsip.jenisArsip
    }).from(arsipVital).leftJoin(arsip, eq(arsipVital.arsipId, arsip.id)).where(eq(arsipVital.id, id)).limit(1);
    return result || null;
  }
  // Designate an archive as vital
  async create(data) {
    const [result] = await db.insert(arsipVital).values({
      ...data,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    }).returning();
    return result;
  }
  // Update arsip vital
  async update(id, data) {
    const [result] = await db.update(arsipVital).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(arsipVital.id, id)).returning();
    return result;
  }
  // Remove vital designation
  async delete(id) {
    const [result] = await db.delete(arsipVital).where(eq(arsipVital.id, id)).returning();
    return result;
  }
  // Get statistics for dashboard
  async getStats(unitKerjaId) {
    const conditions = [eq(arsipVital.unitKerjaId, unitKerjaId)];
    const [total, byKategori, byStatus, byKekritisan] = await Promise.all([
      db.select({ count: sql`count(*)::int` }).from(arsipVital).where(and(...conditions)),
      db.select({
        kategori: arsipVital.kategoriVital,
        count: sql`count(*)::int`
      }).from(arsipVital).where(and(...conditions)).groupBy(arsipVital.kategoriVital),
      db.select({
        status: arsipVital.statusProteksi,
        count: sql`count(*)::int`
      }).from(arsipVital).where(and(...conditions)).groupBy(arsipVital.statusProteksi),
      db.select({
        tingkat: arsipVital.tingkatKekritisan,
        count: sql`count(*)::int`
      }).from(arsipVital).where(and(...conditions)).groupBy(arsipVital.tingkatKekritisan)
    ]);
    return {
      total: total[0]?.count ?? 0,
      byKategori,
      byStatus,
      byKekritisan
    };
  }
  // Get arsip vital due for review
  async getDueForReview(unitKerjaId, daysAhead = 30) {
    const futureDate = /* @__PURE__ */ new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const results = await db.select({
      id: arsipVital.id,
      arsipId: arsipVital.arsipId,
      kategoriVital: arsipVital.kategoriVital,
      tingkatKekritisan: arsipVital.tingkatKekritisan,
      statusProteksi: arsipVital.statusProteksi,
      tanggalReviewSelanjutnya: arsipVital.tanggalReviewSelanjutnya,
      penanggungJawab: arsipVital.penanggungJawab,
      nomorBerkas: arsip.nomorBerkas,
      uraianBerkas: arsip.uraianBerkas,
      nomorSuratOriginal: arsip.nomorSuratOriginal
    }).from(arsipVital).leftJoin(arsip, eq(arsipVital.arsipId, arsip.id)).where(
      and(
        eq(arsipVital.unitKerjaId, unitKerjaId),
        lte(arsipVital.tanggalReviewSelanjutnya, futureDate.toISOString().split("T")[0])
      )
    ).orderBy(arsipVital.tanggalReviewSelanjutnya);
    return results;
  }
};
var arsipVitalService = new ArsipVitalService();

export {
  arsipVitalService
};
