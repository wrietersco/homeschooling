# Phonics Audio Attribution

The `.m4a` clips in this folder are phoneme ("pure sound") recordings used by
the Phonics Playground feature (`/phonics`) for tap-to-hear and blend
interactions. They come from two sources:

1. **Buzzphonics** — https://github.com/hellodeborahuk/buzzphonics — MIT
   License (https://github.com/hellodeborahuk/buzzphonics/blob/main/LICENSE).
   Short recordings of individual English phonemes (UK synthetic-phonics
   style). Files were fetched 2026-09-19 unmodified.

2. **Re-generated clips (Gemini TTS)** — quality-control review of the
   Buzzphonics set (transcribed + verified with Gemini audio understanding)
   found several files whose content did not match their label, some
   re-generated takes that repeated the sound multiple times, and one
   near-silent take. The following clips were (re-)generated with Google's
   `gemini-2.5-flash-preview-tts` model (voices "Leda" and "Kore"), each
   verified to contain the correct pure sound, spoken once, in a female
   voice, at audible loudness (peak ≥ −20 dB): `ai`, `air`, `c` (also used
   for `k` and `ck`), `ch`, `d`, `ear`, `ee`, `er`, `l`, `n`, `oa`, `oo`,
   `or`, `qu`, `th`, `w`, `z`.

3. **`x.m4a`** was constructed locally by concatenating the verified `c`
   and `s` clips (with a 60 ms gap), since /x/ is the blend /ks/.

4. **Loudness-normalized clips** — `ar`, `f`, `h`, `ow`, `p`, `v` (Buzzphonics
   originals, correct content but recorded very quietly, peaks −25 to −28 dB)
   were amplified by pure gain to ≈ −6 dB peak. No content re-synthesis.

5. **Removed** unused leftovers `ooo.m4a` and `ure.m4a` (never referenced by
   the app's sound inventory).

All sources are free to use within this project. See the Buzzphonics repo for
its full license text.
