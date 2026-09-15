import { useEffect, useState } from 'react'
import { arsipService } from '@/services/arsip.service'

// The complete query owns its response, including page and refresh generation.
// This prevents another unit's data or an older search from flashing on screen.
export function useArchiveList({ scope, tab, search, tahun, unitKerjaId, page, pageSize, revision, onPageChange }) {
    const [snapshot, setSnapshot] = useState(null)
    const key = JSON.stringify([scope, tab, search, tahun, unitKerjaId, page, pageSize, revision])
    const enabled = tab !== 'retensi'

    useEffect(() => {
        if (!enabled) return
        let active = true
        Promise.resolve().then(() => arsipService.getAll({
            jenisArsip: tab, search, tahun: tahun === 'all' ? undefined : Number(tahun),
            unitKerjaId, page, limit: pageSize,
        })).then(response => {
            if (!active) return
            if (!Array.isArray(response?.data) || !Number.isSafeInteger(response?.pagination?.total) || response.pagination.total < 0) {
                throw new Error('Daftar arsip tidak lengkap.')
            }
            const total = response.pagination.total
            const totalPages = Math.max(1, Math.ceil(total / pageSize))
            if (page > totalPages) {
                onPageChange(totalPages, true)
                return
            }
            setSnapshot({ key, rows: response.data, total, totalPages, error: null })
        }).catch(error => {
            if (active) setSnapshot({ key, rows: [], total: 0, totalPages: 1, error })
        })
        return () => { active = false }
    }, [enabled, key, tab, search, tahun, unitKerjaId, page, pageSize, onPageChange])

    const current = enabled && snapshot?.key === key
    return {
        key,
        rows: current ? snapshot.rows : [],
        total: current ? snapshot.total : 0,
        totalPages: current ? snapshot.totalPages : 1,
        error: current ? snapshot.error : null,
        loading: enabled && !current,
    }
}
