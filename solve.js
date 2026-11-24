// A faster drop-in for makefun-site 1.0.0: run(input) returns the same output tree, byte for byte.
// One file, no dependencies. Bulk text work is left to the engine's native string and regex code (escape, slug,
// scanning for the next Markdown mark), which costs the same cold or warm, instead of per-character JS loops.

const hasOwn = Object.hasOwn;

// ---------------------------------------------------------------- text

const ESC_G = /[&<>"']/g;

/** HTML escape: & < > " ' only. Returns the argument itself when nothing needs escaping. */
function esc(s) {
  ESC_G.lastIndex = 0;
  if (!ESC_G.test(s)) return s;
  let i = ESC_G.lastIndex - 1;
  let last = 0;
  let out = '';
  for (;;) {
    const c = s.charCodeAt(i);
    out += s.slice(last, i) + (c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;');
    last = i + 1;
    if (!ESC_G.test(s)) break;
    i = ESC_G.lastIndex - 1;
  }
  return out + s.slice(last);
}

const MARKS = /\p{M}/gu;
const NON_ALNUM = /[^A-Za-z0-9]+/g;
const NON_ASCII = /[^\x00-\x7f]/;
const DASH_ENDS = /^-+|-+$/g;
const DASH_END = /-+$/;

/** The slug of text: NFKD, marks dropped, runs of non a-z0-9 one "-", 64 characters at most, "untitled" if empty. */
function slugify(text) {
  const plain = NON_ASCII.test(text) ? text.normalize('NFKD').replace(MARKS, '') : text;
  let out = plain.replace(NON_ALNUM, '-').replace(DASH_ENDS, '').toLowerCase();
  if (out.length > 64) out = out.slice(0, 64).replace(DASH_END, '');
  return out === '' ? 'untitled' : out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** The count of runs of non-\s characters. */
const WORD = /\S+/g;
function wordsOf(text) {
  const m = text.match(WORD);
  return m === null ? 0 : m.length;
}

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => {
  const k = path.lastIndexOf('/');
  return k === -1 ? '' : path.slice(0, k);
};

// ---------------------------------------------------------------- front matter

const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;
const BLANK_LINE = /^[ \t]*$/;
const TRAIL = /[ \t]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

/** { data, body } or { error }; `text` has "\n" line ends. */
function parseFrontMatter(text) {
  if (!text.startsWith('---')) return { error: 'no front matter' };
  if (text.length === 3) return { error: 'the front matter is not closed' };
  if (text.charCodeAt(3) !== 10) return { error: 'no front matter' };
  // lines[0] is "---"; walk the lines from the second.
  let pos = 4;
  const lines = [];
  let bodyAt = -1;
  const n = text.length;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? n : nl;
    if (end - pos === 3 && text.startsWith('---', pos)) {
      bodyAt = nl === -1 ? n : nl + 1;
      break;
    }
    lines.push(text.slice(pos, end));
    if (nl === -1) return { error: 'the front matter is not closed' };
    pos = nl + 1;
  }
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line.charCodeAt(0) === 35 || BLANK_LINE.test(line)) continue;
    const m = LINE.exec(line);
    if (m === null) return { error: `line ${i + 2} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(TRAIL, '');
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: bodyAt >= n ? '' : text.slice(bodyAt) };
}

// ---------------------------------------------------------------- markdown

const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;
const WS = /\s/;
const SPEC = /[\\`*[]/g;

function trimLine(line) {
  const n = line.length;
  if (n === 0) return line;
  const f = line.charCodeAt(0);
  const l = line.charCodeAt(n - 1);
  if (f !== 32 && f !== 9 && l !== 32 && l !== 9) return line;
  let a = 0;
  let b = n;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c !== 32 && c !== 9) break;
    b--;
  }
  return line.slice(a, b);
}

function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : m;
}

function endsParagraph(line) {
  if (line.length === 0) return true;
  const c = line.charCodeAt(0);
  if (c === 32 || c === 9) return BLANK_LINE.test(line);
  if (c === 96) return FENCE_OPEN.test(line);
  if (c === 35) return headingOf(line) !== null;
  if (c === 45 || c === 42) return HR.test(line);
  return false;
}

function escapable(c) {
  switch (c) {
    case 92: case 96: case 42: case 95: case 91: case 93: case 40: case 41: case 35: case 43: case 45: case 46: case 33: case 62:
      return true;
    default:
      return false;
  }
}

/** The first index from `from` where s holds `**` outside a backslash escape, or -1. */
function findStrongClose(s, from) {
  const n = s.length;
  for (let j = from; j + 1 < n; j++) {
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (escapable(s.charCodeAt(j + 1))) j++;
    } else if (c === 42 && s.charCodeAt(j + 1) === 42) return j;
  }
  return -1;
}

function findBracketClose(s, from) {
  const n = s.length;
  for (let j = from; j < n; j++) {
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < n && escapable(s.charCodeAt(j + 1))) j++;
    } else if (c === 93) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  const n = s.length;
  for (let j = from; j < n; j++) {
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < n && escapable(s.charCodeAt(j + 1))) j++;
    } else if (c === 42) {
      if (j + 1 < n && s.charCodeAt(j + 1) === 42) j++;
      else return j;
    }
  }
  return -1;
}

function inline(s, env) {
  SPEC.lastIndex = 0;
  if (!SPEC.test(s)) return esc(s);
  const n = s.length;
  let out = '';
  let i = SPEC.lastIndex - 1;
  let run = 0;
  for (;;) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < n && escapable(s.charCodeAt(i + 1))) {
        if (run < i) out += esc(s.slice(run, i));
        out += esc(s[i + 1]);
        i += 2;
        run = i;
      } else i++;
    } else if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (run < i) out += esc(s.slice(run, i));
        out += `<code>${esc(s.slice(i + 1, j))}</code>`;
        i = j + 1;
        run = i;
      } else i++;
    } else if (c === 42) {
      if (i + 1 < n && s.charCodeAt(i + 1) === 42) {
        const j = findStrongClose(s, i + 2);
        if (j > i + 2) {
          if (run < i) out += esc(s.slice(run, i));
          out += `<strong>${inline(s.slice(i + 2, j), env)}</strong>`;
          i = j + 2;
          run = i;
        } else i += 2;
      } else {
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          if (run < i) out += esc(s.slice(run, i));
          out += `<em>${inline(s.slice(i + 1, j), env)}</em>`;
          i = j + 1;
          run = i;
        } else i++;
      }
    } else {
      // [
      const k = findBracketClose(s, i + 1);
      const m = k !== -1 && k + 1 < n && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      let linked = false;
      if (m !== -1) {
        const target = s.slice(k + 2, m);
        if (target !== '' && !WS.test(target)) {
          if (run < i) out += esc(s.slice(run, i));
          out += `<a href="${esc(env.link(target))}">${inline(s.slice(i + 1, k), env)}</a>`;
          i = m + 1;
          run = i;
          linked = true;
        }
      }
      if (!linked) i++;
    }
    if (i >= n) break;
    SPEC.lastIndex = i;
    if (!SPEC.test(s)) break;
    i = SPEC.lastIndex - 1;
  }
  return run < n ? out + esc(s.slice(run)) : out;
}

/** The HTML, table of contents and excerpt of a Markdown body. */
function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const nl = lines.length;
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let html = '';
  let i = 0;
  while (i < nl) {
    const line = lines[i];
    if (line.length === 0) {
      i++;
      continue;
    }
    const c = line.charCodeAt(0);
    if ((c === 32 || c === 9) && BLANK_LINE.test(line)) {
      i++;
      continue;
    }
    if (c === 96) {
      const fence = FENCE_OPEN.exec(line);
      if (fence !== null) {
        const cls = fence[1] === '' ? '' : ` class="language-${esc(fence[1])}"`;
        let body = '';
        i++;
        while (i < nl && !FENCE_CLOSE.test(lines[i])) body += `${esc(lines[i++])}\n`;
        i++;
        html += `<pre><code${cls}>${body}</code></pre>\n`;
        continue;
      }
    } else if (c === 35) {
      const h = headingOf(line);
      if (h !== null) {
        const depth = h[1].length;
        const text = h[2];
        const id = uniqueSlug(slugify(text), ids);
        const inl = inline(text, env);
        html += `<h${depth} id="${id}">${inl}</h${depth}>\n`;
        if (depth === 2 || depth === 3) toc.push({ level: depth, id, html: inl });
        i++;
        continue;
      }
    } else if (c === 45 || c === 42) {
      if (HR.test(line)) {
        html += '<hr>\n';
        i++;
        continue;
      }
    } else if (c === 62) {
      let text = '';
      let any = false;
      while (i < nl && lines[i].startsWith(">")) {
        const l = lines[i++];
        const t = trimLine(l.length > 1 && l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
        if (t !== '') {
          text = any ? `${text}\n${t}` : t;
          any = true;
        }
      }
      html += any ? `<blockquote>\n<p>${inline(text, env)}</p>\n</blockquote>\n` : '<blockquote>\n</blockquote>\n';
      continue;
    }
    let bullet = null;
    let ordered = null;
    if (c === 45 || c === 42) bullet = BULLET.exec(line);
    else if (c >= 48 && c <= 57) ordered = ORDERED.exec(line);
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const marker = isOrdered ? ORDERED : BULLET;
      const start = isOrdered ? Number(ordered[1]) : 1;
      let items = '';
      let cur = null;
      while (i < nl) {
        const l = lines[i];
        const m = marker.exec(l);
        if (m !== null) {
          if (cur !== null) items += `<li>${inline(cur, env)}</li>\n`;
          cur = trimLine(isOrdered ? m[2] : m[1]);
          i++;
        } else if (l.length > 0 && l.charCodeAt(0) === 32 && CONTINUED.test(l)) {
          cur += `\n${trimLine(l)}`;
          i++;
        } else break;
      }
      items += `<li>${inline(cur, env)}</li>\n`;
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      html += `${open}\n${items}</${tag}>\n`;
      continue;
    }
    let text = trimLine(line);
    i++;
    while (i < nl && !endsParagraph(lines[i])) text += `\n${trimLine(lines[i++])}`;
    const inl = inline(text, env);
    if (excerpt === null) excerpt = inl;
    html += `<p>${inl}</p>\n`;
  }
  // Flat strings keep the heap small: a rope of thousands of pieces costs the collector far more than its text.
  if (html.length > 0) html.charCodeAt(0);
  if (excerpt !== null && excerpt.length > 0) excerpt.charCodeAt(0);
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const INCLUDE_DEPTH = 8;
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = BLANK_LINE.test(src.slice(lineStart, open)) && BLANK_LINE.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

// Node kinds: 0 text, 1 var, 2 raw, 3 if, 4 for, 5 include.
function parseTemplate(name, src) {
  const root = { kind: -1, body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 0, text: tok.text });
    else if (tok.t === 'var') body.push({ kind: 1, path: tok.path });
    else if (tok.t === 'raw') body.push({ kind: 2, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 4, name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 3, not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 3 || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 4 : 3)) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === -1 ? parent.body : parent.kind === 4 ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 5, name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind === 4 ? 'for' : 'if'} is not closed`);
  return root.body;
}

/**
 * Marks each template with what an include of it depends on: `free`, the names it reads that no loop of its own binds
 * (through its includes too), `height`, how many includes deep it nests, and `memo`, whether its output may be reused
 * for the same values of those names (no include cycle, and no read of `loop`, whose object changes under it).
 */
function analyze(templates) {
  const seen = new Map();
  const visit = (name) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const had = seen.get(name);
    if (had !== undefined) return had;
    const info = { visiting: true, cyclic: false, free: [], height: 0, memo: false, cache: new Map() };
    seen.set(name, info);
    const free = new Set();
    let height = 0;
    const walk = (list, bound) => {
      for (const n of list) {
        switch (n.kind) {
          case 1:
          case 2:
            if (!bound.has(n.path[0])) free.add(n.path[0]);
            break;
          case 3:
            if (!bound.has(n.path[0])) free.add(n.path[0]);
            walk(n.then, bound);
            if (n.else !== null) walk(n.else, bound);
            break;
          case 4: {
            if (!bound.has(n.path[0])) free.add(n.path[0]);
            const inner = new Set(bound);
            inner.add(n.name);
            inner.add('loop');
            walk(n.body, inner);
            break;
          }
          case 5: {
            const sub = visit(n.name);
            if (sub === null) {
              height = Math.max(height, 1);
              break;
            }
            if (sub.visiting || sub.cyclic) info.cyclic = true;
            height = Math.max(height, 1 + sub.height);
            for (const f of sub.free) if (!bound.has(f)) free.add(f);
            break;
          }
        }
      }
    };
    walk(nodes, new Set());
    info.free = [...free].sort();
    info.height = height;
    info.memo = !info.cyclic && !free.has('loop');
    info.visiting = false;
    nodes.info = info;
    return info;
  };
  for (const name of templates.keys()) visit(name);
}

// A scope is the root { vars, parent: null } or a loop frame { name, val, loop, parent, vars: undefined }.
function lookup(scope, path) {
  const first = path[0];
  let s = scope;
  let v;
  for (;;) {
    if (s === null) return undefined;
    if (s.vars !== undefined) {
      if (!hasOwn(s.vars, first)) return undefined;
      v = s.vars[first];
      break;
    }
    if (first === 'loop') {
      v = s.loop;
      break;
    }
    if (first === s.name) {
      v = s.val;
      break;
    }
    s = s.parent;
  }
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** The value a free name resolves to in `scope` (its first name only), undefined when no scope holds it. */
function lookupName(scope, name) {
  let s = scope;
  for (;;) {
    if (s === null) return undefined;
    if (s.vars !== undefined) return hasOwn(s.vars, name) ? s.vars[name] : undefined;
    if (name === 'loop') return s.loop;
    if (name === s.name) return s.val;
    s = s.parent;
  }
}

// The escaped form of each string a template writes, so a title written on every page is escaped once.
const escMemo = new Map();
function escVar(v) {
  let r = escMemo.get(v);
  if (r === undefined) {
    r = esc(v);
    if (escMemo.size < 200000) escMemo.set(v, r);
  }
  return r;
}

function renderNodes(nodes, scope, templates, depth) {
  let out = '';
  for (let q = 0; q < nodes.length; q++) {
    const n = nodes[q];
    switch (n.kind) {
      case 0:
        out += n.text;
        break;
      case 1: {
        const v = lookup(scope, n.path);
        out += escVar(typeof v === 'string' ? v : textOf(v));
        break;
      }
      case 2: {
        const v = lookup(scope, n.path);
        out += typeof v === 'string' ? v : textOf(v);
        break;
      }
      case 3: {
        const branch = truthy(lookup(scope, n.path)) !== n.not ? n.then : n.else;
        if (branch !== null) out += renderNodes(branch, scope, templates, depth);
        break;
      }
      case 4: {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const len = xs.length;
        const frame = { vars: undefined, name: n.name, val: undefined, loop: { index: 0, first: true, last: false, length: len }, parent: scope };
        for (let k = 0; k < len; k++) {
          frame.val = xs[k];
          const lp = frame.loop;
          lp.index = k + 1;
          lp.first = k === 0;
          lp.last = k === len - 1;
          out += renderNodes(n.body, frame, templates, depth);
        }
        break;
      }
      case 5: {
        const t = templates.get(n.name);
        if (t === undefined || depth >= INCLUDE_DEPTH) break;
        const info = t.info;
        if (info !== undefined && info.memo && depth + 1 + info.height <= INCLUDE_DEPTH) {
          // The output depends only on the values its free names resolve to: reuse it when they are the same.
          const free = info.free;
          const k = free.length;
          let m = info.cache;
          let r;
          if (k === 0) r = m.get(m);
          else {
            for (let i = 0; i < k - 1; i++) {
              const key = lookupName(scope, free[i]);
              let next = m.get(key);
              if (next === undefined) {
                next = new Map();
                m.set(key, next);
              }
              m = next;
            }
            r = m.get(lookupName(scope, free[k - 1]));
          }
          if (r === undefined) {
            r = renderNodes(t, scope, templates, depth + 1);
            m.set(k === 0 ? m : lookupName(scope, free[k - 1]), r);
          }
          out += r;
        } else out += renderNodes(t, scope, templates, depth + 1);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- the build

const RESERVED = ['posts', 'tags', 'page'];
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function cardOf(s) {
  const date = s.data.date;
  return {
    title: s.data.title,
    url: s.url,
    date: date ?? '',
    date_long: date === undefined ? '' : longDate(date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

function build(input) {
  const templates = new Map();
  const report = [];
  const tnames = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of tnames) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  analyze(templates);
  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. sources
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  let sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const c = f.content;
      sources.push({ path: f.path, text: c.indexOf('\r') === -1 ? c : c.replace(/\r\n?/g, '\n') });
    } else statics.push(f);
  }

  // 2. front matter
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  sources = kept;

  // 3. permalinks
  const taken = new Map();
  const bySource = new Map();
  for (const s of sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. markdown
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of sources) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        const c0 = target.charCodeAt(0);
        if (c0 === 47 || c0 === 35 || SCHEME.test(target)) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null) {
          const p = bySource.get(path);
          if (p !== undefined) return `${p.url}${frag}`;
          if (staticPaths.has(path)) return `${base}/${path}${frag}`;
        }
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. collections
  const posts = sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const names = s.data.tags;
    if (names === undefined) return [];
    const seen = new Set();
    const out = [];
    for (const name of names) {
      const sl = slugify(name);
      if (!seen.has(sl)) {
        seen.add(sl);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of sources) if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  const tagList = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. layouts
  const output = {};
  const cards = new Map();
  for (const s of sources) cards.set(s, cardOf(s));
  const site = { title: input.site.title, base_url: base };
  const allTags = tagList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    vars.site = site;
    vars.tags = allTags;
    vars.recent = recent;
    const page = renderNodes(nodes, { vars, parent: null }, templates, 0);
    if (page.length > 0) page.charCodeAt(0);
    return page;
  };
  for (const s of sources) {
    const page = cards.get(s);
    const full = {
      title: page.title,
      url: page.url,
      date: page.date,
      date_long: page.date_long,
      summary: page.summary,
      excerpt: page.excerpt,
      reading_minutes: page.reading_minutes,
      tags: page.tags,
      slug: s.slug,
      content: s.html,
      toc: s.toc,
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = render(s.layout, { page: full });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tagList) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. report
  const lines = [...report, ...broken].sort(byCodeUnits);
  let pageCount = 0;
  for (const s of sources) if (!s.post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tagList.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}

export function run(input) {
  return build(input);
}
