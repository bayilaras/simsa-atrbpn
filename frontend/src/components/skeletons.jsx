import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function DashboardSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-[200px]" />
                    <Skeleton className="h-4 w-[300px]" />
                </div>
                <Skeleton className="h-10 w-[120px]" />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Skeleton className="col-span-4 h-[350px] rounded-xl" />
                <Skeleton className="col-span-3 h-[350px] rounded-xl" />
            </div>
        </div>
    )
}

export function TableSkeleton({ rows = 5 }) {
    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <Skeleton className="h-10 w-[250px]" />
                <div className="flex gap-2">
                    <Skeleton className="h-10 w-[100px]" />
                    <Skeleton className="h-10 w-[120px]" />
                </div>
            </div>

            <div className="rounded-md border">
                <div className="border-b p-4">
                    <div className="flex justify-between">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-4 w-[100px]" />
                        ))}
                    </div>
                </div>
                <div className="divide-y">
                    {Array.from({ length: rows }).map((_, i) => (
                        <div key={i} className="p-4 flex justify-between items-center">
                            <Skeleton className="h-4 w-[30px]" />
                            <Skeleton className="h-4 w-[100px]" />
                            <Skeleton className="h-4 w-[150px]" />
                            <Skeleton className="h-4 w-[200px]" />
                            <Skeleton className="h-4 w-[100px]" />
                            <div className="flex gap-2">
                                <Skeleton className="h-8 w-8" />
                                <Skeleton className="h-8 w-8" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
