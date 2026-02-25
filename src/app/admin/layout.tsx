import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import AdminSidebar from './sidebar'

export const metadata = {
  title: 'Admin - BabyPlace',
  description: '관리자 페이지',
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabase()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Check if user is admin
  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    redirect('/')
  }

  return (
    <div className="flex h-screen bg-warm-50">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
