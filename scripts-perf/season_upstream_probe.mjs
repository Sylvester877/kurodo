// Times the two outage-fallback stages for seasonal browse:
//   • Kitsu (used today when Jikan 504s and AniList fallback returns null)
//   • AniList Page.media(season, seasonYear) (the missing fast stage)
const KITSU = 'https://kitsu.app/api/edge'
const MAPPING = 'fields[mappings]=externalSite,externalId'
const UA = 'kurodo/0.3.38 (anime desktop app; probe)'

async function t(label, url, opts = {}) {
  const s = Date.now()
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(25000) })
    const j = await r.json().catch(() => null)
    let note = ''
    if (j?.data?.length != null) note = `${j.data.length} rows, ${(j.included || []).length} included`
    else if (j?.data?.Page) note = `${j.data.Page.media?.length ?? 0} media`
    console.log(label.padEnd(40), r.status, String(Date.now() - s).padStart(6) + 'ms', note)
  } catch (e) {
    console.log(label.padEnd(40), 'ERR', String(Date.now() - s).padStart(6) + 'ms', e.name)
  }
}

const kitsuHeaders = { Accept: 'application/vnd.api+json', 'User-Agent': UA }
await t('kitsu season SUMMER 2026',
  `${KITSU}/anime?filter[seasonYear]=2026&filter[season]=summer&sort=-userCount&page[limit]=20&include=mappings&${MAPPING}`,
  { headers: kitsuHeaders })
await t('kitsu current',
  `${KITSU}/anime?filter[status]=current&sort=-userCount&page[limit]=20&include=mappings&${MAPPING}`,
  { headers: kitsuHeaders })
await t('kitsu upcoming',
  `${KITSU}/anime?filter[status]=upcoming&sort=-userCount&page[limit]=20&include=mappings&${MAPPING}`,
  { headers: kitsuHeaders })

const Q = `query($p:Int,$pp:Int,$s:MediaSeason,$y:Int){Page(page:$p,perPage:$pp){pageInfo{hasNextPage total} media(season:$s,seasonYear:$y,type:ANIME,isAdult:false,sort:POPULARITY_DESC){id idMal title{romaji english} coverImage{extraLarge large} averageScore format status episodes season seasonYear}}}`
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
await t('anilist season SUMMER 2026', 'https://graphql.anilist.co',
  post({ query: Q, variables: { p: 1, pp: 24, s: 'SUMMER', y: 2026 } }))
await t('anilist upcoming (NYR)',
  'https://graphql.anilist.co',
  post({ query: `query($p:Int,$pp:Int){Page(page:$p,perPage:$pp){pageInfo{hasNextPage total} media(status:NOT_YET_RELEASED,type:ANIME,isAdult:false,sort:POPULARITY_DESC){id idMal title{romaji english} coverImage{extraLarge large} averageScore format status episodes season seasonYear}}}`, variables: { p: 1, pp: 24 } }))
console.log('probe done')
