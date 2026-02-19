import {
  db
} from "./chunk-64MUSQBB.js";
import {
  arsipTerjaga
} from "./chunk-F55GPJUN.js";
import {
  arsip
} from "./chunk-MR7OZFZ4.js";

// src/services/arsip-terjaga.service.ts
import { eq, and, desc, sql, ilike, or } from "drizzle-orm";
var ArsipTerjagaService = class {
  // List all arsip terjaga with pagination and filters
  async findAll(filters) {
    const {
      unitKerjaId,
      kategoriTerjaga,
      statusPelaporan,
      statusKepatuhan,
      search,
      page = 1,
      limit = 20
    } = filters;
    const conditions = [];
    if (unitKerjaId) {
      conditions.push(eq(arsipTerjaga.unitKerjaId, unitKerjaId));
    }
    if (kategoriTerjaga) {
      conditions.push(eq(arsipTerjaga.kategoriTerjaga, kategoriTerjaga));
    }
    if (statusPelaporan) {
      conditions.push(eq(arsipTerjaga.statusPelaporan, statusPelaporan));
    }
    if (statusKepatuhan) {
      conditions.push(eq(arsipTerjaga.statusKepatuhan, statusKepatuhan));
    }
    if (search) {
      conditions.push(
        or(
          ilike(arsipTerjaga.dasarHukum, `%${search}%`),
          ilike(arsipTerjaga.uraianIsi, `%${search}%`),
          ilike(arsipTerjaga.catatan, `%${search}%`),
          ilike(arsipTerjaga.nomorLaporanANRI, `%${search}%`)
        )
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
    const [data, countResult] = await Promise.all([
      db.select({
        id: arsipTerjaga.id,
        arsipId: arsipTerjaga.arsipId,
        unitKerjaId: arsipTerjaga.unitKerjaId,
        kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
        dasarHukum: arsipTerjaga.dasarHukum,
        uraianIsi: arsipTerjaga.uraianIsi,
        statusPelaporan: arsipTerjaga.statusPelaporan,
        tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
        nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
        periodePelaporanHari: arsipTerjaga.periodePelaporanHari,
        tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
        tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
        statusKepatuhan: arsipTerjaga.statusKepatuhan,
        catatan: arsipTerjaga.catatan,
        createdAt: arsipTerjaga.createdAt,
        // Joined arsip info
        nomorBerkas: arsip.nomorBerkas,
        kodeKlasifikasi: arsip.kodeKlasifikasi,
        uraianBerkas: arsip.uraianBerkas,
        nomorSuratOriginal: arsip.nomorSuratOriginal,
        perihalOriginal: arsip.perihalOriginal,
        kurunWaktu: arsip.kurunWaktu
      }).from(arsipTerjaga).leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id)).where(whereClause).orderBy(desc(arsipTerjaga.createdAt)).limit(limit).offset((page - 1) * limit),
      db.select({ count: sql`count(*)::int` }).from(arsipTerjaga).where(whereClause)
    ]);
    const total = countResult[0]?.count ?? 0;
    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }
  // Get single arsip terjaga with arsip details
  async findById(id) {
    const [result] = await db.select({
      id: arsipTerjaga.id,
      arsipId: arsipTerjaga.arsipId,
      unitKerjaId: arsipTerjaga.unitKerjaId,
      kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
      dasarHukum: arsipTerjaga.dasarHukum,
      uraianIsi: arsipTerjaga.uraianIsi,
      statusPelaporan: arsipTerjaga.statusPelaporan,
      tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
      nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
      periodePelaporanHari: arsipTerjaga.periodePelaporanHari,
      tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
      tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
      statusKepatuhan: arsipTerjaga.statusKepatuhan,
      catatan: arsipTerjaga.catatan,
      createdBy: arsipTerjaga.createdBy,
      createdAt: arsipTerjaga.createdAt,
      updatedAt: arsipTerjaga.updatedAt,
      // Joined arsip info
      nomorBerkas: arsip.nomorBerkas,
      kodeKlasifikasi: arsip.kodeKlasifikasi,
      uraianBerkas: arsip.uraianBerkas,
      uraianItem: arsip.uraianItem,
      nomorSuratOriginal: arsip.nomorSuratOriginal,
      tanggalSuratOriginal: arsip.tanggalSuratOriginal,
      perihalOriginal: arsip.perihalOriginal,
      jenisArsip: arsip.jenisArsip
    }).from(arsipTerjaga).leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id)).where(eq(arsipTerjaga.id, id)).limit(1);
    return result || null;
  }
  // Designate an archive as terjaga
  async create(data) {
    const [result] = await db.insert(arsipTerjaga).values({
      ...data,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    }).returning();
    return result;
  }
  // Update arsip terjaga
  async update(id, data) {
    const [result] = await db.update(arsipTerjaga).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(arsipTerjaga.id, id)).returning();
    return result;
  }
  // Remove terjaga designation
  async delete(id) {
    const [result] = await db.delete(arsipTerjaga).where(eq(arsipTerjaga.id, id)).returning();
    return result;
  }
  // Mark as reported to ANRI
  async markAsReported(id, nomorLaporan, tanggalPelaporan) {
    const [result] = await db.update(arsipTerjaga).set({
      statusPelaporan: "dilaporkan",
      nomorLaporanANRI: nomorLaporan,
      tanggalPelaporan,
      statusKepatuhan: "patuh",
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(arsipTerjaga.id, id)).returning();
    return result;
  }
  // Get statistics for dashboard
  async getStats(unitKerjaId) {
    const conditions = [eq(arsipTerjaga.unitKerjaId, unitKerjaId)];
    const [total, byKategori, byPelaporan, byKepatuhan] = await Promise.all([
      db.select({ count: sql`count(*)::int` }).from(arsipTerjaga).where(and(...conditions)),
      db.select({
        kategori: arsipTerjaga.kategoriTerjaga,
        count: sql`count(*)::int`
      }).from(arsipTerjaga).where(and(...conditions)).groupBy(arsipTerjaga.kategoriTerjaga),
      db.select({
        status: arsipTerjaga.statusPelaporan,
        count: sql`count(*)::int`
      }).from(arsipTerjaga).where(and(...conditions)).groupBy(arsipTerjaga.statusPelaporan),
      db.select({
        status: arsipTerjaga.statusKepatuhan,
        count: sql`count(*)::int`
      }).from(arsipTerjaga).where(and(...conditions)).groupBy(arsipTerjaga.statusKepatuhan)
    ]);
    return {
      total: total[0]?.count ?? 0,
      byKategori,
      byPelaporan,
      byKepatuhan
    };
  }
  // Get arsip terjaga approaching reporting deadline
  async getDueForReporting(unitKerjaId, daysAhead = 30) {
    const futureDate = /* @__PURE__ */ new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const results = await db.select({
      id: arsipTerjaga.id,
      arsipId: arsipTerjaga.arsipId,
      kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
      statusPelaporan: arsipTerjaga.statusPelaporan,
      tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
      tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
      nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
      statusKepatuhan: arsipTerjaga.statusKepatuhan,
      nomorBerkas: arsip.nomorBerkas,
      uraianBerkas: arsip.uraianBerkas,
      nomorSuratOriginal: arsip.nomorSuratOriginal
    }).from(arsipTerjaga).leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id)).where(
      and(
        eq(arsipTerjaga.unitKerjaId, unitKerjaId),
        eq(arsipTerjaga.statusPelaporan, "belum_dilaporkan")
      )
    ).orderBy(arsipTerjaga.tanggalPenetapan);
    return results;
  }
  // Generate ANRI report data
  async generateLaporanANRI(unitKerjaId, tahun) {
    const conditions = [eq(arsipTerjaga.unitKerjaId, unitKerjaId)];
    const results = await db.select({
      id: arsipTerjaga.id,
      arsipId: arsipTerjaga.arsipId,
      kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
      dasarHukum: arsipTerjaga.dasarHukum,
      uraianIsi: arsipTerjaga.uraianIsi,
      statusPelaporan: arsipTerjaga.statusPelaporan,
      tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
      nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
      tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
      statusKepatuhan: arsipTerjaga.statusKepatuhan,
      catatan: arsipTerjaga.catatan,
      // Arsip details
      nomorBerkas: arsip.nomorBerkas,
      kodeKlasifikasi: arsip.kodeKlasifikasi,
      uraianBerkas: arsip.uraianBerkas,
      nomorSuratOriginal: arsip.nomorSuratOriginal,
      tanggalSuratOriginal: arsip.tanggalSuratOriginal,
      perihalOriginal: arsip.perihalOriginal,
      kurunWaktu: arsip.kurunWaktu,
      jumlah: arsip.jumlah
    }).from(arsipTerjaga).leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id)).where(and(...conditions)).orderBy(arsipTerjaga.kategoriTerjaga, arsipTerjaga.tanggalPenetapan);
    const grouped = {};
    for (const item of results) {
      const kat = item.kategoriTerjaga;
      if (!grouped[kat]) grouped[kat] = [];
      grouped[kat].push(item);
    }
    return {
      unitKerjaId,
      tahun: tahun || (/* @__PURE__ */ new Date()).getFullYear(),
      tanggalLaporan: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      totalArsipTerjaga: results.length,
      dataPerKategori: grouped,
      data: results
    };
  }
};
var arsipTerjagaService = new ArsipTerjagaService();

export {
  arsipTerjagaService
};
