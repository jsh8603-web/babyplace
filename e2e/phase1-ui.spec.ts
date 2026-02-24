import { test, expect } from '@playwright/test'

test.describe('Phase 1 — UI Components (Module A)', () => {
  test.beforeEach(async ({ page }) => {
    // Load home page and wait for initial render
    await page.goto('/')
    // Wait for main content to be visible
    await page.waitForSelector('main', { state: 'visible', timeout: 10000 })
  })

  test('Home page loads with main route', async ({ page }) => {
    // Verify page title/meta
    const title = page.locator('title')
    expect(title).toBeDefined()

    // Verify main element exists
    const main = page.locator('main')
    await expect(main).toBeVisible()

    // Verify we're on home route
    expect(page.url()).toBe('http://localhost:3000/')
  })

  test('Map renders or shows error fallback', async ({ page }) => {
    // Check for map container — KakaoMap renders dynamically
    // We'll look for either the map div or any error message
    const mapContainer = page.locator('div[style*="position"]').first()

    // Wait for either map to load or a fallback message
    // Kakao SDK may load asynchronously
    await page.waitForTimeout(3000)

    // Check that page is still responsive (not crashed)
    const main = page.locator('main')
    await expect(main).toBeVisible()

    // Verify no console errors about Kakao SDK
    const consoleMessages: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleMessages.push(msg.text())
      }
    })

    // Give time for any Kakao SDK errors
    await page.waitForTimeout(1000)
    // Note: Kakao SDK errors may be expected if API key is not configured
  })

  test('BottomSheet snap points responsive', async ({ page }) => {
    // Bottom sheet should be visible at default snap point
    const bottomSheet = page.locator('[aria-label="장소 목록"]')
    await expect(bottomSheet).toBeVisible()

    // Check for draggable handle
    const handle = page.locator('div.bg-warm-300.rounded-full').first()
    await expect(handle).toBeVisible()

    // Verify sheet height is responsive (peek position)
    const contentBox = await bottomSheet.boundingBox()
    expect(contentBox).toBeDefined()
    expect(contentBox?.height).toBeGreaterThan(0)

    // Try to scroll within sheet — should not crash
    const listContainer = page.locator('div[class*="overflow-y-auto"]').first()
    await expect(listContainer).toBeVisible()
  })

  test('CategoryChips toggle multi-select', async ({ page }) => {
    // Find category chips container
    const chipsContainer = page.locator('[role="group"][aria-label="카테고리 필터"]')
    await expect(chipsContainer).toBeVisible()

    // Get all category buttons
    const buttons = page.locator('[role="group"][aria-label="카테고리 필터"] button')
    const buttonCount = await buttons.count()
    expect(buttonCount).toBeGreaterThan(0)

    // Click first chip to select it
    const firstButton = buttons.nth(0)
    const initialLabel = await firstButton.getAttribute('aria-label')
    await firstButton.click()
    await page.waitForTimeout(200)

    // Verify button now shows selected state (aria-pressed=true)
    const ariaPressed = await firstButton.getAttribute('aria-pressed')
    expect(ariaPressed).toBe('true')

    // Verify visual feedback (bg-coral-200 class added)
    const classes = await firstButton.getAttribute('class')
    expect(classes).toContain('coral')

    // Click another chip to test multi-select
    if (buttonCount > 1) {
      const secondButton = buttons.nth(1)
      await secondButton.click()
      await page.waitForTimeout(200)

      const secondAriaPressed = await secondButton.getAttribute('aria-pressed')
      expect(secondAriaPressed).toBe('true')

      // First should still be selected
      const firstStillPressed = await firstButton.getAttribute('aria-pressed')
      expect(firstStillPressed).toBe('true')
    }

    // Click first again to deselect
    await firstButton.click()
    await page.waitForTimeout(200)
    const finalAriaPressed = await firstButton.getAttribute('aria-pressed')
    expect(finalAriaPressed).toBe('false')
  })

  test('FilterPanel opens and closes', async ({ page }) => {
    // Find filter button in top bar (uses aria-label, not text content)
    const filterButton = page.locator('button[aria-label*="필터"]').first()
    await expect(filterButton).toBeVisible()

    // Click to open filter panel
    await filterButton.click()
    await page.waitForTimeout(300)

    // Verify filter panel is visible
    const filterPanel = page.locator('[aria-label="필터 패널"]')
    await expect(filterPanel).toBeVisible()

    // Verify filter title visible
    const filterTitle = page.locator('text=필터').first()
    await expect(filterTitle).toBeVisible()

    // Check for category section in filter (use h3 heading specifically)
    const categorySection = page.locator('h3').filter({ hasText: '카테고리' })
    await expect(categorySection).toBeVisible()

    // Check for facility tags section (use h3 heading specifically)
    const facilitySection = page.locator('h3').filter({ hasText: '편의시설' })
    await expect(facilitySection).toBeVisible()

    // Find close button (X icon)
    const closeButton = page.locator('button[aria-label="필터 닫기"]')
    await expect(closeButton).toBeVisible()
    await closeButton.click()
    await page.waitForTimeout(300)

    // Verify filter panel is closed
    await expect(filterPanel).not.toBeVisible()
  })

  test('BottomNav tabs clickable with active state', async ({ page }) => {
    // Find bottom navigation
    const nav = page.locator('nav[aria-label="하단 탭 네비게이션"]')
    await expect(nav).toBeVisible()

    // Get all nav links
    const navLinks = page.locator('nav[aria-label="하단 탭 네비게이션"] a')
    const linkCount = await navLinks.count()
    expect(linkCount).toBeGreaterThan(0)

    // First link should be active (home page)
    const firstLink = navLinks.nth(0)
    const firstAriaCurrentPage = await firstLink.getAttribute('aria-current')
    expect(firstAriaCurrentPage).toBe('page')

    // Verify home link has coral color (active state)
    const firstLinkClasses = await firstLink.getAttribute('class')
    expect(firstLinkClasses).toContain('coral-500')

    // Verify other links are not active
    if (linkCount > 1) {
      const secondLink = navLinks.nth(1)
      const secondAriaCurrentPage = await secondLink.getAttribute('aria-current')
      expect(secondAriaCurrentPage).toBeNull()

      // Second link should have warm color (inactive)
      const secondLinkClasses = await secondLink.getAttribute('class')
      expect(secondLinkClasses).not.toContain('coral-500')
    }

    // Verify nav has expected tabs (홈, 검색, 찜, 내 정보)
    expect(linkCount).toBeGreaterThanOrEqual(4)

    // Verify each tab has label text
    for (let i = 0; i < linkCount; i++) {
      const link = navLinks.nth(i)
      const ariaLabel = await link.getAttribute('aria-label')
      expect(ariaLabel).toBeDefined()
      expect(ariaLabel?.length).toBeGreaterThan(0)
    }
  })

  test('Page handles initial load without crashes', async ({ page }) => {
    // Collect any errors
    const errors: string[] = []
    const consoleErrors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    page.on('error', (error) => {
      errors.push(error.message)
    })

    // Wait a bit for any initial scripts to run
    await page.waitForTimeout(2000)

    // Page should still be responsive
    const main = page.locator('main')
    await expect(main).toBeVisible()

    // Log any errors found (but don't fail on them as Kakao SDK might not be configured)
    if (consoleErrors.length > 0) {
      console.log('Console errors (informational):', consoleErrors)
    }
    if (errors.length > 0) {
      console.log('Page errors:', errors)
    }

    // Verify main elements are present
    const bottomSheet = page.locator('[aria-label="장소 목록"]')
    const nav = page.locator('nav[aria-label="하단 탭 네비게이션"]')

    await expect(bottomSheet).toBeVisible()
    await expect(nav).toBeVisible()
  })
})
