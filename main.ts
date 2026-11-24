// The harness runs `node /bot/main.ts` (node22): read every case from /input/cases.json, answer each with run() from
// solve.js, write /output/answers.json. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in.
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

// One CPU and a few hundred milliseconds of work: no incremental marking, no parallel scavenging and no optimizing
// compiler (its compile time costs more than it saves on a run this short). Set before solve.js is loaded.
setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--no-opt');
setFlagsFromString('--no-parallel-scavenge');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(`${INPUT_DIR}/cases.json`, 'utf8')) as { id: string; input: unknown }[];

// Each answer is written as soon as it is made: no giant joined string, and its pages are free to go.
const fd = openSync(`${OUTPUT_DIR}/answers.json`, 'w');
writeFileSync(fd, '[');
for (let i = 0; i < cases.length; i++) {
  if (i > 0) writeFileSync(fd, ',');
  writeFileSync(fd, JSON.stringify(run(cases[i]!.input)));
}
writeFileSync(fd, ']');
closeSync(fd);
