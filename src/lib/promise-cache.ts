// Share in-flight work as well as successful results. A failed operation can
// be retried; it must not poison the rest of a capture session.
export function cachedPromise<Key, Value>(cache: Map<Key, Promise<Value>>, key: Key, create: () => Promise<Value>): Promise<Value> {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = create().catch((error: unknown) => {
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

export async function mapWithConcurrency<Item, Result>(items: readonly Item[], concurrency: number, map: (item: Item, index: number) => Promise<Result>): Promise<Result[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer.");
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!stopped) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await map(items[index], index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }));
  return results;
}
