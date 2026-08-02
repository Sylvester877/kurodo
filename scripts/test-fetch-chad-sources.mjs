import { fetchChadSources } from '../server/cf-harvester.js'

async function run() {
  console.log('[test] Calling fetchChadSources for Naruto Shippuden ep1 yuki sub...')
  const start = Date.now()
  try {
    const data = await fetchChadSources(1735, null, 1, 'yuki', 'sub')
    console.log('[test] SUCCESS in', Date.now() - start, 'ms')
    console.log(JSON.stringify(data, null, 2))
  } catch (e) {
    console.log('[test] FAILED in', Date.now() - start, 'ms')
    console.error(e.message)
  }
  process.exit(0)
}

run()
