'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useSearchParams, useRouter } from 'next/navigation'
import { Chrome } from 'lucide-react'

export default function LoginForm() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirect = searchParams.get('redirect') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/api/auth/callback?redirect=${redirect}` },
    })
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const action = isSignUp
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password })

    const { error } = await action
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (isSignUp) {
      setError('이메일을 확인해주세요.')
      return
    }

    router.push(redirect)
    router.refresh()
  }

  return (
    <main className="min-h-dvh bg-warm-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-warm-800 text-center mb-2">
          BabyPlace
        </h1>
        <p className="text-warm-400 text-center mb-8">
          아기랑 놀러갈 곳을 찾아보세요
        </p>

        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-2 bg-white border border-warm-200 rounded-xl px-4 py-3 text-warm-700 font-medium hover:bg-warm-50 transition-colors"
        >
          <Chrome size={20} />
          Google로 로그인
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-warm-200" />
          <span className="text-warm-400 text-sm">또는</span>
          <div className="flex-1 h-px bg-warm-200" />
        </div>

        <form onSubmit={handleEmailLogin} className="space-y-3">
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-warm-50 border border-warm-200 rounded-xl px-4 py-3 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:border-coral-400"
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full bg-warm-50 border border-warm-200 rounded-xl px-4 py-3 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:border-coral-400"
          />

          {error && (
            <p className="text-error text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-coral-500 text-white rounded-xl px-4 py-3 font-semibold hover:bg-coral-400 transition-colors disabled:opacity-50"
          >
            {loading ? '처리 중...' : isSignUp ? '회원가입' : '이메일 로그인'}
          </button>
        </form>

        <button
          onClick={() => setIsSignUp(!isSignUp)}
          className="w-full text-center text-warm-400 text-sm mt-4 py-2"
        >
          {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
        </button>
      </div>
    </main>
  )
}
