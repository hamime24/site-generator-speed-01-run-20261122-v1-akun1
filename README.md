# site-generator-speed-01-run-20261122 — fast static site generator

[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/hamime24/site-generator-speed-01-run-20261122-v1-akun1/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/hamime24/site-generator-speed-01-run-20261122-v1-akun1/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A fast drop-in replacement for makefun-site 1.0.0's `build`, built for the
[site-generator-speed-01-run-20261122](https://make.fun/bounty/site-generator-speed-01-run-20261122)
bounty on make.fun. It returns exactly what makefun-site 1.0.0 returns for
every input — the same output tree, byte for byte — but roughly 3x faster on
the practice set, by scanning lines without per-line regexes, rendering
inline Markdown with a native regex that finds the next mark, keeping an
ASCII fast path plus a memo for slugs, and compiling templates once per build
to small render functions (with a tree-walking fallback).

- `main.ts` — the driver: reads `/input/cases.json`, answers each case with
  `run()` from `solve.js`, writes `/output/answers.json`.
- `solve.js` — the fast generator (ES module, stdlib-only, no dependencies).
- `package.json` — `{"type": "module"}` so Node parses `solve.js` as an ES
  module without a warning or re-parse.

Validated: 3/3 practice cases match `expected.json`, plus 0 mismatches across
75 freshly generated cases drawn with the kit's own generator (25 seeds), and
byte-identical output on repeated runs.
