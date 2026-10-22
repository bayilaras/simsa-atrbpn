import { useId } from 'react'
import { IMPORT_UNIT_REQUIRED } from '@/lib/google-sheets-import'

/**
 * An import button before a concrete unit is chosen. It stays focusable
 * (aria-disabled, not disabled) and opens nothing; its hint is the accessible
 * description and shows as a tooltip on hover, keyboard focus and tap.
 */
export default function ImportUnitRequiredButton({ className, children }) {
    const hintId = useId()
    return <span className="relative inline-flex">
        <button type="button" aria-disabled="true" aria-describedby={hintId} className={`peer ${className} cursor-not-allowed opacity-50`}>
            {children}
        </button>
        <span id={hintId} role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md peer-hover:block peer-focus:block">
            {IMPORT_UNIT_REQUIRED}
        </span>
    </span>
}
