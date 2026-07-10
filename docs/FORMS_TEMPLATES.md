# Forms — swapping in the official CTO / Pass Slip templates

`src/lib/docGenerator.ts` currently builds the CTO Application and Pass Slip
`.docx` files from a **provisional layout**: standard CSC fields placed on
the CEDO letterhead, in the same style as the existing Accomplishment Report
generator.

Once you have the official CEDO template files, send them over and they'll
be matched field-for-field (same table grid, spacing, and signature block),
the same way `generateAccomplishmentReport()` already mirrors the official
`Accomplishment_Report_FORMAT.docx`. Nothing in the request workflow, the
Forms page UI, or the approval flow needs to change — only the two
generator functions:

- `generateCTOForm()`
- `generatePassSlipForm()`

If the templates are Word documents, the easiest way to match them exactly
is to open them and note: page size/orientation, margins, table column
widths, font/size, and the exact signatory line wording (names/titles) —
then those values get swapped into the two functions above.
