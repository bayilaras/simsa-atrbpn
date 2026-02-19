import React from 'react';

const Formulir1 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold underline">BERITA ACARA</h1>
                <p className="text-lg font-bold">NOMOR: .......................................................</p>
                <h2 className="text-lg font-bold mt-2">PEMINJAMAN ARSIP ASLI</h2>
                <p className="text-lg font-bold">SEBAGAI .......................................................</p>
            </div>

            <div className="text-justify mb-4 leading-relaxed">
                <p className="mb-4">
                    Pada hari ini ..................... tanggal ..................... bulan ..................... tahun .....................
                    berdasarkan .................................... (dasar permohonan berupa Surat/Nota Dinas/sejenisnya)
                    dari .................................... Nomor ..................... tanggal .....................
                    perihal .................................................................., dilaksanakan peminjaman arsip asli sebagai
                    .................................................................. tanpa pendampingan dari Unit Kearsipan
                    dikarenakan .................................................................., yang melibatkan:
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
                                    Dalam hal ini bertindak atas nama pimpinan .................................................................................... (nama Unit Kearsipan)
                                    sebagai pihak yang menyerahkan Arsip Asli, selanjutnya disebut <strong>PIHAK PERTAMA</strong>.
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
                                    Dalam hal ini bertindak atas nama .................................................................................... (nama satuan kerja)
                                    sebagai pihak yang menerima Arsip Asli, selanjutnya disebut <strong>PIHAK KEDUA</strong>.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p className="mb-4">
                    Menyatakan telah melaksanakan serah terima peminjaman arsip asli sebagai ....................................................................................
                    tanpa pendampingan dari Unit Kearsipan seperti tercantum pada Daftar Arsip terlampir.
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

            {/* Lampiran */}
            <div className="mt-8">
                <div className="text-right mb-4">
                    <table className="inline-table text-left">
                        <tbody>
                            <tr>
                                <td>Lampiran Berita Acara</td>
                            </tr>
                            <tr>
                                <td>Nomor</td>
                                <td className="px-1">:</td>
                                <td>..............................</td>
                            </tr>
                            <tr>
                                <td>Tanggal</td>
                                <td className="px-1">:</td>
                                <td>..............................</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <h3 className="text-center font-bold uppercase mb-4">DAFTAR PEMINJAMAN ARSIP ASLI SEBAGAI ............................................................</h3>

                <table className="form-table w-full text-sm">
                    <thead>
                        <tr>
                            <th rowSpan="2" className="w-8">No</th>
                            <th rowSpan="2" className="w-24">Kode Klasifikasi</th>
                            <th rowSpan="2">Jenis Arsip/ Uraian</th>
                            <th rowSpan="2" className="w-16">Nomor Berkas</th>
                            <th rowSpan="2" className="w-20">Kurun Waktu</th>
                            <th rowSpan="2" className="w-16">Jumlah Berkas</th>
                            <th rowSpan="2" className="w-24">Tingkat Perkembangan</th>
                            <th rowSpan="2" className="w-16">Rak/ No. Boks</th>
                            <th colSpan="2">Peminjaman</th>
                            <th colSpan="2">Pengembalian</th>
                            <th rowSpan="2">Ket.</th>
                        </tr>
                        <tr>
                            <th className="w-20">Tgl</th>
                            <th className="w-12">Paraf</th>
                            <th className="w-20">Tgl</th>
                            <th className="w-12">Paraf</th>
                        </tr>
                        <tr className="italic text-xs font-normal bg-gray-100 print:bg-transparent">
                            <th>(1)</th>
                            <th>(2)</th>
                            <th>(3)</th>
                            <th>(4)</th>
                            <th>(5)</th>
                            <th>(6)</th>
                            <th>(7)</th>
                            <th>(8)</th>
                            <th>(9)</th>
                            <th>(10)</th>
                            <th>(11)</th>
                            <th>(12)</th>
                            <th>(13)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Rows for manual entry */}
                        {[...Array(5)].map((_, i) => (
                            <tr key={i} className="h-10">
                                <td className="text-center">{i + 1}</td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
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

                {/* Lampiran Signatures */}
                <div className="flex justify-between mt-12 mb-8 text-center break-inside-avoid">
                    <div className="w-1/2 px-4">
                        <p className="font-bold mb-16">Yang Menerima<br />(Pihak Kedua)<br />(Nama Jabatan)</p>
                        <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                        <p>NIP ....................................</p>
                    </div>
                    <div className="w-1/2 px-4">
                        <p className="font-bold mb-16">Yang Menyerahkan<br />(Pihak Pertama)<br />(Nama Jabatan)</p>
                        <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                        <p>NIP ....................................</p>
                    </div>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 1. Berita Acara Peminjaman Arsip Asli Tanpa Pendampingan
            </div>
        </div>
    );
};

export default Formulir1;
