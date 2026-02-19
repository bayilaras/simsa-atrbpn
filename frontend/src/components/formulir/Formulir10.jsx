import React from 'react';

const Formulir10 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">DAFTAR SURVEI ARSIP INAKTIF</h1>
            </div>

            <div className="mb-4">
                <table className="w-full">
                    <tbody>
                        <tr>
                            <td className="w-48 font-bold">Pencipta Arsip</td>
                            <td className="w-4">:</td>
                            <td className="border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="font-bold">Unit Pengolah</td>
                            <td>:</td>
                            <td className="border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="font-bold">Tanggal Survei</td>
                            <td>:</td>
                            <td className="border-b border-black border-dotted">................................................................................</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <table className="form-table w-full text-xs">
                <thead>
                    <tr>
                        <th className="w-8">No</th>
                        <th>Uraian Informasi Arsip/ Masalah</th>
                        <th className="w-24">Kurun Waktu</th>
                        <th className="w-24">Media</th>
                        <th className="w-16">Jumlah<br />(Boks/ML)</th>
                        <th className="w-24">Kondisi Fisik</th>
                        <th className="w-24">Sistem Penataan</th>
                        <th className="w-24">Lokasi Simpan Saat Ini</th>
                        <th className="w-24">Ket.</th>
                    </tr>
                    <tr className="italic text-xs font-normal bg-gray-100 print:bg-transparent">
                        <th>(1)</th>
                        <th>(2)</th>
                        <th>(3)</th>
                        <th>(4)</th>
                        <th>(5)</th>
                        <th>(6)</th>
                        <th>(7)</th>
                        <th>(8)</th>
                        <th>(9)</th>
                    </tr>
                </thead>
                <tbody>
                    {[...Array(15)].map((_, i) => (
                        <tr key={i} className="h-10">
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

            <div className="mt-8">
                <p className="font-bold mb-2">Kesimpulan/Rekomendasi Survei:</p>
                <div className="border border-black p-4 h-32"></div>
            </div>

            <div className="flex justify-between mt-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="mb-1">Mengetahui,<br />Pimpinan Unit Pengolah</p>
                    <br /><br /><br />
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
                <div className="w-1/2 px-4">
                    <p className="mb-1">...................................., ....................................<br />Pelaksana Survei</p>
                    <br /><br /><br />
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 10. Survei Arsip Inaktif
            </div>
        </div>
    );
};

export default Formulir10;
