import {
  db
} from "./chunk-YSVDMDWC.js";
import {
  arsipItems
} from "./chunk-F55GPJUN.js";
import {
  arsip
} from "./chunk-MR7OZFZ4.js";

// src/services/arsip.service.ts
import { eq, and, desc, sql, lte, gte } from "drizzle-orm";
var ArsipService = class {
  async findAll(filters) {
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
    const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(arsip).where(and(...conditions));
    const data = await db.select().from(arsip).where(and(...conditions)).orderBy(desc(arsip.createdAt)).limit(limit).offset(offset);
    return {
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    };
  }
  async findById(id) {
    const [result] = await db.select().from(arsip).where(eq(arsip.id, id)).limit(1);
    if (!result) return null;
    const items = await db.select().from(arsipItems).where(eq(arsipItems.arsipId, id)).orderBy(arsipItems.nomorItem);
    return { ...result, items };
  }
  async create(data) {
    const [result] = await db.insert(arsip).values(data).returning();
    return result;
  }
  async update(id, data) {
    const [result] = await db.update(arsip).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(arsip.id, id)).returning();
    return result;
  }
  async delete(id) {
    const [result] = await db.delete(arsip).where(eq(arsip.id, id)).returning();
    return result;
  }
  // Create arsip from surat masuk
  async archiveFromSuratMasuk(suratMasukId, metadata) {
    const { suratMasuk } = await import("./schema-X7T7ECFS.js");
    const [surat] = await db.select().from(suratMasuk).where(eq(suratMasuk.id, suratMasukId)).limit(1);
    if (!surat) {
      throw new Error("Surat masuk not found");
    }
    const [existing] = await db.select().from(arsip).where(and(
      eq(arsip.sourceSuratId, suratMasukId),
      eq(arsip.jenisArsip, "masuk")
    )).limit(1);
    if (existing) {
      throw new Error("Surat masuk sudah diarsipkan");
    }
    const retentionDates = metadata.retensiAktif || metadata.retensiInaktif ? this.calculateRetentionDates(
      surat.tanggalSurat || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      metadata.retensiAktif || null,
      metadata.retensiInaktif || null
    ) : { tanggalKadaluarsa: null };
    const [arsipEntry] = await db.insert(arsip).values({
      unitKerjaId: surat.unitKerjaId,
      jenisArsip: "masuk",
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
      createdBy: metadata.createdBy
    }).returning();
    if (metadata.items && Array.isArray(metadata.items) && metadata.items.length > 0) {
      const itemsToInsert = metadata.items.map((item) => ({
        arsipId: arsipEntry.id,
        nomorItem: item.nomor || item.nomorItem || "",
        uraianItem: item.uraian || item.uraianItem || "",
        tingkatPerkembangan: item.perkembangan || item.tingkatPerkembangan || "",
        tanggalItem: item.tanggal || item.tanggalItem || null,
        jumlah: item.jumlah || 1,
        mediaType: item.mediaType || "kertas",
        lokasiFc: item.lokasiFc || "",
        lokasiLaci: item.lokasiLaci || "",
        lokasiFolder: item.lokasiFolder || ""
      }));
      await db.insert(arsipItems).values(itemsToInsert);
    }
    await db.update(suratMasuk).set({ isArchived: true, updatedAt: /* @__PURE__ */ new Date() }).where(eq(suratMasuk.id, suratMasukId));
    return arsipEntry;
  }
  // Create arsip from surat keluar
  async archiveFromSuratKeluar(suratKeluarId, metadata) {
    const { suratKeluar } = await import("./schema-X7T7ECFS.js");
    const [surat] = await db.select().from(suratKeluar).where(eq(suratKeluar.id, suratKeluarId)).limit(1);
    if (!surat) {
      throw new Error("Surat keluar not found");
    }
    const [existing] = await db.select().from(arsip).where(and(
      eq(arsip.sourceSuratId, suratKeluarId),
      eq(arsip.jenisArsip, "keluar")
    )).limit(1);
    if (existing) {
      throw new Error("Surat keluar sudah diarsipkan");
    }
    const retentionDates = metadata.retensiAktif || metadata.retensiInaktif ? this.calculateRetentionDates(
      surat.tanggalSurat || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      metadata.retensiAktif || null,
      metadata.retensiInaktif || null
    ) : { tanggalKadaluarsa: null };
    const [arsipEntry] = await db.insert(arsip).values({
      unitKerjaId: surat.unitKerjaId,
      jenisArsip: "keluar",
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
      createdBy: metadata.createdBy
    }).returning();
    if (metadata.items && Array.isArray(metadata.items) && metadata.items.length > 0) {
      const itemsToInsert = metadata.items.map((item) => ({
        arsipId: arsipEntry.id,
        nomorItem: item.nomor || item.nomorItem || "",
        uraianItem: item.uraian || item.uraianItem || "",
        tingkatPerkembangan: item.perkembangan || item.tingkatPerkembangan || "",
        tanggalItem: item.tanggal || item.tanggalItem || null,
        jumlah: item.jumlah || 1,
        mediaType: item.mediaType || "kertas",
        lokasiFc: item.lokasiFc || "",
        lokasiLaci: item.lokasiLaci || "",
        lokasiFolder: item.lokasiFolder || ""
      }));
      await db.insert(arsipItems).values(itemsToInsert);
    }
    await db.update(suratKeluar).set({ isArchived: true, updatedAt: /* @__PURE__ */ new Date() }).where(eq(suratKeluar.id, suratKeluarId));
    return arsipEntry;
  }
  // Find arsip by source surat id
  async findBySourceSurat(sourceSuratId) {
    const [result] = await db.select().from(arsip).where(eq(arsip.sourceSuratId, sourceSuratId)).limit(1);
    return result || null;
  }
  // Get arsip with source surat details
  async findByIdWithSourceSurat(id) {
    const arsipEntry = await this.findById(id);
    if (!arsipEntry || !arsipEntry.sourceSuratId) return arsipEntry;
    let sourceSurat = null;
    if (arsipEntry.jenisArsip === "masuk") {
      const { suratMasuk } = await import("./schema-X7T7ECFS.js");
      const [surat] = await db.select().from(suratMasuk).where(eq(suratMasuk.id, arsipEntry.sourceSuratId)).limit(1);
      sourceSurat = surat || null;
    } else if (arsipEntry.jenisArsip === "keluar") {
      const { suratKeluar } = await import("./schema-X7T7ECFS.js");
      const [surat] = await db.select().from(suratKeluar).where(eq(suratKeluar.id, arsipEntry.sourceSuratId)).limit(1);
      sourceSurat = surat || null;
    }
    return {
      ...arsipEntry,
      sourceSurat
    };
  }
  // Get arsip that will expire within N days
  async getExpiring(unitKerjaId, daysAhead = 30) {
    const today = /* @__PURE__ */ new Date();
    const futureDate = /* @__PURE__ */ new Date();
    futureDate.setDate(today.getDate() + daysAhead);
    const data = await db.select().from(arsip).where(and(
      eq(arsip.unitKerjaId, unitKerjaId),
      gte(arsip.tanggalKadaluarsa, today.toISOString().split("T")[0]),
      lte(arsip.tanggalKadaluarsa, futureDate.toISOString().split("T")[0])
    )).orderBy(arsip.tanggalKadaluarsa);
    return data;
  }
  async getStats(unitKerjaId, tahun) {
    const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
    if (tahun) {
      conditions.push(eq(arsip.tahun, tahun));
    }
    const stats = await db.select({
      total: sql`count(*)::int`,
      arsipMasuk: sql`count(*) filter (where ${arsip.jenisArsip} = 'masuk')::int`,
      arsipKeluar: sql`count(*) filter (where ${arsip.jenisArsip} = 'keluar')::int`
    }).from(arsip).where(and(...conditions));
    return stats[0];
  }
  // Calculate retention end dates
  parseRetentionPeriod(retention) {
    if (!retention) return 0;
    const match = retention.match(/(\d+)\s*tahun/i);
    return match ? parseInt(match[1], 10) : 0;
  }
  calculateRetentionDates(tanggalArsip, retensiAktif, retensiInaktif) {
    const arsipDate = new Date(tanggalArsip);
    const aktifYears = this.parseRetentionPeriod(retensiAktif);
    const inaktifYears = this.parseRetentionPeriod(retensiInaktif);
    const endAktif = new Date(arsipDate);
    endAktif.setFullYear(endAktif.getFullYear() + aktifYears);
    const endInaktif = new Date(endAktif);
    endInaktif.setFullYear(endInaktif.getFullYear() + inaktifYears);
    return {
      tanggalAktifBerakhir: aktifYears > 0 ? endAktif.toISOString().split("T")[0] : null,
      tanggalInaktifBerakhir: aktifYears + inaktifYears > 0 ? endInaktif.toISOString().split("T")[0] : null,
      tanggalKadaluarsa: endInaktif.toISOString().split("T")[0]
    };
  }
  // Get archive lifecycle status
  getArchiveStatus(tanggalArsip, retensiAktif, retensiInaktif) {
    const today = /* @__PURE__ */ new Date();
    const dates = this.calculateRetentionDates(tanggalArsip, retensiAktif, retensiInaktif);
    if (!dates.tanggalAktifBerakhir) return "aktif";
    const aktifEnd = new Date(dates.tanggalAktifBerakhir);
    const inaktifEnd = dates.tanggalInaktifBerakhir ? new Date(dates.tanggalInaktifBerakhir) : aktifEnd;
    const thirtyDaysFromNow = /* @__PURE__ */ new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    if (today > inaktifEnd) return "kadaluarsa";
    if (today > aktifEnd && inaktifEnd <= thirtyDaysFromNow) return "akan_kadaluarsa";
    if (today > aktifEnd) return "inaktif";
    if (aktifEnd <= thirtyDaysFromNow) return "akan_inaktif";
    return "aktif";
  }
  // Get lifecycle notifications for all archives in unit
  async getLifecycleNotifications(unitKerjaId) {
    const today = /* @__PURE__ */ new Date();
    const thirtyDaysFromNow = /* @__PURE__ */ new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const todayStr = today.toISOString().split("T")[0];
    const thirtyDaysStr = thirtyDaysFromNow.toISOString().split("T")[0];
    const allArchives = await db.select().from(arsip).where(eq(arsip.unitKerjaId, unitKerjaId));
    const notifications = {
      willBeInactive: [],
      // Akan memasuki masa inaktif
      alreadyInactive: [],
      // Sudah inaktif
      willExpire: [],
      // Akan kadaluarsa (30 hari)
      expired: []
      // Sudah kadaluarsa, perlu action
    };
    for (const arch of allArchives) {
      if (!arch.tanggalArsip) continue;
      const status = this.getArchiveStatus(
        arch.tanggalArsip,
        arch.retensiAktif,
        arch.retensiInaktif
      );
      switch (status) {
        case "akan_inaktif":
          notifications.willBeInactive.push(arch);
          break;
        case "inaktif":
          notifications.alreadyInactive.push(arch);
          break;
        case "akan_kadaluarsa":
          notifications.willExpire.push(arch);
          break;
        case "kadaluarsa":
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
        total: allArchives.length
      }
    };
  }
  // Get disposal candidates grouped by hasilAkhir
  async getDisposalCandidates(unitKerjaId, filters) {
    const { hasilAkhir, status, page = 1, limit = 20 } = filters || {};
    const offset = (page - 1) * limit;
    const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
    if (hasilAkhir) {
      conditions.push(eq(arsip.hasilAkhir, hasilAkhir));
    }
    const allArchives = await db.select().from(arsip).where(and(...conditions)).orderBy(arsip.tanggalKadaluarsa);
    let filteredArchives = allArchives;
    if (status) {
      filteredArchives = allArchives.filter((arch) => {
        if (!arch.tanggalArsip) return false;
        const archStatus = this.getArchiveStatus(arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif);
        return archStatus === status;
      });
    } else {
      filteredArchives = allArchives.filter((arch) => {
        if (!arch.tanggalArsip) return false;
        const archStatus = this.getArchiveStatus(arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif);
        return archStatus === "kadaluarsa" || archStatus === "akan_kadaluarsa";
      });
    }
    const grouped = {
      musnah: filteredArchives.filter((a) => a.hasilAkhir === "Musnah"),
      permanen: filteredArchives.filter((a) => a.hasilAkhir === "Permanen"),
      dinilaiKembali: filteredArchives.filter((a) => a.hasilAkhir === "Dinilai Kembali"),
      belumDitentukan: filteredArchives.filter((a) => !a.hasilAkhir)
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
        totalBelumDitentukan: grouped.belumDitentukan.length
      }
    };
  }
  // Get monthly retention summary for dashboard
  async getRetentionSummary(unitKerjaId) {
    const lifecycle = await this.getLifecycleNotifications(unitKerjaId);
    const expiredByHasilAkhir = {
      musnah: lifecycle.expired.filter((a) => a.hasilAkhir === "Musnah").length,
      permanen: lifecycle.expired.filter((a) => a.hasilAkhir === "Permanen").length,
      dinilaiKembali: lifecycle.expired.filter((a) => a.hasilAkhir === "Dinilai Kembali").length,
      belumDitentukan: lifecycle.expired.filter((a) => !a.hasilAkhir).length
    };
    const currentMonth = (/* @__PURE__ */ new Date()).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    return {
      bulan: currentMonth,
      summary: lifecycle.summary,
      expiredByHasilAkhir,
      message: lifecycle.summary.expired > 0 ? `Bulan ini ada ${lifecycle.summary.expired} berkas yang sudah habis masa retensinya dan perlu ditindaklanjuti.` : "Tidak ada arsip yang kadaluarsa bulan ini.",
      alertLevel: lifecycle.summary.expired > 50 ? "high" : lifecycle.summary.expired > 20 ? "medium" : lifecycle.summary.expired > 0 ? "low" : "none"
    };
  }
  // Generate disposal report data
  async generateDisposalReportData(unitKerjaId, archiveIds) {
    let archives;
    if (archiveIds && archiveIds.length > 0) {
      archives = await db.select().from(arsip).where(eq(arsip.unitKerjaId, unitKerjaId));
      archives = archives.filter((a) => archiveIds.includes(a.id));
    } else {
      const allArchives = await db.select().from(arsip).where(and(eq(arsip.unitKerjaId, unitKerjaId), eq(arsip.hasilAkhir, "Musnah")));
      archives = allArchives.filter((arch) => {
        if (!arch.tanggalArsip) return false;
        return this.getArchiveStatus(arch.tanggalArsip, arch.retensiAktif, arch.retensiInaktif) === "kadaluarsa";
      });
    }
    const now = /* @__PURE__ */ new Date();
    const reportNumber = `BA-${unitKerjaId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    return {
      reportNumber,
      tanggal: now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
      unitKerja: unitKerjaId,
      totalBerkas: archives.length,
      daftarArsip: archives.map((arch, index) => ({
        no: index + 1,
        nomorBerkas: arch.nomorBerkas || "-",
        kodeKlasifikasi: arch.kodeKlasifikasi || "-",
        uraian: arch.uraianBerkas || arch.uraianItem || "-",
        kurunWaktu: arch.kurunWaktu || "-",
        jumlah: arch.jumlah || 1,
        tingkatPerkembangan: arch.tingkatPerkembangan || "-",
        jraKode: arch.jraKode || "-",
        retensiAktif: arch.retensiAktif || "-",
        retensiInaktif: arch.retensiInaktif || "-",
        hasilAkhir: arch.hasilAkhir || "-",
        keterangan: arch.keterangan || "-"
      }))
    };
  }
};
var arsipService = new ArsipService();

export {
  ArsipService,
  arsipService
};
