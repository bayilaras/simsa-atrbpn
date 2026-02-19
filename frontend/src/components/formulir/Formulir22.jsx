import React from 'react';

const Formulir22 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">DAFTAR ARSIP STATIS YANG AKAN DISERAHKAN</h1>
            </div>

            <div className="mb-4">
                {/* No specific header fields mentioned in the text for this form, but implied context */}
            </div>

            <table className="form-table w-full text-xs">
                <thead>
                    <tr>
                        <th className="w-8">No</th>
                        <th className="w-24">Kode Klasifikasi</th>
                        <th>Uraian Informasi Arsip</th>
                        <th className="w-24">Kurun Waktu</th>
                        <th className="w-24">Jumlah</th>
                        <th className="w-32">Keterangan</th>
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

            <div className="flex justify-end mt-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="mb-1">...................................., ....................................</p>
                    <p className="mb-1">Nama Jabatan,</p>
                    <br /><br /><br />
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 22. Daftar Arsip Statis yang akan Diserahkan
            </div>
        </div>
    );
};

export default Formulir22;
