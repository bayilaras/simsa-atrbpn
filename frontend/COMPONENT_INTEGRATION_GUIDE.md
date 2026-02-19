# SIMSA - Component Integration Guide

## Overview
This guide explains how to use the newly created UI components in your pages.

## Available Components

### 1. Loading Skeletons

**Import:**
```jsx
import { TableSkeleton, CardSkeleton, FormSkeleton, DetailSkeleton, ListSkeleton, StatsSkeleton } from '@/components/LoadingSkeletons';
```

**Usage Examples:**

```jsx
// In a list/table page
{loading ? (
    <TableSkeleton rows={10} columns={6} />
) : (
    <DataTable data={data} />
)}

// In a card grid
{loading ? (
    <CardSkeleton count={6} />
) : (
    <div className="grid grid-cols-3 gap-4">
        {items.map(item => <Card key={item.id} {...item} />)}
    </div>
)}

// In a form page
{loading ? <FormSkeleton /> : <MyForm />}

// In a detail page
{loading ? <DetailSkeleton /> : <DetailView data={data} />}
```

### 2. Empty States

**Import:**
```jsx
import { EmptyState, NoSearchResults, NoDataYet, ErrorState } from '@/components/EmptyState';
```

**Usage Examples:**

```jsx
// No data yet
{data.length === 0 && !loading && (
    <NoDataYet 
        entityName="surat masuk"
        onCreate={() => navigate('/surat/masuk/tambah')}
    />
)}

// No search results
{searchQuery && filteredData.length === 0 && (
    <NoSearchResults 
        query={searchQuery}
        onClear={() => setSearchQuery('')}
    />
)}

// Error state
{error && (
    <ErrorState 
        title="Gagal memuat data"
        description={error.message}
        onRetry={loadData}
    />
)}

// Custom empty state
<EmptyState
    icon={FileQuestion}
    title="Tidak ada arsip"
    description="Belum ada arsip yang tersedia untuk ditampilkan"
    action={() => navigate('/arsip/tambah')}
    actionLabel="Tambah Arsip"
/>
```

### 3. Confirmation Dialogs

**Import:**
```jsx
import { useConfirmDialog } from '@/components/ConfirmDialog';
```

**Usage:**

```jsx
function MyComponent() {
    const { confirm, ConfirmDialog } = useConfirmDialog();

    const handleDelete = async (id) => {
        const confirmed = await confirm({
            title: 'Hapus Arsip?',
            description: 'Arsip yang dihapus tidak dapat dikembalikan. Apakah Anda yakin?',
            confirmText: 'Hapus',
            cancelText: 'Batal',
            variant: 'destructive'
        });

        if (confirmed) {
            await deleteArchive(id);
        }
    };

    return (
        <>
            <ConfirmDialog />
            <Button onClick={() => handleDelete(item.id)}>Hapus</Button>
        </>
    );
}
```

### 4. Keyboard Shortcuts

**Import:**
```jsx
import { useKeyboardShortcuts, COMMON_SHORTCUTS } from '@/hooks/useKeyboardShortcuts';
```

**Usage:**

```jsx
function MyPage() {
    const navigate = useNavigate();

    useKeyboardShortcuts([
        {
            ...COMMON_SHORTCUTS.SAVE,
            action: handleSave
        },
        {
            ...COMMON_SHORTCUTS.CANCEL,
            action: () => navigate(-1)
        },
        {
            key: 'n',
            ctrl: true,
            action: () => navigate('/surat/masuk/tambah'),
            description: 'Tambah Surat Baru'
        }
    ]);

    return <div>...</div>;
}
```

### 5. Error Boundary

**Import:**
```jsx
import ErrorBoundary from '@/components/ErrorBoundary';
```

**Usage:**

```jsx
// Wrap your routes or components
<ErrorBoundary fallbackMessage="Gagal memuat halaman">
    <MyComponent />
</ErrorBoundary>

// In App.jsx
<ErrorBoundary>
    <Routes>
        <Route path="/" element={<Dashboard />} />
        {/* ... */}
    </Routes>
</ErrorBoundary>
```

## Integration Examples

### Example 1: Surat Masuk Page

```jsx
import { useState, useEffect } from 'react';
import { TableSkeleton } from '@/components/LoadingSkeletons';
import { NoDataYet, ErrorState } from '@/components/EmptyState';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import { useKeyboardShortcuts, COMMON_SHORTCUTS } from '@/hooks/useKeyboardShortcuts';

function SuratMasuk() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [data, setData] = useState([]);
    const { confirm, ConfirmDialog } = useConfirmDialog();
    const navigate = useNavigate();

    // Keyboard shortcuts
    useKeyboardShortcuts([
        {
            ...COMMON_SHORTCUTS.NEW,
            action: () => navigate('/surat/masuk/tambah')
        },
        {
            ...COMMON_SHORTCUTS.REFRESH,
            action: loadData
        }
    ]);

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);
            const result = await suratService.getAll();
            setData(result);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        const confirmed = await confirm({
            title: 'Hapus Surat?',
            description: 'Data yang dihapus tidak dapat dikembalikan.',
            variant: 'destructive'
        });

        if (confirmed) {
            await suratService.delete(id);
            loadData();
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    if (loading) return <TableSkeleton rows={10} columns={6} />;
    if (error) return <ErrorState onRetry={loadData} />;
    if (data.length === 0) {
        return <NoDataYet entityName="surat masuk" onCreate={() => navigate('/surat/masuk/tambah')} />;
    }

    return (
        <>
            <ConfirmDialog />
            <DataTable data={data} onDelete={handleDelete} />
        </>
    );
}
```

### Example 2: Arsip Detail Page

```jsx
import { DetailSkeleton } from '@/components/LoadingSkeletons';
import { ErrorState } from '@/components/EmptyState';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import ErrorBoundary from '@/components/ErrorBoundary';

function ArsipDetail() {
    const { id } = useParams();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);
    const { confirm, ConfirmDialog } = useConfirmDialog();

    const handleDelete = async () => {
        const confirmed = await confirm({
            title: 'Hapus Arsip?',
            description: 'Arsip ini akan dihapus permanen. Lanjutkan?',
            variant: 'destructive'
        });

        if (confirmed) {
            await arsipService.delete(id);
            navigate('/arsip');
        }
    };

    if (loading) return <DetailSkeleton />;
    if (error) return <ErrorState onRetry={loadData} />;

    return (
        <ErrorBoundary>
            <ConfirmDialog />
            <div>
                {/* Detail content */}
                <Button onClick={handleDelete} variant="destructive">Hapus</Button>
            </div>
        </ErrorBoundary>
    );
}
```

## Best Practices

1. **Always show loading states** - Use skeletons instead of spinners
2. **Handle empty states** - Provide helpful messages and actions
3. **Confirm destructive actions** - Always use ConfirmDialog for delete/archive operations
4. **Add keyboard shortcuts** - Improve power user experience
5. **Wrap with Error Boundaries** - Prevent entire app crashes

## Testing Checklist

- [ ] Loading states display correctly
- [ ] Empty states show appropriate messages
- [ ] Confirmation dialogs work for delete operations
- [ ] Keyboard shortcuts function as expected
- [ ] Error boundaries catch and display errors
- [ ] All components are responsive on mobile

---

**Created**: 2026-02-12  
**Version**: 1.0
