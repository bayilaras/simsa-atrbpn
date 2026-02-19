import React from 'react';

const Formulir9 = () => {
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

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">DAFTAR ARSIP INAKTIF VIDEO DAN FILM (MOVING IMAGE)</h1>
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
                    </tbody>
                </table>
            </div>

            <table className="form-table w-full text-xs">
                <thead>
                    <tr>
                        <th className="w-8">No</th>
                        <th className="w-24">Kode Klasifikasi</th>
                        <th>Uraian Informasi Video/Film</th>
                        <th className="w-20">Kurun Waktu</th>
                        <th className="w-24">Ukuran/ Format</th>
                        <th className="w-20">Durasi</th>
                        <th className="w-16">Jumlah</th>
                        <th className="w-32">Lokasi Simpan</th>
                        <th className="w-24">Keamanan & Akses</th>
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
                        <th>(10)</th>
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
                Formulir 9. Daftar Arsip Inaktif Video dan Film (Moving Image)
            </div>
        </div>
    );
};

export default Formulir9;
