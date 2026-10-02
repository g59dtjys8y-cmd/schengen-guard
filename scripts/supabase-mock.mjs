// In-memory stand-in for the Supabase client, shared by every browser test that boots
// Schengen Guard Anywhere. It's *stateful* and table-aware: writes land in per-table
// arrays and the next read sees them (a canned-response mock makes every write vanish on
// the following re-read, which looks exactly like an app bug but isn't one).
//
// Supports the query shapes the app uses: select().order(), insert(rows), update().eq(),
// update().in(), delete().eq(), delete().in(). Deleting a traveller cascades to their
// trips, matching `trips.traveller_id ... on delete cascade`.
//
// Usage: page.addInitScript(supabaseMockScript(), { tables: { trips: [...] }, user })

export function supabaseMockScript() {
  return ({ tables, user }) => {
    const me = user || { id: 'test-user', email: 'test@test.local' };
    const store = { trips: [], travellers: [] };
    for (const [name, rows] of Object.entries(tables || {})) {
      store[name] = rows.map((r) => ({ user_id: me.id, ...r }));
    }
    let seq = 1;
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `mock-${seq++}`);
    const clone = (v) => JSON.parse(JSON.stringify(v));

    function query(table) {
      let op = 'select';
      let payload = null;
      let orderCol = null;
      const filters = [];
      const rows = () => (store[table] = store[table] || []);
      const matches = (r) => filters.every((f) => f(r));
      function run() {
        if (op === 'insert') {
          const inserted = payload.map((r) => ({
            id: r.id || uuid(), user_id: me.id,
            created_at: new Date(Date.now() + seq++).toISOString(), ...r
          }));
          rows().push(...inserted);
          return { data: clone(inserted), error: null };
        }
        if (op === 'update') {
          for (const r of rows()) if (matches(r)) Object.assign(r, clone(payload));
          return { data: null, error: null };
        }
        if (op === 'delete') {
          const removed = rows().filter(matches);
          store[table] = rows().filter((r) => !matches(r));
          if (table === 'travellers') {
            const gone = new Set(removed.map((r) => r.id));
            store.trips = store.trips.filter((t) => !gone.has(t.traveller_id));
          }
          return { data: null, error: null };
        }
        let out = rows().filter(matches);
        if (orderCol) {
          out = out.slice().sort((a, b) => (String(a[orderCol]) < String(b[orderCol]) ? -1 : String(a[orderCol]) > String(b[orderCol]) ? 1 : 0));
        }
        return { data: clone(out), error: null };
      }
      const q = {
        select() { return q; },
        order(col) { orderCol = col; return q; },
        insert(r) { op = 'insert'; payload = Array.isArray(r) ? r : [r]; return q; },
        update(fields) { op = 'update'; payload = fields; return q; },
        delete() { op = 'delete'; return q; },
        eq(col, val) { filters.push((r) => r[col] === val); return q; },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return q; },
        then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); }
      };
      return q;
    }

    window.__mockDb = store;
    // Defined non-writable: a real CDN-loaded supabase-js UMD bundle assigning
    // `global.supabase = factory()` later (e.g. if route interception loses a
    // race on a real network) silently no-ops instead of clobbering the mock.
    Object.defineProperty(window, 'supabase', {
      value: {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: { user: me } } }),
            signOut: async () => ({ error: null })
          },
          from: (table) => query(table)
        })
      },
      writable: false,
      configurable: false
    });
  };
}
