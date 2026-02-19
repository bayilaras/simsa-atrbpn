import { useToast } from "@/hooks/use-toast"
import { AlertCircle, CheckCircle, X, Info } from "lucide-react"

export function Toaster() {
    const { toasts, dismiss } = useToast()

    return (
        <div className="fixed top-0 right-0 z-[100] flex flex-col gap-2 p-4 w-full max-w-sm pointer-events-none">
            {toasts.map(function ({ id, title, description, variant, ...props }) {
                return (
                    <div
                        key={id}
                        className={`pointer-events-auto relative w-full overflow-hidden rounded-lg border p-4 shadow-lg transition-all
                            ${variant === 'destructive'
                                ? 'bg-destructive text-destructive-foreground border-destructive/50'
                                : 'bg-background text-foreground border-border'
                            }
                        `}
                        {...props}
                    >
                        <div className="flex gap-3">
                            {variant === 'destructive' ? (
                                <AlertCircle className="h-5 w-5 shrink-0" />
                            ) : variant === 'success' ? (
                                <CheckCircle className="h-5 w-5 shrink-0 text-green-500" />
                            ) : (
                                <Info className="h-5 w-5 shrink-0 text-blue-500" />
                            )}

                            <div className="flex-1 space-y-1">
                                {title && <div className="font-medium leading-none tracking-tight">{title}</div>}
                                {description && (
                                    <div className={`text-sm opacity-90 ${variant === 'destructive' ? '' : 'text-muted-foreground'}`}>
                                        {description}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => dismiss(id)}
                                className={`shrink-0 rounded-md p-0.5 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 
                                    ${variant === 'destructive'
                                        ? 'text-destructive-foreground/50 hover:text-destructive-foreground focus:ring-destructive'
                                        : 'text-muted-foreground/50 hover:text-foreground focus:ring-ring'
                                    }
                                `}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
