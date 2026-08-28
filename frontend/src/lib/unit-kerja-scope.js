export const ROLE_MANDATED_UNIT_KERJA = Object.freeze({
    admin_dirjen: 'ditjen',
    admin_sesditjen: 'sesditjen',
});

export function getRoleMandatedUnitKerjaId(role) {
    return ROLE_MANDATED_UNIT_KERJA[role] || '';
}

export function resolveManagedUserUnitKerjaId(role, currentUnitKerjaId = '') {
    if (role === 'super_admin') return '';
    return getRoleMandatedUnitKerjaId(role) || currentUnitKerjaId || '';
}

export function resolveEffectiveUnitKerjaId(user, requestedUnitKerjaId = '') {
    if (!user) return '';

    const mandatedUnitKerjaId = getRoleMandatedUnitKerjaId(user.role);
    if (mandatedUnitKerjaId) return mandatedUnitKerjaId;
    if (user.role === 'super_admin') return requestedUnitKerjaId || '';
    return user.unitKerjaId || '';
}

export function normalizeAuthenticatedUserUnitScope(user) {
    if (!user) return user;
    return {
        ...user,
        unitKerjaId: resolveEffectiveUnitKerjaId(user),
    };
}
