import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // A missed mock is a test failure, never an accidental live PayPal/Supabase request.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unmocked fetch: live network is disabled in money tests'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
