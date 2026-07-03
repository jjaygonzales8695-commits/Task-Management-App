/**
 * docGenerator.ts
 * Generates Word (.docx) documents matching the LGU-CDO formats:
 *   1. Accomplishment Report  (Accomplishment_Report_FORMAT.docx)
 *   2. Accomplishment History (Accomplishment_History.docx)
 */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle,
  ShadingType, HeadingLevel, VerticalAlign,
  PageOrientation,
} from 'docx'
import { saveAs } from 'file-saver'

// ── Shared helpers ───────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function bold(text: string, size = 22): TextRun {
  return new TextRun({ text, bold: true, size })
}

function normal(text: string, size = 22): TextRun {
  return new TextRun({ text, size })
}

function cell(
  children: Paragraph[],
  opts: { width?: number; bold?: boolean; shading?: boolean; vAlign?: typeof VerticalAlign.CENTER } = {},
): TableCell {
  return new TableCell({
    children,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shading ? { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' } : undefined,
    verticalAlign: opts.vAlign ?? VerticalAlign.CENTER,
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      left:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      right:  { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    },
  })
}

function headerCell(text: string, width: number): TableCell {
  return cell(
    [new Paragraph({ children: [bold(text, 22)], alignment: AlignmentType.CENTER })],
    { width, shading: true, vAlign: VerticalAlign.CENTER },
  )
}

function emptyParagraph(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: '' })] })
}

// ── 1. Accomplishment Report ─────────────────────────────────
// Format: LGU-CDO Accomplishment Report Template_JO_Form3
//
// ACCOMPLISHMENT REPORT
// Month date-range, year
// Table: NAME | NATURE OF WORK | ACCOMPLISHMENT REPORT
// Prepared by / Approved by footer

export interface AccomplishmentReportRow {
  name: string
  natureOfWork: string      // task title / deliverable
  accomplishment: string    // parent monthly task title
}

export interface AccomplishmentReportOptions {
  staffName: string
  staffItem: string         // designation
  dateRange: string         // e.g. "July 1-15, 2025"
  rows: AccomplishmentReportRow[]
}

export async function generateAccomplishmentReport(opts: AccomplishmentReportOptions): Promise<void> {
  // Column widths (in DXA, total ~9360 = 6.5in usable)
  const COL_NAME    = 2000
  const COL_NATURE  = 3680
  const COL_ACCOMP  = 3680

  const tableRows: TableRow[] = [
    // Header row
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('NAME', COL_NAME),
        headerCell('NATURE OF WORK', COL_NATURE),
        headerCell('ACCOMPLISHMENT REPORT', COL_ACCOMP),
      ],
    }),
    // Data rows — at least one row even if empty
    ...(opts.rows.length > 0 ? opts.rows : [{ name: '', natureOfWork: '', accomplishment: '' }]).map(
      (row, i) => new TableRow({
        children: [
          // NAME column — only filled on first row
          cell(
            [new Paragraph({ children: [normal(i === 0 ? row.name : '', 22)] })],
            { width: COL_NAME },
          ),
          cell(
            [new Paragraph({ children: [normal(row.natureOfWork, 22)] })],
            { width: COL_NATURE },
          ),
          cell(
            [new Paragraph({ children: [normal(row.accomplishment, 22)] })],
            { width: COL_ACCOMP },
          ),
        ],
      })
    ),
  ]

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },   // US Letter portrait
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: [
        // Title
        new Paragraph({
          children: [bold('ACCOMPLISHMENT REPORT', 28)],
          alignment: AlignmentType.CENTER,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 },
        }),
        // Date range
        new Paragraph({
          children: [bold(opts.dateRange, 24)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        // Main table
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [COL_NAME, COL_NATURE, COL_ACCOMP],
          rows: tableRows,
        }),
        emptyParagraph(),
        emptyParagraph(),
        // Prepared by / Approved by
        new Paragraph({
          children: [
            normal('Prepared by:', 22),
            new TextRun({ text: '\t\t\t\t\t\t\t\tApproved by:', size: 22 }),
          ],
          spacing: { before: 400 },
          tabStops: [{ type: 'right' as never, position: 9360 }],
        }),
        emptyParagraph(),
        emptyParagraph(),
        new Paragraph({
          children: [
            bold(opts.staffName.toUpperCase(), 22),
            new TextRun({ text: '\t\t\t\t\t\t\t\tRICHEL PETALCURIN-DAHAY', bold: true, size: 22 }),
          ],
        }),
        new Paragraph({
          children: [
            normal(opts.staffItem, 22),
            new TextRun({ text: '\t\t\t\t\t\t\t\tActing City Education and Development Officer', size: 22 }),
          ],
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Accomplishment_Report_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── 2. Accomplishment History ────────────────────────────────
// Format: LGU-CDO Accomplishment Report Template_JO_Form3
//
// ACCOMPLISHMENT HISTORY
// Table: ACCOMPLISHMENTS | DATE

export interface HistoryRow {
  accomplishment: string
  date: string
}

export interface AccomplishmentHistoryOptions {
  staffName: string
  rows: HistoryRow[]
}

export async function generateAccomplishmentHistory(opts: AccomplishmentHistoryOptions): Promise<void> {
  const COL_ACCOMP = 7000
  const COL_DATE   = 2360

  const tableRows: TableRow[] = [
    // Header
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('ACCOMPLISHMENTS', COL_ACCOMP),
        headerCell('DATE', COL_DATE),
      ],
    }),
    ...(opts.rows.length > 0 ? opts.rows : [{ accomplishment: '', date: '' }]).map(
      row => new TableRow({
        children: [
          cell(
            [new Paragraph({ children: [normal(row.accomplishment, 22)] })],
            { width: COL_ACCOMP },
          ),
          cell(
            [new Paragraph({ children: [normal(row.date, 22)], alignment: AlignmentType.CENTER })],
            { width: COL_DATE },
          ),
        ],
      })
    ),
  ]

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: [
        new Paragraph({
          children: [bold('ACCOMPLISHMENT HISTORY', 28)],
          alignment: AlignmentType.CENTER,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 400 },
        }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [COL_ACCOMP, COL_DATE],
          rows: tableRows,
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Accomplishment_History_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── Helper: format a date string for display ─────────────────
export function formatDateRange(month: number, year: number, half: 'first' | 'second' | 'full'): string {
  const m = MONTHS[month]
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  if (half === 'first')  return `${m} 1-15, ${year}`
  if (half === 'second') return `${m} 16-${daysInMonth}, ${year}`
  return `${m} 1-${daysInMonth}, ${year}`
}
