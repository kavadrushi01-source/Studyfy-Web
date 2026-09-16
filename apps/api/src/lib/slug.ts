// Collision-safe school slug (spec §9.1: two "St. Mary's School"s must not
// silently fail or overwrite — append a suffix, let the admin edit it).

export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "school";
}

export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) {
    return base;
  }
  let counter = 2;
  for (;;) {
    const candidate = `${base}-${counter}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
    counter += 1;
  }
}
