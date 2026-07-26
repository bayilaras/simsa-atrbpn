import { cn } from '@/lib/utils'

/**
 * Standard page heading.
 *
 * Every page opens the same way: an optional icon, the title, a one-line
 * description, and the page-level actions. Actions drop below the title on
 * narrow screens so a long title and a two-button toolbar never collide.
 */
export function PageHeader({ icon: Icon, title, description, actions, className, children }) {
    return (
        <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
            <div className="flex min-w-0 items-start gap-3">
                {Icon && (
                    <span className="mt-0.5 hidden shrink-0 rounded-md bg-accent p-2 text-accent-foreground sm:inline-flex">
                        <Icon className="h-5 w-5" />
                    </span>
                )}
                <div className="min-w-0 space-y-1">
                    <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
                    {description && (
                        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
                    )}
                    {children}
                </div>
            </div>
            {actions && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
            )}
        </div>
    )
}

/**
 * Compact metric tile for the row of numbers a page leads with.
 *
 * `tone` colours only the value and icon — the surface stays neutral so a
 * screenful of tiles does not turn into a block of competing colour.
 */
const TONES = {
    default: 'text-foreground',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
}

export function StatTile({ icon: Icon, label, value, hint, tone = 'default', className }) {
    return (
        <div className={cn('rounded-lg border bg-card p-4', className)}>
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                </p>
                {Icon && <Icon className={cn('h-4 w-4 shrink-0', TONES[tone])} />}
            </div>
            <p className={cn('mt-2 text-2xl font-semibold tabular-nums', TONES[tone])}>{value}</p>
            {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
    )
}

export default PageHeader
