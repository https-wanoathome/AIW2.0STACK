const PAGE = 1000;

// Page through a Supabase query until it returns < PAGE rows. PostgREST
// caps responses at 1000 rows server-side; .range() pages past the cap.
export async function pagedFetch<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Safety stop at 100k rows so a misconfigured query can't melt the page.
  for (let i = 0; i < 100; i++) {
    const { data } = await build(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
