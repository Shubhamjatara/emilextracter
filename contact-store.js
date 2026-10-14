import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { toCsv } from './extractor.js';

// Read quoted CSV fields, including escaped quotes and embedded line breaks.
export function readContacts(csv) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const input = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(field); field = '';
      if (char !== ',') {
        rows.push(row); row = [];
        if (char === '\r' && input[i + 1] === '\n') i++;
      }
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.slice(1).filter(r => r.length === 3 && r[1]).map(([name, email, company]) => ({ name, email, company }));
}

export function createContactStore(directory) {
  const filename = path.join(directory, 'coldEmailing');
  let queue = Promise.resolve();
  async function readCsv() {
    try { return await readFile(filename, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(directory, { recursive: true });
    let initial = toCsv([]);
    try { initial = await readFile(path.join(directory, 'contacts.csv'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Preserve the previous file as a backup and never overwrite the new file.
    try { await writeFile(filename, initial, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return readFile(filename, 'utf8');
  }
  return {
    async list() { await queue; return readContacts(await readCsv()); },
    append(contacts) {
      // Serialize writes so simultaneous extractions cannot duplicate or overwrite data.
      const job = queue.then(async () => {
        const csv = await readCsv();
        const existing = readContacts(csv);
        const seen = new Set(existing.map(c => c.email.toLowerCase()));
        const additions = contacts.filter(c => {
          const email = c.email.toLowerCase();
          if (seen.has(email)) return false;
          seen.add(email); return true;
        });
        if (additions.length) {
          await mkdir(directory, { recursive: true });
          const output = toCsv(additions);
          const data = csv ? (/[\r\n]$/.test(csv) ? '' : '\r\n') + output.slice(output.indexOf('\r\n') + 2) : output;
          await appendFile(filename, data, 'utf8');
        }
        return { contacts: readContacts(await readCsv()), added: additions.length, alreadySaved: contacts.length - additions.length };
      });
      queue = job.catch(() => {});
      return job;
    }
  };
}
