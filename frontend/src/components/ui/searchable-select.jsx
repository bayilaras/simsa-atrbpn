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
 * Keyboard: the search field keeps focus while ArrowDown/ArrowUp (and
 * Home/End with Ctrl) move the highlighted option, Enter picks it and Escape
 * closes the list. The list follows the WAI-ARIA combobox pattern: the field
 * points at the highlighted option through aria-activedescendant.
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
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
}) {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")
    const [aktif, setAktif] = React.useState(0)
    const idDasar = React.useId()
    const idDaftar = `${idDasar}-daftar`
    const idOpsi = (index) => `${idDasar}-opsi-${index}`

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

    const jumlah = filteredOptions.length
    const indeksAktif = jumlah === 0 ? -1 : Math.min(Math.max(aktif, 0), jumlah - 1)

    const ubahTerbuka = (terbuka) => {
        setOpen(terbuka)
        if (terbuka) {
            // The list opens unfiltered with the current choice highlighted.
            setAktif(Math.max(0, normalizedOptions.findIndex(opt => opt.value === value)))
        } else {
            setSearch("")
        }
    }

    const pilih = (opt) => {
        onValueChange(opt.value === value ? "" : opt.value)
        setOpen(false)
        setSearch("")
    }

    const sorot = (index) => {
        setAktif(index)
        document.getElementById(idOpsi(index))?.scrollIntoView?.({ block: "nearest" })
    }

    const tanganiTombol = (event) => {
        if (jumlah === 0) return
        if (event.key === "ArrowDown") {
            event.preventDefault()
            sorot(indeksAktif < jumlah - 1 ? indeksAktif + 1 : 0)
        } else if (event.key === "ArrowUp") {
            event.preventDefault()
            sorot(indeksAktif > 0 ? indeksAktif - 1 : jumlah - 1)
        } else if ((event.key === "Home" || event.key === "End") && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            sorot(event.key === "Home" ? 0 : jumlah - 1)
        } else if (event.key === "Enter") {
            event.preventDefault()
            if (indeksAktif >= 0) pilih(filteredOptions[indeksAktif])
        }
    }

    return (
        <Popover open={open} onOpenChange={ubahTerbuka}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    id={id}
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-controls={open ? idDaftar : undefined}
                    aria-label={ariaLabel || placeholder}
                    aria-invalid={ariaInvalid}
                    aria-describedby={ariaDescribedBy}
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
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0" align="start">
                <div className="flex flex-col">
                    {/* Search Input */}
                    <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                        <input
                            type="text"
                            role="combobox"
                            aria-label={searchPlaceholder}
                            aria-expanded="true"
                            aria-controls={idDaftar}
                            aria-autocomplete="list"
                            aria-activedescendant={indeksAktif >= 0 ? idOpsi(indeksAktif) : undefined}
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value)
                                setAktif(0)
                            }}
                            onKeyDown={tanganiTombol}
                            placeholder={searchPlaceholder}
                            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                            autoFocus
                        />
                    </div>

                    {/* Options List */}
                    <div
                        id={idDaftar}
                        role="listbox"
                        aria-label={ariaLabel || placeholder}
                        className="max-h-[300px] overflow-y-auto p-1"
                    >
                        {jumlah === 0 ? (
                            <div role="presentation" className="py-6 text-center text-sm text-muted-foreground">
                                Tidak ditemukan.
                            </div>
                        ) : (
                            filteredOptions.map((opt, index) => (
                                <div
                                    key={opt.value}
                                    id={idOpsi(index)}
                                    role="option"
                                    aria-selected={opt.value === value}
                                    data-aktif={index === indeksAktif ? "" : undefined}
                                    onClick={() => pilih(opt)}
                                    onMouseMove={() => { if (index !== indeksAktif) setAktif(index) }}
                                    className={cn(
                                        "relative flex min-h-10 w-full cursor-default select-none items-center rounded-sm px-2 py-2 text-left text-sm outline-none",
                                        index === indeksAktif && "bg-accent text-accent-foreground ring-1 ring-ring/40",
                                        opt.value === value && index !== indeksAktif && "bg-accent/60 text-accent-foreground"
                                    )}
                                >
                                    <Check
                                        aria-hidden="true"
                                        className={cn(
                                            "mr-2 h-4 w-4 shrink-0",
                                            opt.value === value ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <span className="truncate">{opt.label}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
