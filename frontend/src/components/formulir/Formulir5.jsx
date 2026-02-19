import React from 'react';

const Formulir5 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">DAFTAR INFORMASI TEMATIK</h1>
            </div>

            <div className="mb-4 font-bold">
                Klasifikasi: ......................................................................
            </div>

            <table className="form-table w-full text-sm">
                <thead>
                    <tr>
                        <th className="w-10">No</th>
                        <th>Judul</th>
                        <th className="w-48">Pencipta Arsip</th>
                        <th className="w-48">Uraian Hasil Pengolahan</th>
                        <th className="w-32">Kurun Waktu</th>
                    </tr>
                    <tr className="italic text-xs font-normal bg-gray-100 print:bg-transparent">
                        <th>(1)</th>
                        <th>(2)</th>
                        <th>(3)</th>
                        <th>(4)</th>
                        <th>(5)</th>
                    </tr>
                </thead>
                <tbody>
                    {[...Array(10)].map((_, i) => (
                        <tr key={i} className="h-10">
                            <td className="text-center">{i + 1}</td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="mt-8 border p-4 text-xs">
                <p className="font-bold mb-2">Petunjuk Pengisian:</p>
                <ol className="list-decimal list-inside space-y-1">
                    <li><strong>Klasifikasi</strong>: Menuliskan tanda pengenal arsip yang dapat membedakan antara klasifikasi yang satu dengan klasifikasi yang lain sesuai dengan permen kode klasifikasi arsip Kementerian ATR/BPN</li>
                    <li><strong>Judul</strong>: Menuliskan judul arsip</li>
                    <li><strong>Pencipta Arsip</strong>: Menuliskan pencipta arsip</li>
                    <li><strong>Uraian Hasil Pengolahan</strong>: Menuliskan uraian hasil pengolahan, contoh: lengkap, tidak lengkap</li>
                    <li><strong>Kurun Waktu</strong>: Menuliskan tahun terciptanya arsip</li>
                </ol>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 5. Daftar Informasi Tematik
            </div>
        </div>
    );
};

export default Formulir5;
