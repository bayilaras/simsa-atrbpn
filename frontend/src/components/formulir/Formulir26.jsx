import React from 'react';

const Formulir26 = () => {
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
                                <td className="font-bold">Undangan Penandatanganan Berita Acara Penyerahan Arsip Statis</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div className="w-1/2 text-right">
                    <p>...................., ....................</p>
                </div>
            </div>

            <div className="mb-6">
                <p>Yth. ....................................................</p>
                <p>di Tempat</p>
            </div>

            <div className="text-justify mb-6 leading-relaxed">
                <p className="mb-4">
                    Sehubungan dengan pelaksanaan penyerahan arsip statis Kementerian Agraria dan Tata
                    Ruang/Badan Pertanahan Nasional kepada Arsip Nasional Republik Indonesia, dan berdasarkan
                    Surat Keputusan penetapan penyerahan arsip statis Nomor .................................... tanggal
                    ...................................., kami mengharap kehadiran Saudara pada:
                </p>

                <table className="w-full ml-8 mb-4">
                    <tbody>
                        <tr>
                            <td className="w-32 py-1">Hari/Tanggal</td>
                            <td className="w-4 py-1">:</td>
                            <td className="py-1">......................................................................</td>
                        </tr>
                        <tr>
                            <td className="py-1">Pukul</td>
                            <td className="py-1">:</td>
                            <td className="py-1">.................... s.d ....................</td>
                        </tr>
                        <tr>
                            <td className="py-1">Tempat</td>
                            <td className="py-1">:</td>
                            <td className="py-1">......................................................................</td>
                        </tr>
                        <tr>
                            <td className="py-1">Acara</td>
                            <td className="py-1">:</td>
                            <td className="py-1">Penandatanganan Berita Acara Penyerahan Arsip Statis</td>
                        </tr>
                    </tbody>
                </table>

                <p>
                    Atas perhatian dan kerja sama Saudara, kami ucapkan terima kasih.
                </p>
            </div>

            <div className="flex justify-end mt-12 mb-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="font-bold mb-24">PIMPINAN PENCIPTA ARSIP,</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 26. Undangan untuk Menandatangani Berita Acara Penyerahan Arsip Statis
            </div>
        </div>
    );
};

export default Formulir26;
