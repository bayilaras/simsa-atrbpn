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
 * Dialog konfirmasi aplikasi, pengganti window.confirm. Selalu memakai tombol
 * berlabel tindakan ("Simpan tanpa disposisi"), bukan OK/Batal bawaan browser.
 * Menutup dialog lewat Esc atau tombol batal sama dengan menjawab tidak.
 */
export function DialogKonfirmasi({ permintaan, onJawab, terbuka = Boolean(permintaan) }) {
    return (
        <AlertDialog open={terbuka} onOpenChange={(buka) => { if (!buka) onJawab(false) }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{permintaan?.judul}</AlertDialogTitle>
                    {permintaan?.pesan && (
                        <AlertDialogDescription className="whitespace-pre-line">{permintaan.pesan}</AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => onJawab(false)}>{permintaan?.batal || 'Batal'}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => onJawab(true)}
                        variant={permintaan?.berbahaya ? 'destructive' : 'default'}
                    >
                        {permintaan?.aksi || 'Lanjutkan'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default DialogKonfirmasi
