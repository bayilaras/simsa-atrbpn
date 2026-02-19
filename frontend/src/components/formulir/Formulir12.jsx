import React from 'react';

const Formulir12 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold underline">BERITA ACARA</h1>
                <h2 className="text-lg font-bold">ALIH MEDIA ARSIP</h2>
                <p className="text-lg font-bold">NOMOR: .......................................................</p>
            </div>

            <div className="text-justify mb-4 leading-relaxed">
                <p className="mb-4">
                    Pada hari ini ..................... tanggal ..................... bulan ..................... tahun .....................
                    bertempat di .................................................................., telah dilaksanakan kegiatan Alih Media Arsip
                    jenis media .................................... sebanyak ..................... (...) berkas/lembar/.....................
                    sebagaimana tercantum dalam Daftar Arsip Terlampir.
                </p>

                <p className="mb-4">
                    Pelaksanaan Alih Media Arsip dilakukan oleh:
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
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td className="w-8 align-top">2.</td>
                                <td className="w-24 align-top">Nama</td>
                                <td className="w-4 align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td colSpan="4" className="italic text-sm text-gray-600">(Dapat ditambahkan sesuai jumlah pelaksana)</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p className="mb-4">
                    Berita Acara ini dibuat dengan sesungguhnya untuk dipergunakan sebagaimana mestinya.
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

            <div className="flex justify-center mt-4 mb-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="font-bold mb-16">PIMPINAN UNIT KEARSIPAN<br />(Nama Jabatan)</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="page-break-after"></div>

            {/* Lampiran */}
            <div className="mt-8">
                <div className="text-right mb-4">
                    <p className="italic">Lampiran Berita Acara Alih Media Arsip</p>
                    <p>Nomor : ..............................</p>
                    <p>Tanggal : ..............................</p>
                </div>

                <h3 className="text-center font-bold uppercase mb-4">DAFTAR ARSIP YANG DIALIHMEDIAKAN</h3>

                <div className="mb-2">
                    <p><strong>Unit Pengolah:</strong> ................................................................</p>
                </div>

                <table className="form-table w-full text-sm">
                    <thead>
                        <tr>
                            <th className="w-10">No</th>
                            <th className="w-48">Jenis Arsip</th>
                            <th>Uraian Informasi Arsip</th>
                            <th className="w-24">Kurun Waktu</th>
                            <th className="w-20">Jumlah</th>
                            <th className="w-32">Keterangan</th>
                        </tr>
                        <tr className="italic text-xs font-normal bg-gray-100 print:bg-transparent">
                            <th>(1)</th>
                            <th>(2)</th>
                            <th>(3)</th>
                            <th>(4)</th>
                            <th>(5)</th>
                            <th>(6)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...Array(10)].map((_, i) => (
                            <tr key={i} className="h-10">
                                <td className="text-center">{i + 1}</td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="flex justify-between mt-8 text-center break-inside-avoid">
                    <div className="w-1/2"></div>
                    <div className="w-1/2 px-4">
                        <p className="font-bold mb-16">PIMPINAN UNIT KEARSIPAN<br />(Nama Jabatan)</p>
                        <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                        <p>NIP ....................................</p>
                    </div>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 12. Berita Acara Alih Media Arsip
            </div>
        </div>
    );
};

export default Formulir12;
