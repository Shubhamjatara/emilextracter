# Cold Emailing Contact Extractor

A local Node.js app for extracting names, emails, and company names from pasted HTML. No API key or account is needed.

## Run

Requires Node.js 20.18.1 or later.

```sh
npm install
npm start
```

Open http://localhost:3000. Paste HTML into the text area or choose an HTML/TXT file, then click **Extract & append**. Contacts save automatically; no download is needed.

Every extraction appends new contacts to the same `exports/coldEmailing` file (named exactly `coldEmailing`, without an extension). Existing contacts are preserved, and emails already saved are skipped, including after an app restart. The preview includes all saved contacts. Clearing the input does not clear the saved file. On first use, existing `exports/contacts.csv` data is copied into `coldEmailing`; the old file remains as a backup. The file uses comma-separated `Name`, `Email`, and `Company Name` columns, a UTF-8 BOM, and correctly quoted values. Values that could be spreadsheet formulas are prefixed with an apostrophe.

## Supported input

- Apollo contact rows, using stable `data-id` attributes to match name, email, and company within each row.
- Standard HTML tables with Name, Email, and Company column headings (common variants are accepted).
- Other HTML: extracts available email addresses, leaving names and companies blank when their relationship cannot be identified.
- HTML entities and mailto links; multiple emails produce separate CSV rows. Duplicate emails are removed within each extraction, keeping the first occurrence.

Rows without email addresses are skipped and counted. Only information present in the pasted HTML can be extracted. Copying a paginated or virtualized table only includes the rows present in that HTML, not every result on the original website. This app does not verify email deliverability.

Input is parsed on your computer and never rendered as live HTML. The app binds to the local computer only. Uploaded HTML is not saved; the saved contact file remains in `exports` until you remove it. Input limit: 10 MB per JSON request.

Run `npm test` for extraction and HTTP checks. To use a different port in PowerShell: `$env:PORT=3001`, then `npm start`.
