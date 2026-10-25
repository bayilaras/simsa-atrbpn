export function SuratRetentionSummary({ surat }) {
    return (
        <section aria-label="Jadwal Retensi Arsip" className="space-y-2 rounded-lg border p-3">
            <h3 className="text-sm font-semibold">Jadwal Retensi Arsip</h3>
            {surat.jraKode ? <>
                <p className="text-sm"><span className="font-mono">{surat.jraKode}</span>{surat.jraUraian && ` — ${surat.jraUraian}`}</p>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">Retensi aktif</dt><dd>{surat.jraRetensiAktif === '' ? '—' : surat.jraRetensiAktif ?? '—'}</dd></div>
                    <div><dt className="text-muted-foreground">Retensi inaktif</dt><dd>{surat.jraRetensiInaktif === '' ? '—' : surat.jraRetensiInaktif ?? '—'}</dd></div>
                    <div><dt className="text-muted-foreground">Keterangan JRA</dt><dd>{surat.jraKeterangan || '—'}</dd></div>
                </dl>
                <p className="text-xs text-muted-foreground">Pasangan aturan ini diteruskan ke arsip saat pemberkasan. Jadwal pelaksanaan retensi mengikuti pemicu dan proses penilaian pada siklus hidup arsip.</p>
            </> : <p className="text-sm text-muted-foreground">JRA belum ditetapkan. Lengkapi pasangan klasifikasi dan JRA sebelum pemberkasan arsip.</p>}
        </section>
    )
}
