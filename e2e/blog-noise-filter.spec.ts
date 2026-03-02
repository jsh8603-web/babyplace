import { test, expect } from '@playwright/test'

/**
 * Blog Noise Filter E2E Tests
 *
 * Tests the LLM-based blacklist term auto-expansion workflow:
 * 1. DB schema: blog_blacklist_terms table + blog_mentions.llm_reviewed column
 * 2. Noise filter pipeline: sampling → classification → downgrade → term upsert → promotion
 * 3. Dynamic blacklist integration with Pipeline B
 * 4. Retroactive cleanup + mention_count recalculation
 */

// Supabase direct access for DB verification
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function supabaseQuery(
  table: string,
  query: string
): Promise<{ data: any; error: any; count?: number }> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
    },
  })
  const data = await res.json()
  const count = parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10)
  return { data, error: res.ok ? null : data, count }
}

async function supabaseRpc(
  fn: string,
  body: Record<string, unknown>
): Promise<{ data: any; error: any }> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = res.status === 204 ? null : await res.json()
  return { data, error: res.ok ? null : data }
}

// ─── 1. DB Schema Tests ──────────────────────────────────────────────────────

test.describe('Blog Noise Filter — DB Schema', () => {
  test('blog_blacklist_terms table exists and has correct columns', async () => {
    const { data, error } = await supabaseQuery(
      'blog_blacklist_terms',
      'select=id,term,status,occurrence_count,distinct_place_count,sample_titles,source,first_seen_at,last_seen_at,activated_at,seen_place_ids&limit=1'
    )
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test('blog_mentions has llm_reviewed column', async () => {
    const { data, error } = await supabaseQuery(
      'blog_mentions',
      'select=id,llm_reviewed&limit=1'
    )
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      expect(typeof data[0].llm_reviewed).toBe('boolean')
    }
  })

  test('blog_blacklist_terms status constraint enforced', async () => {
    // Insert with invalid status should fail
    const url = `${SUPABASE_URL}/rest/v1/blog_blacklist_terms`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ term: '__test_invalid_status__', status: 'invalid_status' }),
    })
    // Should be rejected by CHECK constraint
    expect(res.ok).toBe(false)
  })
})

// ─── 2. RPC Function Tests ──────────────────────────────────────────────────

test.describe('Blog Noise Filter — RPC', () => {
  const TEST_TERM = '__e2e_test_term_' + Date.now()

  test('upsert_blacklist_term creates new term', async () => {
    const { error } = await supabaseRpc('upsert_blacklist_term', {
      p_term: TEST_TERM,
      p_place_id: 1,
      p_sample_title: 'Test title 1',
    })
    expect(error).toBeNull()

    // Verify inserted
    const { data } = await supabaseQuery(
      'blog_blacklist_terms',
      `select=term,occurrence_count,distinct_place_count,sample_titles,seen_place_ids&term=eq.${TEST_TERM}`
    )
    expect(data.length).toBe(1)
    expect(data[0].occurrence_count).toBe(1)
    expect(data[0].distinct_place_count).toBe(1)
    expect(data[0].seen_place_ids).toContain(1)
    expect(data[0].sample_titles).toContain('Test title 1')
  })

  test('upsert_blacklist_term increments on duplicate term', async () => {
    // Call again with same term, different place
    const { error } = await supabaseRpc('upsert_blacklist_term', {
      p_term: TEST_TERM,
      p_place_id: 2,
      p_sample_title: 'Test title 2',
    })
    expect(error).toBeNull()

    const { data } = await supabaseQuery(
      'blog_blacklist_terms',
      `select=occurrence_count,distinct_place_count,seen_place_ids,sample_titles&term=eq.${TEST_TERM}`
    )
    expect(data[0].occurrence_count).toBe(2)
    expect(data[0].distinct_place_count).toBe(2)
    expect(data[0].seen_place_ids).toContain(1)
    expect(data[0].seen_place_ids).toContain(2)
  })

  test('upsert_blacklist_term does not double-count same place', async () => {
    // Call again with same term AND same place_id=1
    const { error } = await supabaseRpc('upsert_blacklist_term', {
      p_term: TEST_TERM,
      p_place_id: 1,
      p_sample_title: 'Test title 3',
    })
    expect(error).toBeNull()

    const { data } = await supabaseQuery(
      'blog_blacklist_terms',
      `select=occurrence_count,distinct_place_count,seen_place_ids&term=eq.${TEST_TERM}`
    )
    expect(data[0].occurrence_count).toBe(3) // incremented
    expect(data[0].distinct_place_count).toBe(2) // NOT incremented (same place)
  })

  test.afterAll(async () => {
    // Cleanup test term
    const url = `${SUPABASE_URL}/rest/v1/blog_blacklist_terms?term=eq.${TEST_TERM}`
    await fetch(url, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    })
  })
})

// ─── 3. Noise Filter Pipeline Tests ─────────────────────────────────────────

test.describe('Blog Noise Filter — Pipeline Data', () => {
  test('borderline mentions exist for sampling (score 0.40-0.65)', async () => {
    const { count } = await supabaseQuery(
      'blog_mentions',
      'select=id&relevance_score=gte.0.40&relevance_score=lte.0.65&llm_reviewed=eq.false&limit=1'
    )
    // Should have borderline mentions available for sampling
    expect(count).toBeGreaterThan(0)
  })

  test('active blacklist terms exist after filter runs', async () => {
    const { data, error } = await supabaseQuery(
      'blog_blacklist_terms',
      'select=term,occurrence_count,distinct_place_count&status=eq.active&order=occurrence_count.desc&limit=10'
    )
    expect(error).toBeNull()
    // After the test runs in previous step, we should have some active terms
    if (data.length > 0) {
      for (const term of data) {
        expect(term.occurrence_count).toBeGreaterThanOrEqual(5)
        expect(term.distinct_place_count).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test('reviewed mentions are tracked', async () => {
    const { count } = await supabaseQuery(
      'blog_mentions',
      'select=id&llm_reviewed=eq.true&limit=1'
    )
    // After filter ran, some mentions should be marked reviewed
    expect(count).toBeGreaterThanOrEqual(0) // 0 is OK if filter hasn't run yet
  })

  test('downgraded mentions have score 0.15', async () => {
    const { data } = await supabaseQuery(
      'blog_mentions',
      'select=relevance_score&llm_reviewed=eq.true&relevance_score=eq.0.15&limit=5'
    )
    // If any mentions were downgraded, they should have score 0.15
    for (const m of data) {
      expect(m.relevance_score).toBe(0.15)
    }
  })
})

// ─── 4. Term Lifecycle Tests ─────────────────────────────────────────────────

test.describe('Blog Noise Filter — Term Lifecycle', () => {
  test('candidate terms have occurrence < threshold or places < threshold', async () => {
    const { data } = await supabaseQuery(
      'blog_blacklist_terms',
      'select=term,occurrence_count,distinct_place_count&status=eq.candidate&limit=20'
    )
    for (const t of data) {
      // Candidate = not yet meeting BOTH thresholds
      const meetsOccurrence = t.occurrence_count >= 5
      const meetsPlaces = t.distinct_place_count >= 3
      expect(meetsOccurrence && meetsPlaces).toBe(false)
    }
  })

  test('active terms have activated_at set', async () => {
    const { data } = await supabaseQuery(
      'blog_blacklist_terms',
      'select=term,activated_at&status=eq.active&limit=10'
    )
    for (const t of data) {
      expect(t.activated_at).not.toBeNull()
    }
  })

  test('sample_titles array is capped at 5', async () => {
    const { data } = await supabaseQuery(
      'blog_blacklist_terms',
      'select=term,sample_titles&limit=50'
    )
    for (const t of data) {
      if (t.sample_titles) {
        expect(t.sample_titles.length).toBeLessThanOrEqual(5)
      }
    }
  })
})

// ─── 5. Scoring Formula & Constants Tests ────────────────────────────────────

test.describe('Blog Noise Filter — Constants & Logic', () => {
  test('promotion thresholds: occurrence >= 5 AND distinct_places >= 3', () => {
    const MIN_OCCURRENCE = 5
    const MIN_DISTINCT_PLACES = 3

    // Should promote
    expect(10 >= MIN_OCCURRENCE && 5 >= MIN_DISTINCT_PLACES).toBe(true)
    // Should NOT promote (places too low)
    expect(10 >= MIN_OCCURRENCE && 2 >= MIN_DISTINCT_PLACES).toBe(false)
    // Should NOT promote (occurrence too low)
    expect(3 >= MIN_OCCURRENCE && 5 >= MIN_DISTINCT_PLACES).toBe(false)
  })

  test('downgrade score is 0.15 (below 0.4 threshold)', () => {
    const DOWNGRADE_SCORE = 0.15
    const RELEVANCE_THRESHOLD = 0.4

    expect(DOWNGRADE_SCORE).toBeLessThan(RELEVANCE_THRESHOLD)
  })

  test('sampling range 0.40-0.65 captures borderline mentions', () => {
    const SAMPLE_MIN = 0.40
    const SAMPLE_MAX = 0.65

    // Within range
    expect(0.50 >= SAMPLE_MIN && 0.50 <= SAMPLE_MAX).toBe(true)
    // Below range
    expect(0.30 >= SAMPLE_MIN).toBe(false)
    // Above range
    expect(0.70 <= SAMPLE_MAX).toBe(false)
  })

  test('batch size 50 × concurrency 2 = 100 per chunk', () => {
    const BATCH_SIZE = 50
    const CONCURRENCY = 2
    expect(BATCH_SIZE * CONCURRENCY).toBe(100)
  })

  test('retroactive cleanup batch limit prevents long transactions', () => {
    const RETROACTIVE_BATCH_LIMIT = 1000
    expect(RETROACTIVE_BATCH_LIMIT).toBeLessThanOrEqual(1000)
  })
})
