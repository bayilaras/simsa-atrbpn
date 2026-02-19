import React from 'react';

const Formulir29 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            <div className="form-header text-center mb-6">
                <h1 className="text-xl font-bold uppercase">FORMULIR PENDATAAN ARSIP TERJAGA</h1>
            </div>

            <div className="space-y-4">
                <div className="flex items-center">
                    <label className="w-64 font-bold">1. Instansi/Unit Kerja</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 border-b border-black border-dotted">......................................................</div>
                </div>
                <div className="flex items-center">
                    <label className="w-64 font-bold">2. Alamat</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 border-b border-black border-dotted">......................................................</div>
                </div>
                <div className="flex items-center">
                    <label className="w-64 font-bold">3. No. Telepon/Fax</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 border-b border-black border-dotted">......................................................</div>
                </div>
                <div className="flex items-center">
                    <label className="w-64 font-bold">4. Unit Pengolah/Pencipta Arsip</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 border-b border-black border-dotted">......................................................</div>
                </div>

                <div className="mt-8">
                    <p className="font-bold mb-2">5. Uraian Informasi Arsip:</p>
                    <div className="border border-black min-h-[150px] p-2">
                        {/* Text Area */}
                    </div>
                </div>

                <div className="flex items-center mt-4">
                    <label className="w-64 font-bold">6. Kurun Waktu</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 border-b border-black border-dotted">......................................................</div>
                </div>

                <div className="flex items-center">
                    <label className="w-64 font-bold">7. Volume</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 border-b border-black border-dotted">......................................................</div>
                </div>
                <div className="flex items-center">
                    <label className="w-64 font-bold">8. Tingkat Perkembangan</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 flex gap-4">
                        <label><input type="checkbox" className="mr-1" /> Asli</label>
                        <label><input type="checkbox" className="mr-1" /> Tembusan</label>
                        <label><input type="checkbox" className="mr-1" /> Salinan</label>
                    </div>
                </div>
                <div className="flex items-center">
                    <label className="w-64 font-bold">9. Media Arsip</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 flex gap-4">
                        <label><input type="checkbox" className="mr-1" /> Kertas</label>
                        <label><input type="checkbox" className="mr-1" /> Foto</label>
                        <label><input type="checkbox" className="mr-1" /> Digital</label>
                        <label><input type="checkbox" className="mr-1" /> Lainnya: ...............</label>
                    </div>
                </div>
                <div className="flex items-center">
                    <label className="w-64 font-bold">10. Kondisi Fisik</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 flex gap-4">
                        <label><input type="checkbox" className="mr-1" /> Baik</label>
                        <label><input type="checkbox" className="mr-1" /> Rusak Ringan</label>
                        <label><input type="checkbox" className="mr-1" /> Rusak Berat</label>
                    </div>
                </div>
                <div className="flex items-center">
                    <label className="w-64 font-bold">11. Lokasi Simpan</label>
                    <span className="mr-2">:</span>
                    <div className="flex-1 border-b border-black border-dotted">......................................................</div>
                </div>
            </div>

            <div className="flex justify-end mt-12 mb-8 text-center break-inside-avoid">
                <div className="w-64 px-4">
                    <p className="mb-1">...................., ....................</p>
                    <p className="mb-24">Pendata/Petugas,</p>
                    <p className="border-b border-black inline-block min-w-[150px]">(Nama Lengkap)</p>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 29. Formulir Pendataan Arsip Terjaga
            </div>
        </div>
    );
};

export default Formulir29;
