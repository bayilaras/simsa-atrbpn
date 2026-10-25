import { useCallback, useEffect, useMemo, useState } from 'react'

/** A page belongs to its query, so late responses cannot replace a new filter. */
export function usePaginatedResource(fetchPage, { queryKey = '', enabled = true, pageSize = 20 } = {}) {
    const scope = useMemo(() => ({ queryKey, enabled, fetchPage, pageSize }), [queryKey, enabled, fetchPage, pageSize])
    const [position, setPosition] = useState({ scope, page: 1 })
    const [revision, setRevision] = useState(0)
    const [snapshot, setSnapshot] = useState(null)
    const page = position.scope === scope ? position.page : 1

    useEffect(() => {
        if (!enabled) return
        let active = true
        Promise.resolve().then(() => fetchPage({ page, limit: pageSize })).then(response => {
            if (!active) return
            const rows = Array.isArray(response?.data) ? response.data : []
            const total = Number.isSafeInteger(response?.pagination?.total) ? response.pagination.total : rows.length
            const totalPages = Math.max(1, Math.ceil(total / pageSize))
            // A decision may remove the last item on the current page.
            if (page > totalPages) {
                setPosition({ scope, page: totalPages })
                return
            }
            setSnapshot({ scope, page, revision, rows, total, totalPages, response, error: null })
        }).catch(error => {
            if (active) setSnapshot({ scope, page, revision, rows: [], total: 0, totalPages: 1, error })
        })
        return () => { active = false }
    }, [enabled, fetchPage, page, pageSize, scope, revision])

    const current = enabled && snapshot?.scope === scope && snapshot.page === page && snapshot.revision === revision
    const setPage = useCallback(next => setPosition({ scope, page: Math.max(1, next) }), [scope])
    const reload = useCallback(() => setRevision(value => value + 1), [])
    return {
        rows: current ? snapshot.rows : [],
        response: current ? snapshot.response : null,
        error: current ? snapshot.error : null,
        loading: enabled && !current,
        page,
        total: current ? snapshot.total : 0,
        totalPages: current ? snapshot.totalPages : 1,
        setPage,
        reload,
    }
}
