import { useState, useMemo, useEffect, useRef } from 'react'

export function useDataTable(dataInput, { pageSize = 10, defaultSort = null, dependencies = [] } = {}) {
    const [currentPage, setCurrentPage] = useState(1)
    const [sortConfig, setSortConfig] = useState(defaultSort)

    // Server-side state
    const [serverData, setServerData] = useState([])
    const [serverTotal, setServerTotal] = useState(0)
    const [isLoading, setIsLoading] = useState(false)

    // Check mode
    const isServerSide = typeof dataInput === 'function'

    // Client-side sorting
    const sortedData = useMemo(() => {
        if (isServerSide || !Array.isArray(dataInput)) return [];
        const data = dataInput;

        if (!sortConfig) return data;

        return [...data].sort((a, b) => {
            if (a[sortConfig.key] < b[sortConfig.key]) {
                return sortConfig.direction === 'ascending' ? -1 : 1;
            }
            if (a[sortConfig.key] > b[sortConfig.key]) {
                return sortConfig.direction === 'ascending' ? 1 : -1;
            }
            return 0;
        });
    }, [dataInput, sortConfig, isServerSide]);

    // When the filter dependencies change the result set changes too, so the
    // current page may no longer exist — restart from the first page before fetching
    const prevDependenciesRef = useRef(null);
    const prevDependencies = prevDependenciesRef.current;
    prevDependenciesRef.current = dependencies;

    if (
        prevDependencies &&
        currentPage !== 1 &&
        (prevDependencies.length !== dependencies.length ||
            dependencies.some((dep, index) => !Object.is(dep, prevDependencies[index])))
    ) {
        setCurrentPage(1);
    }

    // Server-side fetching
    useEffect(() => {
        if (!isServerSide) return;

        let isMounted = true;
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const result = await dataInput(currentPage, pageSize);
                if (isMounted) {
                    setServerData(result.data || []);
                    setServerTotal(result.total || 0);
                }
            } catch (error) {
                console.error("Error fetching data in useDataTable:", error);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        fetchData();

        return () => { isMounted = false; };
    }, [isServerSide, currentPage, pageSize, ...dependencies]);

    const totalItems = isServerSide ? serverTotal : (sortedData.length || 0);
    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    // Client-side data can shrink below the current page (e.g. after filtering)
    if (!isServerSide && currentPage > totalPages) {
        setCurrentPage(totalPages);
    }

    const currentData = useMemo(() => {
        if (isServerSide) return serverData;
        const start = (currentPage - 1) * pageSize;
        return sortedData.slice(start, start + pageSize);
    }, [isServerSide, serverData, sortedData, currentPage, pageSize]);

    const goToPage = (page) => {
        const pageNumber = Math.max(1, Math.min(page, totalPages));
        setCurrentPage(pageNumber);
    }

    const nextPage = () => {
        goToPage(currentPage + 1)
    }

    const prevPage = () => {
        goToPage(currentPage - 1)
    }

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    }

    return {
        currentData,
        currentPage,
        totalPages,
        goToPage,
        nextPage,
        prevPage,
        canNext: currentPage < totalPages,
        canPrev: currentPage > 1,
        sortConfig,
        requestSort,
        totalItems,
        setPage: goToPage,
        isLoading
    }
}
