export interface CompressedPayload {
  keys: string[];
  data: unknown[][];
}

export function compressPayload<T extends Record<string, unknown>>(mutations: T[]): CompressedPayload {
  if (!mutations || mutations.length === 0) return { keys: [], data: [] };

  const keySet = new Set<string>();
  for (const m of mutations) {
    for (const k of Object.keys(m)) {
      keySet.add(k);
    }
  }
  const keys = Array.from(keySet);

  const data = mutations.map(m => keys.map(k => (m[k] !== undefined ? m[k] : null)));
  return { keys, data };
}

export function decompressPayload<T extends Record<string, unknown>>(compressed: CompressedPayload): T[] {
  if (!compressed || !compressed.keys || !compressed.data) return [];
  return compressed.data.map(row => {
    const obj: Record<string, unknown> = {};
    compressed.keys.forEach((k, i) => {
      if (row[i] !== null) {
        obj[k] = row[i];
      }
    });
    return obj as T;
  });
}
