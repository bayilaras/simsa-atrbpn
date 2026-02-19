import React from 'react';

const Formulir32 = () => {
    return (
        <div className="form-container bg-white p-6 max-w-[330mm] mx-auto landscape:w-full">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">DAFTAR ISI BERKAS ARSIP TERJAGA</h1>
            </div>

            <div className="mb-4">
                <table className="w-full">
                    <tbody>
                        <tr>
                            <td className="w-48 font-bold">Unit Pengolah/Pencipta</td>
                            <td className="w-4">:</td>
                            <td className="border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="w-48 font-bold">Nomor Berkas</td>
                            <td className="w-4">:</td>
                            <td className="border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="w-48 font-bold">Judul Berkas</td>
                            <td className="w-4">:</td>
                            <td className="border-b border-black border-dotted">................................................................................</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <table className="form-table w-full text-xs">
                <thead>
                    <tr>
                        <th className="w-8">No</th>
                        <th className="w-32">Nomor Item Arsip</th>
                        <th className="w-24">Kode Klasifikasi</th>
                        <th>Uraian Informasi Arsip</th>
                        <th className="w-24">Tanggal</th>
                        <th className="w-24">Jumlah</th>
                        <th className="w-32">Keterangan</th>
                    </tr>
                </thead>
                <tbody>
                    {[...Array(10)].map((_, i) => (
                        <tr key={i} className="h-12">
                            <td className="text-center">{i + 1}</td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="flex justify-end mt-8 text-center break-inside-avoid">
                <div className="w-64 px-4">
                    <p className="mb-1">...................., ....................</p>
                    <p className="mb-24">Pimpinan Unit Kearsipan,</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 32. Daftar Isi Berkas Arsip Terjaga
            </div>
        </div>
    );
};

export default Formulir32;
