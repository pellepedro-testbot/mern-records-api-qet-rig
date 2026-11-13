import { expect, test, type APIRequestContext } from '@playwright/test';

// Each test creates its own record, so the tests share no data and can run
// against a database other runs have used.
function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createRecord(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/record', { data: { name, position: 'Engineer', level: 'Junior' } });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.insertedId).toBeTruthy();
  return body.insertedId;
}

test('a created record can be read back', async ({ request }) => {
  const name = uniqueName('Created');
  const id = await createRecord(request, name);
  const response = await request.get(`/record/${id}`);
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ _id: id, name, position: 'Engineer', level: 'Junior' });
});

test('a record without a name is rejected', async ({ request }) => {
  const response = await request.post('/record', { data: { name: ' ', position: 'Engineer', level: 'Junior' } });
  expect(response.status()).toBe(400);
  expect((await response.json()).errors).toContain('Name is required.');
});

test('an updated record shows the new position', async ({ request }) => {
  const name = uniqueName('Updated');
  const id = await createRecord(request, name);
  const update = await request.patch(`/record/${id}`, { data: { name, position: 'Staff Engineer', level: 'Senior' } });
  expect(update.ok()).toBeTruthy();
  const records = await (await request.get('/record')).json();
  expect(records.find((r: { _id: string }) => r._id === id)).toMatchObject({ position: 'Staff Engineer', level: 'Senior' });
});

test('a deleted record leaves the list', async ({ request }) => {
  const id = await createRecord(request, uniqueName('Deleted'));
  const removal = await request.delete(`/record/${id}`);
  expect((await removal.json()).deletedCount).toBe(1);
  const records = await (await request.get('/record')).json();
  expect(records.some((r: { _id: string }) => r._id === id)).toBe(false);
});

// Records made by the length-limit tests start with this prefix, so a run that
// stops early can be cleaned up with scripts/delete-length-limit-records.mjs.
const LENGTH_PREFIX = 'LengthLimit';

// A name unique to this run, padded with 'a' to exactly `length` characters.
function uniqueNameOfLength(length: number): string {
  return uniqueName(LENGTH_PREFIX).replace(/ /g, '-').padEnd(length, 'a');
}

async function namesInList(request: APIRequestContext): Promise<string[]> {
  const response = await request.get('/record');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).map((r: { name: string }) => r.name);
}

test.describe('name and position length limit', () => {
  const created: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of created.splice(0)) await request.delete(`/record/${id}`);
  });

  test('a new record with a name over 80 characters is refused and not stored', async ({ request }) => {
    const name = uniqueNameOfLength(81);
    const response = await request.post('/record', { data: { name, position: 'Engineer', level: 'Junior' } });
    expect(response.status()).toBe(400);
    expect((await response.json()).errors).toEqual(['Name must be at most 80 characters.']);
    expect(await namesInList(request)).not.toContain(name);
  });

  test('a new record with a position over 80 characters is refused and not stored', async ({ request }) => {
    const name = uniqueNameOfLength(40);
    const response = await request.post('/record', { data: { name, position: 'a'.repeat(81), level: 'Junior' } });
    expect(response.status()).toBe(400);
    expect((await response.json()).errors).toEqual(['Position must be at most 80 characters.']);
    expect(await namesInList(request)).not.toContain(name);
  });

  test('an update to a name over 80 characters is refused and the record keeps its name', async ({ request }) => {
    const name = uniqueNameOfLength(40);
    const id = await createRecord(request, name);
    created.push(id);
    const update = await request.patch(`/record/${id}`, {
      data: { name: uniqueNameOfLength(81), position: 'Engineer', level: 'Junior' },
    });
    expect(update.status()).toBe(400);
    expect((await update.json()).errors).toEqual(['Name must be at most 80 characters.']);
    const response = await request.get(`/record/${id}`);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).name).toBe(name);
  });

  test('a new record with a name of exactly 80 characters is stored', async ({ request }) => {
    const name = uniqueNameOfLength(80);
    expect(name).toHaveLength(80);
    const id = await createRecord(request, name);
    created.push(id);
    const response = await request.get(`/record/${id}`);
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toMatchObject({ _id: id, name, position: 'Engineer', level: 'Junior' });
  });
});
