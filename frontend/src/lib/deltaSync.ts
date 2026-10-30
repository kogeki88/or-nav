/**
 * Computes a minimal JSON patch (delta) between two records.
 * Compares the base (e.g., remote state) and modified (e.g., local state) objects.
 * Returns an object containing only the keys that have changed, been added, or deleted.
 * Deletions are typically represented with `undefined` or `null` in the patch depending on the requirement,
 * here we use `null` to represent a removed field for better JSON compatibility.
 */
export function diffRecords<T extends Record<string, unknown>>(base: T, modified: T): Partial<T> {
  if (!base || !modified || typeof base !== 'object' || typeof modified !== 'object') {
    return {};
  }

  const delta: Partial<T> = {};

  const baseKeys = Object.keys(base);
  const modKeys = Object.keys(modified);
  const allKeys = new Set([...baseKeys, ...modKeys]);

  for (const key of allKeys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    const baseVal = base[key];
    const modVal = modified[key];

    if (!(key in modified)) {
      // Key was deleted
      // We use null to indicate deletion for JSON serialization compatibility
      (delta as Record<string, unknown>)[key] = null;
      continue;
    }

    if (!(key in base)) {
      // Key was added
      delta[key as keyof T] = modVal as T[keyof T];
      continue;
    }

    if (baseVal !== modVal) {
      if (typeof baseVal === 'object' && typeof modVal === 'object' && baseVal !== null && modVal !== null) {
        if (JSON.stringify(baseVal) !== JSON.stringify(modVal)) {
          delta[key as keyof T] = modVal as T[keyof T];
        }
      } else {
        delta[key as keyof T] = modVal as T[keyof T];
      }
    }
  }

  return delta;
}
