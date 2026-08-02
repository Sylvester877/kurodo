import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Quote, RefreshCw, Heart, Copy, CheckCircle2,
  Sparkles, Search, X,
} from 'lucide-react'
import { useTitle } from '../hooks/useTitle'
import { cn } from '../lib/utils'
import { useDebounce } from '../hooks/useDebounce'

interface AnimeQuote {
  id: number
  anime: string
  character: string
  quote: string
  avatar?: string
}

// Curated anime quotes - this avoids external API dependency issues
const CURATED_QUOTES: AnimeQuote[] = [
  { id: 1, anime: 'Attack on Titan', character: 'Eren Yeager', quote: "If you win, you live. If you lose, you die. If you don't fight, you can't win." },
  { id: 2, anime: 'Naruto', character: 'Naruto Uzumaki', quote: "I'm not gonna run away, I never go back on my word! That's my nindō: my ninja way!" },
  { id: 3, anime: 'One Piece', character: 'Monkey D. Luffy', quote: "I don't want to conquer anything. I just think the guy with the most freedom in this whole ocean… is the Pirate King!" },
  { id: 4, anime: 'Death Note', character: 'L', quote: "There is no heaven or hell. No matter what you do while you're alive, everybody goes to the same place once they die. Death is Equal." },
  { id: 5, anime: 'Fullmetal Alchemist', character: 'Roy Mustang', quote: "A lesson without pain is meaningless. For you cannot gain something without sacrificing something else in return." },
  { id: 6, anime: 'Hunter x Hunter', character: 'Killua Zoldyck', quote: "Being weak is nothing to be ashamed of. Staying weak is." },
  { id: 7, anime: 'Jujutsu Kaisen', character: 'Gojo Satoru', quote: "Throughout heaven and earth, I alone am the honored one." },
  { id: 8, anime: 'Steins;Gate', character: 'Okabe Rintaro', quote: "The universe has a beginning, but no end. — Infinite. Stars, too, have a beginning, but are by their own power destroyed. — Finite." },
  { id: 9, anime: 'Code Geass', character: 'Lelouch vi Britannia', quote: "The only ones who should kill are those who are prepared to be killed." },
  { id: 10, anime: 'Demon Slayer', character: 'Kyojuro Rengoku', quote: "Set your heart ablaze. Go beyond your limits." },
  { id: 11, anime: 'Vinland Saga', character: 'Thors', quote: "You have no enemies. No one has any enemies. There is no one that you have to hurt." },
  { id: 12, anime: 'Mob Psycho 100', character: 'Reigen Arataka', quote: "It's okay to lose to an opponent. It's not okay to lose to fear." },
  { id: 13, anime: 'Gintama', character: 'Gintoki Sakata', quote: "There are days when nothing goes right, but there are also days when everything goes right. That's what life is." },
  { id: 14, anime: 'My Hero Academia', character: 'All Might', quote: "It's fine now. Why? Because I am here!" },
  { id: 15, anime: 'Spirited Away', character: 'Haku', quote: "Once you've met someone you never really forget them. It just takes a while for your memories to return." },
  { id: 16, anime: 'Cowboy Bebop', character: 'Spike Spiegel', quote: "I'm not going there to die. I'm going to find out if I'm really alive." },
  { id: 17, anime: 'Neon Genesis Evangelion', character: 'Gendo Ikari', quote: "The fate of destruction is also the joy of rebirth." },
  { id: 18, anime: 'Frieren', character: 'Frieren', quote: "Humans are interesting. Even though their lives are so short, they find meaning in their connections to others." },
  { id: 19, anime: 'Chainsaw Man', character: 'Denji', quote: "I just want to eat good bread, sleep in a warm bed, and maybe touch a girl." },
  { id: 20, anime: 'Spy x Family', character: 'Loid Forger', quote: "This is all for the mission. For world peace." },
  { id: 21, anime: 'Dragon Ball Z', character: 'Vegeta', quote: "There's no such thing as fair or unfair in battle. There is only victory or in your case, defeat." },
  { id: 22, anime: 'Tokyo Ghoul', character: 'Kaneki Ken', quote: "What's wrong isn't me, what's wrong is the world!" },
  { id: 23, anime: 'Bleach', character: 'Aizen Sosuke', quote: "Admiration is the furthest thing from understanding." },
  { id: 24, anime: 'Sword Art Online', character: 'Kirito', quote: "The only thing that can overcome bad luck is hard work." },
  { id: 25, anime: 'Re:Zero', character: 'Subaru Natsuki', quote: "I know you can do it. I believe in you." },
  { id: 26, anime: 'Berserk', character: 'Guts', quote: "Struggle, endure, contend. For that alone is the sword of one who defies death." },
  { id: 27, anime: 'Violet Evergarden', character: 'Violet Evergarden', quote: "I want to know what \"I love you\" means." },
  { id: 28, anime: 'Haikyuu!!', character: 'Hinata Shoyo', quote: "As long as I'm on the court, I won't give up." },
  { id: 29, anime: 'Promised Neverland', character: 'Emma', quote: "We will not be livestock. We will escape and survive." },
  { id: 30, anime: 'Clannad', character: 'Tomoya Okazaki', quote: "Life is about change. Sometimes it's painful, sometimes it's beautiful, but most of the time, it's both." },
  { id: 31, anime: 'Monogatari', character: 'Oshino Shinobu', quote: "People who are unable to make an effort cannot be saved." },
  { id: 32, anime: 'Made in Abyss', character: 'Riko', quote: "There's no turning back now. We'll go forward. Together." },
  { id: 33, anime: 'Dandadan', character: 'Okarun', quote: "I don't care what you say! I'm going to protect what's important to me!" },
  { id: 34, anime: 'Black Clover', character: 'Asta', quote: "My magic is never giving up!" },
  { id: 35, anime: 'Solo Leveling', character: 'Sung Jin-Woo', quote: "Arise." },
  { id: 36, anime: 'One Punch Man', character: 'Saitama', quote: "I'm just a guy who's a hero for fun." },
]

function getRandomQuotes(count: number): AnimeQuote[] {
  // Fisher-Yates shuffle — unbiased, unlike sort(() => Math.random() - 0.5)
  const arr = [...CURATED_QUOTES]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, count)
}

export default function Quotes() {
  useTitle('Anime Quotes')

  const [quotes, setQuotes] = useState<AnimeQuote[]>(() => getRandomQuotes(12))
  const [liked, setLiked] = useState<Set<number>>(new Set())
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [animeFilter, setAnimeFilter] = useState<string>('')
  const debouncedFilter = useDebounce(animeFilter, 200)

  const refreshQuotes = useCallback(() => {
    setQuotes(getRandomQuotes(12))
  }, [])

  const toggleLike = (id: number) => {
    setLiked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyQuote = (q: AnimeQuote) => {
    navigator.clipboard.writeText(`"${q.quote}" — ${q.character}, ${q.anime}`)
    setCopiedId(q.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filteredQuotes = debouncedFilter.trim()
    ? CURATED_QUOTES.filter((q) =>
        q.anime.toLowerCase().includes(debouncedFilter.toLowerCase()) ||
        q.character.toLowerCase().includes(debouncedFilter.toLowerCase()) ||
        q.quote.toLowerCase().includes(debouncedFilter.toLowerCase())
      )
    : quotes

  // Unique anime names for the sidebar
  const uniqueAnimes = useMemo(() => [...new Set(CURATED_QUOTES.map((q) => q.anime))].sort(), [])

  return (
    <div className="pt-20 pb-12">
      <div className="max-w-[1600px] mx-auto px-4">
        {/* ───── Header ───── */}
        <div className="glass-card rounded-2xl p-5 mb-5 relative overflow-hidden">
          <div
            aria-hidden
            className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none"
          />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/25 grid place-items-center">
                <Quote className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white leading-tight">
                  Anime Quotes
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Iconic words from your favorite anime characters
                </p>
              </div>
            </div>

            <button
              onClick={refreshQuotes}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Shuffle quotes
            </button>
          </div>

          {/* Search */}
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 max-w-md">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={animeFilter}
              onChange={(e) => setAnimeFilter(e.target.value)}
              placeholder="Filter by anime or character…"
              className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-muted-foreground"
            />
            {animeFilter && (
              <button onClick={() => setAnimeFilter('')} className="text-muted-foreground hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ───── Quotes grid ───── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredQuotes.map((q, idx) => (
              <motion.div
                key={q.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25, delay: idx * 0.03 }}
              >
                <QuoteCard
                  quote={q}
                  liked={liked.has(q.id)}
                  copied={copiedId === q.id}
                  onLike={() => toggleLike(q.id)}
                  onCopy={() => copyQuote(q)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {filteredQuotes.length === 0 && (
          <div className="glass-card rounded-2xl py-16 text-center">
            <Quote className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-white/80 font-semibold mb-1">No quotes found</p>
            <p className="text-xs text-muted-foreground">Try a different search term</p>
          </div>
        )}

        {/* ───── Anime directory ───── */}
        <div className="mt-8 glass-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Browse by Anime
            </h2>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {uniqueAnimes.length} titles
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {uniqueAnimes.map((name) => (
              <button
                key={name}
                onClick={() => setAnimeFilter(name)}
                className={cn(
                  'glass-pill text-xs transition-all',
                  animeFilter === name
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'hover:bg-white/[0.08] hover:text-white',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function QuoteCard({
  quote: q,
  liked,
  copied,
  onLike,
  onCopy,
}: {
  quote: AnimeQuote
  liked: boolean
  copied: boolean
  onLike: () => void
  onCopy: () => void
}) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col h-full card-tilt group">
      {/* Quote mark */}
      <div className="flex items-start gap-3 mb-3">
        <div className="h-8 w-8 rounded-lg bg-amber-500/15 grid place-items-center shrink-0">
          <Quote className="h-4 w-4 text-amber-400" />
        </div>
        <p className="text-sm text-white/90 leading-relaxed flex-1 italic">
          "{q.quote}"
        </p>
      </div>

      <div className="mt-auto pt-3 border-t border-white/5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-white">{q.character}</p>
            <p className="text-[11px] text-muted-foreground">{q.anime}</p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
            <button
              onClick={onLike}
              className={cn(
                'h-7 w-7 rounded-xl grid place-items-center transition-all',
                liked
                  ? 'bg-red-500/20 text-red-400'
                  : 'text-muted-foreground hover:text-red-400 hover:bg-red-500/10',
              )}
              title="Like quote"
            >
              <Heart className={cn('h-3.5 w-3.5', liked && 'fill-red-400')} />
            </button>
            <button
              onClick={onCopy}
              className={cn(
                'h-7 w-7 rounded-xl grid place-items-center transition-all',
                copied
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-muted-foreground hover:text-white hover:bg-white/10',
              )}
              title="Copy quote"
            >
              {copied
                ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
