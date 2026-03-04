'use client'

import { useState, useEffect } from 'react'
import { Save } from 'lucide-react'

interface AppSetting {
  key: string
  value: unknown
  updated_at: string
}

export default function AdminSettingsPage() {
  const [autoHideCount, setAutoHideCount] = useState(20)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((data) => {
        const settings = data.settings as AppSetting[]
        const hideCountSetting = settings?.find((s) => s.key === 'event_auto_hide_count')
        if (hideCountSetting) {
          setAutoHideCount(Number(hideCountSetting.value))
        }
      })
      .catch(() => setMessage('설정을 불러오지 못했습니다'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'event_auto_hide_count', value: autoHideCount }),
      })
      if (res.ok) {
        setMessage('저장되었습니다')
      } else {
        setMessage('저장에 실패했습니다')
      }
    } catch {
      setMessage('네트워크 오류')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-warm-800 mb-6">Settings</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-warm-100 rounded w-1/3" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-warm-800 mb-6">Settings</h1>

      <div className="bg-white rounded-xl border border-warm-200 p-6 max-w-lg">
        <h2 className="text-lg font-semibold text-warm-700 mb-4">이벤트 자동 숨김</h2>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-warm-600">
            인기도 하위 N건 자동 숨김
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={500}
              value={autoHideCount}
              onChange={(e) => setAutoHideCount(parseInt(e.target.value, 10) || 0)}
              className="
                w-24 px-3 py-2 border border-warm-300 rounded-lg
                text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-300
              "
            />
            <span className="text-sm text-warm-500">건</span>
          </div>
          <p className="text-xs text-warm-400">
            스코어링 실행 시 진행중 이벤트 중 인기도 하위 N건을 자동으로 숨깁니다.
            0으로 설정하면 자동 숨김이 비활성화됩니다.
          </p>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="
              flex items-center gap-2 px-4 py-2
              bg-coral-500 text-white rounded-lg font-medium
              hover:bg-coral-600 disabled:opacity-50
              transition-colors
            "
          >
            <Save size={16} />
            {saving ? '저장 중...' : '저장'}
          </button>
          {message && (
            <span className="text-sm text-warm-500">{message}</span>
          )}
        </div>
      </div>
    </div>
  )
}
