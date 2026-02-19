import React from 'react';

const Formulir17 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            {/* Kop Surat Placeholder */}
            <div className="text-center mb-4 border-b-2 border-black pb-2">
                <h2 className="text-lg font-bold">KOP SURAT</h2>
                <p className="text-sm italic text-gray-500">(Sesuaikan dengan Unit Kerja)</p>
            </div>

            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">NOTULA RAPAT<br />PANITIA PENILAI PENYUSUTAN ARSIP</h1>
            </div>

            <div className="mb-6">
                <table className="w-full">
                    <tbody>
                        <tr>
                            <td className="w-32 py-1">Hari/Tanggal</td>
                            <td className="w-4 py-1">:</td>
                            <td className="py-1 border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="py-1">Waktu</td>
                            <td className="py-1">:</td>
                            <td className="py-1 border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="py-1">Tempat</td>
                            <td className="py-1">:</td>
                            <td className="py-1 border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="py-1">Acara</td>
                            <td className="py-1">:</td>
                            <td className="py-1 border-b border-black border-dotted">................................................................................</td>
                        </tr>
                        <tr>
                            <td className="py-1">Pimpinan Rapat</td>
                            <td className="py-1">:</td>
                            <td className="py-1 border-b border-black border-dotted">................................................................................</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="mb-6">
                <h3 className="font-bold mb-2">Hadir:</h3>
                <ol className="list-decimal pl-6">
                    {[...Array(5)].map((_, i) => (
                        <li key={i} className="mb-1 border-b border-black border-dotted inline-block min-w-[300px] leading-loose">
                            &nbsp;
                        </li>
                    ))}
                </ol>
            </div>

            <div className="mb-6">
                <h3 className="font-bold mb-2">Jalannya Rapat:</h3>
                <div className="border border-black min-h-[200px] p-2">
                    {/* Space for minutes */}
                </div>
            </div>

            <div className="mb-6">
                <h3 className="font-bold mb-2">Kesimpulan:</h3>
                <div className="border border-black min-h-[100px] p-2">
                    {/* Space for conclusion */}
                </div>
            </div>

            <div className="flex justify-between mt-12 mb-8 text-center break-inside-avoid">
                <div className="w-1/2 px-4">
                    <p className="mb-16">Pimpinan Rapat/Ketua Panitia,</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
                <div className="w-1/2 px-4">
                    <p className="mb-16">Notulis/Sekretaris,</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                    <p>NIP ....................................</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 17. Notula Rapat Panitia Penilai Penyusutan Arsip
            </div>
        </div>
    );
};

export default Formulir17;
