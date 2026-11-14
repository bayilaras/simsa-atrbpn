import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Dialog konfirmasi aplikasi, pengganti window.confirm. Tombolnya berlabel
 * tindakan ("Simpan tanpa disposisi"), bukan OK/Batal bawaan browser.
 * onJawab dipanggil tepat sekali per jawaban: true untuk tombol aksi; false
 * untuk tombol batal atau Esc. Dengan wajibMemilih, Esc tidak menutup dialog
 * sehingga pengguna harus memilih salah satu tombol.
 */
export function DialogKonfirmasi({ permintaan, onJawab, terbuka = Boolean(permintaan), wajibMemilih = false }) {
    return (
        <AlertDialog open={terbuka} onOpenChange={(buka) => { if (!buka) onJawab(false) }}>
            <AlertDialogContent
                onEscapeKeyDown={wajibMemilih ? (event) => event.preventDefault() : undefined}
                onCloseAutoFocus={(event) => {
                    // Jawaban dapat memindahkan fokus (mis. ke pesan galat formulir);
                    // fokus itu tidak dikembalikan ke tombol yang membuka dialog.
                    const aktif = document.activeElement
                    if (aktif && aktif !== document.body) event.preventDefault()
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{permintaan?.judul}</AlertDialogTitle>
                    {permintaan?.pesan && (
                        <AlertDialogDescription className="whitespace-pre-line">{permintaan.pesan}</AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{permintaan?.batal || 'Batal'}</AlertDialogCancel>
                    <AlertDialogAction
                        variant={permintaan?.berbahaya ? 'destructive' : 'default'}
                        onClick={(event) => {
                            // Pemanggil yang menutup dialog; tanpa ini Radix juga
                            // memanggil onOpenChange(false) sehingga jawabannya ganda.
                            event.preventDefault()
                            onJawab(true)
                        }}
                    >
                        {permintaan?.aksi || 'Lanjutkan'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default DialogKonfirmasi
