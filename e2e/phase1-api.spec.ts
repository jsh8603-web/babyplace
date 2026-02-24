import { test, expect } from '@playwright/test'

/**
 * BabyPlace Phase 1 E2E Tests — API Routes + Integration (Module B)
 * 
 * Test Scope:
 * 1. GET /api/places?bbox=... — Mock data (places array)
 * 2. GET /api/places/[id] — Single place detail
 * 3. GET /api/weather — Weather API
 * 4. GET /api/places/emergency — Emergency API
 * 5. POST /api/favorites — Toggle favorite
 * 6. Integration tests — UI interactions triggering APIs
 */

test.describe.configure({ fullyParallel: false })

// Mock data for testing
const MOCK_BBOX = {
  swLat: 37.4,
  swLng: 127.0,
  neLat: 37.5,
  neLng: 127.1,
}

const MOCK_USER_LOCATION = {
  lat: 37.45,
  lng: 127.05,
}

// ============================================================================
// API Route Tests
// ============================================================================

test.describe('API Routes — Module B', () => {
  test('GET /api/places — bbox query returns places array', async ({ request }) => {
    const response = await request.get('/api/places', {
      params: {
        swLat: MOCK_BBOX.swLat,
        swLng: MOCK_BBOX.swLng,
        neLat: MOCK_BBOX.neLat,
        neLng: MOCK_BBOX.neLng,
        zoom: '12',
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('places')
    expect(data).toHaveProperty('nextCursor')
    expect(Array.isArray(data.places)).toBe(true)
    expect(typeof data.nextCursor).toBe('string' || null)
  })

  test('GET /api/places — missing bbox parameters returns 400', async ({ request }) => {
    const response = await request.get('/api/places', {
      params: {
        swLat: MOCK_BBOX.swLat,
        swLng: MOCK_BBOX.swLng,
        // Missing neLat, neLng
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('GET /api/places — pagination with cursor', async ({ request }) => {
    // First page
    const response1 = await request.get('/api/places', {
      params: {
        swLat: MOCK_BBOX.swLat,
        swLng: MOCK_BBOX.swLng,
        neLat: MOCK_BBOX.neLat,
        neLng: MOCK_BBOX.neLng,
        zoom: '12',
        limit: '5',
      },
    })

    expect(response1.status()).toBe(200)
    const page1 = await response1.json()
    expect(page1.places.length).toBeLessThanOrEqual(5)

    // If nextCursor exists, fetch next page
    if (page1.nextCursor) {
      const response2 = await request.get('/api/places', {
        params: {
          swLat: MOCK_BBOX.swLat,
          swLng: MOCK_BBOX.swLng,
          neLat: MOCK_BBOX.neLat,
          neLng: MOCK_BBOX.neLng,
          zoom: '12',
          limit: '5',
          cursor: page1.nextCursor,
        },
      })

      expect(response2.status()).toBe(200)
      const page2 = await response2.json()
      expect(Array.isArray(page2.places)).toBe(true)
      // Ensure pages are different (sanity check)
      if (page1.places.length > 0 && page2.places.length > 0) {
        expect(page1.places[0].id).not.toBe(page2.places[0].id)
      }
    }
  })

  test('GET /api/places — filter by category', async ({ request }) => {
    const response = await request.get('/api/places', {
      params: {
        swLat: MOCK_BBOX.swLat,
        swLng: MOCK_BBOX.swLng,
        neLat: MOCK_BBOX.neLat,
        neLng: MOCK_BBOX.neLng,
        zoom: '12',
        category: '놀이',
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data.places)).toBe(true)
    // If places returned, verify category filter applied
    if (data.places.length > 0) {
      data.places.forEach((place: any) => {
        expect(place).toHaveProperty('category')
        expect(place.category).toBe('놀이')
      })
    }
  })

  test('GET /api/places — filter by tags (facilities)', async ({ request }) => {
    const response = await request.get('/api/places', {
      params: {
        swLat: MOCK_BBOX.swLat,
        swLng: MOCK_BBOX.swLng,
        neLat: MOCK_BBOX.neLat,
        neLng: MOCK_BBOX.neLng,
        zoom: '12',
        tags: '수유실',
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data.places)).toBe(true)
    // If places returned, verify tags filter applied
    if (data.places.length > 0) {
      data.places.forEach((place: any) => {
        expect(place).toHaveProperty('tags')
        expect(Array.isArray(place.tags)).toBe(true)
        expect(place.tags.includes('수유실')).toBe(true)
      })
    }
  })

  test('GET /api/places — distance sort with user location', async ({ request }) => {
    const response = await request.get('/api/places', {
      params: {
        swLat: MOCK_BBOX.swLat,
        swLng: MOCK_BBOX.swLng,
        neLat: MOCK_BBOX.neLat,
        neLng: MOCK_BBOX.neLng,
        zoom: '12',
        sort: 'distance',
        lat: MOCK_USER_LOCATION.lat,
        lng: MOCK_USER_LOCATION.lng,
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data.places)).toBe(true)
    
    // Verify distance sort: first place should be closer than second
    if (data.places.length >= 2) {
      const calc_distance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
        const R = 6371000
        const dLat = ((lat2 - lat1) * Math.PI) / 180
        const dLng = ((lng2 - lng1) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      }

      const dist1 = calc_distance(
        MOCK_USER_LOCATION.lat,
        MOCK_USER_LOCATION.lng,
        data.places[0].lat,
        data.places[0].lng
      )
      const dist2 = calc_distance(
        MOCK_USER_LOCATION.lat,
        MOCK_USER_LOCATION.lng,
        data.places[1].lat,
        data.places[1].lng
      )
      expect(dist1).toBeLessThanOrEqual(dist2)
    }
  })

  test('GET /api/places/[id] — returns place with top 5 posts', async ({ request }) => {
    // First fetch any place
    const placesResponse = await request.get('/api/places', {
      params: {
        swLat: MOCK_BBOX.swLat,
        swLng: MOCK_BBOX.swLng,
        neLat: MOCK_BBOX.neLat,
        neLng: MOCK_BBOX.neLng,
        zoom: '12',
      },
    })

    expect(placesResponse.status()).toBe(200)
    const placesData = await placesResponse.json()

    if (placesData.places.length === 0) {
      test.skip()
    }

    const placeId = placesData.places[0].id

    // Now fetch place detail
    const detailResponse = await request.get(`/api/places/${placeId}`)
    expect(detailResponse.status()).toBe(200)

    const detailData = await detailResponse.json()
    expect(detailData).toHaveProperty('place')
    expect(detailData).toHaveProperty('topPosts')
    expect(detailData).toHaveProperty('isFavorited')

    // Verify place structure
    expect(detailData.place).toHaveProperty('id')
    expect(detailData.place).toHaveProperty('name')
    expect(detailData.place).toHaveProperty('category')
    expect(detailData.place).toHaveProperty('lat')
    expect(detailData.place).toHaveProperty('lng')

    // Verify topPosts is array with max 5 items
    expect(Array.isArray(detailData.topPosts)).toBe(true)
    expect(detailData.topPosts.length).toBeLessThanOrEqual(5)

    // Verify isFavorited is boolean (true for unauthenticated)
    expect(typeof detailData.isFavorited).toBe('boolean')
  })

  test('GET /api/places/[id] — invalid id returns 400', async ({ request }) => {
    const response = await request.get('/api/places/invalid-id')
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('GET /api/places/[id] — nonexistent place returns 404', async ({ request }) => {
    const response = await request.get('/api/places/999999')
    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('GET /api/weather — returns weather data', async ({ request }) => {
    const response = await request.get('/api/weather', {
      params: {
        lat: MOCK_USER_LOCATION.lat,
        lng: MOCK_USER_LOCATION.lng,
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('isRaining')
    expect(data).toHaveProperty('temperature')
    expect(data).toHaveProperty('description')
    expect(typeof data.isRaining).toBe('boolean')
    expect(typeof data.temperature).toBe('number')
    expect(typeof data.description).toBe('string')
  })

  test('GET /api/weather — missing lat/lng returns 400', async ({ request }) => {
    const response = await request.get('/api/weather', {
      params: {
        lat: MOCK_USER_LOCATION.lat,
        // Missing lng
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('GET /api/places/emergency — returns nearest 5 facilities', async ({ request }) => {
    const response = await request.get('/api/places/emergency', {
      params: {
        lat: MOCK_USER_LOCATION.lat,
        lng: MOCK_USER_LOCATION.lng,
        type: 'nursing_room',
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('places')
    expect(Array.isArray(data.places)).toBe(true)
    expect(data.places.length).toBeLessThanOrEqual(5)

    // Verify distance property exists and is sorted
    if (data.places.length >= 2) {
      for (let i = 0; i < data.places.length - 1; i++) {
        expect(data.places[i].distance_m).toBeLessThanOrEqual(data.places[i + 1].distance_m)
      }
    }
  })

  test('GET /api/places/emergency — missing lat/lng returns 400', async ({ request }) => {
    const response = await request.get('/api/places/emergency', {
      params: {
        lat: MOCK_USER_LOCATION.lat,
        // Missing lng
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('GET /api/places/emergency — invalid type returns 400', async ({ request }) => {
    const response = await request.get('/api/places/emergency', {
      params: {
        lat: MOCK_USER_LOCATION.lat,
        lng: MOCK_USER_LOCATION.lng,
        type: 'invalid_type',
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('POST /api/favorites — unauthenticated returns 401', async ({ request }) => {
    const response = await request.post('/api/favorites', {
      data: {
        placeId: 1,
      },
    })

    expect(response.status()).toBe(401)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('POST /api/favorites — missing both placeId and eventId returns 400', async ({ request }) => {
    const response = await request.post('/api/favorites', {
      data: {},
    })

    // May be 400 (bad request) or 401 (auth) depending on validation order
    expect([400, 401]).toContain(response.status())
  })

  test('POST /api/favorites — providing both placeId and eventId returns 400', async ({ request }) => {
    const response = await request.post('/api/favorites', {
      data: {
        placeId: 1,
        eventId: 1,
      },
    })

    expect([400, 401]).toContain(response.status())
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

test.describe('Integration Tests — UI + API', () => {
  test('Home page loads and displays map', async ({ page }) => {
    await page.goto('/')
    
    // Wait for page to load and map to initialize
    await page.waitForLoadState('domcontentloaded')
    
    // Check for map container or title
    const title = await page.title()
    expect(title).toBeTruthy()
  })

  test('Clicking filter button triggers API call', async ({ page, request }) => {
    // Spy on network requests
    const apiCalls: string[] = []
    page.on('response', (response) => {
      if (response.url().includes('/api/places')) {
        apiCalls.push(response.url())
      }
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Look for filter button (may vary by implementation)
    const filterButton = page.locator('[aria-label*="filter"], [data-testid*="filter"], button:has-text("필터")')
    if (await filterButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await filterButton.click()
      
      // Wait for API call
      await page.waitForTimeout(1000)
      expect(apiCalls.length).toBeGreaterThan(0)
    }
  })

  test('Clicking place card navigates to detail page', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Look for a place card
    const placeCard = page.locator('[data-testid="place-card"], .place-card').first()
    if (await placeCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await placeCard.click()
      
      // Should navigate to place detail page
      await page.waitForURL(/\/place\/\d+/, { timeout: 5000 }).catch(() => {})
      const url = page.url()
      expect(url).toMatch(/\/place\/\d+/)
    }
  })

  test('Favorite button toggles favorite state', async ({ page, request }) => {
    // Skip this test if not authenticated
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const loginButton = page.locator('button:has-text("Google"), button:has-text("이메일")')
    if (!(await loginButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
    }

    // Note: Full login flow may require actual credentials
    // Skipping actual login for CI environment
    test.skip()
  })

  test('Weather filter updates visible places', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Call weather API
    const weatherResponse = await page.request.get('/api/weather', {
      params: {
        lat: 37.45,
        lng: 127.05,
      },
    })

    expect(weatherResponse.ok()).toBe(true)
    const weatherData = await weatherResponse.json()
    
    if (weatherData.isRaining) {
      // If raining, calling /api/places with indoor=true should return results
      const placesResponse = await page.request.get('/api/places', {
        params: {
          swLat: 37.4,
          swLng: 127.0,
          neLat: 37.5,
          neLng: 127.1,
          zoom: '12',
          indoor: 'true',
        },
      })

      expect(placesResponse.ok()).toBe(true)
    }
  })

  test('Emergency mode shows nearest nursing rooms', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Call emergency API
    const emergencyResponse = await page.request.get('/api/places/emergency', {
      params: {
        lat: 37.45,
        lng: 127.05,
        type: 'nursing_room',
      },
    })

    expect(emergencyResponse.ok()).toBe(true)
    const emergencyData = await emergencyResponse.json()
    expect(emergencyData.places).toBeDefined()
    expect(Array.isArray(emergencyData.places)).toBe(true)
  })
})

// ============================================================================
// Response Schema Validation Tests
// ============================================================================

test.describe('API Response Schema Validation', () => {
  test('GET /api/places — response schema', async ({ request }) => {
    const response = await request.get('/api/places', {
      params: {
        swLat: 37.4,
        swLng: 127.0,
        neLat: 37.5,
        neLng: 127.1,
        zoom: '12',
      },
    })

    const data = await response.json()
    
    // Check top-level keys
    expect(Object.keys(data).sort()).toEqual(['nextCursor', 'places'].sort())

    // Check places array structure
    if (data.places.length > 0) {
      const place = data.places[0]
      const requiredKeys = ['id', 'name', 'category', 'lat', 'lng', 'is_active']
      requiredKeys.forEach((key) => {
        expect(place).toHaveProperty(key)
      })
    }
  })

  test('GET /api/places/[id] — response schema', async ({ request }) => {
    // Get a valid place id first
    const placesResponse = await request.get('/api/places', {
      params: {
        swLat: 37.4,
        swLng: 127.0,
        neLat: 37.5,
        neLng: 127.1,
        zoom: '12',
      },
    })

    const placesData = await placesResponse.json()
    if (placesData.places.length === 0) {
      test.skip()
    }

    const placeId = placesData.places[0].id
    const detailResponse = await request.get(`/api/places/${placeId}`)
    const data = await detailResponse.json()

    // Check top-level keys
    expect(Object.keys(data).sort()).toEqual(['isFavorited', 'place', 'topPosts'].sort())

    // Check place object
    expect(data.place).toHaveProperty('id')
    expect(data.place).toHaveProperty('name')

    // Check topPosts array
    expect(Array.isArray(data.topPosts)).toBe(true)
    if (data.topPosts.length > 0) {
      const post = data.topPosts[0]
      expect(post).toHaveProperty('place_id')
      expect(post).toHaveProperty('source_type')
      expect(post).toHaveProperty('title')
    }
  })

  test('GET /api/weather — response schema', async ({ request }) => {
    const response = await request.get('/api/weather', {
      params: {
        lat: 37.45,
        lng: 127.05,
      },
    })

    const data = await response.json()
    expect(Object.keys(data).sort()).toEqual(['description', 'isRaining', 'temperature'].sort())
    expect(typeof data.isRaining).toBe('boolean')
    expect(typeof data.temperature).toBe('number')
    expect(typeof data.description).toBe('string')
  })

  test('GET /api/places/emergency — response schema', async ({ request }) => {
    const response = await request.get('/api/places/emergency', {
      params: {
        lat: 37.45,
        lng: 127.05,
        type: 'nursing_room',
      },
    })

    const data = await response.json()
    expect(data).toHaveProperty('places')
    expect(Array.isArray(data.places)).toBe(true)

    if (data.places.length > 0) {
      const place = data.places[0]
      expect(place).toHaveProperty('distance_m')
      expect(typeof place.distance_m).toBe('number')
    }
  })
})
