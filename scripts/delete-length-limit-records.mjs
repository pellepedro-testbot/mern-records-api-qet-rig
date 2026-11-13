// Deletes the records the length-limit tests in tests/records-api.spec.ts make
// (names starting with "LengthLimit"), for a run that stopped before its own
// cleanup. Exits 0 when there is nothing to delete.
const baseURL = process.env.API_BASE_URL ?? 'http://127.0.0.1:5050';

const response = await fetch(`${baseURL}/record`);
if (!response.ok) throw new Error(`GET /record answered ${response.status}`);
const records = await response.json();
for (const record of records) {
  if (typeof record.name === 'string' && record.name.startsWith('LengthLimit')) {
    const removal = await fetch(`${baseURL}/record/${record._id}`, { method: 'DELETE' });
    if (!removal.ok) throw new Error(`DELETE /record/${record._id} answered ${removal.status}`);
  }
}
