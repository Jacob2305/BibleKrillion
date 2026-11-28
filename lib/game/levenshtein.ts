/**
 * Levenshtein edit distance (insert / delete / substitute, each cost 1).
 *
 * With `max`, stops early and returns `max + 1` as soon as the distance is known
 * to exceed `max`, which keeps matching cheap when ~100 players submit at once.
 */
export function levenshtein(a: string, b: string, max: number = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  // Work on code points so an emoji or astral character counts as one edit.
  const s = Array.from(a);
  const t = Array.from(b);
  if (Math.abs(s.length - t.length) > max) return max + 1;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let prev = new Array<number>(t.length + 1);
  let curr = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  const result = prev[t.length]!;
  return result > max ? max + 1 : result;
}

/**
 * Like `levenshtein`, but swapping two neighbouring letters ("Jonha" -> "Jonah")
 * costs 1 edit instead of 2 (optimal string alignment distance). Same `max` early exit.
 */
export function typoDistance(a: string, b: string, max: number = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  const s = Array.from(a);
  const t = Array.from(b);
  if (Math.abs(s.length - t.length) > max) return max + 1;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let prev2 = new Array<number>(t.length + 1).fill(0);
  let prev = new Array<number>(t.length + 1);
  let curr = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;

  let prevMin = 0;
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) value = Math.min(value, prev2[j - 2]! + 1);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    // A swap reaches back two rows, so stop only once two rows in a row are over budget.
    if (rowMin > max && prevMin > max) return max + 1;
    prevMin = rowMin;
    [prev2, prev, curr] = [prev, curr, prev2];
  }
  const result = prev[t.length]!;
  return result > max ? max + 1 : result;
}
