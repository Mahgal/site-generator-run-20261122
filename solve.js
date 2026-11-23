// A fast drop-in for makefun-site 1.0.0, written from scratch from its README
// and the practice set's expected answers. Dependency-free, deterministic:
// no clock, no environment, no randomness, no I/O, nothing kept from one
// case to the next (every cache below is created fresh inside run()).
//
// Layout of this file:
//   1. small helpers (escaping, slugs, dates, link resolution)
//   2. front matter
//   3. Markdown (blocks, then inline)
//   4. templates (compile once per case, render many times)
//   5. build(): the pipeline, and run().

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const ESC_TEST_RE = /[&<>"']/;

/** HTML escaping: & < > " ' and nothing else. */
function esc(s) {
  if (s.length === 0 || !ESC_TEST_RE.test(s)) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(last, i) + rep;
      last = i + 1;
    }
  }
  return last === 0 ? s : out + s.slice(last);
}

/** Escape one character (used by the inline parser for \-escapes). */
function escChar(c) {
  if (c === '&') return '&amp;';
  if (c === '<') return '&lt;';
  if (c === '>') return '&gt;';
  if (c === '"') return '&quot;';
  if (c === "'") return '&#39;';
  return c;
}

const MARK_RE = /[\p{M}]/gu;
const NON_ALNUM_RE = /[^a-z0-9]+/g;

/**
 * A slug: NFKD, combining marks dropped, A-Z lowered, each run of
 * characters other than a-z and 0-9 one '-', none at either end, cut to
 * 64 characters (a '-' left at the cut dropped), 'untitled' when empty.
 */
function slugOf(text, cache) {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let t = text.normalize('NFKD').replace(MARK_RE, '').toLowerCase();
  t = t.replace(NON_ALNUM_RE, '-');
  let a = 0;
  let b = t.length;
  while (a < b && t.charCodeAt(a) === 45) a++;
  while (b > a && t.charCodeAt(b - 1) === 45) b--;
  t = t.slice(a, b);
  if (t.length > 64) {
    t = t.slice(0, 64);
    if (t.charCodeAt(63) === 45) t = t.slice(0, 63);
  }
  if (t.length === 0) t = 'untitled';
  cache.set(text, t);
  return t;
}

/** '2026-11-09' -> '9 November 2026', from the string alone. */
function dateLong(ds) {
  const y = ds.slice(0, 4);
  const m = (ds.charCodeAt(5) - 48) * 10 + (ds.charCodeAt(6) - 48);
  let d = ds.slice(8, 10);
  if (d.charCodeAt(0) === 48) d = d.slice(1);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A real day from 1970-01-01 to 2099-12-31, written YYYY-MM-DD. */
function isValidDate(ds) {
  if (ds.length !== 10 || ds.charCodeAt(4) !== 45 || ds.charCodeAt(7) !== 45) return false;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = ds.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  const y = (ds.charCodeAt(0) - 48) * 1000 + (ds.charCodeAt(1) - 48) * 100
    + (ds.charCodeAt(2) - 48) * 10 + (ds.charCodeAt(3) - 48);
  const m = (ds.charCodeAt(5) - 48) * 10 + (ds.charCodeAt(6) - 48);
  const d = (ds.charCodeAt(8) - 48) * 10 + (ds.charCodeAt(9) - 48);
  if (y < 1970 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  let dim = DAYS_IN_MONTH[m - 1];
  if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) dim = 29;
  return d <= dim;
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Resolve a link target from the source's directory. Returns the href to
 * write and whether the link is broken (reported, kept as written).
 * pagesBySource maps a source path to its page url; statics holds every
 * static file's path.
 */
function resolveLink(target, fromDir, pagesBySource, statics, base) {
  if (target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35 || SCHEME_RE.test(target)) {
    return { href: target, broken: false };
  }
  let path = target;
  let hash = '';
  const hi = target.indexOf('#');
  if (hi !== -1) {
    path = target.slice(0, hi);
    hash = target.slice(hi);
  }
  const parts = fromDir === '' ? [] : fromDir.split('/');
  const segs = path.split('/');
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === '' || s === '.') continue;
    if (s === '..') {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(s);
  }
  const resolved = parts.join('/');
  const url = pagesBySource.get(resolved);
  if (url !== undefined) return { href: url + hash, broken: false };
  if (statics.has(resolved)) return { href: base + '/' + resolved + hash, broken: false };
  return { href: target, broken: true };
}

/** Words in a body: runs of characters other than whitespace, over 200, rounded up, at least 1. */
function readingMinutes(body) {
  const m = body.match(/\S+/g);
  const words = m === null ? 0 : m.length;
  const r = (words + 199) / 200 | 0;
  return r < 1 ? 1 : r;
}


// ---------------------------------------------------------------- front matter

const FM_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const FM_LINE_RE = /^([a-z_]+):(?: (.*))?$/;
const LAYOUT_RE = /^[a-z0-9-]+$/;
const SLUG_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimEndWs(s) {
  let e = s.length;
  while (e > 0) {
    const c = s.charCodeAt(e - 1);
    if (c !== 32 && c !== 9) break;
    e--;
  }
  return e === s.length ? s : s.slice(0, e);
}

/** Parse a quoted string value (value[0] is '"'). Returns the string, null when not closed (or followed by more text), false when an escape other than \" or \\ appears. */
function parseQuoted(value) {
  let out = '';
  let i = 1;
  while (i < value.length) {
    const c = value[i];
    if (c === '\\') {
      const n = value[i + 1];
      if (n === '"' || n === '\\') {
        out += n;
        i += 2;
        continue;
      }
      return false;
    }
    if (c === '"') {
      if (i !== value.length - 1) return null;
      return out;
    }
    out += c;
    i++;
  }
  return null;
}

function parseTags(value) {
  if (value.length < 2 || value.charCodeAt(0) !== 91 || value.charCodeAt(value.length - 1) !== 93) {
    return { error: 'key "tags": not a list [a, b]' };
  }
  const inner = value.slice(1, -1);
  if (inner.trim() === '') return { tags: [] };
  const raw = inner.split(',');
  const tags = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i];
    let a = 0;
    let b = t.length;
    while (a < b && (t.charCodeAt(a) === 32 || t.charCodeAt(a) === 9)) a++;
    while (b > a && (t.charCodeAt(b - 1) === 32 || t.charCodeAt(b - 1) === 9)) b--;
    t = t.slice(a, b);
    if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
      return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
    }
    tags[i] = t;
  }
  return { tags };
}

/**
 * Parse a source's front matter. Returns { data, body } or { error } with
 * the refusal reason. Lines are counted from 1 at the opening '---'.
 */
function parseFrontMatter(content) {
  const lines = content.split('\n');
  if (lines.length === 0 || lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  const seen = new Set();
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const n = i + 1;
    if (isBlankLine(line)) continue;
    if (line.charCodeAt(0) === 35) continue; // a comment opens on '#'
    const m = FM_LINE_RE.exec(line);
    if (m === null) return { error: `line ${n} is not "key: value"` };
    const key = m[1];
    if (!FM_KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (seen.has(key)) return { error: `key "${key}" is given twice` };
    seen.add(key);
    const value = trimEndWs(m[2] === undefined ? '' : m[2]);
    if (value === '') return { error: `key "${key}" has no value` };
    if (key === 'title' || key === 'summary') {
      if (value.charCodeAt(0) === 34) {
        const q = parseQuoted(value);
        if (q === false) return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\` };
        if (q === null) return { error: `key "${key}": a quoted string is not closed` };
        data[key] = q;
      } else if (value.charCodeAt(0) === 91) {
        return { error: `key "${key}": a bare string opens on [` };
      } else {
        data[key] = value;
      }
    } else if (key === 'date') {
      if (!isValidDate(value)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      data.date = value;
    } else if (key === 'tags') {
      const r = parseTags(value);
      if (r.error) return { error: r.error };
      data.tags = r.tags;
    } else if (key === 'draft') {
      if (value === 'true') data.draft = true;
      else if (value === 'false') data.draft = false;
      else return { error: 'key "draft": true or false' };
    } else if (key === 'layout') {
      if (!LAYOUT_RE.test(value)) return { error: 'key "layout": not a template name' };
      data.layout = value;
    } else if (key === 'slug') {
      if (value.length > 64 || !SLUG_KEY_RE.test(value)) return { error: 'key "slug": not a slug' };
      data.slug = value;
    }
  }
  if (data.title === undefined) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}


// ---------------------------------------------------------------- Markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const WS_RE = /\s/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;
const FENCE_OPEN_RE = /^```([A-Za-z0-9_+-]*)([ \t]*)$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const HR_RE = /^(---|\*\*\*)[ \t]*$/;
const LIST_ORD_RE = /^(\d+)\. /;

function trimWs(s) {
  let a = 0;
  let b = s.length;
  while (a < b && (s.charCodeAt(a) === 32 || s.charCodeAt(a) === 9)) a++;
  while (b > a && (s.charCodeAt(b - 1) === 32 || s.charCodeAt(b - 1) === 9)) b--;
  return s.slice(a, b);
}

function isFenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  const m = FENCE_OPEN_RE.exec(line);
  return m === null ? null : m[1];
}

function isHeading(line) {
  if (line.charCodeAt(0) !== 35) return null;
  const m = HEADING_RE.exec(line);
  if (m === null) return null;
  const text = trimEndWs(m[2]);
  if (text === '') return null;
  return { level: m[1].length, text };
}

function findStrongClose(s, from) {
  // The closer is the next `**` (not escaped) after the opener; with
  // nothing between it and the opener there is no strong at all.
  let j = from;
  while (j + 1 < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j += 2;
      continue;
    }
    if (c === '*' && s[j + 1] === '*') {
      return j === from ? -1 : j;
    }
    j++;
  }
  return -1;
}

function findEmClose(s, from) {
  // The closer is the next lone `*`: a `**` pair is a strong delimiter and
  // is stepped over whole (so the last star of a `***` run can close it),
  // as are \-escapes.
  let j = from;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j += 2;
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        j += 2;
        continue;
      }
      if (j > from) return j;
    }
    j++;
  }
  return -1;
}

function tryLink(s, i, st) {
  let k = i + 1;
  let textEnd = -1;
  while (k < s.length) {
    const c = s[k];
    if (c === '\\' && k + 1 < s.length && ESCAPABLE.has(s[k + 1])) {
      k += 2;
      continue;
    }
    if (c === ']') {
      textEnd = k;
      break;
    }
    k++;
  }
  if (textEnd === -1 || s[textEnd + 1] !== '(') return null;
  let m = textEnd + 2;
  let targetEnd = -1;
  while (m < s.length) {
    const c = s[m];
    if (c === '\\' && m + 1 < s.length && ESCAPABLE.has(s[m + 1])) {
      m += 2;
      continue;
    }
    if (c === ')') {
      targetEnd = m;
      break;
    }
    m++;
  }
  if (targetEnd === -1) return null;
  const target = s.slice(textEnd + 2, targetEnd);
  if (target === '' || WS_RE.test(target)) return null;
  const r = resolveLink(target, st.dir, st.pagesBySource, st.statics, st.base);
  if (r.broken) st.broken.add(target);
  return {
    html: '<a href="' + esc(r.href) + '">' + inline(s.slice(i + 1, textEnd), st) + '</a>',
    next: targetEnd + 1,
  };
}

/** Inline rendering, left to right. `st` carries the link context. */
function inline(s, st) {
  const re = /[\\`*\[&<>"']/g;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    // Copy a maximal plain run: no escapes, no markup, nothing to escape.
    re.lastIndex = i;
    const m = re.exec(s);
    if (m === null) {
      out += s.slice(i);
      break;
    }
    const j = m.index;
    if (j > i) out += s.slice(i, j);
    i = j;
    const c = s[i];
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      out += escChar(s[i + 1]);
      i += 2;
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', i + 1);
      if (k === -1 || k === i + 1) {
        out += '`';
        i++;
        continue;
      }
      out += '<code>' + esc(s.slice(i + 1, k)) + '</code>';
      i = k + 1;
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const k = findStrongClose(s, i + 2);
        if (k === -1) {
          out += '**';
          i += 2;
          continue;
        }
        out += '<strong>' + inline(s.slice(i + 2, k), st) + '</strong>';
        i = k + 2;
        continue;
      }
      const k = findEmClose(s, i + 1);
      if (k === -1) {
        out += '*';
        i++;
        continue;
      }
      out += '<em>' + inline(s.slice(i + 1, k), st) + '</em>';
      i = k + 1;
      continue;
    }
    if (c === '[') {
      const r = tryLink(s, i, st);
      if (r === null) {
        out += '[';
        i++;
        continue;
      }
      out += r.html;
      i = r.next;
      continue;
    }
    out += escChar(c);
    i++;
  }
  return out;
}

function uniqueInPage(base, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  const slug = base + '-' + n;
  taken.add(slug);
  return slug;
}

/**
 * Render one body to HTML. Returns { html, toc, excerpt }: toc holds the
 * level 2 and 3 headings, excerpt the HTML of the body's first paragraph.
 */
function renderBody(body, st) {
  const lines = body.split('\n');
  const n = lines.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlankLine(line)) {
      i++;
      continue;
    }
    const lang = isFenceOpen(line);
    if (lang !== null) {
      let html = '<pre><code' + (lang === '' ? '' : ' class="language-' + lang + '"') + '>';
      i++;
      while (i < n && !FENCE_CLOSE_RE.test(lines[i])) {
        html += esc(lines[i]) + '\n';
        i++;
      }
      if (i < n) i++; // the closing fence
      out.push(html + '</code></pre>\n');
      continue;
    }
    const h = isHeading(line);
    if (h !== null) {
      const inner = inline(h.text, st);
      const id = uniqueInPage(slugOf(h.text, st.slugCache), st.headingTaken);
      if (h.level === 2 || h.level === 3) st.toc.push({ level: h.level, id, html: inner });
      out.push(`<h${h.level} id="${id}">${inner}</h${h.level}>\n`);
      i++;
      continue;
    }
    const fc = line.charCodeAt(0);
    if ((fc === 45 || fc === 42) && HR_RE.test(line)) {
      out.push('<hr>\n');
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      const parts = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let rest = lines[i].slice(1);
        if (rest.charCodeAt(0) === 32 || rest.charCodeAt(0) === 9) rest = rest.slice(1);
        rest = trimWs(rest);
        if (rest !== '') parts.push(rest);
        i++;
      }
      if (parts.length === 0) out.push('<blockquote>\n</blockquote>\n');
      else out.push('<blockquote>\n<p>' + inline(parts.join('\n'), st) + '</p>\n</blockquote>\n');
      continue;
    }
    const ord = fc >= 48 && fc <= 57 ? LIST_ORD_RE.exec(line) : null;
    const bullet = !ord && (line.startsWith('- ') || line.startsWith('* '));
    if (ord !== null || bullet) {
      const ordered = ord !== null;
      const startNum = ordered ? parseInt(ord[1], 10) : 0;
      const items = [];
      let cur;
      if (ordered) cur = trimWs(line.slice(ord[0].length));
      else cur = trimWs(line.slice(2));
      i++;
      while (i < n) {
        const l = lines[i];
        if (isBlankLine(l)) break;
        const lc = l.charCodeAt(0);
        const o2 = lc >= 48 && lc <= 57 ? LIST_ORD_RE.exec(l) : null;
        const b2 = !o2 && (l.startsWith('- ') || l.startsWith('* '));
        if ((ordered && o2 !== null) || (!ordered && b2)) {
          items.push(cur);
          cur = ordered ? trimWs(l.slice(o2[0].length)) : trimWs(l.slice(2));
          i++;
          continue;
        }
        let ws = 0;
        while (ws < l.length && (l.charCodeAt(ws) === 32 || l.charCodeAt(ws) === 9)) ws++;
        if (ws >= 2 && ws < l.length) {
          cur += '\n' + trimWs(l);
          i++;
          continue;
        }
        break;
      }
      items.push(cur);
      const open = ordered && startNum !== 1 ? `<ol start="${startNum}">\n` : ordered ? '<ol>\n' : '<ul>\n';
      let html = open;
      for (let k = 0; k < items.length; k++) html += '<li>' + inline(items[k], st) + '</li>\n';
      html += ordered ? '</ol>\n' : '</ul>\n';
      out.push(html);
      continue;
    }
    // A paragraph: lines up to a blank line, a fence, a heading or a break.
    const parts = [trimWs(line)];
    i++;
    while (i < n) {
      const l = lines[i];
      if (isBlankLine(l)) break;
      if (isFenceOpen(l) !== null) break;
      if (isHeading(l) !== null) break;
      const lc = l.charCodeAt(0);
      if ((lc === 45 || lc === 42) && HR_RE.test(l)) break;
      parts.push(trimWs(l));
      i++;
    }
    const inner = inline(parts.join('\n'), st);
    if (st.excerpt === null) st.excerpt = inner;
    out.push('<p>' + inner + '</p>\n');
  }
  return { html: out.join(''), toc: st.toc, excerpt: st.excerpt === null ? '' : st.excerpt };
}


// ---------------------------------------------------------------- templates

const PATH_SEG_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parsePath(text) {
  const segs = text.split('.');
  for (let i = 0; i < segs.length; i++) {
    if (!PATH_SEG_RE.test(segs[i])) return null;
  }
  return segs;
}

class TemplateError extends Error {}

/**
 * Tokenize a template. A {% %} tag alone on its line (only spaces or tabs
 * beside it) takes the whole line with it, its '\n' included. Text,
 * {{ }} and {{{ }}} never do.
 */
function tokenizeTemplate(src) {
  const tokens = [];
  let pos = 0;
  const n = src.length;
  while (pos < n) {
    const iRaw = src.indexOf('{{{', pos);
    const iVar = src.indexOf('{{', pos);
    const iTag = src.indexOf('{%', pos);
    let next = -1;
    let kind = '';
    if (iRaw !== -1 && (next === -1 || iRaw < next)) {
      next = iRaw;
      kind = 'raw';
    }
    if (iVar !== -1 && (next === -1 || iVar < next)) {
      next = iVar;
      kind = 'var';
    }
    if (iTag !== -1 && (next === -1 || iTag < next)) {
      next = iTag;
      kind = 'tag';
    }
    if (next === -1) {
      if (pos < n) tokens.push({ t: 'text', s: src.slice(pos) });
      break;
    }
    if (kind === 'raw') {
      const close = src.indexOf('}}}', next + 3);
      if (close === -1) throw new TemplateError('a {{{ is not closed');
      const inner = src.slice(next + 3, close).trim();
      const path = parsePath(inner);
      if (path === null) throw new TemplateError(`"${inner}" is not a path`);
      if (next > pos) tokens.push({ t: 'text', s: src.slice(pos, next) });
      tokens.push({ t: 'var', path, raw: true });
      pos = close + 3;
    } else if (kind === 'var') {
      const close = src.indexOf('}}', next + 2);
      if (close === -1) throw new TemplateError('a {{ is not closed');
      const inner = src.slice(next + 2, close).trim();
      const path = parsePath(inner);
      if (path === null) throw new TemplateError(`"${inner}" is not a path`);
      if (next > pos) tokens.push({ t: 'text', s: src.slice(pos, next) });
      tokens.push({ t: 'var', path, raw: false });
      pos = close + 2;
    } else {
      const close = src.indexOf('%}', next + 2);
      if (close === -1) throw new TemplateError('a {% is not closed');
      const chunk = src.slice(pos, next);
      // A {% %} tag takes its whole line only when nothing but spaces or
      // tabs precedes it on that line in the source (earlier tags count).
      const lineStart = src.lastIndexOf('\n', next - 1) + 1;
      const linePrefix = src.slice(lineStart, next);
      let after = close + 2;
      let standalone = false;
      if (/^[ \t]*$/.test(linePrefix)) {
        let k = after;
        while (k < n && src[k] !== '\n' && (src[k] === ' ' || src[k] === '\t')) k++;
        if (k >= n || src[k] === '\n') {
          standalone = true;
          after = k < n ? k + 1 : k;
        }
      }
      if (standalone) {
        const keep = chunk.slice(0, Math.max(0, lineStart - pos));
        if (keep !== '') tokens.push({ t: 'text', s: keep });
      } else if (chunk !== '') {
        tokens.push({ t: 'text', s: chunk });
      }
      tokens.push(parseTag(src.slice(next + 2, close).trim()));
      pos = after;
    }
  }
  return tokens;
}

function parseTag(inner) {
  if (inner === 'else') return { t: 'else' };
  if (inner === 'endif') return { t: 'endif' };
  if (inner === 'endfor') return { t: 'endfor' };
  if (inner === 'if' || inner.startsWith('if ')) {
    const m = /^if\s+(?:(not)\s+)?(.+)$/.exec(inner);
    if (m !== null) {
      const path = parsePath(m[2]);
      if (path !== null) return { t: 'if', path, neg: m[1] === 'not' };
    }
    throw new TemplateError(`{% ${inner} %} is not a tag`);
  }
  if (inner === 'for' || inner.startsWith('for ')) {
    const m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/.exec(inner);
    if (m !== null) {
      const path = parsePath(m[2]);
      if (path !== null) return { t: 'for', name: m[1], path };
    }
    throw new TemplateError(`{% ${inner} %} is not a tag`);
  }
  if (inner === 'include' || inner.startsWith('include ')) {
    const m = /^include\s+"([^"]*)"$/.exec(inner);
    if (m !== null) return { t: 'include', name: m[1] };
    throw new TemplateError(`{% ${inner} %} is not a tag`);
  }
  throw new TemplateError(`{% ${inner} %} is not a tag`);
}

/** Compile a template source into a node tree. Throws TemplateError. */
function compileTemplate(src) {
  const tokens = tokenizeTemplate(src);
  const root = { body: [] };
  const stack = [{ kind: 'root', node: root, body: root.body }];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const top = stack[stack.length - 1];
    if (tok.t === 'text' || tok.t === 'var') {
      top.body.push(tok);
      continue;
    }
    if (tok.t === 'for') {
      const node = { t: 'for', name: tok.name, path: tok.path, body: [] };
      top.body.push(node);
      stack.push({ kind: 'for', node, body: node.body });
      continue;
    }
    if (tok.t === 'if') {
      const node = { t: 'if', path: tok.path, neg: tok.neg, then: [], els: null };
      top.body.push(node);
      stack.push({ kind: 'if', node, body: node.then, inElse: false });
      continue;
    }
    if (tok.t === 'include') {
      top.body.push(tok);
      continue;
    }
    if (tok.t === 'else') {
      if (top.kind !== 'if' || top.inElse) throw new TemplateError('an else outside an if');
      top.node.els = [];
      top.body = top.node.els;
      top.inElse = true;
      continue;
    }
    if (tok.t === 'endif') {
      if (top.kind !== 'if') throw new TemplateError('an endif with no open if');
      stack.pop();
      continue;
    }
    if (tok.t === 'endfor') {
      if (top.kind !== 'for') throw new TemplateError('an endfor with no open for');
      stack.pop();
      continue;
    }
  }
  if (stack.length !== 1) {
    const open = stack[stack.length - 1];
    throw new TemplateError(open.kind === 'for' ? 'a for is not closed' : 'a if is not closed');
  }
  return root.body;
}

function isTruthy(v) {
  if (v === undefined || v === null || v === false) return false;
  if (v === '' || v === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

/** Write a value as a template writes it: string itself, a number in its own digits, true/false, an array joined by ', ', anything else ''. */
function writeValue(v, out) {
  if (typeof v === 'string') {
    out.push(v);
  } else if (typeof v === 'number') {
    out.push(String(v));
  } else if (typeof v === 'boolean') {
    out.push(v ? 'true' : 'false');
  } else if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(', ');
      writeValue(v[i], out);
    }
  }
}

function resolvePath(path, frames, ctx) {
  let v;
  let found = false;
  const first = path[0];
  for (let f = frames.length - 1; f >= 0; f--) {
    const frame = frames[f];
    if (frame.has(first)) {
      v = frame.get(first);
      found = true;
      break;
    }
  }
  if (!found) {
    if (Object.hasOwn(ctx, first)) v = ctx[first];
    else return undefined;
  }
  for (let i = 1; i < path.length; i++) {
    if (v === null || v === undefined) return undefined;
    const name = path[i];
    if (!Object.hasOwn(v, name)) return undefined;
    v = v[name];
  }
  return v;
}

function renderNodes(nodes, frames, ctx, templates, depth, out) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.t === 'text') {
      out.push(node.s);
    } else if (node.t === 'var') {
      const v = resolvePath(node.path, frames, ctx);
      if (v !== undefined) {
        if (node.raw) {
          writeValue(v, out);
        } else if (typeof v === 'string') {
          out.push(esc(v));
        } else if (typeof v === 'number') {
          out.push(String(v));
        } else if (typeof v === 'boolean') {
          out.push(v ? 'true' : 'false');
        } else {
          const tmp = [];
          writeValue(v, tmp);
          out.push(esc(tmp.join('')));
        }
      }
    } else if (node.t === 'for') {
      const v = resolvePath(node.path, frames, ctx);
      if (Array.isArray(v)) {
        const len = v.length;
        for (let k = 0; k < len; k++) {
          const frame = new Map();
          frame.set(node.name, v[k]);
          frame.set('loop', { index: k + 1, first: k === 0, last: k === len - 1, length: len });
          frames.push(frame);
          renderNodes(node.body, frames, ctx, templates, depth, out);
          frames.pop();
        }
      }
    } else if (node.t === 'if') {
      const v = resolvePath(node.path, frames, ctx);
      const ok = isTruthy(v) !== node.neg;
      if (ok) renderNodes(node.then, frames, ctx, templates, depth, out);
      else if (node.els !== null) renderNodes(node.els, frames, ctx, templates, depth, out);
    } else if (node.t === 'include') {
      if (depth < 8) {
        const sub = templates.get(node.name);
        if (sub !== undefined) renderNodes(sub, frames, ctx, templates, depth + 1, out);
      }
    }
  }
}

function renderTemplate(nodes, ctx, templates) {
  const out = [];
  renderNodes(nodes, [], ctx, templates, 0, out);
  return out.join('');
}


// ---------------------------------------------------------------- build

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * makefun-site 1.0.0's answer for one case's input: the output tree as a
 * JSON object of every path it writes and that file's text.
 */
export function run(input) {
  const site = input.site;
  const templatesIn = input.templates || {};
  const filesIn = input.files || [];
  const base = String(site.base_url).replace(/\/+$/, '');
  const slugCache = new Map();
  const report = [];
  const output = {};

  // Templates, parsed in code-unit order of name; one that does not parse
  // is reported and left out, as if it were not there.
  const templates = new Map();
  const names = Object.keys(templatesIn).sort();
  for (let i = 0; i < names.length; i++) {
    try {
      templates.set(names[i], compileTemplate(templatesIn[names[i]]));
    } catch (e) {
      report.push(`template "${names[i]}": ${e.message}`);
    }
  }

  // Sources sorted by path in code-unit order; a .md file is a source, any
  // other file is static.
  const files = filesIn.slice().sort((a, b) => cmpStr(a.path, b.path));
  const statics = new Set();
  const staticFiles = [];
  const pages = [];
  const pagesBySource = new Map();
  const takenByDir = new Map();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f.path.endsWith('.md')) {
      statics.add(f.path);
      staticFiles.push(f);
      continue;
    }
    const content = f.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const fm = parseFrontMatter(content);
    if (fm.error !== undefined) {
      report.push(`refused ${f.path}: ${fm.error}`);
      continue;
    }
    const data = fm.data;
    const isPost = f.path.startsWith('posts/');
    const slash = f.path.lastIndexOf('/');
    const srcDir = slash === -1 ? '' : f.path.slice(0, slash);
    if (srcDir === 'tags' || srcDir === 'page') {
      report.push(`refused ${f.path}: ${srcDir}/ is the generator's own`);
      continue;
    }
    if (isPost && data.date === undefined) {
      report.push(`refused ${f.path}: a post needs a date`);
      continue;
    }
    const layout = data.layout !== undefined ? data.layout : isPost ? 'post' : 'page';
    if (!templates.has(layout)) {
      report.push(`refused ${f.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    if (data.draft === true) {
      report.push(`draft ${f.path}`);
      continue;
    }
    const dir = isPost ? 'posts' : srcDir;
    let taken = takenByDir.get(dir);
    if (taken === undefined) {
      taken = new Set();
      if (dir === '') {
        taken.add('posts');
        taken.add('tags');
        taken.add('page');
      }
      takenByDir.set(dir, taken);
    }
    const baseSlug = data.slug !== undefined ? data.slug : slugOf(data.title, slugCache);
    const slug = uniqueInPage(baseSlug, taken);
    const url = dir === '' ? `${base}/${slug}/` : `${base}/${dir}/${slug}/`;
    const outPath = dir === '' ? `${slug}/index.html` : `${dir}/${slug}/index.html`;
    pages.push({
      source: f.path, isPost, dir, srcDir, slug, url, outPath,
      data, body: fm.body, layout, broken: new Set(),
    });
    pagesBySource.set(f.path, url);
  }

  // Markdown, each source's body rendered to HTML, its links resolved.
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const st = {
      dir: p.srcDir, pagesBySource, statics, base, broken: p.broken,
      slugCache, headingTaken: new Set(), toc: [], excerpt: null,
    };
    const r = renderBody(p.body, st);
    p.content = r.html;
    p.toc = r.toc;
    p.excerpt = r.excerpt;
    p.readingMinutes = readingMinutes(p.body);
  }

  // Collections: the posts, newest date first, equal dates by slug.
  const posts = pages.filter((p) => p.isPost);
  posts.sort((a, b) => cmpStr(b.data.date, a.data.date) || cmpStr(a.slug, b.slug));
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = i > 0 ? posts[i - 1] : null;
    posts[i].older = i < posts.length - 1 ? posts[i + 1] : null;
  }

  // Tags: each slug once, named as first met walking the posts in
  // collection order; ordered by count, most first, then by slug.
  const tagBySlug = new Map();
  const tagList = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const seen = new Set();
    const tags = post.data.tags || [];
    for (let k = 0; k < tags.length; k++) {
      const name = tags[k];
      const slug = slugOf(name, slugCache);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = tagBySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        tagBySlug.set(slug, tag);
        tagList.push(tag);
      }
      tag.posts.push(post);
    }
  }
  tagList.sort((a, b) => b.posts.length - a.posts.length || cmpStr(a.slug, b.slug));

  function pageTags(p) {
    const seen = new Set();
    const out = [];
    const tags = p.data.tags || [];
    for (let k = 0; k < tags.length; k++) {
      const slug = slugOf(tags[k], slugCache);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const tag = tagBySlug.get(slug);
      // A tag is named as it is first met walking the posts in collection
      // order; only a tag no post has keeps the page's own spelling.
      out.push({ name: tag === undefined ? tags[k] : tag.name, slug, url: tag === undefined ? '' : tag.url });
    }
    return out;
  }

  function makeCard(p) {
    const date = p.data.date !== undefined ? p.data.date : '';
    return {
      title: p.data.title,
      url: p.url,
      date,
      date_long: date === '' ? '' : dateLong(date),
      summary: p.data.summary !== undefined ? p.data.summary : '',
      excerpt: p.excerpt,
      reading_minutes: p.readingMinutes,
      tags: pageTags(p),
    };
  }

  const siteCtx = { title: site.title, base_url: base };
  const tagsCtx = tagList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recentCtx = posts.slice(0, site.recent).map((p) => makeCard(p));

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const card = makeCard(p);
    p.card = card;
    const newer = !p.isPost || p.newer === null
      ? null
      : { title: p.newer.data.title, url: p.newer.url, date: p.newer.data.date, date_long: dateLong(p.newer.data.date) };
    const older = !p.isPost || p.older === null
      ? null
      : { title: p.older.data.title, url: p.older.url, date: p.older.data.date, date_long: dateLong(p.older.data.date) };
    p.pageCtx = {
      ...card,
      slug: p.slug,
      content: p.content,
      toc: p.toc,
      newer,
      older,
      is_post: p.isPost,
    };
  }

  // Layouts: every page through its layout, with `page`.
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    output[p.outPath] = renderTemplate(
      templates.get(p.layout),
      { site: siteCtx, tags: tagsCtx, recent: recentCtx, page: p.pageCtx },
      templates,
    );
  }

  // The index through `index`, `site.per_page` posts a page (at least one,
  // even with no posts).
  const indexNodes = templates.get('index');
  if (indexNodes !== undefined) {
    const per = site.per_page > 0 ? site.per_page : posts.length || 1;
    const total = Math.max(1, Math.ceil(posts.length / per));
    for (let k = 1; k <= total; k++) {
      const slice = posts.slice((k - 1) * per, k * per);
      const url = k === 1 ? `${base}/` : `${base}/page/${k}/`;
      const pager = {
        number: k,
        total,
        url,
        newer_url: k > 1 ? (k - 1 === 1 ? `${base}/` : `${base}/page/${k - 1}/`) : '',
        older_url: k < total ? `${base}/page/${k + 1}/` : '',
      };
      const path = k === 1 ? 'index.html' : `page/${k}/index.html`;
      output[path] = renderTemplate(
        indexNodes,
        { site: siteCtx, tags: tagsCtx, recent: recentCtx, posts: slice.map((p) => p.card), pager },
        templates,
      );
    }
  }

  // Each tag through `tag`, and `tags/index.html` through `tags`.
  const tagNodes = templates.get('tag');
  if (tagNodes !== undefined) {
    for (let i = 0; i < tagList.length; i++) {
      const t = tagList[i];
      const tagCtx = {
        name: t.name, slug: t.slug, url: t.url, count: t.posts.length,
        posts: t.posts.map((p) => p.card),
      };
      output[`tags/${t.slug}/index.html`] = renderTemplate(
        tagNodes,
        { site: siteCtx, tags: tagsCtx, recent: recentCtx, tag: tagCtx },
        templates,
      );
    }
  }
  const tagsNodes = templates.get('tags');
  if (tagsNodes !== undefined) {
    output['tags/index.html'] = renderTemplate(
      tagsNodes,
      { site: siteCtx, tags: tagsCtx, recent: recentCtx },
      templates,
    );
  }

  // Static files at their own paths, unless a built page has that path.
  // The built line counts every static file, shadowed or not.
  const staticCount = staticFiles.length;
  for (let i = 0; i < staticFiles.length; i++) {
    const f = staticFiles[i];
    if (Object.hasOwn(output, f.path)) {
      report.push(`shadowed ${f.path}: a built page has its path`);
      continue;
    }
    output[f.path] = f.content;
  }

  // The report: every line reported above and each broken link, sorted in
  // code-unit order, then the built line; every line ends in '\n'.
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    for (const target of p.broken) report.push(`broken-link ${p.source} -> ${target}`);
  }
  report.sort();
  report.push(`built ${pages.length - posts.length} pages, ${posts.length} posts, ${tagList.length} tags and ${staticCount} static files`);
  output['build-report.txt'] = `${report.join('\n')}\n`;
  return output;
}
