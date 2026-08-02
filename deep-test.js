import { anidapProvider } from './server/providers/anidap.js'

async function deepTest(p, anilistId) {
    console.log(`\n>>> Deep testing: ${p.name.toUpperCase()}`)
    try {
        console.log(`[1/3] Resolving slug...`)
        const info = await p.getInfoByAniListId(anilistId)
        if (!info || !info.slug) {
            console.log(`❌ Failed to resolve slug.`)
            return
        }
        console.log(`✅ Slug: ${info.slug}`)

        console.log(`[2/3] Fetching providers for Ep 1...`)
        const servers = await p.getProviders(info.slug, 1, anilistId)
        if (!servers || servers.length === 0) {
            console.log(`❌ No servers found.`)
            return
        }
        console.log(`✅ Found ${servers.length} servers.`)

        console.log(`[3/3] Fetching stream for ${servers[0].name}...`)
        const stream = await p.getStream(info.slug, 1, servers[0].name, servers[0].type, anilistId)
        if (!stream || !stream.url) {
            console.log(`❌ No stream URL returned.`)
        } else {
            console.log(`✅ GOT STREAM: ${stream.url.slice(0, 50)}...`)
        }
    } catch (e) {
        console.log(`❌ ERROR: ${e.message}`)
    }
}

async function run() {
    const animeId = 21 // One Piece
    await deepTest(anidapProvider, animeId)
}

run()
