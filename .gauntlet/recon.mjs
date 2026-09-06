// P0 recon: does each canon feature exist in src/? Outputs a truth table.
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')
const walk = (dir) => {
  let out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(p))
    else if (/\.(tsx|ts|css)$/.test(e.name) && !e.name.endsWith('.test.ts') && !e.name.endsWith('.test.tsx')) out.push(p)
  }
  return out
}
const files = walk(SRC)
const text = files.map((f) => f + '\n' + fs.readFileSync(f, 'utf-8')).join('\n')

const checks = [
  ['dark layered base tokens', /#0b0e14|#10141c|bg-background|bg-surface/i],
  ['hot accent color', /--accent|bg-primary|#f?[0-9a-f]{3,6}.*(pink|violet|crimson)|hsl\(var\(--accent/i],
  ['sticky blurred header', /sticky.*backdrop-blur|backdrop-blur.*sticky|fixed.*backdrop-blur/i],
  ['pill search', /⌘K|Search anime|commandPalette|CommandPalette|/i],
  ['spotlight hero carousel', /Spotlight|FeaturedPicks|Hero.tsx|hero/i],
  ['horizontal rails + section headers', /SectionHeader|Rail|horizontal/i],
  ['2:3 poster cards', /aspect-\[3\/4\]|aspect-\[2\/3\]/i],
  ['hover card meta reveal', /AnimeHoverCard|hover.*meta|group-hover/i],
  ['card hover scale', /group-hover:scale/i],
  ['skeleton shimmer', /shimmer|animate-pulse|Skeleton/i],
  ['episode range selector', /1-\d+,\s*13|rangeSelector|episodes.slice\((\d+)/i],
  ['SUB/DUB toggle', /type=.(sub|dub).|'sub'|'dub'|subDub|type.*sub.*dub/i],
  ['episode grid w/ thumbnails', /EpisodeGrid|episode.*thumb|buildEpisodeImageUrl/i],
  ['watch settings cluster (auto-next/skip)', /autoNext|auto-next|autoSkip|auto-skip|autoPlayNext/i],
  ['schedule page', /Schedule.tsx|AiringSchedule|/i],
  ['schedule estimated release labels', /estimated|est\.|release time/i],
  ['filter sidebar (genres+type+status)', /FilterSidebar|SearchFilters|genre.*checkbox/i],
  ['numbered pagination', /pagination|page=.*1|Page \d/i],
  ['A–Z index browsing', /alphabet|[A-Za-z]\.map.*char|azIndex/i],
  ['detail blurred backdrop hero', /backdrop.*blur|blur.*banner|heroBackdrop/i],
  ['characters / VA row', /characters|voiceActor|CharacterRow|Staff/i],
  ['related + recommended rails', /RelatedAnime|Related|RecommendedRail/i],
  ['watchlist tabs', /Watching|Completed|Planning|On Hold|Dropped/i],
  ['live search dropdown', /SearchDropdown|search.*dropdown|debounce/i],
  ['empty states w/ retry', /EmptyState|empty.*retry|Try again|Reload/i],
  ['404 themed page', /isekai|404|NotFound/i],
  ['mobile bottom nav', /BottomNav|bottom-nav|mobile.*nav/i],
  ['focus rings', /focus-visible|focus:ring/i],
  ['reduced-motion respect', /prefers-reduced-motion|reduceMotion/i],
  ['Top 10 with numerals', /Top ?10|top-ten|rank.*numer|T10/i],
  ['ghost-numeral rail', /ghost|text-\[7[0-9]px\]|opacity-\[0\.0[0-9]\]/i],
]
for (const [name, re] of checks) {
  const hits = []
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf-8')
    if (re.test(t)) hits.push(path.relative(SRC, f).replace(/\\/g, '/'))
  }
  console.log((hits.length ? '✅' : '❌'), name.padEnd(42), hits.length ? hits.slice(0, 3).join(', ') : '—')
}
