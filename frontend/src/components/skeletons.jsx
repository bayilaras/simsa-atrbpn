import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function DashboardSkeleton() {
    return (
        <div role="status" aria-label="Memuat dasbor" className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4" aria-hidden="true">
                <div className="min-w-0 max-w-full space-y-2">
                    <Skeleton className="h-8 w-[200px]" />
                    <Skeleton className="h-4 w-[300px] max-w-full" />
                </div>
                <Skeleton className="h-10 w-[120px]" />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <Skeleton className="h-4 w-[100px]" />
                            <Skeleton className="h-4 w-4 rounded-full" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-8 w-[60px] mb-1" />
                            <Skeleton className="h-3 w-[120px]" />
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-7" aria-hidden="true">
                <Skeleton className="min-w-0 h-[350px] rounded-xl lg:col-span-4" />
                <Skeleton className="min-w-0 h-[350px] rounded-xl lg:col-span-3" />
            </div>
        </div>
    )
}

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
    )
}
