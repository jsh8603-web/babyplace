import { Suspense } from 'react'
import LoginForm from './login-form'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="min-h-dvh bg-warm-50 flex items-center justify-center">
        <p className="text-warm-400">로딩 중...</p>
      </main>
    }>
      <LoginForm />
    </Suspense>
  )
}
