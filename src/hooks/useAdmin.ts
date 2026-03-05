'use client'

import { useQuery } from '@tanstack/react-query'

export function useAdmin(): boolean {
  const { data } = useQuery({
    queryKey: ['profile-role'],
    queryFn: async () => {
      const res = await fetch('/api/profile')
      if (!res.ok) return null
      const { profile } = await res.json()
      return profile?.role as string | null
    },
    staleTime: 5 * 60_000,
    retry: false,
  })

  return data === 'admin'
}
