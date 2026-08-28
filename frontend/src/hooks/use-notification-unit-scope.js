import { useEffect, useState } from 'react';
import settingsService from '@/services/settings.service';
import { resolveEffectiveUnitKerjaId } from '@/lib/unit-kerja-scope';

export function normalizeNotificationUnits(units) {
    if (!Array.isArray(units)) return [];
    return units
        .filter(unit => typeof unit?.id === 'string' && unit.id.trim())
        .map(unit => ({
            ...unit,
            id: unit.id.trim(),
            label: unit.name || unit.label || unit.id,
        }));
}

export function chooseNotificationUnit(units, current = '') {
    if (units.some(unit => unit.id === current)) return current;
    return units[0]?.id || '';
}

export function useNotificationUnitScope(user) {
    const isSuperAdmin = user?.role === 'super_admin';
    const [selectedUnitKerjaId, setSelectedUnitKerjaId] = useState('');
    const [unitKerjaList, setUnitKerjaList] = useState([]);
    const [loadedForUserId, setLoadedForUserId] = useState('');
    const [error, setError] = useState('');
    const superAdminKey = isSuperAdmin ? (user?.id || 'super_admin') : '';

    useEffect(() => {
        if (!isSuperAdmin) return;

        let active = true;
        settingsService.getAllUnitKerja()
            .then((units) => {
                if (!active) return;
                const normalized = normalizeNotificationUnits(units);
                setUnitKerjaList(normalized);
                setSelectedUnitKerjaId(current => chooseNotificationUnit(normalized, current));
                setError(normalized.length > 0 ? '' : 'Unit kerja tidak tersedia');
                setLoadedForUserId(superAdminKey);
            })
            .catch((requestError) => {
                if (!active) return;
                setUnitKerjaList([]);
                setSelectedUnitKerjaId('');
                setError(requestError?.message || 'Daftar unit kerja gagal dimuat');
                setLoadedForUserId(superAdminKey);
            });

        return () => { active = false; };
    }, [isSuperAdmin, superAdminKey]);

    const hasCurrentSuperAdminUnits = isSuperAdmin && loadedForUserId === superAdminKey;

    return {
        isSuperAdmin,
        unitKerjaId: isSuperAdmin
            ? (hasCurrentSuperAdminUnits ? selectedUnitKerjaId : '')
            : resolveEffectiveUnitKerjaId(user),
        selectedUnitKerjaId: hasCurrentSuperAdminUnits ? selectedUnitKerjaId : '',
        setSelectedUnitKerjaId,
        unitKerjaList: hasCurrentSuperAdminUnits ? unitKerjaList : [],
        loading: isSuperAdmin && !hasCurrentSuperAdminUnits,
        error: hasCurrentSuperAdminUnits ? error : '',
    };
}
