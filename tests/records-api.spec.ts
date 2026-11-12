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
