/**
 * Loading Skeleton Components
 * Reusable skeleton loaders for better perceived performance
 */

export function TableSkeleton({ rows = 5, columns = 5 }) {
    return (
        <div className="w-full space-y-3">
            {/* Header */}
            <div className="flex gap-4 pb-3 border-b">
                {Array.from({ length: columns }).map((_, i) => (
                    <div key={i} className="flex-1">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                    </div>
                ))}
            </div>

            {/* Rows */}
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex gap-4 py-3">
                    {Array.from({ length: columns }).map((_, colIndex) => (
                        <div key={colIndex} className="flex-1">
                            <div className="h-4 bg-muted rounded animate-pulse" />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export function CardSkeleton({ count = 3 }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="border rounded-lg p-4 space-y-3">
                    <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                    <div className="h-3 bg-muted rounded w-full animate-pulse" />
                    <div className="h-3 bg-muted rounded w-5/6 animate-pulse" />
                    <div className="flex gap-2 mt-4">
                        <div className="h-8 bg-muted rounded w-20 animate-pulse" />
                        <div className="h-8 bg-muted rounded w-20 animate-pulse" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function FormSkeleton() {
    return (
        <div className="space-y-6 max-w-2xl">
            {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32 animate-pulse" />
                    <div className="h-10 bg-muted rounded w-full animate-pulse" />
                </div>
            ))}
            <div className="flex gap-3 pt-4">
                <div className="h-10 bg-muted rounded w-24 animate-pulse" />
                <div className="h-10 bg-muted rounded w-24 animate-pulse" />
            </div>
        </div>
    );
}

export function DetailSkeleton() {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="space-y-3">
                <div className="h-8 bg-muted rounded w-1/2 animate-pulse" />
                <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
            </div>

            {/* Content sections */}
            {Array.from({ length: 3 }).map((_, sectionIndex) => (
                <div key={sectionIndex} className="border rounded-lg p-6 space-y-4">
                    <div className="h-5 bg-muted rounded w-1/4 animate-pulse" />
                    <div className="grid grid-cols-2 gap-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="space-y-2">
                                <div className="h-3 bg-muted rounded w-24 animate-pulse" />
                                <div className="h-4 bg-muted rounded w-full animate-pulse" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ListSkeleton({ items = 5 }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: items }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
                    <div className="w-12 h-12 bg-muted rounded-full animate-pulse flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                        <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
                    </div>
                    <div className="w-20 h-8 bg-muted rounded animate-pulse" />
                </div>
            ))}
        </div>
    );
}

export function StatsSkeleton({ count = 4 }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="border rounded-lg p-6 space-y-3">
                    <div className="h-4 bg-muted rounded w-24 animate-pulse" />
                    <div className="h-8 bg-muted rounded w-20 animate-pulse" />
                    <div className="h-3 bg-muted rounded w-32 animate-pulse" />
                </div>
            ))}
        </div>
    );
}

// Generic skeleton for any content
export function ContentSkeleton({ lines = 5, className = '' }) {
    return (
        <div className={`space-y-3 ${className}`}>
            {Array.from({ length: lines }).map((_, i) => (
                <div
                    key={i}
                    className="h-4 bg-muted rounded animate-pulse"
                    style={{ width: `${Math.random() * 30 + 70}%` }}
                />
            ))}
        </div>
    );
}

export default {
    Table: TableSkeleton,
    Card: CardSkeleton,
    Form: FormSkeleton,
    Detail: DetailSkeleton,
    List: ListSkeleton,
    Stats: StatsSkeleton,
    Content: ContentSkeleton
};
