import { useEffect, useState } from 'react';
import settingsService from '@/services/settings.service';
import { getRoleMandatedUnitKerjaId, resolveEffectiveUnitKerjaId } from '@/lib/unit-kerja-scope';

export function resolveRequiredUnitKerjaId(user, selectedUnitKerjaId = '', fixedUnitKerjaId = '') {
    if (!user) return '';
    return user.role === 'super_admin'
        ? (fixedUnitKerjaId || selectedUnitKerjaId)
        : resolveEffectiveUnitKerjaId(user);
}

export function useRequiredUnitKerjaScope(user, { fixedUnitKerjaId = '' } = {}) {
    const isSuperAdmin = user?.role === 'super_admin';
    const [selectedUnitKerjaId, setSelectedUnitKerjaId] = useState('');
    const [unitKerjaList, setUnitKerjaList] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isSuperAdmin) return;
        let active = true;

        settingsService.getAllUnitKerja()
            .then((units) => {
                if (!active) return;
                const list = Array.isArray(units) ? units : [];
                setUnitKerjaList(list);
                setSelectedUnitKerjaId(current => (
                    list.some(unit => unit.id === current) ? current : ''
                ));
                setError('');
                setLoaded(true);
            })
            .catch((requestError) => {
                if (!active) return;
                setUnitKerjaList([]);
                setSelectedUnitKerjaId('');
                setError(requestError.message || 'Daftar unit kerja gagal dimuat');
                setLoaded(true);
            });

        return () => { active = false; };
    }, [isSuperAdmin]);

    const mandatedUnitKerjaId = getRoleMandatedUnitKerjaId(user?.role);
    const effectiveSelectedUnitKerjaId = mandatedUnitKerjaId || fixedUnitKerjaId || selectedUnitKerjaId;

    return {
        isSuperAdmin,
        unitKerjaId: resolveRequiredUnitKerjaId(user, selectedUnitKerjaId, fixedUnitKerjaId),
        selectedUnitKerjaId: effectiveSelectedUnitKerjaId,
        setSelectedUnitKerjaId: (fixedUnitKerjaId || mandatedUnitKerjaId) ? () => {} : setSelectedUnitKerjaId,
        unitKerjaList,
        loading: isSuperAdmin && !loaded,
        error,
        locked: Boolean(fixedUnitKerjaId || mandatedUnitKerjaId),
    };
}
