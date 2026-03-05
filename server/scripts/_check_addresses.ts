import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string)
async function main() {
  const ids = [3731, 3550, 5200, 7042, 4083, 36431]
  const { data } = await s.from('places').select('id, name, address, road_address').in('id', ids)
  for (const p of data || []) {
    console.log(`id:${p.id} | ${p.name} | addr: ${p.address} | road: ${p.road_address}`)
  }
}
main()
