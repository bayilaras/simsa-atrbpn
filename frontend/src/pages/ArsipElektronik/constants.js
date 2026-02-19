import { CheckCircle, XCircle, Clock, HardDrive, FileCheck, BarChart3 } from 'lucide-react'

export const STATUS_CONFIG = {
    pending: { label: 'Menunggu', variant: 'outline', icon: Clock, color: 'text-yellow-600' },
    verified: { label: 'Terverifikasi', variant: 'default', icon: CheckCircle, color: 'text-green-600' },
    rejected: { label: 'Ditolak', variant: 'destructive', icon: XCircle, color: 'text-red-600' },
}

export const FORMAT_OPTIONS = ['PDF/A', 'TIFF', 'JPEG', 'PNG', 'DOCX', 'XLSX']
export const MEDIA_OPTIONS = ['kertas', 'mikrofilm', 'digital', 'foto', 'video', 'audio']

export const TABS = [
    { id: 'daftar', label: 'Daftar Arsip Elektronik', icon: HardDrive },
    { id: 'verifikasi', label: 'Verifikasi', icon: FileCheck },
    { id: 'statistik', label: 'Statistik', icon: BarChart3 },
]

export const formatFileSize = (bytes) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const INITIAL_FORM = {
    arsipId: '', formatFile: 'PDF/A', ukuranFile: '', hashSHA256: '',
    resolusiDPI: '', jumlahHalaman: '', mediaAsal: 'kertas', mediaTujuan: 'digital',
    tanggalDigitalisasi: '', alatDigitalisasi: '', softwareDigitalisasi: '', catatanKonversi: '',
}
