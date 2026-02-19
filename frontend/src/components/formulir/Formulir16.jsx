import React from 'react';

const Formulir16 = () => {
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
                                <td className="font-bold">Undangan Rapat Pembahasan Pemusnahan Arsip</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div className="w-1/2 text-right">
                    <p>...................., ....................</p>
                </div>
            </div>

            <div className="mb-6">
                <p>Yth. Anggota Panitia Penilai Penyusutan Arsip</p>
                <p>di Tempat</p>
            </div>

            <div className="text-justify mb-6 leading-relaxed">
                <p className="mb-4">
                    Sehubungan dengan rencana kegiatan pemusnahan arsip dan berdasarkan Surat Keputusan
                    ............................................................ Nomor .................................... tanggal ....................................,
                    bersama ini kami mengundang Bapak/Ibu/Saudara untuk hadir dalam rapat pembahasan
                    penilaian penyusutan arsip (Daftar Arsip Usul Musnah) yang akan dilaksanakan pada:
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
                            <td className="py-1">Pembahasan Daftar Arsip Usul Musnah</td>
                        </tr>
                    </tbody>
                </table>

                <p>
                    Mengingat pentingnya acara tersebut, kami mengharapkan kehadiran Bapak/Ibu/Saudara
                    tepat pada waktunya.
                </p>
                <p className="mt-4">
                    Atas perhatian dan kerja sama Bapak/Ibu/Saudara, kami ucapkan terima kasih.
                </p>
            </div>

            <div className="flex justify-end mt-12 mb-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="font-bold mb-16">PIMPINAN UNIT KEARSIPAN<br />(Selaku Ketua Panitia)</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 16. Undangan Rapat Pembahasan Pemusnahan Arsip
            </div>
        </div>
    );
};

export default Formulir16;
