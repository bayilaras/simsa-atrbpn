import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, FileText, Mail, Send, Archive, Folder, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import searchService from '@/services/search.service';

// Type icons mapping
const TYPE_ICONS = {
    surat_masuk: Mail,
    surat_keluar: Send,
    arsip: Archive,
    dosir: Folder
};

const TYPE_LABELS = {
    surat_masuk: 'Surat Masuk',
    surat_keluar: 'Surat Keluar',
    arsip: 'Arsip',
    dosir: 'Dosir'
};

const TYPE_COLORS = {
    surat_masuk: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    surat_keluar: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    arsip: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    dosir: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
};

export function GlobalSearch({ open, onOpenChange }) {
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Focus input when dialog opens
    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100);
            setQuery('');
            setResults(null);
            setSelectedIndex(0);
        }
    }, [open]);

    // Debounced search
    const doSearch = useCallback(async (searchQuery) => {
        if (!searchQuery || searchQuery.length < 2) {
            setResults(null);
            return;
        }

        setLoading(true);
        try {
            const data = await searchService.search(searchQuery, { limit: 10 });
            setResults(data);
            setSelectedIndex(0);
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Debounce input
    useEffect(() => {
        const timer = setTimeout(() => {
            doSearch(query);
        }, 300);
        return () => clearTimeout(timer);
    }, [query, doSearch]);

    // Navigate to result
    const handleSelect = (result) => {
        onOpenChange(false);

        const routes = {
            surat_masuk: `/surat/masuk/${result.id}`,
            surat_keluar: `/surat/keluar/${result.id}`,
            arsip: `/arsip/detail/${result.id}`,
            dosir: `/dosir/${result.id}`
        };

        navigate(routes[result.type] || '/');
    };

    // Keyboard navigation
    const handleKeyDown = (e) => {
        if (!results?.results?.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, results.results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            handleSelect(results.results[selectedIndex]);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden">
                <DialogTitle className="sr-only">Pencarian Global</DialogTitle>

                {/* Search Input */}
                <div className="flex items-center border-b px-3">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Cari surat, arsip, dosir..."
                        className="border-0 focus-visible:ring-0 h-12"
                    />
                    {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {query && !loading && (
                        <Button variant="ghost" size="icon" onClick={() => setQuery('')}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>

                {/* Results */}
                <ScrollArea className="max-h-[400px]">
                    {results && (
                        <div className="p-2">
                            {/* Counts */}
                            <div className="flex gap-2 px-2 py-1 mb-2">
                                {Object.entries(results.counts).filter(([k, v]) => k !== 'total' && v > 0).map(([type, count]) => (
                                    <Badge key={type} variant="secondary" className={TYPE_COLORS[type]}>
                                        {TYPE_LABELS[type]}: {count}
                                    </Badge>
                                ))}
                            </div>

                            {/* Result List */}
                            {results.results.length > 0 ? (
                                <div className="space-y-1">
                                    {results.results.map((result, index) => {
                                        const Icon = TYPE_ICONS[result.type] || FileText;
                                        return (
                                            <button
                                                key={`${result.type}-${result.id}`}
                                                onClick={() => handleSelect(result)}
                                                className={`w-full text-left px-3 py-2 rounded-lg flex items-start gap-3 transition-colors ${index === selectedIndex
                                                        ? 'bg-accent text-accent-foreground'
                                                        : 'hover:bg-muted'
                                                    }`}
                                            >
                                                <div className={`p-2 rounded-md ${TYPE_COLORS[result.type]}`}>
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium truncate">{result.title}</div>
                                                    <div className="text-sm text-muted-foreground truncate">
                                                        {result.excerpt}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground mt-1">
                                                        {TYPE_LABELS[result.type]} • {result.subtitle}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : query.length >= 2 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    Tidak ada hasil untuk "{query}"
                                </div>
                            ) : null}
                        </div>
                    )}

                    {/* Empty State */}
                    {!results && query.length < 2 && (
                        <div className="text-center py-8 text-muted-foreground">
                            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>Ketik minimal 2 karakter untuk mencari</p>
                            <p className="text-xs mt-1">Telusuri surat masuk, surat keluar, arsip, dan dosir</p>
                        </div>
                    )}
                </ScrollArea>

                {/* Footer hints */}
                <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                    <span>↑↓ Navigasi • Enter Pilih • Esc Tutup</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘K</kbd>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Hook for global search keyboard shortcut
 */
export function useGlobalSearchShortcut(onOpen) {
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                onOpen();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onOpen]);
}

export default GlobalSearch;
