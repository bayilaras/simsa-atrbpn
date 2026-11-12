import { FileText, FolderOpen, Mail, Send } from 'lucide-react'
import { arsipService } from '@/services/arsip.service'
import dosirService from '@/services/dosir.service'
import { suratKeluarService } from '@/services/surat-keluar.service'
import { suratMasukService } from '@/services/surat-masuk.service'

export const BATAS_HASIL_DOKUMEN = 10
export const LABEL_DI_LUAR_JANGKAUAN = 'Dokumen lain (tidak dalam jangkauan Anda)'

const JENIS_ARSIP = { masuk: 'Arsip surat masuk', keluar: 'Arsip surat keluar' }

/**
 * Jenis dokumen yang dapat ditunjuk silang. `cari` memakai daftar yang sudah ada di tiap modul,
 * sehingga hasilnya mengikuti batas unit kerja dan kelas keamanan yang sama dengan halaman daftarnya.
 */
export const JENIS_DOKUMEN = [
    {
        value: 'arsip', label: 'Arsip', icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/15',
        petunjuk: 'Nomor berkas atau uraian',
        tautan: (id) => `/arsip/detail/${id}`,
        cari: async ({ kataKunci, unitKerjaId }) => {
            const response = await arsipService.search({ q: kataKunci, limit: BATAS_HASIL_DOKUMEN, unitKerjaId })
            return { data: response?.data || [], total: response?.pagination?.total }
        },
        ringkas: (arsip) => ({
            nomor: arsip.nomorBerkas || arsip.nomorSuratOriginal || null,
            judul: arsip.uraianBerkas || arsip.perihalOriginal || null,
            jenis: arsip.jenisArsip || null,
            dapatDitautkan: (arsip.disposalStatus ?? 'active') === 'active' && arsip.legalHold !== true,
        }),
    },
    {
        value: 'surat_masuk', label: 'Surat Masuk', icon: Mail, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-500/15',
        petunjuk: 'Nomor, perihal, atau pengirim',
        tautan: (id) => `/surat/masuk/${id}`,
        cari: async ({ kataKunci, unitKerjaId }) => {
            const response = await suratMasukService.getAll({ unitKerjaId, search: kataKunci, page: 1, limit: BATAS_HASIL_DOKUMEN })
            return { data: response?.data || [], total: response?.pagination?.total }
        },
        ringkas: (surat) => ({
            nomor: surat.nomorSurat || null,
            judul: surat.perihal || null,
            jenis: surat.jenisSurat || null,
            dapatDitautkan: surat.isArchived !== true,
        }),
    },
    {
        value: 'surat_keluar', label: 'Surat Keluar', icon: Send, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-500/15',
        petunjuk: 'Nomor, perihal, atau tujuan',
        tautan: (id) => `/surat/keluar/${id}`,
        cari: async ({ kataKunci, unitKerjaId }) => {
            const response = await suratKeluarService.getAll({ unitKerjaId, search: kataKunci, page: 1, limit: BATAS_HASIL_DOKUMEN })
            return { data: response?.data || [], total: response?.pagination?.total }
        },
        ringkas: (surat) => ({
            nomor: surat.nomorSurat || null,
            judul: surat.perihal || null,
            jenis: surat.naskahDinas || null,
            dapatDitautkan: surat.isArchived !== true,
        }),
    },
    {
        value: 'dosir', label: 'Dosir', icon: FolderOpen, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/15',
        petunjuk: 'Kode atau judul dosir',
        tautan: (id) => `/dosir/${id}`,
        cari: async ({ kataKunci, unitKerjaId }) => {
            const data = await dosirService.getAll({ unitKerjaId, search: kataKunci, limit: BATAS_HASIL_DOKUMEN })
            return { data: Array.isArray(data) ? data : [], total: undefined }
        },
        ringkas: (dosir) => ({
            nomor: dosir.kode || null,
            judul: dosir.judul || null,
            jenis: dosir.kategori || null,
            dapatDitautkan: (dosir.status ?? 'open') === 'open',
        }),
    },
]

const JENIS_TAK_DIKENAL = {
    value: '', label: 'Dokumen', icon: FileText, color: 'text-muted-foreground', bg: 'bg-muted/50',
    petunjuk: '', tautan: () => null,
}

export function jenisDokumen(value) {
    return JENIS_DOKUMEN.find((item) => item.value === value) || JENIS_TAK_DIKENAL
}

/** Peran yang dapat membuka halaman Dosir dan Tunjuk Silang (lihat rute di App.jsx). */
export const PERAN_PENGELOLA = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen']

export const JENIS_RELASI = [
    { value: 'balasan', label: 'Balasan', color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200' },
    { value: 'tindak_lanjut', label: 'Tindak Lanjut', color: 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 border-green-200' },
    { value: 'lampiran', label: 'Lampiran', color: 'bg-purple-100 dark:bg-purple-500/15 text-purple-800 dark:text-purple-300 border-purple-200' },
    { value: 'referensi', label: 'Referensi', color: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 border-yellow-200' },
    { value: 'revisi', label: 'Revisi', color: 'bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-200' },
    { value: 'duplikat', label: 'Duplikat', color: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300 border-red-200' },
    { value: 'berkaitan', label: 'Berkaitan', color: 'bg-muted text-foreground border-border' },
]

export function jenisRelasi(value) {
    return JENIS_RELASI.find((item) => item.value === value) || { value, label: 'Hubungan lain', color: 'bg-muted text-foreground border-border' }
}

/** Alamat halaman Tunjuk Silang yang langsung menampilkan tunjuk silang satu dokumen. */
export function alamatTunjukSilang(tipe, id) {
    return `/tunjuk-silang?jenis=${encodeURIComponent(tipe)}&id=${encodeURIComponent(id)}`
}

/**
 * Teks tampilan satu dokumen dari label yang dikirim server ({ accessible, nomor, judul, jenis }).
 * Dokumen yang tidak boleh dibaca pemirsa tidak membawa isi apa pun dan tidak mendapat tautan.
 */
export function tampilanDokumen(tipe, id, label, peran) {
    const jenis = jenisDokumen(tipe)
    if (!label || label.accessible !== true) {
        return { terjangkau: false, jenis, judul: LABEL_DI_LUAR_JANGKAUAN, nomor: null, rincian: null, tautan: null }
    }
    const bolehDibuka = Boolean(id) && (tipe !== 'dosir' || PERAN_PENGELOLA.includes(peran))
    return {
        terjangkau: true,
        jenis,
        judul: label.judul || (tipe === 'arsip' ? 'Tanpa uraian' : tipe === 'dosir' ? 'Tanpa judul' : 'Tanpa perihal'),
        nomor: label.nomor || null,
        rincian: tipe === 'arsip' ? (JENIS_ARSIP[label.jenis] || null) : (label.jenis || null),
        tautan: bolehDibuka ? jenis.tautan(id) : null,
    }
}
