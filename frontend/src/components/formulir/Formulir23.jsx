import React from 'react';

const Formulir23 = () => {
    return (
        <div className="form-container bg-white p-12 max-w-[210mm] mx-auto">
            <div className="text-center mb-6 font-bold uppercase">
                <h1 className="text-lg">SURAT PERTIMBANGAN</h1>
                <h2 className="text-md">PANITIA PENILAI PENYUSUTAN ARSIP</h2>
                <p className="text-md">KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL/</p>
                <p className="text-md">KANTOR WILAYAH/KANTOR PERTANAHAN</p>
            </div>

            <div className="text-justify mb-6 leading-relaxed">
                <p className="mb-4">
                    Berdasarkan Surat Keputusan Menteri Agraria dan Tata Ruang/Kepala Badan
                    Pertanahan Nasional/Kepala Kantor Wilayah/Kepala Kantor Pertanahan
                    Nomor ...................................... tanggal ................... tentang Penunjukan
                    Panitia Penilai Penyusutan Arsip di lingkungan Kementerian Agraria dan Tata
                    Ruang/Badan Pertanahan Nasional/Kantor Wilayah/Kantor Pertanahan dan
                    Hasil Penilaian terhadap daftar arsip usul serah Kementerian Agraria dan Tata
                    Ruang/Badan Pertanahan Nasional/Kantor Wilayah/Kantor Pertanahan pada:
                </p>

                <table className="w-full ml-4 mb-4">
                    <tbody>
                        <tr>
                            <td className="w-32">Hari/Tanggal</td>
                            <td className="w-4">:</td>
                            <td>............................................................</td>
                        </tr>
                        <tr>
                            <td>Waktu</td>
                            <td>:</td>
                            <td>............................................................</td>
                        </tr>
                        <tr>
                            <td>Tempat</td>
                            <td>:</td>
                            <td>............................................................</td>
                        </tr>
                        <tr>
                            <td>Acara</td>
                            <td>:</td>
                            <td>............................................................</td>
                        </tr>
                    </tbody>
                </table>

                <p className="mb-4">
                    memberikan pertimbangan/pendapat bahwa arsip yang terdapat dalam Daftar
                    Arsip Yang Diserahkan dapat diputuskan untuk diserahkan kepada lembaga kearsipan,
                    dengan pertimbangan sebagai berikut:
                </p>

                <ol className="list-decimal pl-6 mb-4">
                    <li>Memiliki nilai guna kesejarahan;</li>
                    <li>Telah habis retensinya; dan/atau</li>
                    <li>Berketerangan dipermanenkan sesuai JRA.</li>
                </ol>

                <p className="mb-4">
                    Demikian pertimbangan/pendapat ini dibuat dengan penuh rasa tanggung
                    jawab dan agar bisa digunakan sebagai bahan pertimbangan Menteri Agraria
                    dan Tata Ruang/Kepala Badan Pertanahan Nasional/Kepala Kantor
                    Wilayah/Kepala Kantor Pertanahan dalam membuat Keputusan Penyerahan Arsip Statis.
                </p>
            </div>

            <div className="flex justify-end mb-8">
                <p>...................................., ....................................</p>
            </div>

            {/* Signatures */}
            <div className="flex justify-between mt-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="mb-24">Ketua Panitia</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
                <div className="w-1/2 px-4">
                    <p className="mb-24">Sekretaris Panitia</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-12 italic">
                Formulir 23. Pertimbangan Panitia Penyusutan Arsip
            </div>
        </div>
    );
};

export default Formulir23;
