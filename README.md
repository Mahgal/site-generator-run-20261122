[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Mahgal/site-generator-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Mahgal/site-generator-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

Built for the [make.fun bounty](https://make.fun/bounty/site-generator-speed-01-run-20261122). Referral code: `6d6dq8sh`.

# site-generator-run-20261122

A fast drop-in replacement for **makefun-site 1.0.0**: it builds the exact
same static site — byte for byte — in less CPU time.

## What it is

- `solve.js` — a dependency-free ES module. `run(input)` takes one case's
  input, `{ site, templates, files }`, and returns the output tree:
  a JSON object of every path the build writes (each page's `index.html`,
  the index and tag pages, `build-report.txt`, and each static file) and
  that file's text.
- `main.ts` — the driver the harness runs: it reads every case from
  `/input/cases.json`, answers each one alone with `run`, and writes
  `/output/answers.json`.

The implementation is written from scratch from makefun-site's README and
the practice set's expected answers. It covers makefun-site's own dialect:
its front matter (with its exact refusal reasons), its template dialect
(`{{ }}`, `{{{ }}}`, `{% for %}`, `{% if %}`, `{% include %}`, standalone
tag lines), its Markdown subset (fences, headings with unique slugs,
thematic breaks, blockquotes, lists, paragraphs, and its inline rules for
escapes, code spans, strong, emphasis and links), its slug rule (NFKD,
combining marks dropped, cut to 64), its collections, tags, pagination and
its `build-report.txt`.

## How it is fast

The reference is a general, regex-heavy implementation. This one is built
for this workload only:

- Templates are compiled once per case into a small node tree and rendered
  by a tight interpreter; nothing is re-parsed per page.
- Markdown is rendered by a single-pass line scanner and an index-based
  inline parser — no per-character regexes in hot loops.
- Slugs are memoised per case; sorting and lookups use plain code-unit
  string comparison and `Map`/`Set` lookups.
- No dependencies, no I/O, no clock, no randomness, no state kept between
  cases — the output depends on the input alone, so two runs are
  byte-identical.

## Usage

Node 22 or later, nothing to install:

```sh
# answer the practice set
MAKEFUN_INPUT_DIR=/path/to/practice/input \
MAKEFUN_OUTPUT_DIR=/path/to/output \
node main.ts

# or as a library
node -e "import('./solve.js').then(m => console.log(Object.keys(m.run(input))))"
```

## Verification

Practice set (3 cases, `practice/input` vs `practice/reference`):

```
g-0001 PASS
g-0002 PASS
g-0003 PASS
```

Speed on this machine (fresh process per run, median of 5, practice set):

| entry | median |
| --- | --- |
| makefun-site 1.0.0 (house baseline) | 1338 ms |
| this entry | 769 ms |

That is 1.74x on wall clock. The wall-clock figure includes Node startup
and JSON parsing/serialisation, which both entries pay; measuring `run()`
alone, interleaved round by round, this entry is ~3.4x faster than the
baseline (median ratio 3.36x over 10 rounds, range 2.48x–6.08x).

On top of the practice set, the entry was checked against the baseline on
a self-made edge-case suite of 146 cases (front-matter refusals, slug
collisions, template edge cases, Markdown edge cases, pagination, link
resolution): every case's output is byte-identical to the baseline's.

## License

MIT. See [LICENSE](LICENSE).
