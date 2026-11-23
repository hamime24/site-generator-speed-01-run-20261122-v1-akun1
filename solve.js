// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// run(input) returns exactly what makefun-site 1.0.0's build returns for the
// same input: the output tree of a generated site, byte for byte. Same pipeline
// (sources, front matter, permalinks, Markdown, collections, tags, layouts,
// report), same rules, only faster: line scanning without per-line regexes,
// chunked inline rendering, an ASCII fast path plus memo for slugs, and
// templates compiled once per build to small render functions (with a
// tree-walking fallback when compiling is unavailable).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const ESC_RE = /[&<>"']/g;

export function escapeHtml(t) {
  let out = '';
  let last = 0;
  let m;
  ESC_RE.lastIndex = 0;
  while ((m = ESC_RE.exec(t)) !== null) {
    if (m.index > last) out += t.slice(last, m.index);
    out += ESC[m[0]];
    last = m.index + 1;
  }
  if (last === 0) return t;
  if (last < t.length) out += t.slice(last);
  return out;
}

const SLUG_MAX = 64;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Slug of `text`: NFKD, combining marks dropped, A-Z lowered, each run of
// characters other than a-z and 0-9 one "-", none at either end, at most 64
// characters (a "-" left at the cut dropped), "untitled" when nothing is left.
// ASCII text is stable under NFKD and holds no combining marks, so it takes
// the fast path; anything else goes through the general path.
function slugifyGeneral(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function slugifyAscii(text) {
  let out = '';
  let gap = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function makeSlugify() {
  const memo = new Map();
  return function slugify(text) {
    let s = memo.get(text);
    if (s !== undefined) return s;
    let ascii = true;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) >= 128) { ascii = false; break; }
    }
    s = ascii ? slugifyAscii(text) : slugifyGeneral(text);
    memo.set(text, s);
    return s;
  };
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
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
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

function isKeyChar(c) {
  return (c >= 'a' && c <= 'z') || c === '_';
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-';
      let y = 0, mo = 0, d = 0;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) { ok = false; break; }
        }
      }
      if (ok) {
        y = Number(raw.slice(0, 4)); mo = Number(raw.slice(5, 7)); d = Number(raw.slice(8, 10));
        if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) ok = false;
      }
      if (!ok) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        for (let i = 0; i < t.length; i++) {
          const c = t[i];
          if (c === '"' || c === '[' || c === ']') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      if (raw.length === 0) return { error: 'key "layout": not a template name' };
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) return { error: 'key "layout": not a template name' };
      }
      return { value: raw };
    }
    case 'slug': {
      if (raw.length === 0 || raw.length > 64) return { error: 'key "slug": not a slug' };
      let prevDash = true;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { prevDash = false; continue; }
        if (c === '-' && !prevDash) { prevDash = true; continue; }
        return { error: 'key "slug": not a slug' };
      }
      if (prevDash) return { error: 'key "slug": not a slug' };
      return { value: raw };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

// Parse one source's front matter without splitting its whole body into
// lines: scan line by line, then take the body as one slice.
function parseFrontMatter(text) {
  // First line must be exactly "---".
  let nl = text.indexOf('\n');
  const firstEnd = nl === -1 ? text.length : nl;
  if (text.slice(0, firstEnd) !== '---') return { error: 'no front matter' };
  let pos = nl === -1 ? text.length : nl + 1;
  let lineNo = 1; // 1-based, counting from the opening "---"
  let close = -1;
  let closeEnd = -1;
  // Find the closing "---" line; remember where each line starts so the
  // key/value lines can be read back in order.
  const fmLines = [];
  while (pos <= text.length) {
    const e = text.indexOf('\n', pos);
    const end = e === -1 ? text.length : e;
    lineNo++;
    const line = text.slice(pos, end);
    if (line === '---') { close = lineNo; closeEnd = end; break; }
    fmLines.push(line);
    if (e === -1) { pos = text.length + 1; break; }
    pos = e + 1;
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let k = 0; k < fmLines.length; k++) {
    const line = fmLines[k];
    const n = k + 2; // line number: opening is 1, so fm line k is k+2
    if (isBlankLine(line) || line[0] === '#') continue;
    // LINE: ^([a-z_]+):(?: (.*))?$
    const ci = line.indexOf(':');
    if (ci <= 0) return { error: `line ${n} is not "key: value"` };
    let keyOk = true;
    for (let i = 0; i < ci; i++) if (!isKeyChar(line[i])) { keyOk = false; break; }
    if (!keyOk) return { error: `line ${n} is not "key: value"` };
    const key = line.slice(0, ci);
    let raw;
    if (ci === line.length - 1) raw = '';
    else if (line[ci + 1] === ' ') raw = line.slice(ci + 2);
    else return { error: `line ${n} is not "key: value"` };
    // Trailing spaces and tabs dropped.
    let re = raw.length;
    while (re > 0 && (raw[re - 1] === ' ' || raw[re - 1] === '\t')) re--;
    if (re !== raw.length) raw = raw.slice(0, re);
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd === text.length ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ---------------------------------------------------------------- Markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function isSpaceTab(c) {
  return c === ' ' || c === '\t';
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && isSpaceTab(line[a])) a++;
  while (b > a && isSpaceTab(line[b - 1])) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

function isBlank(line) {
  return isBlankLine(line);
}

// Fence open: ``` + lang ([A-Za-z0-9_+-]*) + spaces/tabs only. Returns lang or null.
function fenceLang(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let i = 3;
  while (i < line.length) {
    const c = line[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-') i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length && isSpaceTab(line[i])) i++;
  return i === line.length ? lang : null;
}

function isFenceClose(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return false;
  for (let i = 3; i < line.length; i++) if (!isSpaceTab(line[i])) return false;
  return true;
}

// Heading: 1-6 "#", at least one space/tab, then non-empty text (trailing
// spaces/tabs dropped). Returns { depth, text } or null.
function headingOf(line) {
  let n = 0;
  while (n < line.length && line[n] === '#') n++;
  if (n === 0 || n > 6) return null;
  if (n >= line.length || !isSpaceTab(line[n])) return null;
  let a = n;
  while (a < line.length && isSpaceTab(line[a])) a++;
  let b = line.length;
  while (b > a && isSpaceTab(line[b - 1])) b--;
  if (b === a) return null;
  return { depth: n, text: line.slice(a, b) };
}

function isHr(line) {
  if (line.length < 3) return false;
  const a = line[0], b = line[1], c = line[2];
  if (!((a === '-' && b === '-' && c === '-') || (a === '*' && b === '*' && c === '*'))) return false;
  for (let i = 3; i < line.length; i++) if (!isSpaceTab(line[i])) return false;
  return true;
}

function endsParagraph(line) {
  return isBlank(line) || fenceLang(line) !== null || headingOf(line) !== null || isHr(line);
}

// `src` rendered in one pass: its HTML (each block on its own lines, a "\n"
// after the last), its table of contents (every level 2 and 3 heading:
// level, id and its inline HTML) and its excerpt (the first paragraph's
// inline HTML, or ""). Blocks are rendered as they are lexed, with no token
// objects in between; classification is by direct character checks.
function renderMarkdown(src, env, slugify) {
  const lines = src.split('\n');
  const n = lines.length;
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let html = '';
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const lang = fenceLang(line);
    if (lang !== null) {
      let inner = '';
      i++;
      while (i < n && !isFenceClose(lines[i])) { inner += escapeHtml(lines[i]); inner += '\n'; i++; }
      i++;
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      html += `<pre><code${cls}>${inner}</code></pre>\n`;
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text), ids);
      const h = inline(heading.text, env);
      html += `<h${heading.depth} id="${id}">${h}</h${heading.depth}>\n`;
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: h });
      i++;
      continue;
    }
    if (isHr(line)) { html += '<hr>\n'; i++; continue; }
    if (line[0] === '>') {
      const body = [];
      while (i < n && lines[i][0] === '>') body.push(lines[i++].replace(/^> ?/, ''));
      const ls = body.map(trimLine).filter((l) => l !== '');
      html += ls.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(ls.join('\n'), env)}</p>\n</blockquote>\n`;
      continue;
    }
    const bullet = (line[0] === '-' || line[0] === '*') && line[1] === ' ';
    // Ordered: 1-9 digits, ". ", then the item text.
    let orderedNum = null;
    if (!bullet) {
      let d = 0;
      while (d < line.length && d < 9 && line[d] >= '0' && line[d] <= '9') d++;
      if (d >= 1 && line[d] === '.' && line[d + 1] === ' ') orderedNum = line.slice(0, d);
    }
    if (bullet || orderedNum !== null) {
      const isOrdered = orderedNum !== null;
      const items = [];
      while (i < n) {
        const l = lines[i];
        if (isOrdered) {
          let d = 0;
          while (d < l.length && d < 9 && l[d] >= '0' && l[d] <= '9') d++;
          if (d >= 1 && l[d] === '.' && l[d + 1] === ' ') {
            items.push([trimLine(l.slice(d + 2))]);
            i++;
            continue;
          }
        } else if ((l[0] === '-' || l[0] === '*') && l[1] === ' ') {
          items.push([trimLine(l.slice(2))]);
          i++;
          continue;
        }
        // Continued: two or more spaces, then a non-space.
        let sp = 0;
        while (sp < l.length && l[sp] === ' ') sp++;
        if (sp >= 2 && sp < l.length && !/\s/.test(l[sp])) {
          items[items.length - 1].push(trimLine(l));
          i++;
          continue;
        }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && Number(orderedNum) !== 1 ? `<ol start="${Number(orderedNum)}">` : `<${tag}>`;
      let inner = '';
      for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
      html += `${open}\n${inner}</${tag}>\n`;
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const p = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = p;
    html += `<p>${p}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

/** First index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** First single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/**
 * `s` rendered inline; `env.link(target)` is a link's href. A native regex
 * finds the next inline mark; plain runs between marks are escaped in bulk.
 * A mark that does not close stays literal text: the scan just moves past it
 * and the pending plain run still covers it.
 */
function inline(s, env) {
  const SPECIAL = /[\\`*[]/g;
  let out = '';
  let plain = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    SPECIAL.lastIndex = i;
    const m = SPECIAL.exec(s);
    if (m === null) break;
    const j = m.index;
    const c = s[j];
    if (c === '\\' && j + 1 < n && ESCAPABLE.has(s[j + 1])) {
      if (j > plain) out += escapeHtml(s.slice(plain, j));
      out += escapeHtml(s[j + 1]);
      i = j + 2;
      plain = i;
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        if (j > plain) out += escapeHtml(s.slice(plain, j));
        out += `<code>${escapeHtml(s.slice(j + 1, k))}</code>`;
        i = k + 1;
        plain = i;
      } else {
        i = j + 1;
      }
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          if (j > plain) out += escapeHtml(s.slice(plain, j));
          out += `<strong>${inline(s.slice(j + 2, k), env)}</strong>`;
          i = k + 2;
          plain = i;
        } else {
          i = j + 2;
        }
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        if (j > plain) out += escapeHtml(s.slice(plain, j));
        out += `<em>${inline(s.slice(j + 1, k), env)}</em>`;
        i = k + 1;
        plain = i;
      } else {
        i = j + 1;
      }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', j + 1);
      const q = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = q === -1 ? '' : s.slice(k + 2, q);
      if (target !== '' && !/\s/.test(target)) {
        if (j > plain) out += escapeHtml(s.slice(plain, j));
        out += `<a href="${escapeHtml(env.link(target))}">${inline(s.slice(j + 1, k), env)}</a>`;
        i = q + 1;
        plain = i;
        continue;
      }
      i = j + 1;
      continue;
    }
    i = j + 1;
  }
  if (plain < n) out += escapeHtml(s.slice(plain, n));
  return out;
}



// ---------------------------------------------------------------- Templates

const INCLUDE_DEPTH = 8;

class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
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
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain: first name from the nearest scope holding it, then own properties. */
function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
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

// Tree-walking renderer (the fallback when a template cannot compile).
function renderNodes(nodes, scope, ctx, depth) {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out += n.text;
        break;
      case 'var':
        out += ctx.escape(textOf(lookup(scope, n.path)));
        break;
      case 'raw':
        out += textOf(lookup(scope, n.path));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) out += renderNodes(branch, scope, ctx, depth);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        xs.forEach((x, k) => {
          const vars = { [n.name]: x, loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
          out += renderNodes(n.body, { vars, parent: scope }, ctx, depth);
        });
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) out += renderNodes(t, scope, ctx, depth + 1);
        break;
      }
    }
  }
  return out;
}

// Compile a parsed template to a render function:
//   fn(scope, ctx, depth, T, lookup, truthy, textOf, escape) -> string
// T maps template names to their compiled functions. Returns null when the
// template cannot be compiled (the caller then walks the tree instead).
// Includes are inlined, up to 4 levels and never through a cycle: the
// inlined body shares the caller's output array and scope, and the include
// depth is threaded through a local `d` (checked, bumped, restored) so a
// chain renders exactly as far as the reference's depth counter allows.
function compileTemplate(nodes, templates, selfName) {
  let uid = 0;
  const gen = (ns, scopeVar, out, stack, level) => {
    for (const n of ns) {
      if (n.kind === 'text') {
        out.push(`o.push(${JSON.stringify(n.text)});`);
      } else if (n.kind === 'var') {
        out.push(`o.push(esc(textOf(L(${scopeVar},${JSON.stringify(n.path)}))));`);
      } else if (n.kind === 'raw') {
        out.push(`o.push(textOf(L(${scopeVar},${JSON.stringify(n.path)})));`);
      } else if (n.kind === 'if') {
        const cond = `truthy(L(${scopeVar},${JSON.stringify(n.path)}))!==${n.not}`;
        out.push(`if(${cond}){`);
        gen(n.then, scopeVar, out, stack, level);
        out.push('}');
        if (n.else !== null) {
          out.push('else{');
          gen(n.else, scopeVar, out, stack, level);
          out.push('}');
        }
      } else if (n.kind === 'for') {
        const s = `s${++uid}`;
        const xs = `x${uid}`;
        const k = `k${uid}`;
        // One scope object per loop, its loop record mutated per element:
        // rendering is synchronous, so no iteration can observe another's
        // bindings. (The reference builds a fresh scope per element; the
        // values read are the same.)
        out.push(`{const ${xs}=L(${scopeVar},${JSON.stringify(n.path)});if(Array.isArray(${xs})){const ${s}={vars:{loop:{index:0,first:false,last:false,length:${xs}.length}},parent:${scopeVar}};for(let ${k}=0;${k}<${xs}.length;${k}++){${s}.vars[${JSON.stringify(n.name)}]=${xs}[${k}];${s}.vars.loop.index=${k}+1;${s}.vars.loop.first=${k}===0;${s}.vars.loop.last=${k}===${xs}.length-1;`);
        gen(n.body, s, out, stack, level);
        out.push('}}}');
      } else if (n.kind === 'include') {
        const target = templates.get(n.name);
        if (target !== undefined && level < 4 && !stack.includes(n.name)) {
          out.push(`if(d<${INCLUDE_DEPTH}){d++;`);
          gen(target, scopeVar, out, [...stack, n.name], level + 1);
          out.push('d--;}');
        } else {
          out.push(`{const _t=T[${JSON.stringify(n.name)}];if(_t!==undefined&&d<${INCLUDE_DEPTH})o.push(_t(${scopeVar},ctx,d+1,T,L,truthy,textOf,esc));}`);
        }
      }
    }
  };
  const lines = ['let o=[];let d=depth;'];
  gen(nodes, 'scope', lines, [selfName], 0);
  lines.push('return o.join("");');
  try {
    return new Function('scope', 'ctx', 'depth', 'T', 'L', 'truthy', 'textOf', 'esc', lines.join('\n'));
  } catch {
    return null;
  }
}

// Name a compiled template function after its template, for profiles.
function nameCompiled(fn, name) {
  try {
    Object.defineProperty(fn, 'name', { value: `render_${name.replace(/[^A-Za-z0-9_]/g, '_')}` });
  } catch { /* name is best-effort */ }
  return fn;
}

// ---------------------------------------------------------------- the build

const RESERVED = ['posts', 'tags', 'page'];

function byCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The words of a body: its runs of characters other than whitespace
// (JavaScript's \s, checked by code unit, exactly as /\S+/g counts them).
const SPACE_TABLE = new Uint8Array(128);
for (const c of [9, 10, 11, 12, 13, 32]) SPACE_TABLE[c] = 1;

function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const cc = text.charCodeAt(i);
    let sp;
    if (cc < 128) sp = SPACE_TABLE[cc] === 1;
    else sp = cc === 0xa0 || cc === 0x1680 || (cc >= 0x2000 && cc <= 0x200a) || cc === 0x2028 || cc === 0x2029 || cc === 0x202f || cc === 0x205f || cc === 0x3000 || cc === 0xfeff;
    if (sp) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

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

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function build(input) {
  const slugify = makeSlugify();
  const templates = new Map(); // name -> parsed nodes
  const compiled = Object.create(null); // name -> compiled fn (or undefined)
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      const nodes = parseTemplate(name, input.templates[name]);
      templates.set(name, nodes);
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  // Compile after every template is parsed: inlining a leaf include needs
  // the whole map.
  for (const [name, nodes] of templates) {
    const fn = compileTemplate(nodes, templates, name);
    if (fn !== null) compiled[name] = nameCompiled(fn, name);
  }
  const ctx = { templates, escape: escapeHtml };
  const render = (name, vars, site, tags, recent) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const scope = { vars: { site, tags, recent, ...vars }, parent: null };
    const fn = compiled[name];
    if (fn !== undefined) return fn(scope, ctx, 0, compiled, lookup, truthy, textOf, escapeHtml);
    return renderNodes(nodes, scope, ctx, 0);
  };

  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report,
    posts: [],
    tags: [],
    output: {},
  };

  // 1. Sources, in code-unit order of path; .md line ends made "\n".
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const c = f.content;
      b.sources.push({ path: f.path, text: c.indexOf('\r') === -1 ? c : c.replace(/\r\n?/g, '\n') });
    } else b.statics.push({ path: f.path, content: f.content });
  }

  // 2. Front matter and the refusal checks, in order.
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;

  // 3. Permalinks.
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }

  // 4. Markdown, links resolved.
  const staticPaths = new Set(b.statics.map((f) => f.path));
  const linkCache = new Map(); // (dir + "\n" + target) -> resolved href
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        const ck = `${dir}\n${target}`;
        const hit = linkCache.get(ck);
        if (hit !== undefined) {
          if (hit !== false) return hit;
          b.broken.add(`broken-link ${s.path} -> ${target}`);
          return target;
        }
        let href;
        let broken = false;
        if (target[0] === '/' || target[0] === '#') href = target;
        else {
          const ci = target.indexOf(':');
          let scheme = false;
          if (ci > 0) {
            const c0 = target[0];
            scheme = (c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z');
            for (let i = 1; scheme && i < ci; i++) {
              const c = target[i];
              if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '+' || c === '-' || c === '.')) scheme = false;
            }
          }
          if (scheme) href = target;
          else {
            const hash = target.indexOf('#');
            const rel = hash === -1 ? target : target.slice(0, hash);
            const frag = hash === -1 ? '' : target.slice(hash);
            const path = rel === '' ? null : resolvePath(dir, rel);
            if (path !== null && b.bySource.has(path)) href = `${b.bySource.get(path).url}${frag}`;
            else if (path !== null && staticPaths.has(path)) href = `${b.base}/${path}${frag}`;
            else { href = target; broken = true; }
          }
        }
        linkCache.set(ck, broken ? false : href);
        if (broken) b.broken.add(`broken-link ${s.path} -> ${target}`);
        return href;
      },
    };
    const md = renderMarkdown(s.body, env, slugify);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. Collections.
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. Tags.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (!seen.has(slug)) { seen.add(slug); out.push(name); }
    }
    return out;
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) {
    if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  }
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const pageOf = (s, card) => ({
    ...card,
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  // 7. Layouts.
  const cards = new Map();
  for (const p of b.posts) cards.set(p, cardOf(p));
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => cards.get(p));
  const tagOf = (t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) });
  for (const s of b.sources) {
    const card = s.post ? cards.get(s) : cardOf(s);
    b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s, card) }, site, allTags, recent);
  }
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    }, site, allTags, recent);
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const html = render('tag', { tag: tagOf(t) }, site, allTags, recent);
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {}, site, allTags, recent);
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }

  // 8. The report.
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pagesCount = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output['build-report.txt'] = `${lines.join('\n')}\n`;
  return b.output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  return build(input);
}
