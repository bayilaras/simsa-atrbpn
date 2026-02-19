import React from 'react';

const Formulir30 = () => {
    return (
        <div className="form-container bg-white p-6 max-w-[330mm] mx-auto landscape:w-full">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">DAFTAR IDENTIFIKASI ARSIP TERJAGA</h1>
            </div>

            <table className="form-table w-full text-xs">
                <thead>
                    <tr>
                        <th className="w-8">No</th>
                        <th>Jenis Arsip Terjaga</th>
                        <th className="w-32">Unit Pencipta</th>
                        <th className="w-24">Kurun Waktu</th>
                        <th className="w-24">Media</th>
                        <th className="w-16">Jumlah</th>
                        <th className="w-32">Kondisi</th>
                        <th className="w-32">Lokasi Simpan</th>
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
                            <td></td>
                            <td></td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="flex justify-end mt-8 text-center break-inside-avoid">
                <div className="w-64 px-4">
                    <p className="mb-1">...................., ....................</p>
                    <p className="mb-24">Mengetahui,<br />Pimpinan Unit Kearsipan/Ketua Tim</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 30. Daftar Identifikasi Arsip Terjaga
            </div>
        </div>
    );
};

export default Formulir30;
