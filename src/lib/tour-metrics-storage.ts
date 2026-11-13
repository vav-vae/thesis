/**
 * Generation results are JSON and can include matrices (for example the
 * per-photo BGR exposure gains). Firestore rejects arrays directly inside
 * arrays. Store each nested row as { values: [...] }, retaining order and
 * every value, while leaving ordinary arrays and report fields unchanged.
 * Apply only to metrics, before adding Firestore timestamp transforms.
 */
export function tourMetricsForStorage(metrics: unknown): unknown {
  function encode(value: unknown, arrayElement = false): unknown {
    if (Array.isArray(value)) {
      const values = value.map((item) => encode(item, true));
      return arrayElement ? { values } : values;
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    }
    return value;
  }
  return encode(metrics);
}
