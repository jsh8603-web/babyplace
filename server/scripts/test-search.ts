import { fetchNaverSearch } from './server/collectors/naver-blog'

const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'

interface Img { title: string; link: string; sizewidth: string; sizeheight: string }

async function search(query: string) {
  const url = `${NAVER_IMAGE_URL}?query=${encodeURIComponent(query)}&display=5&sort=sim`
  const results = await fetchNaverSearch<Img>(url)
  return (results || []).filter((i) => {
    const w = parseInt(i.sizewidth) || 0
    const h = parseInt(i.sizeheight) || 0
    return w >= 300 && h >= 300 && !i.link.includes('search.pstatic.net') && !i.link.includes('type=b150')
  })
}

async function main() {
  const tests = [
    '위시캣 테마파크 인사동 2026',
    '위시캣 테마파크 인사센트럴뮤지엄',
    '급식왕 급식이가 사라졌다 뮤지컬',
    '아쿠아플라넷 일산 곤충 파충류 2026',
    '서울 유아차런 2026 포스터',
  ]

  for (const q of tests) {
    const r = await search(q)
    const strip = (s: string) => s.replace(/<[^>]*>/g, '')
    console.log(`${q} -> ${r.length} results`)
    for (const item of r.slice(0, 3)) {
      console.log(`  ${strip(item.title)} | ${item.link.substring(0, 80)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
}

main()
