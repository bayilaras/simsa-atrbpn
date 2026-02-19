import React from 'react';

const Formulir20 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold underline">BERITA ACARA PEMUSNAHAN ARSIP</h1>
                <p className="text-lg font-bold">NOMOR: .......................................................</p>
            </div>

            <div className="text-justify mb-4 leading-relaxed">
                <p className="mb-4">
                    Pada hari ini ..................... tanggal ..................... bulan ..................... tahun .....................
                    yang bertanda tangan di bawah ini, telah melaksanakan pemusnahan arsip berdasarkan Keputusan ....................................
                    Nomor .................................... Tanggal .................................... tentang .................................... bertempat di
                    ...................................................................
                </p>

                <p className="mb-4">
                    Pemusnahan arsip dilakukan secara total dengan cara .................................... sehingga fisik dan informasi arsip musnah
                    dan tidak dapat dikenali lagi.
                </p>

                <p className="mb-4">
                    Daftar Arsip yang dimusnahkan terlampir dalam Berita Acara ini.
                </p>
            </div>

            <div className="flex justify-between mt-12 mb-8 text-center break-inside-avoid">
                <div className="w-1/2"></div>
                <div className="w-1/2 px-4">
                    <p className="mb-24">Pimpinan Unit Kearsipan,</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="mt-8">
                <h3 className="font-bold mb-4">Saksi-saksi:</h3>
                <table className="w-full ml-4">
                    <tbody>
                        <tr>
                            <td className="w-8 py-4 align-middle">1.</td>
                            <td className="w-48 py-4 align-middle">
                                <p>Nama: ....................................</p>
                                <p>Jabatan: ....................................</p>
                            </td>
                            <td className="py-4 align-middle text-left font-bold">
                                1. ....................................
                            </td>
                        </tr>
                        <tr>
                            <td className="w-8 py-4 align-middle">2.</td>
                            <td className="w-48 py-4 align-middle">
                                <p>Nama: ....................................</p>
                                <p>Jabatan: ....................................</p>
                            </td>
                            <td className="py-4 align-middle text-left font-bold">
                                2. ....................................
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="text-right text-xs mt-12 italic">
                Formulir 20. Berita Acara Pemusnahan Arsip
            </div>
        </div>
    );
};

export default Formulir20;
