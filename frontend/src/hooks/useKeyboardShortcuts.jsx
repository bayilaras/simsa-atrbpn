import { useEffect, useCallback } from 'react';

/* eslint-disable react-refresh/only-export-components -- this utility module intentionally exports hooks, constants, and its help component */

/**
 * Keyboard Shortcuts Hook
 * Provides easy keyboard shortcut management for common actions
 */

export function useKeyboardShortcuts(shortcuts, enabled = true) {
    const handleKeyDown = useCallback((event) => {
        if (!enabled) return;

        for (const shortcut of shortcuts) {
            const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
            const ctrlMatch = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
            const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
            const altMatch = shortcut.alt ? event.altKey : !event.altKey;

            if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
                if (shortcut.preventDefault !== false) {
                    event.preventDefault();
                }
                shortcut.action();
                break;
            }
        }
    }, [shortcuts, enabled]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}

/**
 * Common keyboard shortcuts for SIMSA application
 */
export const COMMON_SHORTCUTS = {
    // Navigation
    DASHBOARD: { key: 'd', ctrl: true, description: 'Go to Dashboard' },
    SEARCH: { key: 'k', ctrl: true, description: 'Open Search' },

    // Actions
    NEW: { key: 'n', ctrl: true, description: 'Create New' },
    SAVE: { key: 's', ctrl: true, description: 'Save' },
    CANCEL: { key: 'Escape', description: 'Cancel/Close' },
    REFRESH: { key: 'r', ctrl: true, description: 'Refresh' },

    // Editing
    EDIT: { key: 'e', ctrl: true, description: 'Edit' },
    DELETE: { key: 'Delete', description: 'Delete' },

    // Help
    HELP: { key: '?', shift: true, description: 'Show Keyboard Shortcuts' },
};

/**
 * Keyboard Shortcuts Help Dialog Component
 */
export function KeyboardShortcutsHelp({ shortcuts, onClose }) {
    useKeyboardShortcuts([
        { key: 'Escape', action: onClose }
    ]);

    const formatShortcut = (shortcut) => {
        const keys = [];
        if (shortcut.ctrl) keys.push('Ctrl');
        if (shortcut.shift) keys.push('Shift');
        if (shortcut.alt) keys.push('Alt');
        keys.push(shortcut.key.toUpperCase());
        return keys.join(' + ');
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-card rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b">
                    <h2 className="text-2xl font-bold">Keyboard Shortcuts</h2>
                    <p className="text-muted-foreground mt-1">
                        Use these shortcuts to navigate faster
                    </p>
                </div>

                <div className="p-6">
                    <div className="space-y-3">
                        {shortcuts.filter(s => s.description).map((shortcut, index) => (
                            <div key={index} className="flex items-center justify-between py-2 border-b last:border-0">
                                <span className="text-sm">{shortcut.description}</span>
                                <kbd className="px-3 py-1.5 text-sm font-semibold bg-muted border border-border rounded">
                                    {formatShortcut(shortcut)}
                                </kbd>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-6 border-t bg-muted/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default useKeyboardShortcuts;
