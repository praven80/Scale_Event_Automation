import { useState, useMemo } from 'react'

const PAGE_SIZE = 20

export function useTableState<T>(items: T[], opts?: { defaultSortField?: string }) {
  const [filterText, setFilterText] = useState('')
  const [sortField, setSortField] = useState(opts?.defaultSortField || '')
  const [sortAsc, setSortAsc] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)

  const filtered = useMemo(() => {
    if (!filterText) return items
    const lower = filterText.toLowerCase()
    return items.filter(item =>
      Object.values(item as Record<string, unknown>).some(v =>
        String(v ?? '').toLowerCase().includes(lower)
      )
    )
  }, [items, filterText])

  const sorted = useMemo(() => {
    if (!sortField) return filtered
    return [...filtered].sort((a, b) => {
      const rawA = (a as any)[sortField] ?? ''
      const rawB = (b as any)[sortField] ?? ''
      const numA = parseFloat(String(rawA).replace(/[^0-9.-]/g, ''))
      const numB = parseFloat(String(rawB).replace(/[^0-9.-]/g, ''))
      let cmp: number
      if (!isNaN(numA) && !isNaN(numB)) {
        cmp = numA - numB
      } else {
        cmp = String(rawA).toLowerCase().localeCompare(String(rawB).toLowerCase())
      }
      return sortAsc ? cmp : -cmp
    })
  }, [filtered, sortField, sortAsc])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return {
    paged,
    filtered: sorted,
    filterText,
    setFilterText: (t: string) => { setFilterText(t); setCurrentPage(1) },
    sortField,
    sortAsc,
    onSort: (field: string) => {
      if (field === sortField) setSortAsc(!sortAsc)
      else { setSortField(field); setSortAsc(true) }
    },
    currentPage: safePage,
    totalPages,
    setCurrentPage,
    pageSize: PAGE_SIZE,
  }
}
