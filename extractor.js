import { load } from 'cheerio';

const EMAIL = /[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;
const clean = (value) => value.replace(/\s+/g, ' ').trim();

function emailsIn($, element) {
  const node = $(element);
  const textNode = node.clone();
  textNode.find('div, p, li, tr, td, th, section, article, br, hr').prepend(' ').append(' ');
  const values = [textNode.text()];
  node.find('a[href], [data-email], [title]').addBack('a[href], [data-email], [title]').each((_, item) => {
    const el = $(item);
    const href = el.attr('href') || '';
    if (/^mailto:/i.test(href)) {
      let address = href.slice(7).split('?')[0];
      try { address = decodeURIComponent(address); } catch { /* Keep malformed escapes as text. */ }
      values.push(address);
    }
    values.push(el.attr('data-email') || '', el.attr('title') || '');
  });
  return [...new Set((values.join(' ').match(EMAIL) || []).map(email => email.toLowerCase()))];
}

export function extractContacts(html) {
  const $ = load(html);
  $('script, style, template, noscript').remove();
  const contacts = [];
  const seen = new Set();
  let rowsScanned = 0;
  let rowsWithoutEmail = 0;
  let duplicatesRemoved = 0;
  function add(name, company, emails) {
    rowsScanned++;
    if (!emails.length) rowsWithoutEmail++;
    for (const email of emails) {
      if (seen.has(email)) { duplicatesRemoved++; continue; }
      seen.add(email);
      contacts.push({ name: clean(name), email, company: clean(company) });
    }
  }

  // Stable data fields preserve associations despite Apollo's generated CSS classes.
  const apolloRows = $('[role="row"]').filter((_, row) =>
    $(row).find('[role="cell"][data-id="contact.name"]').length > 0);
  if (apolloRows.length) {
    apolloRows.each((_, row) => {
      const cell = (id) => $(row).find(`[role="cell"][data-id="${id}"]`).first();
      const nameCell = cell('contact.name');
      const companyCell = cell('contact.account');
      const nameLink = nameCell.find('a').filter((_, a) => clean($(a).text())).first();
      const companyLink = companyCell.find('a').filter((_, a) => clean($(a).text())).first();
      add((nameLink.length ? nameLink : nameCell).text(),
        (companyLink.length ? companyLink : companyCell).text(), emailsIn($, cell('contact.emails')));
    });
  } else {
    // Ordinary tables are supported when their column headings identify the fields.
    $('table, [role="grid"], [role="treegrid"]').each((_, table) => {
      const rows = $(table).find('tr, [role="row"]');
      const headings = rows.first().find('th, td, [role="columnheader"]').map((_, el) => clean($(el).text()).toLowerCase()).get();
      const nameIndex = headings.findIndex(h => /^(full name|name|contact name)$/.test(h));
      const companyIndex = headings.findIndex(h => /^(company|company name|organization|organisation)$/.test(h));
      const emailIndex = headings.findIndex(h => /^(e-?mail|e-?mails|email address)$/.test(h));
      if (emailIndex < 0) return;
      rows.slice(1).each((_, row) => {
        const cells = $(row).find('td, [role="cell"], [role="gridcell"]').filter((_, el) =>
          $(el).parentsUntil(row, 'td, [role="cell"], [role="gridcell"]').length === 0);
        if (!cells.length) return;
        add(nameIndex < 0 ? '' : cells.eq(nameIndex).text(), companyIndex < 0 ? '' : cells.eq(companyIndex).text(), emailsIn($, cells.eq(emailIndex)));
      });
    });
    if (!rowsScanned) add('', '', emailsIn($, $.root()));
  }

  const warnings = [];
  if (rowsWithoutEmail) warnings.push(`${rowsWithoutEmail} row(s) had no available email and were skipped.`);
  if (contacts.some(c => !c.name || !c.company)) warnings.push('Some names or companies could not be identified. Those fields are left blank.');
  if (!contacts.length) warnings.push('No email addresses were found. Paste HTML containing visible emails or mailto links.');
  return { contacts, stats: { rowsScanned, emailsFound: contacts.length, rowsWithoutEmail, duplicatesRemoved }, warnings };
}

export function toCsv(contacts) {
  const escape = (value) => {
    // Prevent pasted HTML from becoming executable spreadsheet formulas.
    const safe = /^[\s]*[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return '\uFEFFName,Email,Company Name\r\n' + contacts.map(c =>
    [c.name, c.email, c.company].map(escape).join(',')).join('\r\n') + (contacts.length ? '\r\n' : '');
}
