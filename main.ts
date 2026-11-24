// The harness runs `node /bot/main.ts` (node22): read every case from /input/cases.json, answer each with run() from
// solve.js, write /output/answers.json. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in.
import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

// One CPU and a few hundred milliseconds of work: no background threads, no incremental marking, and no optimizing
// compiler (its compile time costs more than it saves on a run this short). Set before solve.js is loaded.
setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--no-opt');
setFlagsFromString('--single-threaded');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(`${INPUT_DIR}/cases.json`, 'utf8')) as { id: string; input: unknown }[];
const answers: string[] = [];
for (const c of cases) answers.push(JSON.stringify(run(c.input)));
writeFileSync(`${OUTPUT_DIR}/answers.json`, `[${answers.join(',')}]`);
