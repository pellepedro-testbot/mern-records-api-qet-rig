// Removes the records tests/records-top-api.spec.ts creates (names starting
// with "TopAPI " or "Legacy TopAPI "), for a run that stopped before its own
// cleanup. Exits 0 when there is nothing to remove.
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:5050';
const records = await (await fetch(`${base}/record`)).json();
for (const record of records) {
  if (/^(Legacy )?TopAPI /.test(String(record.name))) {
    await fetch(`${base}/record/${record._id}`, { method: 'DELETE' });
  }
}
