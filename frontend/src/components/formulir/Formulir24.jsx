import React from 'react';

const Formulir24 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="flex justify-between mb-6">
                <div className="w-1/2">
                    <table>
                        <tbody>
                            <tr>
                                <td>Nomor</td>
                                <td className="px-2">:</td>
                                <td>..............................</td>
                            </tr>
                            <tr>
                                <td>Sifat</td>
                                <td className="px-2">:</td>
                                <td>..............................</td>
                            </tr>
                            <tr>
                                <td>Lampiran</td>
                                <td className="px-2">:</td>
                                <td>..............................</td>
                            </tr>
                            <tr>
                                <td>Hal</td>
                                <td className="px-2">:</td>
                                <td className="font-bold">Permohonan Penyerahan Arsip Statis</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div className="w-1/2 text-right">
                    <p>...................., ....................</p>
                </div>
            </div>

            <div className="mb-6">
                <p>Yth. Kepala Arsip Nasional Republik Indonesia</p>
                <p>Jl. Ampera Raya No. 7</p>
                <p>Jakarta Selatan</p>
            </div>

            <div className="text-justify mb-6 leading-relaxed">
                <p className="mb-4">
                    Sehubungan dengan amanat Undang-Undang Nomor 43 Tahun 2009 tentang Kearsipan,
                    bahwa Lembaga Negara dan Pemerintahan Daerah wajib menyerahkan arsip statis
                    kepada Arsip Nasional Republik Indonesia (ANRI).
                </p>

                <p className="mb-4">
                    Berkenaan dengan hal tersebut, bersama ini kami sampaikan Daftar Arsip Statis
                    Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional kurun waktu tahun
                    .................... s.d. .................... sebagaimana terlampir, untuk dapat dilakukan penilaian
                    dan verifikasi.
                </p>

                <p className="mb-4">
                    Sebagai bahan pertimbangan, kami lampirkan:
                </p>
                <ol className="list-decimal pl-8 mb-4">
                    <li>Daftar Arsip Statis yang Akan Diserahkan;</li>
                    <li>Surat Pertimbangan Panitia Penilai Penyusutan Arsip;</li>
                </ol>

                <p className="mt-4">
                    Demikian permohonan ini kami sampaikan. Atas perhatian dan kerja sama yang baik,
                    kami ucapkan terima kasih.
                </p>
            </div>

            <div className="flex justify-end mt-12 mb-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="font-bold mb-24">MENTERI AGRARIA DAN TATA RUANG/<br />KEPALA BADAN PERTANAHAN NASIONAL</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 24. Surat Permohonan Penyerahan Arsip Statis
            </div>
        </div>
    );
};

export default Formulir24;
