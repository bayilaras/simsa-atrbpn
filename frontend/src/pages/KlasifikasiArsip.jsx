import { useState, useEffect, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronRight, ChevronDown, Search, Plus, Edit2, Trash2, FolderTree, Loader2, Book, Building2, Folder, FileText } from 'lucide-react'
import { api } from '@/services/api'
import { Skeleton } from "@/components/ui/skeleton"

// Tree Node Component
function TreeNode({ node, level = 0, onEdit, onDelete }) {
    const [isOpen, setIsOpen] = useState(level < 1) // Auto-expand first level
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

                <Badge variant="outline" className="font-mono text-xs shrink-0 bg-background/50 text-foreground">
                    {node.kode}
                </Badge>

                <span className="flex-1 text-sm font-medium text-foreground/90 truncate" title={node.jenis}>
                    {node.jenis}
                </span>

                {node.keterangan && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px] hidden sm:block">
                        {node.keterangan}
                    </span>
                )}

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

// Main Page Component
export default function KlasifikasiArsip() {
    const [activeTab, setActiveTab] = useState('fasilitatif')
    const [searchQuery, setSearchQuery] = useState('')
    const [treeData, setTreeData] = useState([])
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [currentItem, setCurrentItem] = useState(null)
    const [formData, setFormData] = useState({
        kode: '',
        jenis: '',
        keterangan: '',
        parentKode: '',
        kategori: '',
    })

    // Fetch tree data
    const fetchData = async () => {
        setLoading(true)
        try {
            const response = await api.get(`/api/klasifikasi`, { format: 'tree', tipe: activeTab })
            if (response.success) {
                setTreeData(response.data)
            }
        } catch (error) {
            console.error('Gagal memuat data klasifikasi:', error)
        } finally {
            setLoading(false)
        }
    }

    // Fetch stats
    const fetchStats = async () => {
        try {
            const response = await api.get('/api/klasifikasi/stats')
            if (response.success) {
                setStats(response.data)
            }
        } catch (error) {
            console.error('Error fetching stats:', error)
        }
    }

    useEffect(() => {
        fetchData()
    }, [activeTab])

    useEffect(() => {
        fetchStats()
    }, [])

    // Filter tree based on search
    const filterTree = (nodes, query) => {
        if (!query) return nodes
        const lowerQuery = query.toLowerCase()

        return nodes.reduce((acc, node) => {
            const matches = node.kode.toLowerCase().includes(lowerQuery) ||
                node.jenis.toLowerCase().includes(lowerQuery)

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

    // Handle create/edit
    const handleSave = async () => {
        try {
            if (editMode && currentItem) {
                // Update
                const response = await api.put(`/api/klasifikasi/${currentItem.kode}`, {
                    jenis: formData.jenis,
                    keterangan: formData.keterangan,
                    kategori: formData.kategori,
                })
                if (response.success) {
                    // alert('Klasifikasi berhasil diperbarui')
                    fetchData()
                }
            } else {
                // Create
                const response = await api.post('/api/klasifikasi', {
                    ...formData,
                    tipe: activeTab,
                    level: formData.parentKode ? 1 : 0,
                })
                if (response.success) {
                    // alert('Klasifikasi berhasil ditambahkan')
                    fetchData()
                    fetchStats()
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
            jenis: node.jenis,
            keterangan: node.keterangan || '',
            parentKode: node.parentKode || '',
            kategori: node.kategori || '',
        })
        setDialogOpen(true)
    }

    const handleDelete = async (node) => {
        if (!confirm(`Hapus klasifikasi "${node.kode} - ${node.jenis}"?`)) return

        try {
            const response = await api.delete(`/api/klasifikasi/${node.kode}`)
            if (response.success) {
                // alert('Klasifikasi berhasil dihapus')
                fetchData()
                fetchStats()
            }
        } catch (error) {
            // alert('Gagal menghapus data')
            console.error(error)
        }
    }

    const resetForm = () => {
        setFormData({
            kode: '',
            jenis: '',
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
                            <FolderTree className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Klasifikasi Arsip
                    </h1>
                    <p className="text-muted-foreground">
                        Master data klasifikasi arsip sesuai Permen ATR/BPN No. 10 Tahun 2018
                    </p>
                </div>
                <Button onClick={handleAddNew} className="h-9 shadow-sm bg-indigo-600 hover:bg-indigo-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Tambah Klasifikasi
                </Button>
            </div>

            {/* Stats Cards */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="shadow-sm border-l-4 border-l-slate-400">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Klasifikasi</CardTitle>
                            <div className="p-1.5 bg-muted rounded-full">
                                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
                            <p className="text-xs text-muted-foreground mt-1">Total seluruh kode</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-blue-400">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Fasilitatif</CardTitle>
                            <div className="p-1.5 bg-blue-100 dark:bg-blue-500/15 rounded-full">
                                <Book className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.fasilitatif}</div>
                            <p className="text-xs text-muted-foreground mt-1">{stats.rootFasilitatif} kategori utama</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-emerald-400">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Substantif</CardTitle>
                            <div className="p-1.5 bg-emerald-100 dark:bg-emerald-500/15 rounded-full">
                                <Building2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.substantif}</div>
                            <p className="text-xs text-muted-foreground mt-1">{stats.rootSubstantif} kategori utama</p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Main Content */}
            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                            <TabsList className="bg-muted/50 p-1">
                                <TabsTrigger value="fasilitatif" className="gap-2">
                                    <Book className="h-4 w-4" />
                                    Fasilitatif
                                </TabsTrigger>
                                <TabsTrigger value="substantif" className="gap-2">
                                    <Building2 className="h-4 w-4" />
                                    Substantif
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari kode atau jenis..."
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
                                <FolderTree className="h-8 w-8 opacity-20" />
                            </div>
                            <h3 className="text-lg font-medium mb-1">Tidak ditemukan</h3>
                            <p className="text-sm opacity-80">{searchQuery ? 'Tidak ada klasifikasi yang cocok dengan pencarian' : 'Belum ada data klasifikasi'}</p>
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
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <div className="p-1.5 bg-primary/10 rounded-md">
                                <Edit2 className="h-5 w-5 text-primary" />
                            </div>
                            {editMode ? 'Edit Klasifikasi' : 'Tambah Klasifikasi Baru'}
                        </DialogTitle>
                        <DialogDescription>
                            {editMode
                                ? 'Perbarui data klasifikasi arsip'
                                : `Tambahkan klasifikasi baru ke kategori ${activeTab}`
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
                                placeholder="Contoh: PR.01"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="jenis" className="text-right font-medium">Jenis</Label>
                            <Input
                                id="jenis"
                                value={formData.jenis}
                                onChange={(e) => setFormData({ ...formData, jenis: e.target.value })}
                                className="col-span-3"
                                placeholder="Nama jenis klasifikasi"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="parentKode" className="text-right font-medium">Parent</Label>
                            <Input
                                id="parentKode"
                                value={formData.parentKode}
                                onChange={(e) => setFormData({ ...formData, parentKode: e.target.value })}
                                className="col-span-3 font-mono"
                                placeholder="Kode parent (kosong jika root)"
                                disabled={editMode}
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="kategori" className="text-right font-medium">Kategori</Label>
                            <Input
                                id="kategori"
                                value={formData.kategori}
                                onChange={(e) => setFormData({ ...formData, kategori: e.target.value })}
                                className="col-span-3"
                                placeholder="Kategori utama (opsional)"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-start gap-4">
                            <Label htmlFor="keterangan" className="text-right pt-2 font-medium">Keterangan</Label>
                            <Textarea
                                id="keterangan"
                                value={formData.keterangan}
                                onChange={(e) => setFormData({ ...formData, keterangan: e.target.value })}
                                className="col-span-3"
                                placeholder="Deskripsi klasifikasi"
                                rows={3}
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Batal
                        </Button>
                        <Button onClick={handleSave} className="bg-primary hover:bg-primary/90">
                            {editMode ? 'Simpan Perubahan' : 'Tambah'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
