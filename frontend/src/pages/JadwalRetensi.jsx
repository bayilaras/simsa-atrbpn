import { useState, useEffect, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronRight, ChevronDown, Search, Plus, Edit2, Trash2, Clock, Loader2, FileText, FolderOpen, AlertCircle, CheckCircle2, Archive, Trash, Info } from 'lucide-react'
import { api } from '@/services/api'
import { Skeleton } from "@/components/ui/skeleton"

// Tree Node Component for JRA
function TreeNode({ node, level = 0, onEdit, onDelete }) {
    const [isOpen, setIsOpen] = useState(level < 1)
    const hasChildren = node.children && node.children.length > 0

    return (
        <div className="select-none animate-in fade-in slide-in-from-left-2 duration-300">
            <div
                className={`flex items-center gap-2 py-3 px-3 border-b border-border/50 hover:bg-muted/50 group transition-all
          ${level === 0 ? 'bg-muted/30 font-semibold' : ''}`}
                style={{ paddingLeft: `${level * 24 + 12}px` }}
            >
                <div className="w-5 flex justify-center shrink-0">
                    {hasChildren ? (
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            className="p-0.5 hover:bg-muted rounded-sm transition-colors"
                        >
                            {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>
                    ) : (
                        <span className="w-4" />
                    )}
                </div>

                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-background/50">
                    {node.kode}
                </Badge>

                <span className="flex-1 text-sm truncate font-medium text-foreground/90" title={node.uraian}>
                    {node.uraian}
                </span>

                <div className="flex items-center gap-2 shrink-0">
                    {node.retensiAktif && (
                        <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded">
                            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                            Aktif: {node.retensiAktif}
                        </div>
                    )}

                    {node.retensiInaktif && (
                        <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded">
                            <span className="w-2 h-2 rounded-full bg-orange-400"></span>
                            Inaktif: {node.retensiInaktif}
                        </div>
                    )}

                    {node.keterangan && node.keterangan !== '' && (
                        <Badge
                            variant={node.keterangan.toLowerCase().includes('permanen') ? 'default' : 'secondary'}
                            className={`text-[10px] ${node.keterangan.toLowerCase().includes('permanen') ? 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200' : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-200'}`}
                        >
                            {node.keterangan}
                        </Badge>
                    )}
                </div>

                <div className="flex gap-1 shrink-0 ml-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-blue-50 dark:hover:bg-blue-500/15 hover:text-blue-600 dark:hover:text-blue-400" onClick={() => onEdit(node)}>
                        <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(node)}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {hasChildren && isOpen && (
                <div>
                    {node.children.map((child) => (
                        <TreeNode
                            key={child.kode}
                            node={child}
                            level={level + 1}
                            onEdit={onEdit}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export default function JadwalRetensi() {
    const [activeTab, setActiveTab] = useState('fasilitatif')
    const [searchQuery, setSearchQuery] = useState('')
    const [treeData, setTreeData] = useState([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [currentItem, setCurrentItem] = useState(null)
    const [formData, setFormData] = useState({
        kode: '',
        uraian: '',
        retensiAktif: '',
        retensiInaktif: '',
        keterangan: '',
        parentKode: '',
        kategori: '',
    })

    // Fetch tree data
    const fetchData = async () => {
        setLoading(true)
        try {
            const response = await api.get(`/api/jra`, { format: 'tree', tipe: activeTab })
            if (response.success) {
                setTreeData(response.data)
            }
        } catch (error) {
            console.error('Gagal memuat data JRA:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [activeTab])

    // Filter tree based on search
    const filterTree = (nodes, query) => {
        if (!query) return nodes
        const lowerQuery = query.toLowerCase()

        return nodes.reduce((acc, node) => {
            const matches = node.kode.toLowerCase().includes(lowerQuery) ||
                node.uraian.toLowerCase().includes(lowerQuery)

            const filteredChildren = node.children ? filterTree(node.children, query) : []

            if (matches || filteredChildren.length > 0) {
                acc.push({
                    ...node,
                    children: filteredChildren
                })
            }

            return acc
        }, [])
    }

    const filteredData = useMemo(() => {
        return filterTree(treeData, searchQuery)
    }, [treeData, searchQuery])

    // Handle save
    const handleSave = async () => {
        try {
            if (editMode && currentItem) {
                const response = await api.put(`/api/jra/${currentItem.kode}`, {
                    uraian: formData.uraian,
                    retensiAktif: formData.retensiAktif,
                    retensiInaktif: formData.retensiInaktif,
                    keterangan: formData.keterangan,
                    kategori: formData.kategori,
                })
                if (response.success) {
                    // alert('JRA berhasil diperbarui')
                    fetchData()
                }
            } else {
                const response = await api.post('/api/jra', {
                    ...formData,
                    tipe: activeTab,
                    level: formData.parentKode ? 1 : 0,
                })
                if (response.success) {
                    // alert('JRA berhasil ditambahkan')
                    fetchData()
                }
            }
            setDialogOpen(false)
            resetForm()
        } catch (error) {
            // alert('Gagal menyimpan data')
            console.error(error)
        }
    }

    const handleEdit = (node) => {
        setEditMode(true)
        setCurrentItem(node)
        setFormData({
            kode: node.kode,
            uraian: node.uraian,
            retensiAktif: node.retensiAktif || '',
            retensiInaktif: node.retensiInaktif || '',
            keterangan: node.keterangan || '',
            parentKode: node.parentKode || '',
            kategori: node.kategori || '',
        })
        setDialogOpen(true)
    }

    const handleDelete = async (node) => {
        if (!confirm(`Hapus JRA "${node.kode} - ${node.uraian}"?`)) return

        try {
            const response = await api.delete(`/api/jra/${node.kode}`)
            if (response.success) {
                // alert('JRA berhasil dihapus')
                fetchData()
            }
        } catch (error) {
            // alert('Gagal menghapus data')
            console.error(error)
        }
    }

    const resetForm = () => {
        setFormData({
            kode: '',
            uraian: '',
            retensiAktif: '',
            retensiInaktif: '',
            keterangan: '',
            parentKode: '',
            kategori: '',
        })
        setEditMode(false)
        setCurrentItem(null)
    }

    const handleAddNew = () => {
        resetForm()
        setDialogOpen(true)
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <Clock className="h-6 w-6 text-indigo-600" />
                        </div>
                        Jadwal Retensi Arsip (JRA)
                    </h1>
                    <p className="text-muted-foreground">
                        Master data jadwal retensi sesuai Permen ATR/BPN No. 8 Tahun 2020
                    </p>
                </div>
                <Button onClick={handleAddNew} className="h-9 shadow-sm bg-indigo-600 hover:bg-indigo-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Tambah JRA
                </Button>
            </div>

            {/* Legend / Info Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="shadow-sm border-l-4 border-l-blue-400">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Retensi Aktif</CardTitle>
                        <div className="p-1.5 bg-blue-100 dark:bg-blue-500/15 rounded-full">
                            <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-muted-foreground">Jangka waktu penyimpanan arsip di unit pengolah (arsip aktif).</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-orange-400">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Retensi Inaktif</CardTitle>
                        <div className="p-1.5 bg-orange-100 dark:bg-orange-500/15 rounded-full">
                            <Archive className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-muted-foreground">Jangka waktu penyimpanan di pusat arsip (arsip inaktif).</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-indigo-400">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Permanen</CardTitle>
                        <div className="p-1.5 bg-indigo-100 dark:bg-indigo-500/15 rounded-full">
                            <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-muted-foreground">Arsip bernilai guna abadi yang wajib dilestarikan.</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-red-400">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Musnah</CardTitle>
                        <div className="p-1.5 bg-red-100 dark:bg-red-500/15 rounded-full">
                            <Trash className="h-3.5 w-3.5 text-red-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-muted-foreground">Arsip yang dapat dimusnahkan setelah masa retensi habis.</p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content */}
            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                            <TabsList className="bg-muted/50 p-1">
                                <TabsTrigger value="fasilitatif" className="gap-2">
                                    <FileText className="h-4 w-4" />
                                    Fasilitatif
                                </TabsTrigger>
                                <TabsTrigger value="substantif" className="gap-2">
                                    <FolderOpen className="h-4 w-4" />
                                    Substantif
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari kode atau uraian JRA..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 bg-background focus:bg-background"
                            />
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    {loading ? (
                        <div className="p-4 space-y-2">
                            {[1, 2, 3, 4, 5].map(i => (
                                <Skeleton key={i} className="h-12 w-full" />
                            ))}
                        </div>
                    ) : filteredData.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <div className="p-4 bg-muted/50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                                <Search className="h-8 w-8 opacity-20" />
                            </div>
                            <h3 className="text-lg font-medium mb-1">Tidak ditemukan</h3>
                            <p className="text-sm opacity-80">{searchQuery ? 'Tidak ada data JRA yang cocok dengan pencarian' : 'Belum ada data JRA'}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {filteredData.map((node) => (
                                <TreeNode
                                    key={node.kode}
                                    node={node}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <div className="p-1.5 bg-primary/10 rounded-md">
                                <Edit2 className="h-5 w-5 text-primary" />
                            </div>
                            {editMode ? 'Edit JRA' : 'Tambah JRA Baru'}
                        </DialogTitle>
                        <DialogDescription>
                            {editMode
                                ? 'Perbarui data jadwal retensi arsip'
                                : `Tambahkan JRA baru ke kategori ${activeTab}`
                            }
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="kode" className="text-right font-medium">Kode</Label>
                            <Input
                                id="kode"
                                value={formData.kode}
                                onChange={(e) => setFormData({ ...formData, kode: e.target.value })}
                                className="col-span-3 font-mono"
                                disabled={editMode}
                                placeholder="Contoh: I.A.1"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="uraian" className="text-right font-medium">Uraian</Label>
                            <Input
                                id="uraian"
                                value={formData.uraian}
                                onChange={(e) => setFormData({ ...formData, uraian: e.target.value })}
                                className="col-span-3"
                                placeholder="Deskripsi/Uraian jenis arsip"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="retensiAktif" className="text-right font-medium">Retensi Aktif</Label>
                            <Input
                                id="retensiAktif"
                                value={formData.retensiAktif}
                                onChange={(e) => setFormData({ ...formData, retensiAktif: e.target.value })}
                                className="col-span-3"
                                placeholder="Contoh: 2 tahun"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="retensiInaktif" className="text-right font-medium">Retensi Inaktif</Label>
                            <Input
                                id="retensiInaktif"
                                value={formData.retensiInaktif}
                                onChange={(e) => setFormData({ ...formData, retensiInaktif: e.target.value })}
                                className="col-span-3"
                                placeholder="Contoh: 5 tahun"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="keterangan" className="text-right font-medium">Nasib Akhir</Label>
                            <Select
                                value={formData.keterangan}
                                onValueChange={(val) => setFormData({ ...formData, keterangan: val })}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Pilih nasib akhir" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Musnah">Musnah</SelectItem>
                                    <SelectItem value="Permanen">Permanen</SelectItem>
                                    <SelectItem value="Dinilai Kembali">Dinilai Kembali</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="parentKode" className="text-right font-medium">Parent Kode</Label>
                            <Input
                                id="parentKode"
                                value={formData.parentKode}
                                onChange={(e) => setFormData({ ...formData, parentKode: e.target.value })}
                                className="col-span-3 font-mono"
                                placeholder="Kode parent (kosong jika root)"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Batal
                        </Button>
                        <Button onClick={handleSave} className="bg-primary hover:bg-primary/90">
                            {editMode ? 'Simpan Perubahan' : 'Simpan Data'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
