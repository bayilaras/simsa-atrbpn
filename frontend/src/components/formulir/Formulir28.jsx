import React from 'react';

const Formulir28 = () => {
    return (
        <div className="form-container bg-white p-8 max-w-[210mm] mx-auto">
            <div className="form-header text-center mb-8">
                <h1 className="text-xl font-bold uppercase underline">KARTU TUNJUK SILANG</h1>
            </div>

            <div className="border-2 border-black p-6 relative min-h-[400px]">
                {/* Top Right Code Box */}
                <div className="absolute top-6 right-6 border border-black w-32 h-12 flex items-center justify-center">
                    (KODE KLASIFIKASI)
                </div>

                <div className="mt-8 space-y-6">
                    <div className="flex">
                        <span className="w-32 font-bold uppercase">Masalah/Hal</span>
                        <span className="mx-2">:</span>
                        <div className="border-b border-black w-full text-center">...........................................................................</div>
                    </div>

                    <div className="flex">
                        <span className="w-32 font-bold uppercase">Indeks</span>
                        <span className="mx-2">:</span>
                        <div className="border-b border-black w-full text-center">...........................................................................</div>
                    </div>

                    <div className="flex">
                        <span className="w-32 font-bold uppercase">Lihat</span>
                        <span className="mx-2">:</span>
                        <div className="border-b border-black w-full text-center">...........................................................................</div>
                        <span className="mx-2 text-sm italic">(Sebutkan indeks berkas yang tunjuk silang)</span>
                    </div>

                    <div className="flex">
                        <span className="w-32 font-bold uppercase">Kode</span>
                        <span className="mx-2">:</span>
                        <div className="border-b border-black w-full text-center">...........................................................................</div>
                    </div>
                </div>
            </div>

            <div className="text-right text-xs mt-4 italic">
                Formulir 28. Kartu Tunjuk Silang
            </div>
        </div>
    );
};

export default Formulir28;
