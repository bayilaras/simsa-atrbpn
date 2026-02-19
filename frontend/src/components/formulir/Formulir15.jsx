import React from 'react';

const Formulir15 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[297mm] mx-auto landscape:max-w-none">
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
                <h1 className="text-xl font-bold uppercase">DAFTAR ARSIP USUL MUSNAH</h1>
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
                        <th className="w-8">No</th>
                        <th>Jenis Arsip</th>
                        <th className="w-24">Tahun</th>
                        <th className="w-24">Jumlah</th>
                        <th className="w-32">Tingkat Perkembangan</th>
                        <th className="w-48">Keterangan</th>
                    </tr>
                    <tr className="italic text-xs font-normal bg-gray-100 print:bg-transparent">
                        <th>(1)</th>
                        <th>(2)</th>
                        <th>(3)</th>
                        <th>(4)</th>
                        <th>(5)</th>
                        <th>(6)</th>
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
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="flex justify-between mt-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="mb-1">Mengetahui,<br />Pimpinan Unit Kearsipan</p>
                    <br /><br /><br />
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
                <div className="w-1/2 px-4">
                    <p className="mb-1">...................................., ....................................<br />Pimpinan Unit Pengolah</p>
                    <br /><br /><br />
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 15. Daftar Arsip Usul Musnah
            </div>
        </div>
    );
};

export default Formulir15;
