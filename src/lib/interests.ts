export const interestOptions = [
  "Music",
  "Gaming",
  "Books",
  "Movies",
  "Anime",
  "Art",
  "Coding",
  "Science",
  "Photography",
  "Travel",
  "Food",
  "Fitness",
  "Outdoors",
  "Study",
  "Philosophy",
  "Pets",
] as const;
export type Interest = string;
export const maxInterests = 5;
export const maxTagLength = 30;
export function normalizeInterest(value: unknown): Interest | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (
    tag.length < 2 ||
    tag.length > maxTagLength ||
    !/^[a-z0-9][a-z0-9 -]*[a-z0-9]$/.test(tag)
  )
    return null;
  return interestOptions.find((option) => option.toLowerCase() === tag) || tag;
}
export function normalizeInterests(values: unknown): Interest[] {
  if (!Array.isArray(values)) return [];
  const result: Interest[] = [];
  for (const value of values) {
    const tag = normalizeInterest(value);
    if (tag && !result.includes(tag)) result.push(tag);
    if (result.length === maxInterests) break;
  }
  return result;
}
export function commonInterests(
  a: readonly string[] = [],
  b: readonly string[] = [],
): Interest[] {
  const other = normalizeInterests(b);
  return normalizeInterests(a).filter((tag) => other.includes(tag));
}
