import React from 'react';

const Formulir19 = () => {
    return (
        <div className="form-container bg-white p-12 max-w-[210mm] mx-auto">
            <div className="text-center mb-6">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
            </div>

            <div className="text-center mb-8 font-bold uppercase">
                <p>KEPUTUSAN MENTERI AGRARIA DAN TATA RUANG/<br />KEPALA BADAN PERTANAHAN NASIONAL/<br />KEPALA KANTOR WILAYAH/KEPALA KANTOR PERTANAHAN</p>
                <p className="mt-2">NOMOR ................................</p>
                <p className="mt-4">TENTANG</p>
                <p className="mt-2">PEMUSNAHAN ARSIP PADA ........................................................</p>
            </div>

            <div className="text-center mb-8 font-bold uppercase">
                <p>MENTERI AGRARIA DAN TATA RUANG/KEPALA BADAN PERTANAHAN NASIONAL/<br />KEPALA KANTOR WILAYAH/KEPALA KANTOR PERTANAHAN,</p>
            </div>

            <div className="mb-4 text-justify leading-relaxed">
                <table className="w-full align-top">
                    <tbody>
                        <tr>
                            <td className="w-24 font-bold align-top">Menimbang</td>
                            <td className="w-4 align-top">:</td>
                            <td className="align-top">
                                <ol className="list-lower-alpha pl-4">
                                    <li className="mb-2">bahwa arsip yang tercipta dalam pelaksanaan tugas dan fungsi Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional/Kantor Wilayah/Kantor Pertanahan yang sudah tidak memiliki nilai guna, telah habis retensinya, dan berketerangan musnah berdasarkan Jadwal Retensi Arsip perlu dilakukan pemusnahan;</li>
                                    <li className="mb-2">bahwa berdasarkan penilaian Panitia Penilai Penyusutan Arsip sebagaimana tercantum dalam Berita Acara .................... dan Surat Pertimbangan Panitia Penilai Penyusutan Arsip ...................., arsip sebagaimana dimaksud dalam huruf a telah memenuhi syarat untuk dimusnahkan;</li>
                                    <li>bahwa berdasarkan pertimbangan sebagaimana dimaksud dalam huruf a dan huruf b, perlu menetapkan Keputusan tentang Pemusnahan Arsip pada ....................................;</li>
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
                                    <li className="mb-2 italic">(Tambahkan dasar hukum lain yang relevan)</li>
                                </ol>
                            </td>
                        </tr>
                        <tr>
                            <td className="font-bold align-top pt-4">Memperhatikan</td>
                            <td className="align-top pt-4">:</td>
                            <td className="align-top pt-4">
                                Surat Persetujuan Kepala ANRI Nomor .................... Tanggal .................... Hal Persetujuan Pemusnahan Arsip.
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
                                KEPUTUSAN .................................................... TENTANG PEMUSNAHAN ARSIP PADA ....................................................
                            </td>
                        </tr>
                        <tr>
                            <td className="font-bold align-top pt-4">KESATU</td>
                            <td className="align-top pt-4">:</td>
                            <td className="align-top pt-4">
                                Menetapkan pemusnahan arsip pada .................................... sebagaimana tercantum dalam Daftar Arsip Musnah yang merupakan bagian tidak terpisahkan dari Keputusan ini.
                            </td>
                        </tr>
                        <tr>
                            <td className="font-bold align-top pt-4">KEDUA</td>
                            <td className="align-top pt-4">:</td>
                            <td className="align-top pt-4">
                                Pemusnahan arsip sebagaimana dimaksud dalam Diktum KESATU dilaksanakan secara total sehingga fisik dan informasi arsip musnah dan tidak dapat dikenali lagi.
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
                    <p className="mb-1">Ditetapkan di ....................................</p>
                    <p className="mb-8">pada tanggal ....................................</p>

                    <p className="font-bold mb-24">a.n. MENTERI AGRARIA DAN TATA RUANG/<br />KEPALA BADAN PERTANAHAN NASIONAL/<br />KEPALA KANTOR WILAYAH/<br />KEPALA KANTOR PERTANAHAN</p>

                    <p className="border-b border-black inline-block min-w-[150px] font-bold">NAMA LENGKAP</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-12 italic">
                Formulir 19. Surat Keputusan Penetapan Pemusnahan Arsip
            </div>
        </div>
    );
};

export default Formulir19;
