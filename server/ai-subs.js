// server/ai-subs.js — AI caption generation via whisper.cpp.
//
// Generates English captions from the episode's actual audio (transcription
// for dub audio) using whisper.cpp (MIT, offline, no API key) — word-timed
// to the stream being played, unlike fansub files cut to a different master.
//
// Pipeline: /proxy stream → ffmpeg (16kHz mono WAV) → whisper-cli
// (large-v3-turbo q8_0, beam 5, title prompt) → SRT → VTT → disk cache.
//
// Jobs are single-flight per key; progress is polled by the renderer.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// whisper-cli lives in tools/whisper (repo) or extraResources (packaged).
// Packaged: server/** is asar-unpacked at app.asar.unpacked/, resources sit
// beside it under resources/tools/whisper.
const WHISPER_CANDIDATES = [
  process.env.KURODO_WHISPER_BIN,
  path.join(__dirname, '..', 'tools', 'whisper', 'whisper-cli.exe'),
  path.join(__dirname, '..', '..', 'tools', 'whisper', 'whisper-cli.exe'),
  path.join(process.resourcesPath || '', 'tools', 'whisper', 'whisper-cli.exe'),
].filter(Boolean)
const MODEL_CANDIDATES = [
  process.env.KURODO_WHISPER_MODEL,
  path.join(__dirname, '..', 'tools', 'whisper', 'ggml-large-v3-turbo-q8_0.bin'),
  path.join(__dirname, '..', '..', 'tools', 'whisper', 'ggml-large-v3-turbo-q8_0.bin'),
  path.join(process.resourcesPath || '', 'tools', 'whisper', 'ggml-large-v3-turbo-q8_0.bin'),
].filter(Boolean)

function findFirst(candidates) {
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return null
}

let ffmpegPathCache = null
async function getFfmpegPath() {
  if (ffmpegPathCache) return ffmpegPathCache
  try {
    const mod = await import('ffmpeg-static')
    ffmpegPathCache = mod.default || mod
  } catch {
    ffmpegPathCache = 'ffmpeg'
  }
  return ffmpegPathCache
}

const AI_SUBS_DIR = process.env.KURODO_AI_SUBS_DIR || path.join(os.tmpdir(), 'kurodo-ai-subs')
const WORK_DIR = path.join(AI_SUBS_DIR, 'work')

function ensureDirs() {
  try { fs.mkdirSync(WORK_DIR, { recursive: true }) } catch { /* ignore */ }
}

// ── Job state ──────────────────────────────────────────────────────
// key: `${streamUrlHash}` — one generation per stream, cached forever.
const jobs = new Map() // key -> { status, phase, pct, error, vttPath, startedAt, endedAt }

export function aiSubsStatus(key) {
  const j = jobs.get(key)
  if (!j) return { status: 'unknown' }
  return {
    status: j.status,
    phase: j.phase || '',
    pct: j.pct ?? 0,
    error: j.error || null,
    url: j.status === 'done' ? `/ai-subs/${key}.vtt` : null,
  }
}

export function aiSubsCacheKey(streamUrl) {
  return crypto.createHash('sha1').update(streamUrl).digest('hex').slice(0, 24)
}

export function startAiSubsJob({ streamUrl, title, headers }) {
  const key = aiSubsCacheKey(streamUrl)
  const existing = jobs.get(key)
  if (existing && (existing.status === 'running')) return { key, ...aiSubsStatus(key) }
  if (existing && existing.status === 'done' && fs.existsSync(existing.vttPath)) {
    return { key, ...aiSubsStatus(key) }
  }

  ensureDirs()
  const job = {
    status: 'running',
    phase: 'audio',
    pct: 0,
    vttPath: path.join(AI_SUBS_DIR, `${key}.vtt`),
    startedAt: Date.now(),
  }
  jobs.set(key, job)

  // Run async — the HTTP handler returns immediately.
  runJob({ key, job, streamUrl, title, headers }).catch((e) => {
    job.status = 'error'
    job.error = e.message
    job.endedAt = Date.now()
    console.warn(`[ai-subs] job ${key} failed: ${e.message}`)
  })

  return { key, ...aiSubsStatus(key) }
}

function runOnce(cmd, args, { timeoutMs, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { proc.kill('kill') } catch { /* ignore */ }
      reject(new Error(`${path.basename(cmd)} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    proc.stdout.on('data', (d) => {
      out += d.toString()
      if (onLine) onLine(d.toString())
    })
    proc.stderr.on('data', (d) => {
      err += d.toString()
      if (onLine) onLine(d.toString())
    })
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ out, err })
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${(err || out).slice(-300)}`))
    })
  })
}

// Progress parser for whisper-cli progress lines: "progress = 42%"
function whisperProgressChunk(chunk) {
  const m = chunk.match(/progress\s*=\s*(\d{1,3})%/)
  return m ? Number(m[1]) : null
}

async function runJob({ key, job, streamUrl, title, headers }) {
  const ffmpeg = await getFfmpegPath()
  const whisperBin = findFirst(WHISPER_CANDIDATES)
  const modelPath = findFirst(MODEL_CANDIDATES)
  if (!whisperBin) throw new Error('whisper-cli not found (tools/whisper missing)')
  if (!modelPath) throw new Error('whisper model not found (tools/whisper missing)')

  // Final artifact already there? done.
  if (fs.existsSync(job.vttPath)) {
    job.status = 'done'
    job.phase = 'done'
    job.pct = 100
    return
  }

  // 1. Extract audio through the app's own /proxy (carries referer headers).
  job.phase = 'audio'
  job.pct = 2
  const proxied = `http://127.0.0.1:${process.env.PORT || 5173}/proxy?url=${encodeURIComponent(streamUrl)}` +
    (headers && Object.keys(headers).length ? `&h=${Buffer.from(JSON.stringify(headers)).toString('base64')}` : '')
  const wavPath = path.join(WORK_DIR, `${key}.wav`)
  // 24-min episode cap: 40 min of audio is plenty; keeps disk + time bounded.
  await runOnce(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-user_agent', 'Mozilla/5.0',
    '-i', proxied,
    '-t', '2400',
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
    '-y', wavPath,
  ], { timeoutMs: 10 * 60 * 1000 })

  // 2. Transcribe + translate.
  job.phase = 'whisper'
  job.pct = 8
  const srtPath = path.join(WORK_DIR, `${key}.srt`)
  const prompt = title ? `${title}. ` : ''
  await runOnce(whisperBin, [
    '-m', modelPath,
    '-f', wavPath,
    '-l', 'en',
    '--beam-size', '5',
    '--prompt', prompt,
    '-osrt', '-of', srtPath.replace(/\.srt$/, ''),
    '-pp',
  ], {
    timeoutMs: 90 * 60 * 1000,
    onLine: (chunk) => {
      const p = whisperProgressChunk(chunk)
      if (p != null) job.pct = Math.min(95, 8 + Math.round(p * 0.87))
    },
  })

  // 3. SRT → VTT (ffmpeg, same trick as the Wyzie pipeline).
  job.phase = 'convert'
  job.pct = 96
  await runOnce(ffmpeg, ['-y', '-i', srtPath, '-f', 'webvtt', job.vttPath], { timeoutMs: 30_000 })

  // 4. Cleanup work files.
  try { fs.rmSync(wavPath, { force: true }) } catch { /* ignore */ }
  try { fs.rmSync(srtPath, { force: true }) } catch { /* ignore */ }

  job.status = 'done'
  job.phase = 'done'
  job.pct = 100
  job.endedAt = Date.now()
  console.log(`[ai-subs] ✓ job ${key} done in ${Math.round((job.endedAt - job.startedAt) / 1000)}s → ${job.vttPath}`)
}

export function aiSubsVttPath(key) {
  const p = path.join(AI_SUBS_DIR, `${key}.vtt`)
  try { return fs.existsSync(p) ? p : null } catch { return null }
}
