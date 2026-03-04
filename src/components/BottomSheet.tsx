'use client'

import { ReactNode, useRef, useState, useCallback, useEffect } from 'react'

type SnapPoint = number | string

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapPoints?: SnapPoint[]
  activeSnapPoint?: SnapPoint
  setActiveSnapPoint?: (snap: SnapPoint | null) => void
  children: ReactNode
  headerContent?: ReactNode
  title?: string
  showHandle?: boolean
}

const SHEET_HEIGHT_DVH = 90
const DRAG_THRESHOLD = 5 // px — movement below this is treated as a tap, not a drag

function toNumber(snap: SnapPoint): number {
  return typeof snap === 'number' ? snap : parseFloat(snap) / 100
}

/**
 * BottomSheet — custom draggable bottom sheet (no vaul/Radix).
 * The drag region covers handle + headerContent for a large touch target.
 * Child button clicks are preserved via a drag threshold.
 */
export default function BottomSheet({
  open,
  onOpenChange: _onOpenChange,
  snapPoints = [0.12, 0.5, 0.9],
  activeSnapPoint,
  setActiveSnapPoint,
  children,
  headerContent,
  title,
  showHandle = true,
}: BottomSheetProps) {
  const numericSnaps = snapPoints.map(toNumber)
  const currentSnap = activeSnapPoint !== undefined ? toNumber(activeSnapPoint) : numericSnaps[0]

  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<{ y: number; snap: number; time: number; pointerId: number } | null>(null)
  const dragRegionRef = useRef<HTMLDivElement>(null)

  // translateY: snap=0.12 → 90-12=78dvh down, snap=0.9 → 90-90=0dvh
  const translateYDvh = SHEET_HEIGHT_DVH - currentSnap * 100

  const findNearestSnap = useCallback(
    (targetFraction: number, velocity: number) => {
      const VELOCITY_THRESHOLD = 0.3 // px/ms
      if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
        const currentIdx = numericSnaps.indexOf(currentSnap)
        if (velocity < 0 && currentIdx < numericSnaps.length - 1) {
          return numericSnaps[currentIdx + 1]
        }
        if (velocity > 0 && currentIdx > 0) {
          return numericSnaps[currentIdx - 1]
        }
      }
      return numericSnaps.reduce((prev, curr) =>
        Math.abs(curr - targetFraction) < Math.abs(prev - targetFraction) ? curr : prev
      )
    },
    [numericSnaps, currentSnap]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      dragStartRef.current = { y: e.clientY, snap: currentSnap, time: Date.now(), pointerId: e.pointerId }
      // Don't capture or set isDragging yet — wait for threshold to preserve child clicks
    },
    [currentSnap]
  )

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return
    const dy = e.clientY - dragStartRef.current.y

    if (!isDragging && Math.abs(dy) > DRAG_THRESHOLD) {
      setIsDragging(true)
      // Capture pointer for smooth drag tracking even outside the element
      dragRegionRef.current?.setPointerCapture(dragStartRef.current.pointerId)
    }
    if (isDragging || Math.abs(dy) > DRAG_THRESHOLD) {
      setDragOffset(dy)
    }
  }, [isDragging])

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return

      if (isDragging) {
        const dy = e.clientY - dragStartRef.current.y
        const dt = Date.now() - dragStartRef.current.time
        const velocity = dy / Math.max(dt, 1)
        const dvhDelta = (dy / window.innerHeight) * 100
        const currentVisible = dragStartRef.current.snap * 100 - dvhDelta
        const targetFraction = currentVisible / 100

        const nearest = findNearestSnap(targetFraction, velocity)
        setActiveSnapPoint?.(nearest)
      }
      // If not isDragging (tap), child click events fire normally

      setIsDragging(false)
      setDragOffset(0)
      dragStartRef.current = null
    },
    [isDragging, findNearestSnap, setActiveSnapPoint]
  )

  // Clean up body styles vaul/Radix may have left behind
  useEffect(() => {
    document.body.style.pointerEvents = ''
  }, [])

  if (!open) return null

  const transform = isDragging
    ? `translateY(calc(${translateYDvh}dvh + ${dragOffset}px))`
    : `translateY(${translateYDvh}dvh)`

  return (
    <div
      className="
        fixed bottom-0 left-0 right-0 z-30
        bg-white border-t border-warm-200
        rounded-t-[20px]
        shadow-lg
        flex flex-col
        outline-none
        mx-auto max-w-2xl
      "
      style={{
        height: `${SHEET_HEIGHT_DVH}dvh`,
        transform,
        transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
        willChange: 'transform',
      }}
      aria-label={title ?? '장소 목록'}
    >
      {/* Drag region: handle + headerContent — large touch target */}
      <div
        ref={dragRegionRef}
        className="shrink-0 select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {showHandle && (
          <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
            <div className="w-12 h-1.5 bg-warm-300 rounded-full" aria-hidden="true" />
          </div>
        )}
        {headerContent}
      </div>
      {title && <h2 className="sr-only">{title}</h2>}
      {children}
    </div>
  )
}
