'use client'

import { ReactNode } from 'react'
import { Drawer } from 'vaul'

type SnapPoint = number | string

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapPoints?: SnapPoint[]
  activeSnapPoint?: SnapPoint
  setActiveSnapPoint?: (snap: SnapPoint | null) => void
  children: ReactNode
  title?: string
  /** Whether the sheet has a visible handle bar */
  showHandle?: boolean
}

/**
 * BottomSheet — vaul-based draggable bottom sheet.
 * Uses snap points: 0.15 (peek), 0.5 (half), 0.9 (full).
 * Wraps vaul Drawer.Root + Drawer.Content.
 */
export default function BottomSheet({
  open,
  onOpenChange,
  snapPoints = [0.15, 0.5, 0.9],
  activeSnapPoint,
  setActiveSnapPoint,
  children,
  title,
  showHandle = true,
}: BottomSheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={setActiveSnapPoint}
      modal={false}
    >
      <Drawer.Portal>
        <Drawer.Content
          className="
            fixed bottom-0 left-0 right-0 z-30
            bg-white border-t border-warm-200
            rounded-t-[20px]
            shadow-lg
            flex flex-col
            outline-none
          "
          style={{
            height: '90dvh',
          }}
          aria-label={title ?? '장소 목록'}
        >
          {showHandle && (
            <div className="flex justify-center pt-3 pb-2 shrink-0">
              <div className="w-10 h-1 bg-warm-300 rounded-full" aria-hidden="true" />
            </div>
          )}
          {title && (
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
          )}
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
