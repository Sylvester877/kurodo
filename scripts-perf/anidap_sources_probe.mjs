// Probe /api/anime/sources variations to find the shape that returns encrypted data.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function tryCall(label, url, extra = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': UA,
        Referer: 'https://anidap.lol/watch?id=5114&ep=1&type=sub',
        Origin: 'https://anidap.lol',
        ...extra,
      },
    })
    const text = await res.text()
    let summary
    try {
      const j = JSON.parse(text)
      const d = j?.data
      summary =
        typeof d === 'string'
          ? `data:string(${d.length})`
          : d && typeof d === 'object'
            ? `data:obj(keys=${Object.keys(d).slice(0, 6).join(',')})`
            : `data:${JSON.stringify(d)?.slice(0, 60)}`
    } catch {
      summary = `non-json(${text.length}b): ${text.slice(0, 80).replace(/\n/g, ' ')}`
    }
    console.log(`${res.status}  ${label}  ->  ${summary}`)
    return text
  } catch (e) {
    console.log(`ERR ${label}: ${e.message}`)
    return null
  }
}

const slug = process.argv[2] || 'fullmetal-alchemist-brotherhood'
const base = 'https://anidap.lol/api/anime/sources'

// 1. Different host values
for (const host of ['yuki', 'sora', 'kiwi', 'mochi', 'chad']) {
  await tryCall(`host=${host}`, `${base}?id=${slug}&ep=1&host=${host}&type=sub`)
}

// 2. Different type
await tryCall('type=dub', `${base}?id=${slug}&ep=1&host=yuki&type=dub`)

// 3. Without origin/referer
try {
  const res = await fetch(`${base}?id=${slug}&ep=1&host=yuki&type=sub`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  })
  console.log(`${res.status}  bare-headers  ->  ${(await res.text()).slice(0, 90)}`)
} catch (e) {
  console.log(`ERR bare: ${e.message}`)
}

// 4. Repeats to check flakiness
for (let i = 0; i < 3; i++) {
  await tryCall(`repeat#${i}`, `${base}?id=${slug}&ep=1&host=yuki&type=sub`)
}
