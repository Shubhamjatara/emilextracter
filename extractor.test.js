import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContacts, toCsv } from './extractor.js';
import { createServer } from './server.js';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContactStore, readContacts } from './contact-store.js';

const contactRow = (name, company, emails) => `<div role="row"><div role="cell" data-id="contact.name"><a>${name}</a></div><div role="cell" data-id="contact.account"><a><img alt="logo"></a><a>${company}</a></div><div role="cell" data-id="contact.emails">${emails}</div></div>`;

test('Apollo extraction keeps records paired and handles duplicates, entities, and missing emails', () => {
  const result = extractContacts(contactRow('Jane &amp; Jo', 'A &amp; B', '<span>Jane@example.com</span>') + contactRow('Second', 'Elsewhere', '<a href="mailto:other%40example.com?subject=hello">Email</a> jane@example.com') + contactRow('Hidden', 'C', 'Access email'));
  assert.deepEqual(result.contacts, [
    { name: 'Jane & Jo', email: 'jane@example.com', company: 'A & B' },
    { name: 'Second', email: 'other@example.com', company: 'Elsewhere' }
  ]);
  assert.equal(result.stats.rowsWithoutEmail, 1);
  assert.equal(result.stats.duplicatesRemoved, 1);
});

test('standard tables identify columns by heading, not position', () => {
  const result = extractContacts('<table><tr><th>Company Name</th><th>Email address</th><th>Full name</th></tr><tr><td>Example, Inc.</td><td>a@example.com b@example.com</td><td>Jane</td></tr></table>');
  assert.equal(result.contacts.length, 2);
  assert.deepEqual(result.contacts[1], { name: 'Jane', email: 'b@example.com', company: 'Example, Inc.' });
});

test('fallback extracts mailto and visible addresses without inventing names or reading scripts', () => {
  const result = extractContacts('<script>"fake@example.com"</script><p>real&#64;example.com</p><a href="mailto:hello%40example.org?body=ignore@example.net">Write</a>');
  assert.deepEqual(result.contacts.map(c => c.email), ['real@example.com', 'hello@example.org']);
  assert.ok(result.contacts.every(c => !c.name && !c.company));
});

test('CSV escapes quotes and commas, preserves Unicode, and neutralizes formulas', () => {
  assert.equal(toCsv([{ name: '=HYPERLINK("x")', email: 'a@example.com', company: 'Café, Inc.' }]), '\uFEFFName,Email,Company Name\r\n"\'=HYPERLINK(""x"")","a@example.com","Café, Inc."\r\n');
});

test('local HTTP flow appends to coldEmailing without downloads and validates input', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contact-extractor-test-'));
  const server = createServer({ directory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /id="download"|Download CSV/);
  const send = body => fetch(`${base}/api/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send({ html: '' })).status, 400);
  assert.equal((await send(null)).status, 400);
  const response = await send({ html: contactRow('Jane', 'Example', 'jane@example.com') });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.contacts[0].name, 'Jane');
  assert.equal(result.stats.added, 1);
  const second = await (await send({ html: contactRow('Jane', 'Example', 'jane@example.com') + contactRow('Jo', 'Second', 'jo@example.com') })).json();
  assert.equal('downloadUrl' in result, false);
  assert.equal('downloadUrl' in second, false);
  assert.equal(second.stats.added, 1);
  assert.equal(second.stats.alreadySaved, 1);
  assert.equal(second.contacts.length, 2);
  const saved = await (await fetch(`${base}/api/contacts`)).json();
  assert.equal(saved.contacts.length, 2);
  assert.deepEqual(await readdir(directory), ['coldEmailing']);
  assert.match(await readFile(path.join(directory, 'coldEmailing'), 'utf8'), /"Jane","jane@example.com","Example"/);
  assert.equal((await fetch(`${base}/exports/contacts.csv`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});

test('CSV append preserves existing bytes, handles concurrent batches, and deduplicates after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contact-store-test-'));
  const first = { name: 'Jo "JJ", Smith', email: 'jo@example.com', company: 'Café, Inc.' };
  const second = { name: 'Other', email: 'other@example.com', company: 'Elsewhere' };
  const store = createContactStore(directory);
  await store.append([first]);
  const initial = await readFile(path.join(directory, 'coldEmailing'), 'utf8');
  const results = await Promise.all([store.append([first, second]), store.append([second])]);
  assert.equal(results.reduce((n, r) => n + r.added, 0), 1);
  const csv = await readFile(path.join(directory, 'coldEmailing'), 'utf8');
  assert.ok(csv.startsWith(initial));
  assert.deepEqual(readContacts(csv), [first, second]);
  const restarted = createContactStore(directory);
  assert.equal((await restarted.append([first, second])).added, 0);
  assert.equal(await readFile(path.join(directory, 'coldEmailing'), 'utf8'), csv);
});

test('coldEmailing carries over the previous saved file once and preserves its backup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contact-migration-test-'));
  const first = { name: 'Jane', email: 'jane@example.com', company: 'Example' };
  const original = toCsv([first]);
  await writeFile(path.join(directory, 'contacts.csv'), original);
  const store = createContactStore(directory);
  assert.deepEqual(await store.list(), [first]);
  assert.equal(await readFile(path.join(directory, 'coldEmailing'), 'utf8'), original);
  const second = { name: 'Jo', email: 'jo@example.com', company: 'Second' };
  await store.append([first, second]);
  assert.deepEqual(await createContactStore(directory).list(), [first, second]);
  assert.equal(await readFile(path.join(directory, 'contacts.csv'), 'utf8'), original);
});

test('an empty collection creates coldEmailing with its column headings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contact-empty-test-'));
  assert.deepEqual(await createContactStore(directory).list(), []);
  assert.equal(await readFile(path.join(directory, 'coldEmailing'), 'utf8'), toCsv([]));
});
