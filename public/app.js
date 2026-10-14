const el = (id) => document.getElementById(id);
const html = el('html');
let busy = false;

function resetResults() {
  el('rows').replaceChildren();
  el('count').textContent = '0 contacts';
  el('table-wrap').hidden = true;
  el('empty').hidden = false;
  el('warnings').hidden = true;
}
function changed() {
  el('status').textContent = 'Ready to append new contacts to exports/coldEmailing.';
  el('input-info').textContent = html.value ? `${html.value.length.toLocaleString()} characters loaded` : 'Supports Apollo contact rows and standard HTML tables.';
}
html.addEventListener('input', changed);
el('file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file || busy) return;
  if (file.size > 10 * 1024 * 1024) { el('status').textContent = 'Please choose a file smaller than 10 MB.'; return; }
  try { html.value = await file.text(); changed(); }
  catch { el('status').textContent = 'Could not read that file. Try pasting its HTML instead.'; }
});
el('clear').addEventListener('click', () => {
  html.value = ''; el('file').value = ''; changed(); html.focus();
});
el('extract').addEventListener('click', async () => {
  if (busy) return;
  if (!html.value.trim()) { el('status').textContent = 'Paste HTML or choose a file first.'; html.focus(); return; }
  busy = true;
  for (const id of ['extract', 'clear', 'file', 'html']) el(id).disabled = true;
  el('status').textContent = 'Extracting and appending new contacts to exports/coldEmailing…';
  try {
    const response = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: html.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Extraction failed.');
    renderContacts(data);
    el('warnings').textContent = data.warnings.join(' ');
    el('warnings').hidden = !data.warnings.length;
    el('status').textContent = `${data.stats.added} new contacts appended. ${data.stats.alreadySaved} already saved; ${data.stats.duplicatesRemoved} duplicates in this input skipped. ${data.stats.totalSaved} contacts total in exports/coldEmailing.`;
  } catch (error) { el('status').textContent = error.message || 'Could not connect to the app. Please try again.'; }
  finally {
    busy = false;
    for (const id of ['extract', 'clear', 'file', 'html']) el(id).disabled = false;
  }
});

function renderContacts(data) {
    resetResults();
    const fragment = document.createDocumentFragment();
    for (const contact of data.contacts) {
      const row = document.createElement('tr');
      for (const key of ['name', 'email', 'company']) {
        const cell = document.createElement('td');
        cell.textContent = contact[key] || '—';
        row.append(cell);
      }
      fragment.append(row);
    }
    el('rows').append(fragment);
    el('count').textContent = `${data.contacts.length} saved contacts`;
    el('empty').hidden = data.contacts.length > 0;
    el('table-wrap').hidden = !data.contacts.length;
}

async function loadSavedContacts() {
  el('extract').disabled = true;
  try {
    const response = await fetch('/api/contacts');
    if (!response.ok) throw new Error('Could not load saved contacts.');
    const data = await response.json();
    renderContacts(data);
    el('status').textContent = `${data.contacts.length} contacts saved in exports/coldEmailing. New extractions append to this file.`;
  } catch (error) { el('status').textContent = error.message; }
  finally { el('extract').disabled = false; }
}
loadSavedContacts();
