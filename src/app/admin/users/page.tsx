'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import DataTable, { Column } from '@/components/admin/DataTable'
import type { Profile } from '@/types'

interface UserRow extends Profile {
  reviewCount?: number
}

export default function UsersManagement() {
  const queryClient = useQueryClient()
  const [confirmModal, setConfirmModal] = useState<{
    userId: string
    newRole: 'user' | 'admin'
  } | null>(null)

  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error('Failed to fetch users')
      return res.json()
    },
  })

  const updateRoleMutation = useMutation({
    mutationFn: async (data: { userId: string; role: 'user' | 'admin' }) => {
      const res = await fetch(`/api/admin/users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update role')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      setConfirmModal(null)
    },
  })

  const columns: Column<UserRow>[] = [
    {
      key: 'email',
      label: 'Email',
      width: 'w-48',
      sortable: true,
      render: (email) => (
        <span className="text-sm text-warm-700">{email || '-'}</span>
      ),
    },
    {
      key: 'display_name',
      label: 'Name',
      width: 'w-40',
      sortable: true,
      render: (name) => (
        <span className="text-sm text-warm-700">{name || '-'}</span>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      width: 'w-32',
      sortable: true,
      render: (role, row) => (
        <select
          value={role}
          onChange={(e) => {
            setConfirmModal({
              userId: row.id,
              newRole: e.target.value as 'user' | 'admin',
            })
          }}
          className="
            px-2 py-1 rounded border border-warm-200 bg-white
            text-sm font-medium focus:outline-none focus:ring-2 focus:ring-coral-400
            ${
              role === 'admin'
                ? 'text-purple-700 border-purple-200'
                : 'text-warm-700'
            }
          "
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      ),
    },
    {
      key: 'created_at',
      label: 'Joined',
      width: 'w-32',
      sortable: true,
      render: (date) =>
        new Date(date).toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }),
    },
    {
      key: 'reviewCount',
      label: 'Reviews',
      width: 'w-20',
      sortable: true,
      render: (count) => <span className="text-sm font-semibold">{count || 0}</span>,
    },
  ]

  const stats = {
    totalUsers: users.length,
    admins: users.filter((u) => u.role === 'admin').length,
    regularUsers: users.filter((u) => u.role === 'user').length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users size={24} className="text-coral-500" />
        <h1 className="text-3xl font-bold text-warm-800">Users Management</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 bg-white p-4 rounded-lg border border-warm-200">
        <div>
          <p className="text-warm-500 text-sm font-medium mb-1">Total Users</p>
          <p className="text-3xl font-bold text-warm-800">{stats.totalUsers}</p>
        </div>
        <div>
          <p className="text-warm-500 text-sm font-medium mb-1">Admins</p>
          <p className="text-3xl font-bold text-purple-600">{stats.admins}</p>
        </div>
        <div>
          <p className="text-warm-500 text-sm font-medium mb-1">Regular Users</p>
          <p className="text-3xl font-bold text-warm-800">{stats.regularUsers}</p>
        </div>
      </div>

      {/* Data table */}
      <DataTable<UserRow>
        columns={columns}
        data={users}
        searchableFields={['email', 'display_name']}
        defaultSortKey="created_at"
        defaultSortDir="desc"
        pageSize={15}
        emptyMessage="No users found"
      />

      {/* Confirm role change modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold text-warm-800 mb-4">
              Confirm Role Change
            </h2>

            <p className="text-warm-600 mb-6">
              Are you sure you want to change this user's role to{' '}
              <span className="font-semibold">
                {confirmModal.newRole === 'admin' ? 'Admin' : 'Regular User'}
              </span>
              ?
            </p>

            {confirmModal.newRole === 'admin' && (
              <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Warning:</strong> Admins can access all management features.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="
                  flex-1 px-4 py-2 rounded-lg border border-warm-200 bg-white
                  text-warm-700 font-medium hover:bg-warm-50 transition
                "
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  updateRoleMutation.mutate({
                    userId: confirmModal.userId,
                    role: confirmModal.newRole,
                  })
                }}
                disabled={updateRoleMutation.isPending}
                className="
                  flex-1 px-4 py-2 rounded-lg bg-coral-500 text-white
                  font-medium hover:bg-coral-600 disabled:opacity-50 transition
                "
              >
                {updateRoleMutation.isPending ? 'Updating...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
