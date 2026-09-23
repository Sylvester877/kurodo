# whisper.cpp — AI captions (EN)

Kurodo can generate English captions from an episode's **actual audio**
(dub-friendly, word-timed to the stream you're watching) using
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) — fully offline, no API key.

## Layout

| File | Tracked? | Size |
|---|---|---|
| `whisper-cli.exe` | ✅ yes | ~62 MB (Windows x64, v1.8.4) |
| `ggml-large-v3-turbo-q8_0.bin` | ❌ gitignored | **874 MB** — exceeds GitHub's 100 MB limit |

## Getting the model (one time)

Download `ggml-large-v3-turbo-q8_0.bin` into this folder:

```
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin
```

```bash
curl -L -o tools/whisper/ggml-large-v3-turbo-q8_0.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin"
```

Smaller/faster alternative (lower accuracy): `ggml-base.en-q8_0.bin` from the same repo.

## Overrides

Both paths can be pointed elsewhere via env vars (checked first):

- `KURODO_WHISPER_BIN` — path to a `whisper-cli` binary
- `KURODO_WHISPER_MODEL` — path to a ggml `.bin` model
- `KURODO_AI_SUBS_DIR` — where generated `.vtt` files are cached (default `%TEMP%/kurodo-ai-subs`)

In packaged builds, `whisper-cli.exe` + the model are shipped via `extraResources`
(see `package.json`) and found under `process.resourcesPath`.

## Requirements

- `ffmpeg` — resolved via the `ffmpeg-static` npm package (falls back to `ffmpeg` on PATH).
- First run on an episode takes ~12–15 min CPU-only (large-v3-turbo, beam 5);
  results are cached to disk per stream, so it's a one-time cost per episode.
