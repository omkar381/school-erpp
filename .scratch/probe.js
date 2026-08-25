// Probes real API responses so pages are built against the actual contract.
const BASE = 'http://localhost:4000/api/v1';

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin@greenfield.edu', password: 'Admin@123' }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('login failed: ' + j.message);
  return j.data.tokens.accessToken;
}

async function main() {
  const token = await login();
  const paths = process.argv.slice(2);
  for (const path of paths) {
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => null);
    console.log(`\n--- ${path}  [${r.status}] ---`);
    if (!j) { console.log('(no json)'); continue; }
    if (!j.success) { console.log('ERROR:', j.message, j.code); continue; }
    const d = j.data;
    const sample = Array.isArray(d) ? d[0] : d?.items ? d.items[0] : d;
    if (d?.meta) console.log('meta:', JSON.stringify(d.meta));
    if (d && !Array.isArray(d) && !d.items) console.log('keys:', Object.keys(d).join(', '));
    console.log(JSON.stringify(sample, null, 1)?.slice(0, Number(process.env.LEN || 900)));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
