import React from 'react';

const Formulir25 = () => {
    return (
        <div className="form-container bg-white p-12 max-w-[210mm] mx-auto">
            <div className="text-center mb-6">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
            </div>

            <div className="text-center mb-8 font-bold uppercase">
                <p>KEPUTUSAN MENTERI AGRARIA DAN TATA RUANG/<br />KEPALA BADAN PERTANAHAN NASIONAL</p>
                <p className="mt-2">NOMOR ................................</p>
                <p className="mt-4">TENTANG</p>
                <p className="mt-2">PENETAPAN PENYERAHAN ARSIP STATIS KEMENTERIAN AGRARIA DAN TATA RUANG/<br />BADAN PERTANAHAN NASIONAL TAHUN ....................</p>
            </div>

            <div className="text-center mb-8 font-bold uppercase">
                <p>MENTERI AGRARIA DAN TATA RUANG/KEPALA BADAN PERTANAHAN NASIONAL,</p>
            </div>

            <div className="mb-4 text-justify leading-relaxed">
                <table className="w-full align-top">
                    <tbody>
                        <tr>
                            <td className="w-24 font-bold align-top">Menimbang</td>
                            <td className="w-4 align-top">:</td>
                            <td className="align-top">
                                <ol className="list-lower-alpha pl-4">
                                    <li className="mb-2">bahwa dalam rangka penyelamatan arsip statis sebagai memori kolektif bangsa, perlu dilakukan penyerahan arsip statis Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional kepada Arsip Nasional Republik Indonesia;</li>
                                    <li className="mb-2">bahwa berdasarkan Persetujuan Kepala Arsip Nasional Republik Indonesia Nomor .................... tanggal .................... hal ...................., perlu menetapkan arsip statis yang akan diserahkan;</li>
                                    <li>bahwa berdasarkan pertimbangan sebagaimana dimaksud dalam huruf a dan huruf b, perlu menetapkan Keputusan Menteri Agraria dan Tata Ruang/Kepala Badan Pertanahan Nasional tentang Penetapan Penyerahan Arsip Statis Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional Tahun ....................;</li>
                                </ol>
                            </td>
                        </tr>
                        <tr>
                            <td className="font-bold align-top pt-4">Mengingat</td>
                            <td className="align-top pt-4">:</td>
                            <td className="align-top pt-4">
                                <ol className="list-decimal pl-4">
                                    <li className="mb-2">Undang-Undang Nomor 43 Tahun 2009 tentang Kearsipan...;</li>
                                    <li className="mb-2">Peraturan Pemerintah Nomor 28 Tahun 2012 tentang Pelaksanaan Undang-Undang Nomor 43 Tahun 2009 tentang Kearsipan...;</li>
                                    <li>Peraturan Menteri Agraria dan Tata Ruang/Kepala Badan Pertanahan Nasional Nomor 2 Tahun 2026...;</li>
                                </ol>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="text-center my-6 font-bold">
                MEMUTUSKAN:
            </div>

            <div className="mb-4 text-justify leading-relaxed">
                <table className="w-full align-top">
                    <tbody>
                        <tr>
                            <td className="w-24 font-bold align-top">Menetapkan</td>
                            <td className="w-4 align-top">:</td>
                            <td className="align-top uppercase font-bold">
                                KEPUTUSAN MENTERI AGRARIA DAN TATA RUANG/KEPALA BADAN PERTANAHAN NASIONAL TENTANG PENETAPAN PENYERAHAN ARSIP STATIS KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL TAHUN ....................
                            </td>
                        </tr>
                        <tr>
                            <td className="font-bold align-top pt-4">KESATU</td>
                            <td className="align-top pt-4">:</td>
                            <td className="align-top pt-4">
                                Menetapkan penyerahan arsip statis Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional kurun waktu tahun .................... s.d. .................... sejumlah .................... berkas sebagaimana tercantum dalam Daftar Arsip Statis yang Diserahkan yang merupakan bagian tidak terpisahkan dari Keputusan ini.
                            </td>
                        </tr>
                        <tr>
                            <td className="font-bold align-top pt-4">KEDUA</td>
                            <td className="align-top pt-4">:</td>
                            <td className="align-top pt-4">
                                Arsip statis sebagaimana dimaksud dalam Diktum KESATU diserahkan kepada Arsip Nasional Republik Indonesia.
                            </td>
                        </tr>
                        <tr>
                            <td className="font-bold align-top pt-4">KETIGA</td>
                            <td className="align-top pt-4">:</td>
                            <td className="align-top pt-4">
                                Keputusan ini mulai berlaku sejak tanggal ditetapkan.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="flex justify-end mt-12 mb-8 text-left">
                <div className="w-1/2">
                    <p className="mb-1">Ditetapkan di Jakarta</p>
                    <p className="mb-8">pada tanggal ....................................</p>

                    <p className="font-bold mb-24">MENTERI AGRARIA DAN TATA RUANG/<br />KEPALA BADAN PERTANAHAN NASIONAL,</p>

                    <p className="border-b border-black inline-block min-w-[150px] font-bold">NAMA LENGKAP</p>
                </div>
            </div>

            <div className="text-right text-xs mt-12 italic">
                Formulir 25. Surat Keputusan Penetapan Penyerahan Arsip Statis
            </div>
        </div>
    );
};

export default Formulir25;
