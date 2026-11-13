import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext } from '@playwright/test';

// GET /record/top returns the three newest employees of each level. The tests
// here read which records are the newest, so run this file with --workers=1:
// every record a test creates is then newer than anything already stored.

const LEVELS = ['Senior', 'Junior', 'Intern'] as const;
type Level = (typeof LEVELS)[number];
type TopRecord = { _id: string; name: string; position: string; level: string };
type Top = Partial<Record<Level, TopRecord[]>>;

// Every name starts with this prefix, so scripts/cleanup-top-records.mjs can
// find what a stopped run left behind.
function uniqueName(label: string): string {
  return `TopAPI ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

let created: string[] = [];

async function createRecord(request: APIRequestContext, name: string, level: string): Promise<string> {
  const response = await request.post('/record', { data: { name, position: 'Engineer', level } });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.insertedId).toBeTruthy();
  created.push(body.insertedId);
  return body.insertedId;
}

// Creates `count` employees of each level one at a time and returns their ids
// per level, in creation order.
async function createPerLevel(request: APIRequestContext, count: number): Promise<Record<Level, string[]>> {
  const ids = { Senior: [], Junior: [], Intern: [] } as Record<Level, string[]>;
  for (const level of LEVELS) {
    for (let i = 1; i <= count; i++) {
      ids[level].push(await createRecord(request, uniqueName(`${level} ${i}`), level));
    }
  }
  return ids;
}

async function getTop(request: APIRequestContext): Promise<Top> {
  const response = await request.get('/record/top');
  expect(response.status()).toBe(200);
  return response.json();
}

function idsOf(records: TopRecord[] | undefined): string[] {
  return (records ?? []).map((r) => r._id);
}

// Stores a record the way the API did before it validated levels.
function insertLegacyRecord(name: string, level: string): void {
  const doc = JSON.stringify({ name, position: 'Engineer', level });
  execFileSync('docker', ['exec', 'mern-records-mongo', 'mongosh', 'employees', '--quiet', '--eval', `db.records.insertOne(${doc})`]);
}

test.afterEach(async ({ request }) => {
  for (const id of created) {
    await request.delete(`/record/${id}`);
  }
  created = [];
});

test('returns exactly three Senior, Junior and Intern employees when each level has five', async ({ request }) => {
  await createPerLevel(request, 5);
  const top = await getTop(request);
  expect(Object.keys(top).sort()).toEqual(['Intern', 'Junior', 'Senior']);
  for (const level of LEVELS) {
    expect(top[level], level).toHaveLength(3);
    for (const record of top[level]!) {
      expect(record).toEqual(expect.objectContaining({ _id: expect.any(String), name: expect.any(String), position: 'Engineer', level }));
    }
  }
});

test('lists the newest employees of each level, newest first', async ({ request }) => {
  const ids = await createPerLevel(request, 5);
  const top = await getTop(request);
  for (const level of LEVELS) {
    const [first, second, third, fourth, fifth] = ids[level];
    expect(idsOf(top[level]), level).toEqual([fifth, fourth, third]);
    expect(idsOf(top[level])).not.toContain(first);
    expect(idsOf(top[level])).not.toContain(second);
  }
});

test('puts each employee only under their own level', async ({ request }) => {
  await createPerLevel(request, 5);
  const top = await getTop(request);
  const all: string[] = [];
  for (const level of LEVELS) {
    for (const record of top[level] ?? []) {
      expect(record.level, `${record.name} under ${level}`).toBe(level);
      all.push(record._id);
    }
  }
  expect(all).toHaveLength(9);
  expect(new Set(all).size).toBe(9);
});

test('returns every employee of a level with fewer than three and three of a level with more', async ({ request }) => {
  // Start from an empty collection: the API has no bulk delete, so remove
  // every record it lists.
  const existing: TopRecord[] = await (await request.get('/record')).json();
  for (const record of existing) {
    await request.delete(`/record/${record._id}`);
  }
  const seniors = [await createRecord(request, uniqueName('Senior 1'), 'Senior'), await createRecord(request, uniqueName('Senior 2'), 'Senior')];
  const juniors: string[] = [];
  for (let i = 1; i <= 3; i++) juniors.push(await createRecord(request, uniqueName(`Junior ${i}`), 'Junior'));
  const interns: string[] = [];
  for (let i = 1; i <= 4; i++) interns.push(await createRecord(request, uniqueName(`Intern ${i}`), 'Intern'));

  let top = await getTop(request);
  expect(idsOf(top.Senior)).toEqual([seniors[1], seniors[0]]);
  expect(idsOf(top.Junior)).toEqual([juniors[2], juniors[1], juniors[0]]);
  expect(idsOf(top.Intern)).toEqual([interns[3], interns[2], interns[1]]);

  for (const id of seniors) {
    expect((await (await request.delete(`/record/${id}`)).json()).deletedCount).toBe(1);
  }
  top = await getTop(request);
  expect(top.Senior ?? []).toEqual([]);
  expect(idsOf(top.Junior)).toEqual([juniors[2], juniors[1], juniors[0]]);
});

test('lists an employee whose level was changed under the new level only', async ({ request }) => {
  await createPerLevel(request, 3);
  const name = uniqueName('Promoted');
  const id = await createRecord(request, name, 'Junior');
  let top = await getTop(request);
  expect(idsOf(top.Junior)[0]).toBe(id);

  const update = await request.patch(`/record/${id}`, { data: { name, position: 'Engineer', level: 'Senior' } });
  expect(update.ok()).toBeTruthy();
  top = await getTop(request);
  expect(idsOf(top.Senior)[0]).toBe(id);
  expect(top.Senior![0].level).toBe('Senior');
  expect(idsOf(top.Junior)).not.toContain(id);
  expect(idsOf(top.Junior)).toHaveLength(3);
});

test('replaces a deleted employee with the next newest of the level', async ({ request }) => {
  const ids = await createPerLevel(request, 5);
  const newestIntern = ids.Intern[4];
  const removal = await request.delete(`/record/${newestIntern}`);
  expect((await removal.json()).deletedCount).toBe(1);
  const top = await getTop(request);
  expect(idsOf(top.Intern)).not.toContain(newestIntern);
  expect(idsOf(top.Intern)).toEqual([ids.Intern[3], ids.Intern[2], ids.Intern[1]]);
});

// Records saved before level validation may hold a level in another case or
// with spaces around it. The list page shows them as that level, so the
// highlights must count them there too.
for (const storedLevel of ['senior', 'SENIOR', ' Senior ']) {
  test(`counts an employee stored with level ${JSON.stringify(storedLevel)} as the newest Senior`, async ({ request }) => {
    const name = `Legacy ${uniqueName('Senior')}`;
    insertLegacyRecord(name, storedLevel);
    const records: TopRecord[] = await (await request.get('/record')).json();
    const legacy = records.find((r) => r.name === name);
    expect(legacy, 'GET /record lists the stored record').toBeTruthy();
    created.push(legacy!._id);
    expect(legacy!.level).toBe(storedLevel);

    const top = await getTop(request);
    expect((top.Senior ?? []).map((r) => r.name)[0]).toBe(name);
  });
}
