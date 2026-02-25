'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Map, Search, BookOpen, Heart, User } from 'lucide-react'

const NAV_ITEMS = [
  {
    href: '/',
    label: '홈',
    icon: Map,
    matchPaths: ['/'],
  },
  {
    href: '/search',
    label: '검색',
    icon: Search,
    matchPaths: ['/search'],
  },
  {
    href: '/diary',
    label: '다이어리',
    icon: BookOpen,
    matchPaths: ['/diary'],
  },
  {
    href: '/favorites',
    label: '찜',
    icon: Heart,
    matchPaths: ['/favorites'],
  },
  {
    href: '/profile',
    label: '내 정보',
    icon: User,
    matchPaths: ['/profile', '/login'],
  },
] as const

export default function BottomNav() {
  const pathname = usePathname()

  const isActive = (matchPaths: readonly string[]) =>
    matchPaths.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p)))

  return (
    <nav
      className="
        fixed bottom-0 left-0 right-0 z-40
        bg-white border-t border-warm-200
        pb-safe-bottom
      "
      aria-label="하단 탭 네비게이션"
    >
      <div className="flex items-center justify-around">
        {NAV_ITEMS.map(({ href, label, icon: Icon, matchPaths }) => {
          const active = isActive(matchPaths)
          return (
            <Link
              key={href}
              href={href}
              className={`
                flex flex-col items-center justify-center
                flex-1 min-h-[56px] py-2 gap-1
                transition-colors duration-150
                ${active ? 'text-coral-500' : 'text-warm-400'}
              `}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
            >
              <Icon
                size={24}
                className={active ? 'fill-none stroke-coral-500' : 'fill-none stroke-warm-400'}
                aria-hidden="true"
              />
              <span
                className={`
                  text-[10px] font-medium
                  ${active ? 'text-coral-500' : 'text-warm-400'}
                `}
              >
                {label}
              </span>
              {active && (
                <span className="sr-only">현재 페이지</span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
