import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronRight, ChevronDown, Search, Plus, Edit2, Trash2, MapPin, Loader2, QrCode, Building2, Archive, Package, Box as BoxIcon, Download, Layers } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import storageLocationService from '@/services/storage-location.service'
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from '@/hooks/use-toast'
import { useRequiredUnitKerjaScope } from '@/hooks/use-required-unit-kerja-scope'
import { RequiredUnitKerjaScope } from '@/components/RequiredUnitKerjaScope'

// Level configuration
const LEVEL_CONFIG = {
    gedung: { label: 'Gedung', icon: Building2, color: 'bg-blue-500', bgColor: 'bg-blue-100 dark:bg-blue-500/15', textColor: 'text-blue-700 dark:text-blue-300' },
    ruang: { label: 'Ruang', icon: MapPin, color: 'bg-green-500', bgColor: 'bg-green-100 dark:bg-green-500/15', textColor: 'text-green-700 dark:text-green-300' },
    rak: { label: 'Rak', icon: Layers, color: 'bg-yellow-500', bgColor: 'bg-yellow-100 dark:bg-yellow-500/15', textColor: 'text-yellow-700 dark:text-yellow-300' },
    box: { label: 'Box', icon: Package, color: 'bg-purple-500', bgColor: 'bg-purple-100 dark:bg-purple-500/15', textColor: 'text-purple-700 dark:text-purple-300' },
}

// Tree Node Component
function TreeNode({ node, level = 0, onEdit, onDelete, onGenerateQR, onAddChild }) {
    const [isOpen, setIsOpen] = useState(level < 2)
    const hasChildren = node.children && node.children.length > 0
    const config = LEVEL_CONFIG[node.level] || LEVEL_CONFIG.box
    const Icon = config.icon

    return (
        <div className="select-none animate-in fade-in slide-in-from-left-2 duration-300">
            <div
                className={`flex items-center gap-2 py-3 px-3 border-b border-border/50 hover:bg-muted/50 group transition-all`}
                style={{ paddingLeft: `${level * 24 + 12}px` }}
            >
                <div className="w-5 flex justify-center shrink-0">
                    {hasChildren ? (
                        <button onClick={() => setIsOpen(!isOpen)} className="p-0.5 hover:bg-muted rounded text-muted-foreground transition-colors">
                            {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                            ) : (
                                <ChevronRight className="h-4 w-4" />
                            )}
                        </button>
                    ) : (
                        <span className="w-4" />
                    )}
                </div>

                <div className={`p-1.5 rounded-md ${config.bgColor}`}>
                    <Icon className={`h-4 w-4 ${config.textColor}`} />
                </div>

                <Badge variant="outline" className="font-mono text-xs text-foreground bg-background/50">
                    {node.code}
                </Badge>

                <span className="flex-1 text-sm font-medium text-foreground/90 truncate">{node.name}</span>

                {node.level === 'box' && (
                    <Badge variant="secondary" className="text-[10px] h-6">
                        <span className="text-muted-foreground mr-1">Isi:</span>
                        <span className="font-bold">{node.currentCount || 0}</span>
                        <span className="text-muted-foreground mx-1">/</span>
                        <span>{node.capacity || '∞'}</span>
                    </Badge>
                )}

                <div className="flex gap-1 ml-2">
                    {node.level !== 'box' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 hover:text-indigo-600 dark:hover:text-indigo-400" onClick={() => onAddChild(node)} title="Tambah Sub-lokasi">
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted" onClick={() => onGenerateQR(node)} title="QR Code">
                        <QrCode className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-blue-50 dark:hover:bg-blue-500/15 hover:text-blue-600" onClick={() => onEdit(node)} title="Edit">
                        <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(node)} title="Hapus">
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {hasChildren && isOpen && (
                <div>
                    {node.children.map((child) => (
                        <TreeNode
                            key={child.id}
                            node={child}
                            level={level + 1}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onGenerateQR={onGenerateQR}
                            onAddChild={onAddChild}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// QR Code Dialog
function QRCodeDialog({ open, onOpenChange, location, qrData }) {
    if (!location) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <QrCode className="h-5 w-5 text-primary" />
                        QR Code - {location.code}
                    </DialogTitle>
                    <DialogDescription>{location.name}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center gap-4 py-6 bg-muted/20 rounded-lg mt-2">
                    {qrData?.qrCodeDataUrl ? (
                        <>
                            <div className="bg-card p-4 rounded-xl shadow-sm border">
                                <img src={qrData.qrCodeDataUrl} alt="QR Code" className="w-48 h-48 mix-blend-multiply" />
                            </div>
                            <p className="text-sm text-muted-foreground text-center px-4">
                                Scan QR Code ini untuk melihat detail lokasi dan arsip di dalamnya.
                            </p>
                            <Button
                                className="w-full max-w-xs gap-2"
                                onClick={() => {
                                    const link = document.createElement('a')
                                    link.href = qrData.qrCodeDataUrl
                                    link.download = `qr-${location.code}.png`
                                    link.click()
                                }}
                            >
                                <Download className="h-4 w-4" />
                                Download QR Code
                            </Button>
                        </>
                    ) : (
                        <div className="py-12 flex flex-col items-center gap-2">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Membuat QR Code...</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

// Main Page Component
export default function StorageLocations() {
    const { user } = useAuth()
    const unitScope = useRequiredUnitKerjaScope(user)
    const unitKerjaId = unitScope.unitKerjaId
    const { toast } = useToast()

    const [treeData, setTreeData] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [currentItem, setCurrentItem] = useState(null)
    const [parentItem, setParentItem] = useState(null)
    const [qrDialogOpen, setQrDialogOpen] = useState(false)
    const [qrLocation, setQrLocation] = useState(null)
    const [qrData, setQrData] = useState(null)

    const [formData, setFormData] = useState({
        code: '',
        name: '',
        level: 'gedung',
        description: '',
        capacity: '',
    })

    // Fetch tree data
    const fetchData = useCallback(async () => {
        if (!unitKerjaId) return
        setLoading(true)
        try {
            const response = await storageLocationService.getTree(unitKerjaId)
            if (response.success) {
                setTreeData(response.data)
            }
        } catch (error) {
            console.error('Gagal memuat data lokasi:', error)
        } finally {
            setLoading(false)
        }
    }, [unitKerjaId])

    useEffect(() => {
        if (unitKerjaId) {
            fetchData()
        } else {
            setTreeData([])
            setLoading(false)
        }
    }, [fetchData, unitKerjaId])

    // Filter tree based on search
    const filterTree = useCallback(function filterTree(nodes, query) {
        if (!query) return nodes
        const lowerQuery = query.toLowerCase()

        return nodes.reduce((acc, node) => {
            const matches = node.code.toLowerCase().includes(lowerQuery) ||
                node.name.toLowerCase().includes(lowerQuery)
            const filteredChildren = node.children ? filterTree(node.children, query) : []

            if (matches || filteredChildren.length > 0) {
                acc.push({ ...node, children: filteredChildren })
            }
            return acc
        }, [])
    }, [])

    const filteredData = useMemo(() => filterTree(treeData, searchQuery), [filterTree, treeData, searchQuery])

    // Get next level for child
    const getNextLevel = (parentLevel) => {
        const levels = ['gedung', 'ruang', 'rak', 'box']
        const idx = levels.indexOf(parentLevel)
        return idx < levels.length - 1 ? levels[idx + 1] : null
    }

    // Handle save
    const handleSave = async () => {
        if (!unitKerjaId) return
        try {
            const data = {
                ...formData,
                unitKerjaId,
                // Omit capacity when empty (backend rejects null via .positive()).
                capacity: formData.capacity ? parseInt(formData.capacity) : undefined,
            }

            if (editMode && currentItem) {
                // Do NOT send parentId on edit — the service does a wholesale update and
                // a null parentId would detach the node and re-parent it to the root.
                await storageLocationService.update(currentItem.id, data, unitKerjaId)
                toast({ title: 'Lokasi berhasil diperbarui' })
            } else {
                data.parentId = parentItem?.id || null
                await storageLocationService.create(data)
                toast({ title: 'Lokasi berhasil ditambahkan' })
            }
            fetchData()
            setDialogOpen(false)
            resetForm()
        } catch (error) {
            console.error(error)
            toast({
                variant: 'destructive',
                title: 'Gagal menyimpan data',
                description: error.response?.data?.error || error.message || 'Terjadi kesalahan',
            })
        }
    }

    const handleEdit = (node) => {
        setEditMode(true)
        setCurrentItem(node)
        setParentItem(null)
        setFormData({
            code: node.code,
            name: node.name,
            level: node.level,
            description: node.description || '',
            capacity: node.capacity?.toString() || '',
        })
        setDialogOpen(true)
    }

    const handleAddChild = (parent) => {
        const nextLevel = getNextLevel(parent.level)
        if (!nextLevel) return

        setEditMode(false)
        setCurrentItem(null)
        setParentItem(parent)
        setFormData({
            code: '',
            name: '',
            level: nextLevel,
            description: '',
            capacity: '',
        })
        setDialogOpen(true)
    }

    const handleDelete = async (node) => {
        if (!unitKerjaId) return
        if (!confirm(`Hapus lokasi "${node.code} - ${node.name}"?`)) return

        try {
            await storageLocationService.delete(node.id, unitKerjaId)
            // alert('Lokasi berhasil dihapus')
            fetchData()
        } catch (error) {
            // alert(error.response?.data?.error || 'Gagal menghapus data')
            console.error(error)
        }
    }

    const handleGenerateQR = async (node) => {
        if (!unitKerjaId) return
        setQrLocation(node)
        setQrData(null)
        setQrDialogOpen(true)

        try {
            const response = await storageLocationService.generateQR(node.id, unitKerjaId)
            if (response.success) {
                setQrData(response.data)
            }
        } catch (error) {
            console.error('Gagal generate QR:', error)
        }
    }

    const resetForm = () => {
        setFormData({ code: '', name: '', level: 'gedung', description: '', capacity: '' })
        setEditMode(false)
        setCurrentItem(null)
        setParentItem(null)
    }

    const handleAddNew = () => {
        if (!unitKerjaId) return
        resetForm()
        setDialogOpen(true)
    }

    if (!unitKerjaId) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <MapPin className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Lokasi Penyimpanan
                    </h1>
                    <p className="text-muted-foreground">Kelola hierarki lokasi penyimpanan arsip fisik</p>
                </div>
                <RequiredUnitKerjaScope scope={unitScope} disabled={unitScope.loading} />
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <MapPin className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Lokasi Penyimpanan
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola hierarki lokasi penyimpanan arsip fisik (Gedung, Ruang, Rak, Box)
                    </p>
                </div>
                <Button onClick={handleAddNew} className="h-9 shadow-sm bg-indigo-600 hover:bg-indigo-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Tambah Lokasi
                </Button>
            </div>

            <RequiredUnitKerjaScope scope={unitScope} disabled={loading || dialogOpen || qrDialogOpen} />

            {/* Stats Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {Object.entries(LEVEL_CONFIG).map(([key, config]) => {
                    const count = treeData.reduce((acc, node) => {
                        const countLevel = (n) => {
                            let c = n.level === key ? 1 : 0
                            if (n.children) n.children.forEach(ch => c += countLevel(ch))
                            return c
                        }
                        return acc + countLevel(node)
                    }, 0)
                    const Icon = config.icon

                    return (
                        <Card key={key} className={`shadow-sm border-l-4 ${config.color.replace('bg-', 'border-l-')}`}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                    <Icon className={`h-4 w-4 ${config.textColor}`} /> {config.label}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${config.textColor}`}>{count}</div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            {/* Main Content */}
            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="relative w-full sm:max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari kode atau nama lokasi..."
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
                                <MapPin className="h-8 w-8 opacity-20" />
                            </div>
                            <h3 className="text-lg font-medium mb-1">Tidak ditemukan</h3>
                            <p className="text-sm opacity-80">{searchQuery ? 'Tidak ada lokasi yang cocok dengan pencarian' : 'Belum ada data lokasi penyimpanan'}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {filteredData.map((node) => (
                                <TreeNode
                                    key={node.id}
                                    node={node}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                    onGenerateQR={handleGenerateQR}
                                    onAddChild={handleAddChild}
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
                        <DialogTitle>
                            {editMode ? 'Edit Lokasi' : parentItem ? `Tambah ${LEVEL_CONFIG[formData.level]?.label}` : 'Tambah Lokasi Baru'}
                        </DialogTitle>
                        <DialogDescription>
                            {parentItem ? `Di dalam: ${parentItem.code} - ${parentItem.name}` : 'Buat lokasi penyimpanan baru'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="level" className="text-right">Level</Label>
                            <Select
                                value={formData.level}
                                onValueChange={(v) => setFormData({ ...formData, level: v })}
                                disabled={editMode || parentItem}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(LEVEL_CONFIG).map(([key, config]) => (
                                        <SelectItem key={key} value={key}>
                                            <div className="flex items-center gap-2">
                                                <config.icon className="h-4 w-4" /> {config.label}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="code" className="text-right">Kode</Label>
                            <Input
                                id="code"
                                value={formData.code}
                                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                className="col-span-3 font-mono"
                                placeholder="Contoh: G1-R2-RAK3-B15"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">Nama</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="col-span-3"
                                placeholder="Nama lokasi"
                            />
                        </div>

                        {formData.level === 'box' && (
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="capacity" className="text-right">Kapasitas</Label>
                                <Input
                                    id="capacity"
                                    type="number"
                                    value={formData.capacity}
                                    onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                                    className="col-span-3"
                                    placeholder="Jumlah maksimum arsip"
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-4 items-start gap-4">
                            <Label htmlFor="description" className="text-right pt-2">Keterangan</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                className="col-span-3"
                                placeholder="Deskripsi lokasi (opsional)"
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

            {/* QR Code Dialog */}
            <QRCodeDialog
                open={qrDialogOpen}
                onOpenChange={setQrDialogOpen}
                location={qrLocation}
                qrData={qrData}
            />
        </div>
    )
}
