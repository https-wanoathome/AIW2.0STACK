const PAGE = 1000;

/**
 * Fetch every row of an unbounded query in 1000-row pages. The builder
 * receives the inclusive range bounds for each page. Hard-capped at
 * 100 pages as a runaway guard.
 */
export async function pagedFetch<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (let i = 0; i < 100; i++) {
    const { data } = await build(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
