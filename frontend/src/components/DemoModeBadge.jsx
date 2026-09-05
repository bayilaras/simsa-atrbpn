/** Kept inside the sticky header so the synthetic-data warning survives scroll. */
export function DemoModeBadge({ mode }) {
    if (mode !== 'metadata-demo') return null
    return (
        <span
            role="note"
            className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-950"
            title="Demo — hanya gunakan data contoh; dokumen asli dinonaktifkan."
        >
            Demo<span className="hidden sm:inline"> — data contoh</span>
            <span className="sr-only sm:hidden"> — hanya gunakan data contoh</span>
        </span>
    )
}
