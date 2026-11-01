/**
 * Strict readers for the daemon's serde JSON (FSPEC-068): a field is present
 * with its type, an Option is null or its type, an enum is one of its serde
 * names. Anything else throws `<where>.<field> is not <type>`; nothing is
 * defaulted.
 */
export type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(where: string, key: string, what: string): never {
  throw new Error(`${where}.${key} is not ${what}`);
}

export function asObject(value: unknown, what: string): Json {
  if (!isObject(value)) throw new Error(`${what} is not an object`);
  return value;
}

export function string(o: Json, key: string, where: string): string {
  const value = o[key];
  return typeof value === "string" ? value : fail(where, key, "a string");
}

export function nullableString(o: Json, key: string, where: string): string | null {
  const value = o[key];
  return value === null || typeof value === "string" ? value : fail(where, key, "a string or null");
}

export function number(o: Json, key: string, where: string): number {
  const value = o[key];
  return typeof value === "number" ? value : fail(where, key, "a number");
}

export function nullableNumber(o: Json, key: string, where: string): number | null {
  const value = o[key];
  return value === null || typeof value === "number" ? value : fail(where, key, "a number or null");
}

export function boolean(o: Json, key: string, where: string): boolean {
  const value = o[key];
  return typeof value === "boolean" ? value : fail(where, key, "a boolean");
}

export function strings(o: Json, key: string, where: string): string[] {
  const value = o[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? (value as string[])
    : fail(where, key, "a list of strings");
}

export function nullableStrings(o: Json, key: string, where: string): string[] | null {
  return o[key] === null ? null : Array.isArray(o[key]) ? strings(o, key, where) : fail(where, key, "a list of strings or null");
}

export function list(o: Json, key: string, where: string): unknown[] {
  const value = o[key];
  return Array.isArray(value) ? value : fail(where, key, "a list");
}

export function nullableList(o: Json, key: string, where: string): unknown[] | null {
  const value = o[key];
  return value === null ? null : Array.isArray(value) ? value : fail(where, key, "a list or null");
}

export function object(o: Json, key: string, where: string): Json {
  const value = o[key];
  return isObject(value) ? value : fail(where, key, "an object");
}

export function nullableObject(o: Json, key: string, where: string): Json | null {
  const value = o[key];
  return value === null ? null : isObject(value) ? value : fail(where, key, "an object or null");
}

export function oneOf<T extends string>(o: Json, key: string, where: string, names: readonly T[]): T {
  const value = o[key];
  return typeof value === "string" && (names as readonly string[]).includes(value)
    ? (value as T)
    : fail(where, key, `one of ${names.join(", ")}`);
}
