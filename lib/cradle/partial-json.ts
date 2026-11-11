/**
 * Reads a JSON object while the model is still writing it (B21): which
 * top-level fields are finished, their values, and the string being written
 * now. The app agent starts the catalog search the moment the fields it needs
 * are finished, and the screen shows the headline as it is written.
 *
 * A field counts as finished only once the next field or the closing brace
 * has begun: "12" could still become "120". The model may write fields in
 * any order; callers wait for the set they need, not a position.
 */
export type Scan = {
  values: Record<string, unknown>;
  complete: Set<string>;
  /** The string value being written when the text ends, so far (escapes decoded). */
  open: { key: string; value: string } | null;
  /** The closing brace has been written. */
  closed: boolean;
};

const WS = /\s/;

export function scanObject(text: string): Scan {
  const out: Scan = { values: {}, complete: new Set(), open: null, closed: false };
  let i = skipWs(text, 0);
  if (text[i] !== "{") return out;
  i++;
  let pending: string | null = null; // a field whose value ended but that isn't confirmed finished yet
  for (;;) {
    i = skipWs(text, i);
    if (i >= text.length) return out;
    const c = text[i];
    if (c === "}" || c === ",") {
      if (pending != null) out.complete.add(pending);
      pending = null;
      if (c === "}") {
        out.closed = true;
        return out;
      }
      i++;
      continue;
    }
    if (c !== '"') return out; // not JSON we understand: report what we have
    const keyEnd = stringEnd(text, i);
    if (keyEnd < 0) return out;
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = skipWs(text, keyEnd);
    if (text[i] !== ":") return out;
    i = skipWs(text, i + 1);
    if (i >= text.length) return out;
    const end = valueEnd(text, i);
    if (end < 0) {
      if (text[i] === '"') out.open = { key, value: partialString(text.slice(i + 1)) };
      return out;
    }
    try {
      out.values[key] = JSON.parse(text.slice(i, end));
    } catch {
      return out;
    }
    pending = key;
    i = end;
  }
}

function skipWs(s: string, i: number) {
  while (i < s.length && WS.test(s[i]!)) i++;
  return i;
}

/** Index just past the closing quote of the string starting at i, or -1 if it isn't closed yet. */
function stringEnd(s: string, i: number) {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === '"') return j + 1;
  }
  return -1;
}

/** Index just past the value starting at i, or -1 if it may not be finished. */
function valueEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"') return stringEnd(s, i);
  if (c === "{" || c === "[") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const d = s[j];
      if (d === '"') {
        j = stringEnd(s, j) - 1;
        if (j < 0) return -1;
      } else if (d === "{" || d === "[") depth++;
      else if (d === "}" || d === "]") {
        if (--depth === 0) return j + 1;
      }
    }
    return -1;
  }
  // A number or literal ends at a delimiter; at the end of the text it may still be growing.
  let j = i;
  while (j < s.length && /[-+.\w]/.test(s[j]!)) j++;
  return j < s.length ? j : -1;
}

/** The decoded text of a string still being written; an escape cut in half is left out. */
function partialString(body: string): string {
  const b = trimEscape(body);
  try {
    return JSON.parse(`"${b}"`) as string;
  } catch {
    return b.replace(/\\(.)/g, "$1");
  }
}

/** Drop an escape the text ends in the middle of: a lone "\" or "\u12". */
function trimEscape(b: string): string {
  const u = /\\u[0-9a-fA-F]{0,3}$/.exec(b);
  if (u && escapes(b, u.index)) return b.slice(0, u.index);
  return b.endsWith("\\") && escapes(b, b.length - 1) ? b.slice(0, -1) : b;
}

/** Whether the backslash at k starts an escape (an odd run of backslashes ends there). */
function escapes(b: string, k: number) {
  let n = 0;
  while (k >= 0 && b[k] === "\\") (n++, k--);
  return n % 2 === 1;
}
