import React from 'react';

const Formulir4 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[297mm] mx-auto landscape:max-w-none">
            {/* Landscape A4 is best for this table */}
            <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 15mm;
          }
        }
      `}</style>

            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">DAFTAR ARSIP AKTIF</h1>
            </div>

            <div className="mb-4">
                <table className="w-full">
                    <tbody>
                        <tr>
                            <td className="w-32 font-bold">Unit Pengolah</td>
                            <td className="w-4">:</td>
                            <td className="border-b border-black border-dotted">................................................................................</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <table className="form-table w-full text-xs">
                <thead>
                    <tr>
                        <th rowSpan="2" className="w-8">No. Berkas</th>
                        <th rowSpan="2" className="w-20">Kode Klasifikasi</th>
                        <th rowSpan="2">Uraian Informasi Berkas</th>
                        <th rowSpan="2" className="w-20">Kurun Waktu Berkas</th>
                        <th rowSpan="2" className="w-16">Jumlah Berkas</th>
                        <th colSpan="4">Item Arsip</th>
                        <th rowSpan="2" className="w-20">Tingkat Perkembangan</th>
                        <th rowSpan="2" className="w-20">Lokasi Simpan</th>
                        <th rowSpan="2" className="w-20">Tingkat Klasifikasi Keamanan & Akses</th>
                        <th rowSpan="2" className="w-20">Ket.</th>
                    </tr>
                    <tr>
                        <th className="w-8">No. Item</th>
                        <th>Uraian Informasi Arsip</th>
                        <th className="w-20">Tanggal</th>
                        <th className="w-12">Jml</th>
                    </tr>
                    {/* Column Numbering inferred */}
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
                        <th>(10)</th>
                        <th>(11)</th>
                        <th>(12)</th>
                        <th>(13)</th>
                    </tr>
                </thead>
                <tbody>
                    {[...Array(8)].map((_, i) => (
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
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                        </tr>
                    ))}
                </tbody>
            </table>


            <div className="flex justify-between mt-8 text-center break-inside-avoid">
                <div className="w-1/2"></div>
                <div className="w-1/2 px-4">
                    <p className="mb-1">...................................., ....................................</p>
                    <p className="font-bold mb-16">Pimpinan Unit Pengolah<br />(Nama Jabatan)</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 4. Daftar Arsip Aktif
            </div>
        </div>
    );
};

export default Formulir4;
