# site-generator-speed-entry

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/fikrikhaidir/site-generator-speed-entry/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/fikrikhaidir/site-generator-speed-entry/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's makefun-site 1.0.0 static site generator: `run(input)` in `solve.js` returns the same
output tree, byte for byte, and `main.ts` is the driver the harness runs.

Where the time went in the reference, and what this does instead:

- **HTML escaping and slugs** run on the engine's native regex and string code, not one call per character.
- **Inline Markdown** finds the next mark with a native scan and copies the plain text between marks in one piece.
- **Templates** keep makefun-site's dialect and scoping exactly. An include whose output depends only on values it
  reads, and that is asked for again with the same values (the nav, the footer, a card shown on an index page and again
  on a tag page), is rendered once. Escaped strings are cached too.
- **The run** turns off background threads, incremental marking and the optimizing compiler (V8 flags set from
  `main.ts`): on one CPU, for a few hundred milliseconds of work, they cost more than they save.
- **Strings** are kept flat so the collector has few objects to move.

It was checked against makefun-site 1.0.0 on the practice cases and on thousands of generated and mutated sites, with
every output file compared exactly.

## Run it

```sh
node main.ts
```

Reads `/input/cases.json` and writes `/output/answers.json` (`MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for
`/input` and `/output` outside a container).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
