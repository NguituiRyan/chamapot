// Minimal in-memory PostgREST test double: evaluates each query atomically, including conditional writes.
export type TestRow = Record<string, any>;
export function fakeDb(tables: Record<string, TestRow[]>) {
  const from = (table: string) => {
    if (!table.startsWith('chama_')) throw new Error(`Forbidden test table ${table}`);
    tables[table] ??= [];
    let operation = 'select';
    let values: TestRow | TestRow[] = {};
    let returning = false;
    let singular = false;
    let optional = false;
    let max = Infinity;
    const filters: ((r: TestRow) => boolean)[] = [];
    const query = {
      select(_columns = '*') { returning = true; return query; },
      insert(input: TestRow | TestRow[]) { operation = 'insert'; values = input; return query; },
      update(input: TestRow) { operation = 'update'; values = input; return query; },
      delete() { operation = 'delete'; return query; },
      eq(key: string, value: unknown) { filters.push(r => r[key] === value); return query; },
      neq(key: string, value: unknown) { filters.push(r => r[key] !== value); return query; },
      is(key: string, value: unknown) { filters.push(r => (r[key] ?? null) === value); return query; },
      in(key: string, values: unknown[]) { filters.push(r => values.includes(r[key])); return query; },
      contains(key: string, value: TestRow) { filters.push(r => Object.entries(value).every(([k, v]) => r[key]?.[k] === v)); return query; },
      order() { return query; },
      limit(n: number) { max = n; return query; },
      single() { singular = true; return query; },
      maybeSingle() { singular = true; optional = true; return query; },
      then(resolve: any, reject: any) {
        return Promise.resolve().then(() => {
          let rows = tables[table].filter(r => filters.every(f => f(r))).slice(0, max);
          if (operation === 'insert') {
            const input = Array.isArray(values) ? values : [values];
            const duplicate = input.some(v => tables[table].some(r => table === 'chama_webhook_events' ? r.id === v.id : table === 'chama_approvals' ? r.payout_id === v.payout_id && r.member_id === v.member_id : table === 'chama_payouts' ? r.cycle_id === v.cycle_id : false));
            if (duplicate) return { data: null, error: { code: '23505', message: 'Unique constraint' } };
            rows = input.map(v => ({ id: `generated-${tables[table].length + 1}`, created_at: new Date().toISOString(), sent_at: null, ...v }));
            tables[table].push(...rows);
          } else if (operation === 'update') rows.forEach(r => Object.assign(r, values));
          else if (operation === 'delete') tables[table] = tables[table].filter(r => !rows.includes(r));
          if (singular && rows.length !== 1 && !(optional && !rows.length)) return { data: null, error: { code: 'PGRST116', message: 'Expected one row' } };
          return { data: returning ? structuredClone(singular ? rows[0] ?? null : rows) : null, error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  };
  return { from };
}
