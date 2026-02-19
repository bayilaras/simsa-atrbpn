import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from 'react-router-dom';

const forms = [
    { id: 1, name: "Formulir 1: Berita Acara Peminjaman Arsip Asli Tanpa Pendampingan" },
    { id: 2, name: "Formulir 2: Berita Acara Pengembalian Arsip Asli Tanpa Pendampingan" },
    { id: 3, name: "Formulir 3: Surat Pernyataan Menghilangkan/Merusak Arsip" },
    { id: 4, name: "Formulir 4: Daftar Arsip Aktif" },
    { id: 5, name: "Formulir 5: Daftar Informasi Tematik" },
    { id: 6, name: "Formulir 6: Daftar Arsip Inaktif (Kertas)" },
    { id: 7, name: "Formulir 7: Daftar Arsip Inaktif (Foto)" },
    { id: 8, name: "Formulir 8: Daftar Arsip Inaktif (Sound Recording)" },
    { id: 9, name: "Formulir 9: Daftar Arsip Inaktif Video dan Film (Moving Image)" },
    { id: 10, name: "Formulir 10: Survei Arsip Inaktif" },
    { id: 11, name: "Formulir 11: Daftar Ikhtisar Arsip" },
    { id: 12, name: "Formulir 12: Berita Acara Alih Media Arsip" },
    { id: 13, name: "Formulir 13: Berita Acara Pemindahan Arsip" },
    { id: 14, name: "Formulir 14: Surat Keputusan Pembentukan Panitia Penilai Penyusutan Arsip" },
    { id: 15, name: "Formulir 15: Daftar Arsip Usul Musnah" },
    { id: 16, name: "Formulir 16: Undangan Rapat Pembahasan Pemusnahan Arsip" },
    { id: 17, name: "Formulir 17: Notula Rapat Panitia Penilai Penyusutan Arsip" },
    { id: 18, name: "Formulir 18: Pertimbangan Panitia Penilai Penyusutan Arsip" },
    { id: 19, name: "Formulir 19: Surat Keputusan Penetapan Pemusnahan Arsip" },
    { id: 20, name: "Formulir 20: Berita Acara Pemusnahan Arsip" },
    { id: 21, name: "Formulir 21: Daftar Arsip Usul Serah" },
    { id: 22, name: "Formulir 22: Daftar Arsip Statis yang akan Diserahkan" },
    { id: 23, name: "Formulir 23: Pertimbangan Panitia Penyusutan Arsip" },
    { id: 24, name: "Formulir 24: Surat Permohonan Penyerahan Arsip Statis" },
    { id: 25, name: "Formulir 25: Surat Keputusan Penetapan Penyerahan Arsip Statis" },
    { id: 26, name: "Formulir 26: Undangan untuk Menandatangani Berita Acara Penyerahan Arsip Statis" },
    { id: 27, name: "Formulir 27: Daftar Arsip Vital" },
    { id: 28, name: "Formulir 28: Kartu Tunjuk Silang" },
    { id: 29, name: "Formulir 29: Formulir Pendataan Arsip Terjaga" },
    { id: 30, name: "Formulir 30: Daftar Identifikasi Arsip Terjaga" },
    { id: 31, name: "Formulir 31: Daftar Berkas Arsip Terjaga" },
    { id: 32, name: "Formulir 32: Daftar Isi Berkas Arsip Terjaga" },
    { id: 33, name: "Formulir 33: Berita Acara Penyerahan Salinan Autentik Arsip Terjaga" },
];

const FormulirIndex = () => {
    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Formulir Standar Kearsipan</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {forms.map((form) => (
                    <Card key={form.id} className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle className="text-lg">{form.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Link to={`/formulir/cetak/${form.id}`} target="_blank">
                                <Button className="w-full">
                                    Buka Formulir
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};

export default FormulirIndex;
