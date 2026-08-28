import { Building2, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function RequiredUnitKerjaScope({ scope, disabled = false }) {
    if (!scope.isSuperAdmin) return null;

    return (
        <div className="space-y-2 rounded-lg border bg-card p-4">
            <Label className="flex items-center gap-2" htmlFor="required-unit-kerja">
                <Building2 className="h-4 w-4" /> Unit kerja tujuan
            </Label>
            <Select
                value={scope.selectedUnitKerjaId || undefined}
                onValueChange={scope.setSelectedUnitKerjaId}
                disabled={disabled || scope.loading}
            >
                <SelectTrigger id="required-unit-kerja" className="w-full sm:max-w-md">
                    <SelectValue placeholder={scope.loading ? 'Memuat unit kerja…' : 'Pilih satu unit kerja'} />
                </SelectTrigger>
                <SelectContent>
                    {scope.unitKerjaList.map(unit => (
                        <SelectItem key={unit.id} value={unit.id}>{unit.name || unit.id}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {scope.loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat cakupan unit…</p>}
            {!scope.loading && !scope.unitKerjaId && !scope.error && (
                <p className="text-xs text-amber-700 dark:text-amber-300">Pilih unit kerja sebelum memuat, mengunggah, atau mencetak data.</p>
            )}
            {scope.error && (
                <Alert variant="destructive"><AlertDescription>{scope.error}</AlertDescription></Alert>
            )}
        </div>
    );
}
