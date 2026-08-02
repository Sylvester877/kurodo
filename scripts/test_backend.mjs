import axios from 'axios'

const BASE = 'http://localhost:5173'

async function test() {
  try {
    const r = await axios.get(`${BASE}/api/anilist/config`, { timeout: 5000 })
    console.log('/api/anilist/config:', JSON.stringify(r.data, null, 2))
  } catch (e) {
    console.error('config error:', e.code, e.message)
  }
  try {
    const r = await axios.get(`${BASE}/api/health`, { timeout: 5000 })
    console.log('/api/health:', JSON.stringify(r.data, null, 2))
  } catch (e) {
    console.error('health error:', e.code, e.message)
  }
}
test()
