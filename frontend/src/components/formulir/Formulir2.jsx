import React from 'react';

const Formulir2 = () => {
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
                <h2 className="text-lg font-bold mt-2">PENGEMBALIAN ARSIP ASLI</h2>
                <p className="text-lg font-bold">SEBAGAI .......................................................</p>
            </div>

            <div className="text-justify mb-4 leading-relaxed">
                <p className="mb-4">
                    Pada hari ini ..................... tanggal ..................... bulan ..................... tahun .....................
                    dilaksanakan pengembalian Arsip asli sebagai ....................................................................
                    tanpa pendampingan dari Unit Kearsipan melalui Berita Acara Nomor ..................... tanggal .....................
                    tentang Peminjaman Arsip Asli Sebagai ..................................................... dari:
                </p>

                <div className="ml-4 mb-4">
                    <table className="w-full border-collapse border-none">
                        <tbody>
                            <tr>
                                <td className="w-24 align-top">Nama</td>
                                <td className="w-4 align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td className="align-top">NIP</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td className="align-top">Bertindak atas nama</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p className="mb-2 font-bold">Kepada:</p>

                <div className="ml-4 mb-4">
                    <table className="w-full border-collapse border-none">
                        <tbody>
                            <tr>
                                <td className="w-24 align-top">Nama</td>
                                <td className="w-4 align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td className="align-top">NIP</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                            <tr>
                                <td className="align-top">Bertindak atas nama</td>
                                <td className="align-top">:</td>
                                <td className="border-b border-black border-dotted">................................................................................</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p className="mb-4">
                    Menyatakan telah melaksanakan pengembalian Arsip asli sebagai ....................................................................................
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

            <div className="text-right text-xs mt-4 italic">
                Formulir 2. Berita Acara Pengembalian Arsip Asli Tanpa Pendampingan
            </div>
        </div>
    );
};

export default Formulir2;
