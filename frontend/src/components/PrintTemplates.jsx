import { useState } from 'react';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { Printer, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// ==================== HELPER ====================

function KopSurat() {
    return (
        <div className="border-b-4 border-double border-black pb-4 mb-6">
            <div className="flex items-center gap-4">
                <img
                    src="/icons/logo-atrbpn.png"
                    alt="Logo ATR/BPN"
                    className="w-20 h-20 object-contain"
                    onError={(e) => { e.target.style.display = 'none'; }}
                />
                <div className="flex-1 text-center">
                    <p className="text-sm font-bold">KEMENTERIAN AGRARIA DAN TATA RUANG/</p>
                    <p className="text-sm font-bold">BADAN PERTANAHAN NASIONAL</p>
                    <p className="text-lg font-bold mt-1">DIREKTORAT JENDERAL PENETAPAN HAK DAN PENDAFTARAN TANAH</p>
                    <p className="text-xs mt-1">
                        Jl. Sisingamangaraja No. 2, Kebayoran Baru, Jakarta Selatan 12110
                    </p>
                    <p className="text-xs">
                        Telepon: (021) 7394409, Faksimile: (021) 7394408
                    </p>
                    <p className="text-xs">
                        Laman: www.atrbpn.go.id
                    </p>
                </div>
            </div>
        </div>
    );
}

function ArsipTable({ items, extraColumns = [] }) {
    return (
        <table className="w-full text-sm border-collapse">
            <thead>
                <tr className="bg-gray-100">
                    <th className="border p-2 text-left w-10">No</th>
                    <th className="border p-2 text-left">Kode Klasifikasi</th>
                    <th className="border p-2 text-left">Uraian Berkas</th>
                    <th className="border p-2 text-left">Kurun Waktu</th>
                    <th className="border p-2 text-left w-16">Jumlah</th>
                    {extraColumns.map(col => (
                        <th key={col.key} className="border p-2 text-left">{col.label}</th>
                    ))}
                    <th className="border p-2 text-left">Ket.</th>
                </tr>
            </thead>
            <tbody>
                {items && items.length > 0 ? (
                    items.map((item, index) => {
                        const arsip = item.arsip || item;
                        return (
                            <tr key={item.id || index}>
                                <td className="border p-2">{item.nomorUrut || index + 1}</td>
                                <td className="border p-2">{arsip.kodeKlasifikasi || '-'}</td>
                                <td className="border p-2">{arsip.uraianBerkas || arsip.uraianItem || arsip.perihalOriginal || '-'}</td>
                                <td className="border p-2">{arsip.kurunWaktu || arsip.kurunWaktuAwal || '-'}</td>
                                <td className="border p-2">{arsip.jumlah || 1} berkas</td>
                                {extraColumns.map(col => (
                                    <td key={col.key} className="border p-2">{col.render ? col.render(item, arsip) : (arsip[col.key] || '-')}</td>
                                ))}
                                <td className="border p-2">{item.keterangan || arsip.keterangan || '-'}</td>
                            </tr>
                        );
                    })
                ) : (
                    <tr>
                        <td className="border p-2 text-center" colSpan={5 + extraColumns.length + 1}>
                            Tidak ada arsip
                        </td>
                    </tr>
                )}
            </tbody>
            <tfoot>
                <tr className="font-bold">
                    <td className="border p-2 text-right" colSpan={4}>Total:</td>
                    <td className="border p-2" colSpan={2 + extraColumns.length}>{items?.length || 0} berkas</td>
                </tr>
            </tfoot>
        </table>
    );
}

function PrintDialog({ open, onOpenChange, title, children, triggerLabel = 'Cetak', triggerVariant = 'outline', triggerIcon: TriggerIcon = Printer }) {
    const handlePrint = () => { window.print(); };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button variant={triggerVariant} size="sm">
                    <TriggerIcon className="mr-2 h-4 w-4" />
                    {triggerLabel}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto print:max-w-none print:max-h-none print:overflow-visible">
                <DialogHeader className="print:hidden">
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                <div className="bg-white p-8 text-black print:p-0">
                    {children}
                </div>

                <div className="flex justify-end gap-2 mt-4 print:hidden">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Tutup
                    </Button>
                    <Button onClick={handlePrint}>
                        <Printer className="mr-2 h-4 w-4" />
                        Cetak
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ==================== SURAT DINAS PRINT ====================

export function SuratDinasPrint({ surat, type = 'keluar' }) {
    const [open, setOpen] = useState(false);

    const formatDate = (date) => {
        if (!date) return '-';
        return format(new Date(date), "d MMMM yyyy", { locale: idLocale });
    };

    return (
        <PrintDialog open={open} onOpenChange={setOpen} title="Preview Surat" triggerLabel="Cetak">
            <KopSurat />

            <div className="grid grid-cols-2 gap-4 mb-8">
                <div>
                    <table className="text-sm">
                        <tbody>
                            <tr>
                                <td className="pr-2">Nomor</td>
                                <td className="pr-2">:</td>
                                <td className="font-medium">{surat.nomorSurat || '-'}</td>
                            </tr>
                            <tr>
                                <td className="pr-2">Sifat</td>
                                <td className="pr-2">:</td>
                                <td>{surat.sifatSurat || 'Biasa'}</td>
                            </tr>
                            <tr>
                                <td className="pr-2">Lampiran</td>
                                <td className="pr-2">:</td>
                                <td>-</td>
                            </tr>
                            <tr>
                                <td className="pr-2">Hal</td>
                                <td className="pr-2">:</td>
                                <td className="font-medium">{surat.perihal || '-'}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div className="text-right">
                    <p className="text-sm">Jakarta, {formatDate(surat.tanggalSurat)}</p>
                </div>
            </div>

            <div className="mb-8">
                <p className="text-sm">Yth.</p>
                <p className="text-sm font-medium">{type === 'keluar' ? surat.kepada : surat.dari}</p>
                <p className="text-sm">di</p>
                <p className="text-sm ml-4">Tempat</p>
            </div>

            <div className="mb-8 min-h-[200px] text-sm leading-relaxed">
                <p className="text-justify">[Isi surat akan ditampilkan di sini]</p>
                {surat.keterangan && (
                    <p className="mt-4 text-justify">{surat.keterangan}</p>
                )}
            </div>

            <div className="flex justify-end mt-16">
                <div className="text-center">
                    <p className="text-sm">Direktur Jenderal</p>
                    <p className="text-sm">Penetapan Hak dan Pendaftaran Tanah</p>
                    <div className="h-20"></div>
                    <p className="text-sm font-bold underline">[Nama Pejabat]</p>
                    <p className="text-sm">NIP. [NIP Pejabat]</p>
                </div>
            </div>
        </PrintDialog>
    );
}

// ==================== BERITA ACARA PEMINDAHAN ====================

export function BeritaAcaraPemindahan({ batch, unitKerja }) {
    const [open, setOpen] = useState(false);
    const today = format(new Date(), "d MMMM yyyy", { locale: idLocale });
    const hari = format(new Date(), "EEEE", { locale: idLocale });

    return (
        <PrintDialog
            open={open}
            onOpenChange={setOpen}
            title="Berita Acara Pemindahan Arsip"
            triggerLabel="BA Pemindahan"
            triggerIcon={Download}
        >
            <div className="text-center mb-8">
                <p className="text-lg font-bold uppercase">Berita Acara</p>
                <p className="text-lg font-bold uppercase">Pemindahan Arsip</p>
                <p className="text-sm mt-2">
                    Nomor: {batch?.nomorBA || `BA-${format(new Date(), 'yyyyMMdd')}/PEMINDAHAN/${new Date().getFullYear()}`}
                </p>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Pada hari ini, {hari} tanggal {today},
                    bertempat di {unitKerja?.nama || 'Kantor Kementerian ATR/BPN'}, kami yang bertanda tangan di bawah ini:
                </p>
            </div>

            {/* Pihak yang terlibat */}
            <div className="mb-6">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="bg-gray-100">
                            <th className="border p-2 text-left">No</th>
                            <th className="border p-2 text-left">Nama</th>
                            <th className="border p-2 text-left">Jabatan</th>
                            <th className="border p-2 text-left">Keterangan</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="border p-2">1</td>
                            <td className="border p-2">[Nama Pimpinan Unit Pengolah]</td>
                            <td className="border p-2">[Jabatan]</td>
                            <td className="border p-2">Yang Menyerahkan</td>
                        </tr>
                        <tr>
                            <td className="border p-2">2</td>
                            <td className="border p-2">[Nama Pimpinan Unit Kearsipan]</td>
                            <td className="border p-2">[Jabatan]</td>
                            <td className="border p-2">Yang Menerima</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Telah melakukan pemindahan arsip dari Unit Pengolah ke Unit Kearsipan,
                    sesuai dengan ketentuan Jadwal Retensi Arsip (JRA) yang berlaku.
                    Arsip yang dipindahkan telah melewati masa retensi aktif dan memenuhi
                    persyaratan untuk dipindahkan ke Unit Kearsipan.
                </p>
                <p>Adapun arsip yang dipindahkan adalah sebagai berikut:</p>
            </div>

            <div className="mb-6">
                <ArsipTable items={batch?.items || []} />
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p>
                    Demikian Berita Acara Pemindahan Arsip ini dibuat dengan sebenarnya
                    untuk dapat dipergunakan sebagaimana mestinya.
                </p>
            </div>

            {batch?.catatanPanitia && (
                <div className="mb-4 text-sm">
                    <p className="font-medium">Catatan:</p>
                    <p>{batch.catatanPanitia}</p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-8 mt-12 text-sm text-center">
                <div>
                    <p>Yang Menyerahkan,</p>
                    <p className="font-medium">Pimpinan Unit Pengolah</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
                <div>
                    <p>Yang Menerima,</p>
                    <p className="font-medium">Pimpinan Unit Kearsipan</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
            </div>
        </PrintDialog>
    );
}

// ==================== BERITA ACARA PEMUSNAHAN ====================

export function BeritaAcaraPemusnahan({ batch, arsipList, unitKerja }) {
    const [open, setOpen] = useState(false);
    const today = format(new Date(), "d MMMM yyyy", { locale: idLocale });
    const hari = format(new Date(), "EEEE", { locale: idLocale });

    // Support both batch.items and standalone arsipList
    const items = batch?.items || (arsipList || []).map((a, i) => ({ id: a.id, nomorUrut: i + 1, arsip: a, keterangan: '' }));

    return (
        <PrintDialog
            open={open}
            onOpenChange={setOpen}
            title="Berita Acara Pemusnahan Arsip"
            triggerLabel="BA Pemusnahan"
            triggerVariant="destructive"
            triggerIcon={Download}
        >
            <div className="text-center mb-8">
                <p className="text-lg font-bold uppercase">Berita Acara</p>
                <p className="text-lg font-bold uppercase">Pemusnahan Arsip</p>
                <p className="text-sm mt-2">
                    Nomor: {batch?.nomorBA || `BA-${format(new Date(), 'yyyyMMdd')}/PEMUSNAHAN/${new Date().getFullYear()}`}
                </p>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Pada hari ini, {hari} tanggal {today},
                    bertempat di {unitKerja?.nama || 'Kantor Kementerian ATR/BPN'}, kami yang bertanda tangan di bawah ini:
                </p>
            </div>

            {/* Tim Penilai */}
            <div className="mb-6">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="bg-gray-100">
                            <th className="border p-2 text-left">No</th>
                            <th className="border p-2 text-left">Nama</th>
                            <th className="border p-2 text-left">Jabatan</th>
                            <th className="border p-2 text-left">Keterangan</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="border p-2">1</td>
                            <td className="border p-2">[Nama Ketua Tim]</td>
                            <td className="border p-2">[Jabatan]</td>
                            <td className="border p-2">Ketua</td>
                        </tr>
                        <tr>
                            <td className="border p-2">2</td>
                            <td className="border p-2">[Nama Anggota 1]</td>
                            <td className="border p-2">[Jabatan]</td>
                            <td className="border p-2">Anggota</td>
                        </tr>
                        <tr>
                            <td className="border p-2">3</td>
                            <td className="border p-2">[Nama Anggota 2]</td>
                            <td className="border p-2">[Jabatan]</td>
                            <td className="border p-2">Anggota</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Telah melakukan pemusnahan arsip yang telah melewati masa retensinya
                    sesuai dengan Jadwal Retensi Arsip (JRA) yang berlaku.
                    Adapun arsip yang dimusnahkan adalah sebagai berikut:
                </p>
            </div>

            <div className="mb-6">
                <ArsipTable items={items} />
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-2">
                    Pemusnahan arsip dilakukan dengan cara: <strong>□ Dibakar</strong> / <strong>□ Dicacah</strong> / <strong>□ Dilebur</strong> / <strong>□ Lainnya</strong>
                </p>
                <p>
                    Demikian Berita Acara ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.
                </p>
            </div>

            {batch?.catatanPanitia && (
                <div className="mb-4 text-sm">
                    <p className="font-medium">Catatan Panitia:</p>
                    <p>{batch.catatanPanitia}</p>
                </div>
            )}

            <div className="grid grid-cols-3 gap-4 mt-12 text-sm text-center">
                <div>
                    <p>Mengetahui,</p>
                    <p className="font-medium">Pimpinan Unit Kerja</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
                <div>
                    <p>Ketua Tim</p>
                    <p className="font-medium">Penilai Arsip</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
                <div>
                    <p>Pelaksana</p>
                    <p className="font-medium">Pemusnahan</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
            </div>
        </PrintDialog>
    );
}

// ==================== BERITA ACARA ALIH MEDIA ====================

export function BeritaAcaraAlihMedia({ batch, unitKerja }) {
    const [open, setOpen] = useState(false);
    const today = format(new Date(), "d MMMM yyyy", { locale: idLocale });
    const hari = format(new Date(), "EEEE", { locale: idLocale });

    const extraColumns = [
        { key: 'mediaAsal', label: 'Media Asal', render: () => 'Kertas' },
        { key: 'mediaTujuan', label: 'Media Tujuan', render: () => 'Digital' },
    ];

    return (
        <PrintDialog
            open={open}
            onOpenChange={setOpen}
            title="Berita Acara Alih Media Arsip"
            triggerLabel="BA Alih Media"
            triggerIcon={Download}
        >
            <div className="text-center mb-8">
                <p className="text-lg font-bold uppercase">Berita Acara</p>
                <p className="text-lg font-bold uppercase">Alih Media Arsip</p>
                <p className="text-sm mt-2">
                    Nomor: {batch?.nomorBA || `BA-${format(new Date(), 'yyyyMMdd')}/ALIHMEDIA/${new Date().getFullYear()}`}
                </p>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Pada hari ini, {hari} tanggal {today},
                    bertempat di {unitKerja?.nama || 'Kantor Kementerian ATR/BPN'}, kami yang bertanda tangan di bawah ini:
                </p>
            </div>

            {/* Pihak yang terlibat */}
            <div className="mb-6">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="bg-gray-100">
                            <th className="border p-2 text-left">No</th>
                            <th className="border p-2 text-left">Nama</th>
                            <th className="border p-2 text-left">Jabatan</th>
                            <th className="border p-2 text-left">Keterangan</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="border p-2">1</td>
                            <td className="border p-2">[Nama Pimpinan Unit Kearsipan]</td>
                            <td className="border p-2">[Jabatan]</td>
                            <td className="border p-2">Mengetahui</td>
                        </tr>
                        <tr>
                            <td className="border p-2">2</td>
                            <td className="border p-2">[Nama Pelaksana Alih Media]</td>
                            <td className="border p-2">[Jabatan]</td>
                            <td className="border p-2">Pelaksana</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Telah melakukan alih media terhadap arsip dari bentuk media asal ke bentuk media tujuan,
                    sesuai dengan ketentuan peraturan perundang-undangan yang berlaku. Proses alih media dilaksanakan
                    dengan memperhatikan keautentikan, keutuhan, keamanan, dan keselamatan informasi arsip.
                </p>
            </div>

            <div className="mb-6 text-sm">
                <p className="mb-1">Alih media dilakukan:</p>
                <div className="ml-4 space-y-1">
                    <p>Media Asal&emsp;&emsp;: □ Kertas &emsp; □ Mikrofilm &emsp; □ Media Lainnya: _________</p>
                    <p>Media Tujuan&emsp;: □ Digital (PDF/A) &emsp; □ Mikrofilm &emsp; □ Media Lainnya: _________</p>
                    <p>Resolusi&emsp;&emsp;&emsp;&emsp;: ___________ DPI</p>
                    <p>Format File&emsp;&emsp;: □ PDF/A &emsp; □ TIFF &emsp; □ JPEG &emsp; □ Lainnya: _________</p>
                </div>
            </div>

            <div className="mb-4 text-sm">
                <p>Adapun arsip yang telah dialih-mediakan adalah sebagai berikut:</p>
            </div>

            <div className="mb-6">
                <ArsipTable items={batch?.items || []} extraColumns={extraColumns} />
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p>
                    Hasil alih media telah diverifikasi dan dinyatakan sesuai dengan arsip asli.
                    Demikian Berita Acara Alih Media Arsip ini dibuat dengan sebenarnya
                    untuk dapat dipergunakan sebagaimana mestinya.
                </p>
            </div>

            {batch?.catatanPanitia && (
                <div className="mb-4 text-sm">
                    <p className="font-medium">Catatan:</p>
                    <p>{batch.catatanPanitia}</p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-8 mt-12 text-sm text-center">
                <div>
                    <p>Mengetahui,</p>
                    <p className="font-medium">Pimpinan Unit Kearsipan</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
                <div>
                    <p>Pelaksana Alih Media,</p>
                    <p className="font-medium">Arsiparis/Pengelola Arsip</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
            </div>
        </PrintDialog>
    );
}

// ==================== BERITA ACARA PENYERAHAN ====================

export function BeritaAcaraPenyerahan({ batch, unitKerja }) {
    const [open, setOpen] = useState(false);
    const today = format(new Date(), "d MMMM yyyy", { locale: idLocale });
    const hari = format(new Date(), "EEEE", { locale: idLocale });

    return (
        <PrintDialog
            open={open}
            onOpenChange={setOpen}
            title="Berita Acara Penyerahan Arsip Statis"
            triggerLabel="BA Penyerahan"
            triggerIcon={Download}
        >
            <div className="text-center mb-8">
                <p className="text-lg font-bold uppercase">Berita Acara</p>
                <p className="text-lg font-bold uppercase">Penyerahan Arsip Statis</p>
                <p className="text-sm mt-2">
                    Nomor: {batch?.nomorBA || `BA-${format(new Date(), 'yyyyMMdd')}/PENYERAHAN/${new Date().getFullYear()}`}
                </p>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Pada hari ini, {hari} tanggal {today},
                    bertempat di {unitKerja?.nama || 'Kantor Kementerian ATR/BPN'}, kami yang bertanda tangan di bawah ini:
                </p>
            </div>

            {/* Pihak yang terlibat */}
            <div className="mb-6 text-sm">
                <p className="font-medium mb-2">PIHAK PERTAMA (Yang Menyerahkan):</p>
                <div className="ml-4 mb-4">
                    <p>Unit Kerja: {batch?.unitKerjaId || unitKerja?.nama || '-'}</p>
                    <p>Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional</p>
                </div>
                <p className="font-medium mb-2">PIHAK KEDUA (Yang Menerima):</p>
                <div className="ml-4">
                    <p>Arsip Nasional Republik Indonesia (ANRI)</p>
                    <p>Jl. Ampera Raya No. 7, Cilandak, Jakarta Selatan</p>
                </div>
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p className="mb-4">
                    Telah dilakukan penyerahan arsip statis dari Pihak Pertama kepada Pihak Kedua,
                    sesuai dengan ketentuan peraturan perundang-undangan yang berlaku mengenai kearsipan.
                    Arsip yang diserahkan telah memenuhi kriteria sebagai arsip statis yang memiliki
                    nilai guna kesejarahan.
                </p>
                <p>Adapun arsip yang diserahkan adalah sebagai berikut:</p>
            </div>

            <div className="mb-6">
                <ArsipTable items={batch?.items || []} />
            </div>

            <div className="mb-6 text-sm leading-relaxed text-justify">
                <p>
                    Demikian Berita Acara Penyerahan Arsip Statis ini dibuat dalam rangkap 2 (dua) bermeterai cukup,
                    masing-masing mempunyai kekuatan hukum yang sama, untuk dapat dipergunakan sebagaimana mestinya.
                </p>
            </div>

            {batch?.catatanPanitia && (
                <div className="mb-4 text-sm">
                    <p className="font-medium">Catatan:</p>
                    <p>{batch.catatanPanitia}</p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-8 mt-12 text-sm text-center">
                <div>
                    <p className="font-medium">PIHAK PERTAMA,</p>
                    <p>Yang Menyerahkan</p>
                    <p>Pimpinan Unit Kearsipan</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
                <div>
                    <p className="font-medium">PIHAK KEDUA,</p>
                    <p>Yang Menerima</p>
                    <p>Kepala ANRI/Pejabat Berwenang</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline">[Nama]</p>
                    <p>NIP.</p>
                </div>
            </div>
        </PrintDialog>
    );
}

export default { SuratDinasPrint, BeritaAcaraPemindahan, BeritaAcaraPemusnahan, BeritaAcaraAlihMedia, BeritaAcaraPenyerahan };
