'use client'

import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, Search } from 'lucide-react'

export interface Column<T> {
  key: string
  label: string
  width?: string
  sortable?: boolean
  render?: (value: any, row: T) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  searchableFields?: (keyof T)[]
  defaultSortKey?: string
  defaultSortDir?: 'asc' | 'desc'
  pageSize?: number
  onRowClick?: (row: T) => void
  emptyMessage?: string
}

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  searchableFields = [],
  defaultSortKey = '',
  defaultSortDir = 'asc',
  pageSize = 10,
  onRowClick,
  emptyMessage = 'No data found',
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)
  const [currentPage, setCurrentPage] = useState(1)

  // Filter data
  const filteredData = useMemo(() => {
    if (!searchQuery || searchableFields.length === 0) return data

    return data.filter((row) =>
      searchableFields.some((field) => {
        const value = row[field]
        return value
          ?.toString()
          .toLowerCase()
          .includes(searchQuery.toLowerCase())
      })
    )
  }, [data, searchQuery, searchableFields])

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]

      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      if (typeof aVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      if (typeof aVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }

      return 0
    })
  }, [filteredData, sortKey, sortDir])

  // Paginate
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [sortedData, currentPage, pageSize])

  const totalPages = Math.ceil(sortedData.length / pageSize)

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setCurrentPage(1)
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setCurrentPage(1)
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      {searchableFields.length > 0 && (
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3 top-3 text-warm-400"
          />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="
              w-full pl-10 pr-4 py-2 rounded-lg border border-warm-200
              bg-white text-warm-700 placeholder-warm-400
              focus:outline-none focus:ring-2 focus:ring-coral-400
            "
          />
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-warm-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-warm-50 border-b border-warm-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`
                    px-4 py-3 text-left font-semibold text-warm-700
                    ${col.width || ''}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span>{col.label}</span>
                    {col.sortable && (
                      <button
                        onClick={() => handleSort(col.key)}
                        className="ml-2 p-1 hover:bg-warm-100 rounded transition"
                      >
                        {sortKey === col.key ? (
                          sortDir === 'asc' ? (
                            <ChevronUp size={16} />
                          ) : (
                            <ChevronDown size={16} />
                          )
                        ) : (
                          <ChevronDown size={16} className="opacity-30" />
                        )}
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-warm-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, idx) => (
                <tr
                  key={idx}
                  onClick={() => onRowClick?.(row)}
                  className={`
                    border-b border-warm-100 last:border-b-0
                    ${onRowClick ? 'hover:bg-warm-50 cursor-pointer' : ''}
                    transition
                  `}
                >
                  {columns.map((col) => (
                    <td
                      key={`${idx}-${col.key}`}
                      className={`px-4 py-3 text-warm-700 ${col.width || ''}`}
                    >
                      {col.render
                        ? col.render(row[col.key], row)
                        : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-warm-500">
            Page {currentPage} of {totalPages} ({sortedData.length} total)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="
                px-3 py-2 rounded-lg border border-warm-200 bg-white
                text-warm-700 font-medium disabled:opacity-50
                hover:enabled:bg-warm-50 transition
              "
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="
                px-3 py-2 rounded-lg border border-warm-200 bg-white
                text-warm-700 font-medium disabled:opacity-50
                hover:enabled:bg-warm-50 transition
              "
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
