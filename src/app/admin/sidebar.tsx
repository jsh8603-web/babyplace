'use client'

import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { BarChart3, MapPin, KeyRound, Radio, Users, ArrowLeft } from 'lucide-react'

const menuItems = [
  { href: '/admin', icon: BarChart3, label: 'Dashboard' },
  { href: '/admin/places', icon: MapPin, label: 'Places' },
  { href: '/admin/keywords', icon: KeyRound, label: 'Keywords' },
  { href: '/admin/pipeline', icon: Radio, label: 'Pipeline' },
  { href: '/admin/users', icon: Users, label: 'Users' },
]

export default function AdminSidebar() {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <aside className="w-56 bg-white border-r border-warm-200 flex flex-col">
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
    </aside>
  )
}
