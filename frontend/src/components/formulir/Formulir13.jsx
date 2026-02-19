import React from 'react';

const Formulir13 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold underline">BERITA ACARA</h1>
                <h2 className="text-lg font-bold">PEMINDAHAN ARSIP INAKTIF</h2>
                <p className="text-lg font-bold">NOMOR: .......................................................</p>
            </div>

            <div className="text-justify mb-4 leading-relaxed">
                <p className="mb-4">
                    Pada hari ini ..................... tanggal ..................... bulan ..................... tahun .....................
                    bertempat di .................................................................., kami yang bertanda tangan di bawah ini:
                </p>

                <div className="ml-4 mb-4">
                    <table className="w-full border-collapse border-none">
                        <tbody>
                            <tr>
                                <td className="w-8 align-top">1.</td>
                                <td className="w-24 align-top">Nama</td>
                                <td className="w-4 align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">NIP</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td colSpan="3" className="pt-2">
                                    Dalam hal ini bertindak atas nama .................................................................................... (Unit Pengolah)
                                    selanjutnya disebut <strong>PIHAK PERTAMA</strong>.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="ml-4 mb-4">
                    <table className="w-full border-collapse border-none">
                        <tbody>
                            <tr>
                                <td className="w-8 align-top">2.</td>
                                <td className="w-24 align-top">Nama</td>
                                <td className="w-4 align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">NIP</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td colSpan="3" className="pt-2">
                                    Dalam hal ini bertindak atas nama .................................................................................... (Unit Kearsipan)
                                    selanjutnya disebut <strong>PIHAK KEDUA</strong>.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p className="mb-4">
                    PIHAK PERTAMA menyerahkan Arsip Inaktif kepada PIHAK KEDUA, dan PIHAK KEDUA menerima penyerahan Arsip Inaktif
                    dari PIHAK PERTAMA, sebagaimana tercantum dalam Daftar Arsip Inaktif terlampir.
                </p>

                <p className="mb-4">
                    Berita Acara ini dibuat rangkap 2 (dua) untuk masing-masing pihak.
                </p>
            </div>

            {/* Signatures */}
            <div className="flex justify-between mt-12 mb-8 text-center break-inside-avoid">
                <div className="w-1/2">
                </div>
                <div className="w-1/2 text-left ml-auto pl-24">
                    ...................................., ....................................
                </div>
            </div>

            <div className="flex justify-between mt-4 mb-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="font-bold mb-16">PIHAK KEDUA<br />(Nama Jabatan)</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
                <div className="w-1/2 px-4">
                    <p className="font-bold mb-16">PIHAK PERTAMA<br />(Nama Jabatan)</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="page-break-after"></div>

            {/* Lampiran uses Form 6 format implicitly or similar */}
            <div className="mt-8">
                <div className="text-right mb-4">
                    <p className="italic">Lampiran Berita Acara Pemindahan Arsip</p>
                    <p>Nomor : ..............................</p>
                    <p>Tanggal : ..............................</p>
                </div>

                <h3 className="text-center font-bold uppercase mb-4">DAFTAR ARSIP INAKTIF YANG DIPINDAHKAN</h3>

                <div className="mb-4">
                    <table className="w-full">
                        <tbody>
                            <tr>
                                <td className="w-32 font-bold">Unit Pengolah</td>
                                <td className="w-4">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <table className="form-table w-full text-xs">
                    <thead>
                        <tr>
                            <th className="w-8">No</th>
                            <th className="w-24">Kode Klasifikasi</th>
                            <th>Uraian Informasi Arsip/Berkas</th>
                            <th className="w-20">Kurun Waktu</th>
                            <th className="w-16">Jumlah</th>
                            <th className="w-24">Tingkat Perkembangan</th>
                            <th className="w-32">Keterangan</th>
                        </tr>
                        <tr className="italic text-xs font-normal bg-gray-100 print:bg-transparent">
                            <th>(1)</th>
                            <th>(2)</th>
                            <th>(3)</th>
                            <th>(4)</th>
                            <th>(5)</th>
                            <th>(6)</th>
                            <th>(7)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...Array(15)].map((_, i) => (
                            <tr key={i} className="h-10">
                                <td className="text-center">{i + 1}</td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 13. Berita Acara Pemindahan Arsip
            </div>
        </div>
    );
};

export default Formulir13;
