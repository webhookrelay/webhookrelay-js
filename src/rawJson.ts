/**
 * Lossless access to members of a JSON object. `JSON.parse` turns every
 * number into a float64, so a filter such as `{"id": 9007199254740993}`
 * comes back as `9007199254740992`; sending a parsed value back would change
 * it. These helpers work on the text instead, so a value can be sent back
 * byte for byte.
 */

/**
 * The exact JSON text of the top-level member `key` of the object in `json`,
 * or `undefined` when `json` is not an object or has no such member. A
 * duplicated key resolves to its last occurrence, as `JSON.parse` does.
 */
export function rawJsonMember(json: string, key: string): string | undefined {
  try {
    let i = skipSpace(json, 0);
    if (json[i] !== "{") return undefined;
    i = skipSpace(json, i + 1);
    let found: string | undefined;
    if (json[i] === "}") return undefined;
    for (;;) {
      if (json[i] !== '"') return undefined;
      const keyEnd = skipString(json, i);
      const name = JSON.parse(json.slice(i, keyEnd)) as string;
      i = skipSpace(json, keyEnd);
      if (json[i] !== ":") return undefined;
      const valueStart = skipSpace(json, i + 1);
      const valueEnd = skipValue(json, valueStart);
      if (name === key) found = json.slice(valueStart, valueEnd);
      i = skipSpace(json, valueEnd);
      if (json[i] === "}") return found;
      if (json[i] !== ",") return undefined;
      i = skipSpace(json, i + 1);
    }
  } catch {
    return undefined;
  }
}

/**
 * `JSON.stringify(object)` with `rawMembers` appended verbatim, each value
 * being JSON text (e.g. from {@link rawJsonMember}). Keys in `rawMembers`
 * must not also be in `object`.
 */
export function stringifyWithRawMembers(object: object, rawMembers: Record<string, string>): string {
  let json = JSON.stringify(object);
  for (const [key, raw] of Object.entries(rawMembers)) {
    const member = `${JSON.stringify(key)}:${raw}`;
    json = json === "{}" ? `{${member}}` : `${json.slice(0, -1)},${member}}`;
  }
  return json;
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) i++;
  return i;
}

// Index just past the string literal that opens at `i`.
function skipString(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === '"') return j + 1;
  }
  throw new SyntaxError("unterminated string");
}

// Index just past the JSON value that starts at `i`.
function skipValue(s: string, i: number): number {
  const c = s[i];
  if (c === '"') return skipString(s, i);
  if (c === "{" || c === "[") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const d = s[j];
      if (d === '"') j = skipString(s, j) - 1;
      else if (d === "{" || d === "[") depth++;
      else if (d === "}" || d === "]") {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    throw new SyntaxError("unterminated value");
  }
  // A number or literal runs to the next delimiter.
  let j = i;
  while (j < s.length && !",}] \t\n\r".includes(s[j]!)) j++;
  if (j === i) throw new SyntaxError("missing value");
  return j;
}
