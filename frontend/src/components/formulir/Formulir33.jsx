import React from 'react';

const Formulir33 = () => {
    return (
        <div className="form-container bg-white p-12 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="text-center mb-8 font-bold uppercase">
                <h1 className="text-xl underline">BERITA ACARA</h1>
                <h2 className="text-lg">PENYERAHAN SALINAN AUTENTIK ARSIP TERJAGA</h2>
                <p className="mt-2">NOMOR : ....................................................</p>
            </div>

            <div className="text-justify mb-6 leading-relaxed">
                <p className="mb-4">
                    Pada hari ini ..................... tanggal ..................... bulan ..................... tahun .....................,
                    yang bertanda tangan di bawah ini:
                </p>

                <div className="ml-4 mb-4">
                    <table className="w-full">
                        <tbody>
                            <tr>
                                <td className="w-8 align-top">1.</td>
                                <td className="w-24 align-top">Nama</td>
                                <td className="w-4 align-top">:</td>
                                <td className="align-top">....................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">NIP</td>
                                <td className="align-top">:</td>
                                <td className="align-top">....................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="align-top">....................................................</td>
                            </tr>
                        </tbody>
                    </table>
                    <p className="mt-2">
                        Dalam hal ini bertindak untuk dan atas nama Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional,
                        selanjutnya disebut <strong>Pihak Pertama</strong>.
                    </p>
                </div>

                <div className="ml-4 mb-4">
                    <table className="w-full">
                        <tbody>
                            <tr>
                                <td className="w-8 align-top">2.</td>
                                <td className="w-24 align-top">Nama</td>
                                <td className="w-4 align-top">:</td>
                                <td className="align-top">....................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">NIP</td>
                                <td className="align-top">:</td>
                                <td className="align-top">....................................................</td>
                            </tr>
                            <tr>
                                <td></td>
                                <td className="align-top">Jabatan</td>
                                <td className="align-top">:</td>
                                <td className="align-top">....................................................</td>
                            </tr>
                        </tbody>
                    </table>
                    <p className="mt-2">
                        Dalam hal ini bertindak untuk dan atas nama Arsip Nasional Republik Indonesia (ANRI),
                        selanjutnya disebut <strong>Pihak Kedua</strong>.
                    </p>
                </div>

                <p className="mb-4">
                    Menyatakan telah melakukan penyerahan arsip terjaga seperti yang tercantum dalam Daftar Penyerahan
                    Arsip Terjaga terlampir untuk disimpan di ANRI sesuai dengan peraturan perundang-undangan.
                </p>
            </div>

            <div className="flex justify-end mb-8">
                <p>...................................., ....................................</p>
            </div>

            <div className="flex justify-between mt-8 text-center break-inside-avoid px-4">
                <div className="w-1/2">
                    <p className="font-bold mb-24">PIHAK PERTAMA<br />Pimpinan Pencipta Arsip</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
                <div className="w-1/2">
                    <p className="font-bold mb-24">PIHAK KEDUA<br />Kepala ANRI</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-12 italic">
                Formulir 33. Berita Acara Penyerahan Salinan Autentik Arsip Terjaga
            </div>
        </div>
    );
};

export default Formulir33;
