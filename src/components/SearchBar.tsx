'use client'

import { useRef } from 'react'
import { Search, X } from 'lucide-react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}

export default function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = '장소명, 주소로 검색',
  autoFocus,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit?.(value)
    inputRef.current?.blur()
  }

  const handleClear = () => {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1" role="search">
      <div className="relative flex items-center">
        <Search
          size={18}
          className="absolute left-3.5 text-warm-400 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="
            w-full h-12 pl-10 pr-10
            bg-warm-50 border border-warm-200 rounded-xl
            text-[15px] text-warm-700 placeholder-warm-300
            focus:outline-none focus:ring-2 focus:ring-coral-300 focus:border-coral-300
            transition-all
          "
          aria-label={placeholder}
          inputMode="search"
          enterKeyHint="search"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="
              absolute right-3 min-w-[24px] min-h-[24px]
              flex items-center justify-center
              text-warm-400 hover:text-warm-600
            "
            aria-label="검색어 지우기"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </form>
  )
}
