'use client'

import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useRef, useCallback, useEffect } from 'react'
import { BarChart3, MapPin, KeyRound, Radio, Users, TrendingUp, ArrowLeft, EyeOff, Settings, Inbox, Image, Menu } from 'lucide-react'

const menuItems = [
  { href: '/admin', icon: BarChart3, label: 'Dashboard' },
  { href: '/admin/places', icon: MapPin, label: 'Places' },
  { href: '/admin/events', icon: Image, label: 'Events' },
  { href: '/admin/keywords', icon: KeyRound, label: 'Keywords' },
  { href: '/admin/search-analysis', icon: TrendingUp, label: 'Search Analysis' },
  { href: '/admin/submissions', icon: Inbox, label: 'Submissions' },
  { href: '/admin/hidden', icon: EyeOff, label: 'Hidden' },
  { href: '/admin/pipeline', icon: Radio, label: 'Pipeline' },
  { href: '/admin/users', icon: Users, label: 'Users' },
  { href: '/admin/settings', icon: Settings, label: 'Settings' },
]

export default function AdminSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const translateX = useRef(0)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    translateX.current = 0
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current || !drawerRef.current) return
    const dx = e.touches[0].clientX - touchStart.current.x
    const dy = e.touches[0].clientY - touchStart.current.y
    // Only handle horizontal swipe
    if (Math.abs(dx) < Math.abs(dy)) return
    // Only allow swiping left (negative)
    if (dx < 0) {
      translateX.current = dx
      drawerRef.current.style.transform = `translateX(${dx}px)`
      drawerRef.current.style.transition = 'none'
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!drawerRef.current) return
    drawerRef.current.style.transition = 'transform 0.3s ease'
    // If swiped more than 80px left, close
    if (translateX.current < -80) {
      drawerRef.current.style.transform = 'translateX(-100%)'
      setTimeout(() => setOpen(false), 300)
    } else {
      drawerRef.current.style.transform = 'translateX(0)'
    }
    touchStart.current = null
    translateX.current = 0
  }, [])

  // Close on navigation (mobile)
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="p-6 border-b border-warm-200">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-coral-500 flex items-center justify-center text-white font-bold">
            B
          </div>
          <div>
            <p className="font-bold text-warm-800">BabyPlace</p>
            <p className="text-xs text-warm-400">Admin</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-lg font-medium
                transition-colors duration-200
                ${
                  isActive
                    ? 'bg-coral-50 text-coral-600'
                    : 'text-warm-600 hover:bg-warm-50'
                }
              `}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Back button */}
      <div className="p-4 border-t border-warm-200">
        <button
          onClick={() => router.push('/')}
          className="
            flex items-center gap-3 w-full px-4 py-3 rounded-lg
            text-warm-600 font-medium hover:bg-warm-50
            transition-colors duration-200
          "
        >
          <ArrowLeft size={20} />
          <span>Back to App</span>
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile: hamburger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-warm-200"
          aria-label="Open menu"
        >
          <Menu size={20} className="text-warm-600" />
        </button>
      )}

      {/* Mobile: drawer overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile: swipeable drawer */}
      <aside
        ref={drawerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`
          md:hidden fixed top-0 left-0 h-full w-56 bg-white border-r border-warm-200
          flex flex-col z-50 transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {sidebarContent}
      </aside>

      {/* Desktop: static sidebar */}
      <aside className="hidden md:flex w-56 bg-white border-r border-warm-200 flex-col">
        {sidebarContent}
      </aside>
    </>
  )
}
