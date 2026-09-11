// Package-internal type guards. Not exported via index.ts — putting them on the public surface
// would make them subject to the public-surface rule (never export the same name twice),
// yet these are not judgment logic, merely tools for narrowing unknown.
//
// The same body had been copied into four modules; it was gathered into one place. If the narrowing rules
// differed per module, “how far to trust the payload” would differ per module.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
