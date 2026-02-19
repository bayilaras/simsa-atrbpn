import { FileQuestion, Inbox, Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Empty State Components
 * Helpful empty states with actions for better UX
 */

export function EmptyState({
    icon: Icon = Inbox,
    title = 'No data found',
    description = 'Get started by creating a new item',
    action,
    actionLabel,
    secondaryAction,
    secondaryActionLabel,
    className = ''
}) {
    return (
        <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Icon className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{title}</h3>
            <p className="text-muted-foreground mb-6 max-w-md">{description}</p>
            {action && (
                <div className="flex gap-3">
                    <Button onClick={action}>
                        <Plus className="w-4 h-4 mr-2" />
                        {actionLabel || 'Create New'}
                    </Button>
                    {secondaryAction && (
                        <Button variant="outline" onClick={secondaryAction}>
                            {secondaryActionLabel || 'Learn More'}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

export function NoSearchResults({ query, onClear }) {
    return (
        <EmptyState
            icon={Search}
            title="No results found"
            description={`We couldn't find anything matching "${query}". Try adjusting your search terms.`}
            action={onClear}
            actionLabel="Clear Search"
        />
    );
}

export function NoDataYet({ entityName = 'items', onCreate }) {
    return (
        <EmptyState
            icon={Inbox}
            title={`No ${entityName} yet`}
            description={`You haven't created any ${entityName} yet. Get started by creating your first one.`}
            action={onCreate}
            actionLabel={`Create ${entityName}`}
        />
    );
}

export function ErrorState({
    title = 'Something went wrong',
    description = 'An error occurred while loading the data. Please try again.',
    onRetry
}) {
    return (
        <EmptyState
            icon={FileQuestion}
            title={title}
            description={description}
            action={onRetry}
            actionLabel="Try Again"
        />
    );
}

export default EmptyState;
