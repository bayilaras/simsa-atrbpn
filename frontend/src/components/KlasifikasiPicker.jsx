import { useState, useEffect, useMemo, useCallback } from 'react'
import { API_BASE_URL } from '@/lib/api-url'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    ChevronRight,
    Search,
    FolderTree,
    Loader2,
    Check,
    FileText,
    Folder,
    Info,
    X,
    Trash2,
    Clock,
    ArrowRight,
    Link as LinkIcon,
    ChevronDown,
    ChevronUp
} from 'lucide-react'
import { cn } from "@/lib/utils"
import { filterJraPickerItems, filterKlasifikasiPickerItems } from '@/lib/klasifikasi-picker-search'

const RESULT_PAGE_SIZE = 100

function ruleItemIdentity(item) {
    return item?.id ?? item?.sourceRecordKey ?? item?.kode
}

function isSameRuleItem(left, right) {
    if (!left || !right) return false
    return ruleItemIdentity(left) === ruleItemIdentity(right)
}

// Simple flat list item component
function KlasifikasiItem({ item, isSelected, onSelect }) {
    return (
        <button
            type="button"
            disabled={item.isSelectable === false}
            aria-pressed={isSelected}
            onClick={() => onSelect(item)}
            className={cn(
                "flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                item.isSelectable === false ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                "border border-transparent hover:border-primary/20 hover:bg-primary/5",
                isSelected ? "bg-primary/10 border-primary/30 shadow-sm" : "bg-card border-border/40",
            )}
        >
            <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
                <Folder className="w-4 h-4" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge
                        variant="outline"
                        className={cn(
                            "font-mono text-xs font-semibold h-6 px-2",
                            isSelected ? "bg-primary/20 text-primary border-primary/30" : "bg-muted border-border text-foreground"
                        )}
                    >
                        {item.kode}
                    </Badge>
                    <Badge
                        variant="secondary"
                        className={cn(
                            "text-[10px] h-5 px-1.5",
                            item.tipe === 'fasilitatif' ? "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/15" : "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/15"
                        )}
                    >
                        {item.tipe === 'fasilitatif' ? 'Fasilitatif' : 'Substantif'}
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {item.organizationalScope === 'kanwil' ? 'Kanwil' : item.organizationalScope === 'kantah' ? 'Kantah' : 'Kementerian'}
                    </Badge>
                    {item.version && <span className="text-[10px] text-muted-foreground">Versi {item.version}</span>}
                </div>
                <p className={cn(
                    "text-sm font-medium leading-tight",
                    isSelected ? "text-primary" : "text-foreground"
                )}>
                    {item.jenis}
                </p>
                {item.kategori && item.kategori !== '-' && item.kategori !== item.jenis && (
                    <p className={cn(
                        "text-[11px] mt-0.5 font-medium leading-tight",
                        isSelected ? "text-primary/70" : "text-amber-700 dark:text-amber-300"
                    )}>
                        {item.kategori}
                    </p>
                )}
                {item.keterangan && item.keterangan !== '-' && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                        {item.keterangan}
                    </p>
                )}
                {/* Show parent path for context */}
                {item.parentKode && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                        <FolderTree className="h-2.5 w-2.5" />
                        Induk: {item.parentKode}
                    </p>
                )}
                {item.sourcePage && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">Sumber halaman {item.sourcePage}</p>
                )}
            </div>

            {isSelected && (
                <div className="bg-primary text-primary-foreground rounded-full p-1 shrink-0 mt-0.5">
                    <Check className="w-3 h-3" />
                </div>
            )}
        </button>
    )
}

// JRA group header (category item without retention data)
function JRAGroupHeader({ item }) {
    return (
        <div className="mt-1.5 first:mt-0 mb-0.5">
            <div className="flex items-center gap-1.5 px-1.5 py-1 bg-amber-50/80 rounded border border-amber-200/50">
                <Folder className="h-3 w-3 text-amber-700 dark:text-amber-300" />
                <Badge variant="outline" className="h-5 border-amber-300 bg-card/50 px-1 font-mono text-[9px] text-amber-800 dark:text-amber-300">
                    {item.kode}
                </Badge>
                <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 line-clamp-1">{item.uraian}</span>
            </div>
        </div>
    )
}

// JRA suggestion item component (selectable, with retention info)
function JRAItem({ item, isSelected, onSelect }) {
    return (
        <button
            type="button"
            disabled={item.isSelectable === false}
            aria-pressed={isSelected}
            onClick={() => onSelect(item)}
            className={cn(
                "mb-1 flex w-full items-start gap-2 rounded-md p-2 text-left text-xs transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                item.isSelectable === false ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                "border border-transparent hover:border-amber-500/30 hover:bg-amber-50 dark:hover:bg-amber-500/15",
                isSelected ? "bg-amber-50 dark:bg-amber-500/15 border-amber-500/40 shadow-sm" : "bg-card border-border/30",
            )}
        >
            <div className={cn(
                "w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5",
                isSelected ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"
            )}>
                {isSelected ? <Check className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <Badge variant="outline" className="h-5 bg-card/50 px-1 font-mono text-[9px]">
                        {item.kode}
                    </Badge>
                    <p className="text-[11px] font-medium leading-tight line-clamp-1 flex-1">{item.uraian}</p>
                </div>

                <div className="flex flex-wrap gap-x-2 gap-y-0 text-[9px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                        <span className="opacity-70">Aktif:</span>
                        <span className="font-medium text-foreground">{item.retensiAktif}</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                        <span className="opacity-70">Inaktif:</span>
                        <span className="font-medium text-foreground">{item.retensiInaktif}</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                        <span className="opacity-70">Nasib:</span>
                        <span className={cn(
                            "font-medium",
                            item.keterangan?.toLowerCase().includes('permanen') ? "text-red-600 dark:text-red-400 font-bold" : "text-foreground"
                        )}>{item.keterangan}</span>
                    </span>
                    <span>Mode: <b className="text-foreground">{item.calculationMode === 'duration' ? 'terstruktur' : 'appraisal'}</b></span>
                    {item.sourcePage && <span>Sumber hlm. {item.sourcePage}</span>}
                </div>
                {item.triggerGuidance && (
                    <p className="mt-1 line-clamp-2 text-[9px] text-muted-foreground">Pemicu: {item.triggerGuidance}</p>
                )}
            </div>
        </button>
    )
}

/**
 * KlasifikasiPicker Component - Enhanced with JRA Mapping Suggestions
 */
export function KlasifikasiPicker({ value, onChange, label = "Pilih Klasifikasi Arsip", id }) {
    const API_BASE = API_BASE_URL;
    const [open, setOpen] = useState(false)
    const [activeTab, setActiveTab] = useState('all')
    const [allData, setAllData] = useState([])
    const [loading, setLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [visibleResultLimit, setVisibleResultLimit] = useState(RESULT_PAGE_SIZE)
    const [selectedItem, setSelectedItem] = useState(null)
    const [error, setError] = useState(null)

    // JRA Mapping State
    const [suggestedJRA, setSuggestedJRA] = useState([])
    const [jraMappings, setJraMappings] = useState([])
    const [allJRA, setAllJRA] = useState([]) // New: Store all JRA items
    const [selectedJRA, setSelectedJRA] = useState(null)
    const [loadingJRA, setLoadingJRA] = useState(false)
    const [showJRAPanel, setShowJRAPanel] = useState(false)
    const [jraTab, setJraTab] = useState('suggested') // New: 'suggested' | 'all'
    const [jraSearchQuery, setJraSearchQuery] = useState('') // New: Search for JRA

    const fetchData = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await fetch(`${API_BASE}/api/klasifikasi`, {
                credentials: 'include'
            })
            const result = await response.json()
            if (result.success && result.data) {
                setAllData(result.data)
            } else {
                setError('Gagal memuat data klasifikasi')
            }
        } catch (err) {
            console.error('Error fetching klasifikasi:', err)
            setError('Gagal terhubung ke server')
        } finally {
            setLoading(false)
        }
    }, [API_BASE])

    // Refresh the active rule edition every time the picker opens so a newly
    // published version cannot leave stale choices in a long-lived browser tab.
    useEffect(() => {
        if (open) {
            fetchData()
            setAllJRA([])
        }
    }, [fetchData, open])

    // Fetch suggested JRA via the thematic mapping API
    const fetchSuggestedJRA = async (kode) => {
        setLoadingJRA(true)
        setSuggestedJRA([])
        setJraMappings([])
        setSelectedJRA(null)
        try {
            const response = await fetch(`${API_BASE}/api/mapping/suggest-jra/${encodeURIComponent(kode)}`, {
                credentials: 'include'
            })
            const result = await response.json()
            if (result.success) {
                setSuggestedJRA(result.suggestedJRA || [])
                setJraMappings(result.mappings || [])
                setShowJRAPanel(true)

                // Auto-switch to 'all' if no suggestions found
                if (!result.suggestedJRA || result.suggestedJRA.length === 0) {
                    setJraTab('all')
                } else {
                    setJraTab('suggested')
                }
            }
        } catch (err) {
            console.error('Error fetching JRA suggestions:', err)
        } finally {
            setLoadingJRA(false)
        }
    }

    // New: Fetch all JRA items
    const fetchAllJRA = useCallback(async () => {
        setLoadingJRA(true)
        try {
            const response = await fetch(`${API_BASE}/api/jra`, {
                credentials: 'include'
            })
            const result = await response.json()
            if (result.success) {
                setAllJRA(result.data || [])
            }
        } catch (err) {
            console.error('Error fetching all JRA:', err)
        } finally {
            setLoadingJRA(false)
        }
    }, [API_BASE])

    // Effect to handle JRA tab switching
    useEffect(() => {
        if (open && jraTab === 'all') {
            fetchAllJRA()
        }
    }, [fetchAllJRA, open, jraTab])

    // Filter data based on tab and search
    const filteredData = useMemo(() => {
        return filterKlasifikasiPickerItems(allData, activeTab, searchQuery)
    }, [allData, activeTab, searchQuery])
    const visibleData = useMemo(
        () => filteredData.slice(0, visibleResultLimit),
        [filteredData, visibleResultLimit],
    )

    // Count by type for badges
    const counts = useMemo(() => ({
        all: allData.length,
        fasilitatif: allData.filter(d => d.tipe === 'fasilitatif').length,
        substantif: allData.filter(d => d.tipe === 'substantif').length
    }), [allData])

    // Separate JRA items into groups (headers) and leaf items (selectable)
    const { groupedJRA, leafJRA } = useMemo(() => {
        const groups = suggestedJRA.filter(j => !j.retensiAktif || j.retensiAktif === '-')
        const leaves = suggestedJRA.filter(j => j.retensiAktif && j.retensiAktif !== '-')
        return { groupedJRA: groups, leafJRA: leaves }
    }, [suggestedJRA])

    // Build a grouped display: group headers followed by their children
    const jraDisplayItems = useMemo(() => {
        const items = []
        // Group leaf items by their parent kode
        const parentMap = new Map()
        for (const group of groupedJRA) {
            parentMap.set(group.kode, group)
        }
        // For each leaf, find its parent group
        const usedParents = new Set()
        const sortedLeaves = [...leafJRA].sort((a, b) => (a.kode || '').localeCompare(b.kode || ''))

        for (const leaf of sortedLeaves) {
            // Check if parent is a group header
            if (leaf.parentKode && parentMap.has(leaf.parentKode) && !usedParents.has(leaf.parentKode)) {
                usedParents.add(leaf.parentKode)
                items.push({ type: 'header', item: parentMap.get(leaf.parentKode) })
            }
            items.push({ type: 'leaf', item: leaf })
        }
        return items
    }, [groupedJRA, leafJRA])

    // New: Filtered All JRA list
    const filteredAllJRA = useMemo(() => {
        if (jraTab !== 'all') return []
        return filterJraPickerItems(allJRA, jraSearchQuery)
    }, [allJRA, jraTab, jraSearchQuery])

    const handleActiveTabChange = (nextTab) => {
        setActiveTab(nextTab)
        setSearchQuery('')
        setVisibleResultLimit(RESULT_PAGE_SIZE)
    }

    const handleSearchChange = (event) => {
        setSearchQuery(event.target.value)
        setVisibleResultLimit(RESULT_PAGE_SIZE)
    }

    const handleClearSearch = () => {
        setSearchQuery('')
        setVisibleResultLimit(RESULT_PAGE_SIZE)
    }

    const handleSelect = (item) => {
        setSelectedItem(item)
        // Reset JRA selection state
        setJraTab('suggested')
        setJraSearchQuery('')
        // Fetch suggestions and determine initial tab
        fetchSuggestedJRA(item.kode)
    }

    const handleConfirm = () => {
        if (selectedItem && selectedJRA) {
            onChange(selectedItem.kode, selectedItem, selectedJRA)
            setOpen(false)
        }
    }

    const handleClear = (e) => {
        e?.stopPropagation()
        onChange('', null, null)
        setSelectedItem(null)
        setSelectedJRA(null)
        setSuggestedJRA([])
        setJraMappings([])
        setShowJRAPanel(false)
    }

    const handleClearAndClose = () => {
        handleClear()
        setOpen(false)
    }

    return (
        <>
            {/* Trigger Button */}
            <div className="relative">
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    className={cn(
                        "group h-auto w-full justify-between px-3 py-2 text-left font-normal",
                        value && "pr-20",
                        !value && "text-muted-foreground"
                    )}
                    onClick={() => {
                        setVisibleResultLimit(RESULT_PAGE_SIZE)
                        setOpen(true)
                    }}
                >
                {value ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Badge variant="secondary" className="font-mono text-xs shrink-0 h-6">
                            {value}
                        </Badge>
                        <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm line-clamp-1 block">
                                {selectedItem?.jenis || 'Klasifikasi terpilih'}
                            </span>
                            {selectedJRA && (
                                <span className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    JRA: {selectedJRA.kode} — Aktif: {selectedJRA.retensiAktif}, {selectedJRA.keterangan}
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <FolderTree className="h-4 w-4 shrink-0" />
                        <span className="truncate">{label}</span>
                    </div>
                )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </Button>
                {value && (
                    <button
                        type="button"
                        className="absolute right-9 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={handleClear}
                        aria-label="Hapus klasifikasi yang dipilih"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Dialog - Two Panel Layout */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-[95vw] md:max-w-5xl h-[92vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl">
                    {/* Header - Compact */}
                    <div className="p-3 md:p-4 border-b bg-muted/30 flex-shrink-0">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                            <DialogHeader className="text-left space-y-1">
                                <DialogTitle className="flex items-center gap-2 text-lg">
                                    <div className="bg-primary/10 p-1.5 rounded-lg hidden md:block">
                                        <FolderTree className="h-4 w-4 text-primary" />
                                    </div>
                                    Pilih Klasifikasi & Retensi Arsip
                                </DialogTitle>
                                <DialogDescription className="text-xs hidden sm:block">
                                    Pilih klasifikasi, lalu pilih jadwal retensi yang sesuai dari saran yang muncul.
                                </DialogDescription>
                            </DialogHeader>

                            {/* Search Bar */}
                            <div className="relative w-full md:w-[300px]">
                                <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                    aria-label="Cari klasifikasi arsip"
                                    placeholder="Cari klasifikasi..."
                                    value={searchQuery}
                                    onChange={handleSearchChange}
                                    className="h-10 bg-background pl-8 pr-11 text-sm"
                                    autoFocus
                                />
                                {searchQuery && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        aria-label="Hapus pencarian klasifikasi"
                                        className="absolute right-0 top-1/2 h-10 w-10 -translate-y-1/2 p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                        onClick={handleClearSearch}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Tabs */}
                        <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="w-full">
                            <TabsList className="grid w-full grid-cols-3 h-9 p-1 bg-muted/50 border">
                                <TabsTrigger value="all" className="text-xs py-1 px-1 h-7">
                                    <span className="truncate">Semua</span>
                                    <Badge variant="secondary" className="ml-1.5 hidden h-5 px-1 text-[10px] sm:inline-flex">{counts.all}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="fasilitatif" className="text-xs py-1 px-1 h-7">
                                    <span className="truncate">Fasilitatif</span>
                                    <Badge variant="secondary" className="ml-1.5 hidden h-5 bg-blue-100 px-1 text-[10px] text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 sm:inline-flex">{counts.fasilitatif}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="substantif" className="text-xs py-1 px-1 h-7">
                                    <span className="truncate">Substantif</span>
                                    <Badge variant="secondary" className="ml-1.5 hidden h-5 bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 sm:inline-flex">{counts.substantif}</Badge>
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    {/* Content - Two Panel Layout */}
                    <div className="flex-1 overflow-hidden bg-muted/50 relative flex flex-col md:flex-row">
                        {/* Left Panel - Klasifikasi List */}
                        <div className={cn(
                            "overflow-auto p-2 md:p-3 scroll-smooth",
                            showJRAPanel && selectedItem ? "md:w-1/2 md:border-r" : "w-full",
                            showJRAPanel && selectedItem ? "h-1/2 md:h-full border-b md:border-b-0" : "h-full"
                        )}>
                            {loading ? (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <p className="text-sm">Memuat data...</p>
                                </div>
                            ) : error ? (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-destructive">
                                    <Info className="h-8 w-8" />
                                    <p className="text-sm font-medium">{error}</p>
                                    <Button variant="outline" size="sm" onClick={fetchData}>
                                        Coba Lagi
                                    </Button>
                                </div>
                            ) : filteredData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-8 text-center opacity-70">
                                    <Search className="h-10 w-10 text-muted-foreground/30" />
                                    <p className="font-medium text-sm">Tidak ditemukan</p>
                                </div>
                            ) : (
                                <div className="space-y-1.5 pb-2">
                                    {visibleData.map((item) => (
                                        <KlasifikasiItem
                                            key={ruleItemIdentity(item)}
                                            item={item}
                                            isSelected={isSameRuleItem(selectedItem, item)}
                                            onSelect={handleSelect}
                                        />
                                    ))}
                                    {visibleData.length < filteredData.length && (
                                        <div className="flex flex-col items-center gap-2 py-3 text-center">
                                            <p className="text-xs text-muted-foreground" role="status">
                                                Menampilkan {visibleData.length} dari {filteredData.length} hasil.
                                            </p>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setVisibleResultLimit((limit) => limit + RESULT_PAGE_SIZE)}
                                            >
                                                Tampilkan lebih banyak
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Right Panel - JRA Suggestions */}
                        {showJRAPanel && selectedItem && (
                            <div className={cn(
                                "overflow-auto bg-amber-50/30",
                                "md:w-1/2 h-1/2 md:h-full",
                                "flex flex-col" // Added flex-col to handle sticky header and content properly
                            )}>
                                {/* Valid Sticky Header - COMPACT */}
                                <div className="p-2 border-b bg-amber-50/80 sticky top-0 z-10 backdrop-blur-sm">
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                        <h3 className="text-xs font-semibold flex items-center gap-1.5 text-amber-900 dark:text-amber-300">
                                            <Clock className="h-3.5 w-3.5 text-amber-600" />
                                            Saran Jadwal Retensi
                                        </h3>
                                        <Badge variant="outline" className="h-5 border-amber-300 bg-amber-100 px-1 text-[9px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                            {leafJRA.length} item
                                        </Badge>
                                    </div>
                                    <p className="text-[10px] text-amber-800 dark:text-amber-300/60 mb-1 leading-tight line-clamp-1">
                                        Pilih jadwal sesuai masa simpan arsip.
                                    </p>
                                    {jraMappings.length > 0 && (
                                        <div className="space-y-0.5">
                                            {jraMappings.map((m, i) => (
                                                <div key={i} className="bg-amber-100/50 border border-amber-200/50 rounded px-1.5 py-1 text-[10px]">
                                                    <div className="flex items-center gap-1.5">
                                                        <LinkIcon className="h-2.5 w-2.5 text-amber-700 dark:text-amber-300 shrink-0" />
                                                        <span className="font-semibold text-amber-800 dark:text-amber-300">Area: {m.tema}</span>
                                                    </div>
                                                    {m.keterangan && (
                                                        <p className="text-amber-700 dark:text-amber-300/80 mt-0 ml-[16px] leading-tight line-clamp-1">{m.keterangan}</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* JRA Toolbar: Tabs & Search */}
                                <div className="px-3 py-2 border-b bg-amber-50/30 flex flex-col gap-2 shrink-0">
                                    <div className="flex items-center bg-muted/50 p-1 rounded-lg border">
                                        <button
                                            type="button"
                                            aria-pressed={jraTab === 'suggested'}
                                            className={cn(
                                                "min-h-10 flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                                                jraTab === 'suggested'
                                                    ? "bg-card shadow text-amber-900 dark:text-amber-300"
                                                    : "text-muted-foreground hover:text-foreground"
                                            )}
                                            onClick={() => setJraTab('suggested')}
                                        >
                                            Disarankan ({leafJRA.length})
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={jraTab === 'all'}
                                            className={cn(
                                                "min-h-10 flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                                                jraTab === 'all'
                                                    ? "bg-card shadow text-amber-900 dark:text-amber-300"
                                                    : "text-muted-foreground hover:text-foreground"
                                            )}
                                            onClick={() => setJraTab('all')}
                                        >
                                            Semua ({allJRA.length || '...'})
                                        </button>
                                    </div>

                                    {jraTab === 'all' && (
                                        <div className="relative">
                                            <Search aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                            <Input
                                                aria-label="Cari jadwal retensi arsip"
                                                placeholder="Cari JRA..."
                                                value={jraSearchQuery}
                                                onChange={(e) => setJraSearchQuery(e.target.value)}
                                                className="h-10 bg-card pl-8 text-xs"
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* JRA List Content */}
                                <div className="p-2 md:p-3 overflow-auto flex-1">
                                    {loadingJRA ? (
                                        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                                            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
                                            <p className="text-xs">Memuat data...</p>
                                        </div>
                                    ) : jraTab === 'suggested' ? (
                                        leafJRA.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                                                <Info className="h-6 w-6 text-muted-foreground/40" />
                                                <p className="text-xs text-center">Tidak ada saran retensi berdasarkan mapping.</p>
                                                <Button size="sm" variant="outline" className="h-7 text-xs mt-2" onClick={() => setJraTab('all')}>
                                                    Lihat Semua JRA
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="space-y-1">
                                                {jraDisplayItems.map((entry) => (
                                                    entry.type === 'header' ? (
                                                        <JRAGroupHeader key={ruleItemIdentity(entry.item)} item={entry.item} />
                                                    ) : (
                                                        <JRAItem
                                                            key={ruleItemIdentity(entry.item)}
                                                            item={entry.item}
                                                            isSelected={isSameRuleItem(selectedJRA, entry.item)}
                                                            onSelect={setSelectedJRA}
                                                        />
                                                    )
                                                ))}
                                            </div>
                                        )
                                    ) : (
                                        <div className="space-y-1">
                                            {filteredAllJRA.length === 0 ? (
                                                <div className="text-center py-8 text-xs text-muted-foreground">
                                                    Tidak ditemukan
                                                </div>
                                            ) : (
                                                filteredAllJRA.map((item) => (
                                                    <JRAItem
                                                        key={ruleItemIdentity(item)}
                                                        item={item}
                                                        isSelected={isSameRuleItem(selectedJRA, item)}
                                                        onSelect={setSelectedJRA}
                                                    />
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer - Selection Preview - COMPACT VERSION */}
                    <div className="px-3 py-2 border-t bg-background flex-shrink-0 z-10 shadow-[0_-4px_10px_-4px_rgba(0,0,0,0.05)]">
                        {selectedItem ? (
                            <div className="bg-primary/5 border border-primary/20 rounded-md p-2 mb-2 transition-all">
                                <div className="flex flex-col gap-1.5">
                                    {/* Top Row: Classification Info */}
                                    <div className="flex items-start gap-2">
                                        <div className="bg-primary/10 p-1 rounded shrink-0 mt-0.5">
                                            <Folder className="h-3.5 w-3.5 text-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <Badge className="h-5 px-1 font-mono text-[9px]">{selectedItem.kode}</Badge>
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                                                    {selectedItem.tipe === 'fasilitatif' ? 'Fasilitatif' : 'Substantif'}
                                                </span>
                                            </div>
                                            <p className="font-semibold text-xs text-foreground line-clamp-1 leading-tight">{selectedItem.jenis}</p>
                                        </div>
                                    </div>

                                    {/* Bottom Row: JRA Info (if selected) */}
                                    {selectedJRA && (
                                        <div className="flex items-start gap-2 pt-1.5 border-t border-primary/10">
                                            <div className="bg-amber-100 dark:bg-amber-500/15 p-1 rounded shrink-0 mt-0.5">
                                                <Clock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                    <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300">Jadwal Retensi:</span>
                                                    <Badge variant="outline" className="h-5 border-amber-200 bg-card px-1 font-mono text-[9px] text-amber-800 dark:text-amber-300">{selectedJRA.kode}</Badge>
                                                </div>
                                                <div className="flex flex-wrap gap-x-3 text-[10px] leading-tight text-muted-foreground">
                                                    <span>Aktif: <b className="text-foreground">{selectedJRA.retensiAktif}</b></span>
                                                    <span>Inaktif: <b className="text-foreground">{selectedJRA.retensiInaktif}</b></span>
                                                    <span>Nasib: <b className={cn(
                                                        "text-foreground",
                                                        selectedJRA.keterangan?.toLowerCase().includes('permanen') ? "text-red-600 dark:text-red-400" : ""
                                                    )}>{selectedJRA.keterangan}</b></span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : null}

                        {selectedItem && !selectedJRA && (
                            <p className="px-1 text-xs text-amber-700 dark:text-amber-300" role="status">
                                Pilih satu butir JRA untuk melengkapi pasangan klasifikasi. Rekomendasi yang tampil hanya bantuan dan tetap harus Anda konfirmasi.
                            </p>
                        )}

                        <DialogFooter className="w-full flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                            {/* Left Side: Hapus Button */}
                            <div className="w-full sm:w-auto">
                                {(value || selectedItem) && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleClearAndClose}
                                        className="min-h-11 w-full px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto md:text-sm"
                                    >
                                        <Trash2 className="h-4 w-4 mr-1.5" />
                                        Hapus Pilihan
                                    </Button>
                                )}
                            </div>

                            {/* Right Side: Action Buttons */}
                            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
                                <Button type="button" variant="outline" onClick={() => setOpen(false)} className="min-h-11 text-xs md:text-sm">
                                    Batal
                                </Button>
                                <Button
                                    type="button"
                                    onClick={handleConfirm}
                                    disabled={!selectedItem || !selectedJRA}
                                    title={!selectedItem ? 'Pilih klasifikasi arsip' : !selectedJRA ? 'Pilih dan konfirmasi JRA' : 'Gunakan pasangan klasifikasi dan JRA ini'}
                                    className="min-h-11 text-xs font-medium shadow-sm sm:min-w-[100px] md:text-sm"
                                >
                                    <Check className="mr-2 h-4 w-4" />
                                    Pilih
                                </Button>
                            </div>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog >
        </>
    )
}

export default KlasifikasiPicker
