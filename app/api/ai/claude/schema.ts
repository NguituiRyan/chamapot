// Studio advertises tool parameters as JSON Schema 2020-12 (its Shape library's output). Claude's
// non-strict tool use accepts nearly all of it, with one hard rule: `input_schema` must be an object
// schema - a root `anyOf`/`oneOf`/`allOf`, or a non-object root, is a 400. Studio's docs also warn
// that providers trip on its `undefined` sentinel. This transform fixes exactly those cases and
// leaves everything else (descriptions, enums, $defs/$ref, nested unions) untouched, so the
// arguments Claude produces keep the shape Studio validates them against.

type JsonSchema = Record<string, unknown>;

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Shape encodes "may be undefined" (the optional half of `union(T, undefined)`) as `{ not: {} }`.
const isUndefinedSentinel = (value: unknown) =>
  isSchema(value) && Object.keys(value).length === 1 && isSchema(value.not) && Object.keys(value.not).length === 0;

const UNION_KEYS = ['anyOf', 'oneOf'] as const;

/** Remove `{ not: {} }` branches from unions everywhere, collapsing a union left with one branch. */
function stripUndefinedSentinels(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedSentinels);
  if (!isSchema(value)) return value;

  let out: JsonSchema = {};
  for (const [key, child] of Object.entries(value)) out[key] = stripUndefinedSentinels(child);

  for (const key of UNION_KEYS) {
    const branches = out[key];
    if (!Array.isArray(branches)) continue;
    const kept = branches.filter((b) => !isUndefinedSentinel(b));
    if (kept.length === branches.length || kept.length === 0) continue;
    const { [key]: _removed, ...rest } = out;
    void _removed;
    out = kept.length === 1 && isSchema(kept[0]) ? { ...kept[0], ...rest } : { ...rest, [key]: kept };
  }
  return out;
}

const isObjectSchema = (s: JsonSchema) => s.type === 'object' || isSchema(s.properties);

/** Merge a union of object schemas into one loose object: every property, required only if in all. */
function mergeObjectBranches(branches: JsonSchema[], rest: JsonSchema): JsonSchema {
  const properties: JsonSchema = {};
  let required: Set<string> | undefined;
  for (const branch of branches) {
    Object.assign(properties, isSchema(branch.properties) ? branch.properties : {});
    const branchRequired = new Set(Array.isArray(branch.required) ? (branch.required as string[]) : []);
    required = required ? new Set([...required].filter((k) => branchRequired.has(k))) : branchRequired;
  }
  const descriptions = branches.map((b) => b.description).filter((d): d is string => typeof d === 'string');
  return {
    ...rest,
    type: 'object',
    ...(descriptions.length > 0 && !rest.description
      ? { description: `One of: ${descriptions.join(' | ')}` }
      : {}),
    properties,
    ...(required && required.size > 0 ? { required: [...required] } : {}),
  };
}

export interface SanitizeResult {
  schema: JsonSchema;
  /** What was changed, for logging and tests. Empty when the schema passed through untouched. */
  changes: string[];
}

/** Make a Studio tool schema acceptable as a Claude `input_schema`. Never throws. */
export function toClaudeInputSchema(parameters: unknown): SanitizeResult {
  const changes: string[] = [];
  if (!isSchema(parameters)) {
    changes.push('non-object parameters replaced with an empty object schema');
    return { schema: { type: 'object', properties: {} }, changes };
  }

  let schema = stripUndefinedSentinels(parameters) as JsonSchema;
  if (JSON.stringify(schema) !== JSON.stringify(parameters)) changes.push('stripped undefined sentinels');

  // Draft markers are noise to Claude; the API treats the schema as 2020-12 regardless.
  if ('$schema' in schema || '$id' in schema) {
    const { $schema: _s, $id: _i, ...rest } = schema;
    void _s;
    void _i;
    schema = rest;
    changes.push('removed $schema/$id');
  }

  for (const key of [...UNION_KEYS, 'allOf'] as const) {
    const branches = schema[key];
    if (!Array.isArray(branches)) continue;
    const { [key]: _removed, ...rest } = schema;
    void _removed;
    const objects = branches.filter(isSchema);
    if (objects.length === branches.length && objects.every(isObjectSchema)) {
      schema = mergeObjectBranches(objects, rest);
      changes.push(`merged root ${key} of ${objects.length} object branches`);
    } else {
      schema = { ...rest, type: 'object', properties: isSchema(rest.properties) ? rest.properties : {} };
      changes.push(`dropped root ${key} with non-object branches`);
    }
  }

  if (schema.type !== 'object') {
    if (isSchema(schema.properties)) {
      schema = { ...schema, type: 'object' };
      changes.push('added type: object to root');
    } else {
      // A void (`s.undefined()`) or scalar root: the tool takes no arguments Claude can supply.
      const { description } = schema;
      schema = { type: 'object', properties: {}, ...(typeof description === 'string' ? { description } : {}) };
      changes.push('replaced non-object root with an empty object schema');
    }
  }

  return { schema, changes };
}
