import React from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Confirmation Dialog Component
 * Reusable confirmation dialog for destructive actions
 */

export function ConfirmDialog({
    open,
    onOpenChange,
    onConfirm,
    title = 'Are you sure?',
    description = 'This action cannot be undone.',
    confirmText = 'Continue',
    cancelText = 'Cancel',
    variant = 'destructive' // 'destructive' | 'default'
}) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{cancelText}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={onConfirm}
                        className={variant === 'destructive' ? 'bg-red-600 hover:bg-red-700' : ''}
                    >
                        {confirmText}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/**
 * Hook for managing confirmation dialogs
 */
export function useConfirmDialog() {
    const [isOpen, setIsOpen] = React.useState(false);
    const [config, setConfig] = React.useState({});
    const resolveRef = React.useRef(null);

    const confirm = (options = {}) => {
        setConfig(options);
        setIsOpen(true);

        return new Promise((resolve) => {
            resolveRef.current = resolve;
        });
    };

    const handleConfirm = () => {
        resolveRef.current?.(true);
        setIsOpen(false);
    };

    const handleCancel = () => {
        resolveRef.current?.(false);
        setIsOpen(false);
    };

    const ConfirmDialogComponent = () => (
        <ConfirmDialog
            open={isOpen}
            onOpenChange={setIsOpen}
            onConfirm={handleConfirm}
            {...config}
        />
    );

    return { confirm, ConfirmDialog: ConfirmDialogComponent };
}

export default ConfirmDialog;
