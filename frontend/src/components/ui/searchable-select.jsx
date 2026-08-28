import * as React from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

/**
 * SearchableSelect - A select dropdown with built-in search/filter functionality.
 *
 * @param {Object} props
 * @param {Array<string|{value: string, label: string}>} props.options - Array of options
 * @param {string} props.value - Currently selected value
 * @param {function} props.onValueChange - Callback when value changes
 * @param {string} [props.placeholder] - Placeholder text
 * @param {string} [props.searchPlaceholder] - Search input placeholder
 * @param {string} [props.className] - Additional CSS classes for trigger
 * @param {boolean} [props.disabled] - Whether the select is disabled
 */
export function SearchableSelect({
    options = [],
    value,
    onValueChange,
    placeholder = "Pilih...",
    searchPlaceholder = "Cari...",
    className,
    disabled = false,
    id,
    ariaLabel,
}) {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")

    // Normalize options to { value, label } format
    const normalizedOptions = React.useMemo(() => {
        return options.map(opt =>
            typeof opt === "string" ? { value: opt, label: opt } : opt
        )
    }, [options])

    // Filter options based on search
    const filteredOptions = React.useMemo(() => {
        if (!search.trim()) return normalizedOptions
        const term = search.toLowerCase()
        return normalizedOptions.filter(opt =>
            opt.label.toLowerCase().includes(term)
        )
    }, [normalizedOptions, search])

    // Get display label for selected value
    const selectedLabel = React.useMemo(() => {
        const found = normalizedOptions.find(opt => opt.value === value)
        return found ? found.label : ""
    }, [normalizedOptions, value])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    id={id}
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={ariaLabel || placeholder}
                    disabled={disabled}
                    className={cn(
                        "w-full justify-between h-11 font-normal",
                        !value && "text-muted-foreground",
                        className
                    )}
                >
                    <span className="truncate">
                        {value ? selectedLabel : placeholder}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0" align="start">
                <div className="flex flex-col">
                    {/* Search Input */}
                    <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <input
                            type="text"
                            aria-label={searchPlaceholder}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={searchPlaceholder}
                            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                            autoFocus
                        />
                    </div>

                    {/* Options List */}
                    <div className="max-h-[300px] overflow-y-auto p-1">
                        {filteredOptions.length === 0 ? (
                            <div className="py-6 text-center text-sm text-muted-foreground">
                                Tidak ditemukan.
                            </div>
                        ) : (
                            filteredOptions.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => {
                                        onValueChange(opt.value === value ? "" : opt.value)
                                        setOpen(false)
                                        setSearch("")
                                    }}
                                    className={cn(
                                        "relative flex min-h-10 w-full cursor-default select-none items-center rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                                        opt.value === value && "bg-accent text-accent-foreground"
                                    )}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4 shrink-0",
                                            opt.value === value ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <span className="truncate">{opt.label}</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
