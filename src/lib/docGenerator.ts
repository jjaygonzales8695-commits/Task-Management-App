/**
 * docGenerator.ts
 * Generates Word (.docx) documents matching the LGU-CDO formats:
 *   1. Accomplishment Report  (Accomplishment_Report_FORMAT.docx)
 *   2. Accomplishment History (Accomplishment_History.docx)
 *
 * Both formats are reproduced field-for-field from the official templates:
 * same page size/orientation/margins, same letterhead, same table grid
 * (widths, borders, no shading), same fonts/sizes, and the same
 * Prepared-by / Approved-by signature block layout.
 */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle,
  ShadingType, VerticalAlign, Header, ImageRun,
} from 'docx'
import { saveAs } from 'file-saver'
import letterheadUrl from '@/imports/CEDO_Letterhead.png'

// ── Shared helpers ───────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const FONT = 'Arial'

// Letterhead image is 1121x173px in the source template, placed at
// 6081713 x 941112 EMU (÷9525 = px) in the header.
const LOGO_WIDTH = 639
const LOGO_HEIGHT = 99

let cachedLogoBuffer: ArrayBuffer | null = null
async function getLogoBuffer(): Promise<ArrayBuffer> {
  if (cachedLogoBuffer) return cachedLogoBuffer
  const res = await fetch(letterheadUrl)
  cachedLogoBuffer = await res.arrayBuffer()
  return cachedLogoBuffer
}

async function buildLetterheadHeader(): Promise<Header> {
  const buffer = await getLogoBuffer()
  return new Header({
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            data: buffer,
            transformation: { width: LOGO_WIDTH, height: LOGO_HEIGHT },
          }),
        ],
      }),
    ],
  })
}

function bold(text: string, size = 24, underline = false): TextRun {
  return new TextRun({ text, bold: true, size, font: FONT, underline: underline ? {} : undefined })
}

function normal(text: string, size = 24, underline = false): TextRun {
  return new TextRun({ text, size, font: FONT, underline: underline ? {} : undefined })
}

function tabs(count: number): TextRun[] {
  return Array.from({ length: count }, () => new TextRun({ text: '\t', size: 24, font: FONT }))
}

function cell(
  children: Paragraph[],
  opts: { width?: number; vAlign?: (typeof VerticalAlign)[keyof typeof VerticalAlign] } = {},
): TableCell {
  return new TableCell({
    children,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'auto' },
    verticalAlign: opts.vAlign ?? VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 8, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
      left:   { style: BorderStyle.SINGLE, size: 8, color: '000000' },
      right:  { style: BorderStyle.SINGLE, size: 8, color: '000000' },
    },
  })
}

function headerCell(text: string, width: number): TableCell {
  return cell(
    [new Paragraph({ children: [bold(text, 24)], alignment: AlignmentType.CENTER })],
    { width, vAlign: VerticalAlign.CENTER },
  )
}

function emptyParagraph(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: '', font: FONT })] })
}

// ── 1. Accomplishment Report ─────────────────────────────────
// Format: LGU-CDO Accomplishment Report Template_JO_Form3 (landscape A4)
//
// [Letterhead]
// ACCOMPLISHMENT REPORT
// [Month date-range, year]  (bold, underlined)
// Table: NAME | NATURE OF WORK | ACCOMPLISHMENT REPORT
//   — a single row per staff member. The ACCOMPLISHMENT REPORT cell holds a
//     numbered list; each numbered item has a bold heading followed by a
//     plain-text description, all within the same cell (no extra rows).
// Prepared by: ................................ Approved by:
// [FULL NAME]                                    RICHEL PETALCURIN-DAHAY
// [Position]                                     Acting City Education and Development Officer
// [Nature of Work]

export interface AccomplishmentItem {
  heading: string        // e.g. "Presented the first Prototype of the Scholars' Bridging Application"
  description: string    // e.g. "Presented the initial working prototype ... continuous technical improvement."
}

export interface AccomplishmentReportOptions {
  staffName: string
  natureOfWork: string      // e.g. "Learning and Instructional Support" — printed in the NATURE OF WORK column
  staffItem: string         // printed on the line under the staff name (now: Position)
  staffPosition?: string    // printed on the line below that (now: Nature of Work)
  dateRange: string         // e.g. "July 1-15, 2025"
  items: AccomplishmentItem[]
}

export async function generateAccomplishmentReport(opts: AccomplishmentReportOptions): Promise<void> {
  // Column widths (DXA) — exact match to the official template's table grid
  const COL_NAME    = 3675
  const COL_NATURE  = 2625
  const COL_ACCOMP  = 9015
  const TABLE_WIDTH = COL_NAME + COL_NATURE + COL_ACCOMP // 15315

  const items = opts.items.length > 0 ? opts.items : [{ heading: '', description: '' }]

  // Build the numbered list inside a single ACCOMPLISHMENT REPORT cell:
  // "1. Heading" (bold) followed by the description (normal), for each item.
  const accomplishmentParagraphs: Paragraph[] = items.flatMap((item, i) => [
    new Paragraph({
      children: [bold(`${i + 1}. ${item.heading}`, 24)],
      spacing: { before: i === 0 ? 0 : 160 },
    }),
    new Paragraph({
      children: [normal(item.description, 24)],
    }),
  ])

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
    // Single data row — no per-accomplishment rows are added
    new TableRow({
      children: [
        cell(
          [new Paragraph({ children: [normal(opts.staffName, 24)] })],
          { width: COL_NAME },
        ),
        cell(
          [new Paragraph({ children: [normal(opts.natureOfWork, 24)] })],
          { width: COL_NATURE },
        ),
        cell(accomplishmentParagraphs, { width: COL_ACCOMP, vAlign: VerticalAlign.TOP }),
      ],
    }),
  ]

  const header = await buildLetterheadHeader()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 16838, height: 11906 },   // A4 landscape (DXA)
          margin: { top: 1440, right: 720, bottom: 431, left: 720, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        // Title
        new Paragraph({
          children: [bold('ACCOMPLISHMENT REPORT', 36)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        // Date range
        new Paragraph({
          children: [bold(opts.dateRange, 24, true)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        // Main table
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [COL_NAME, COL_NATURE, COL_ACCOMP],
          rows: tableRows,
        }),
        emptyParagraph(),
        emptyParagraph(),
        // Prepared by / Approved by
        new Paragraph({
          children: [normal('Prepared by:', 24), ...tabs(8), normal('Approved by:', 24)],
        }),
        emptyParagraph(),
        new Paragraph({
          children: [
            bold(opts.staffName.toUpperCase(), 24, true),
            ...tabs(8),
            bold('RICHEL PETALCURIN-DAHAY', 24, true),
          ],
        }),
        new Paragraph({
          children: [
            normal(opts.staffItem, 24),
            ...tabs(9),
            normal('Acting City Education and Development Officer', 24),
          ],
        }),
        new Paragraph({
          children: [normal(opts.staffPosition ?? '', 24)],
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Accomplishment_Report_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── 2. Accomplishment History ────────────────────────────────
// Format: LGU-CDO Accomplishment Report Template_JO_Form3 (portrait A4)
//
// [Letterhead]
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
  // Column widths (DXA) — exact match to the official template's table grid
  const COL_ACCOMP = 5944
  const COL_DATE   = 3544
  const TABLE_WIDTH = COL_ACCOMP + COL_DATE // 9488

  const dataRows = opts.rows.length > 0 ? opts.rows : [{ accomplishment: '', date: '' }]

  const tableRows: TableRow[] = [
    // Header
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('ACCOMPLISHMENTS', COL_ACCOMP),
        headerCell('DATE', COL_DATE),
      ],
    }),
    ...dataRows.map(
      row => new TableRow({
        children: [
          cell(
            [new Paragraph({ children: [normal(row.accomplishment, 24)] })],
            { width: COL_ACCOMP },
          ),
          cell(
            [new Paragraph({ children: [normal(row.date, 24)] })],
            { width: COL_DATE },
          ),
        ],
      })
    ),
  ]

  const header = await buildLetterheadHeader()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },   // A4 portrait (DXA)
          margin: { top: 720, right: 431, bottom: 720, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({
          children: [bold('ACCOMPLISHMENT HISTORY', 36)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [COL_ACCOMP, COL_DATE],
          rows: tableRows,
        }),
        emptyParagraph(),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Accomplishment_History_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── Helper: format a date range string for display ─────────────
export function formatDateRange(month: number, year: number, half: 'first' | 'second' | 'full'): string {
  const m = MONTHS[month]
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  if (half === 'first')  return `${m} 1-15, ${year}`
  if (half === 'second') return `${m} 16-${daysInMonth}, ${year}`
  return `${m} 1-${daysInMonth}, ${year}`
}

// ── 3. CTO Application ───────────────────────────────────────
// PROVISIONAL layout — built from the standard CSC compensatory-time-off
// request fields. Swap this for the official CEDO template once it's
// supplied (see docs/FORMS_TEMPLATES.md).

export interface CTOFormOptions {
  staffName: string
  division: string
  position: string
  dateFrom: string    // display-formatted, e.g. "July 14, 2026"
  dateTo: string       // same as dateFrom for a single day
  dayType: 'Full Day' | 'Half Day (AM)' | 'Half Day (PM)'
  totalDays: string     // e.g. "1" or "3"
  reason: string
}

function labeledRow(label: string, value: string, labelWidth = 3200): TableRow {
  return new TableRow({
    children: [
      cell([new Paragraph({ children: [bold(label, 22)] })], { width: labelWidth }),
      cell([new Paragraph({ children: [normal(value || ' ', 22)] })], { width: 9488 - labelWidth }),
    ],
  })
}

export async function generateCTOForm(opts: CTOFormOptions): Promise<void> {
  const header = await buildLetterheadHeader()
  const COL_LABEL = 3200
  const COL_VALUE = 9488 - COL_LABEL

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 431, bottom: 720, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({ children: [bold('APPLICATION FOR COMPENSATORY TIME-OFF (CTO)', 32)], alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
        new Table({
          width: { size: 9488, type: WidthType.DXA },
          columnWidths: [COL_LABEL, COL_VALUE],
          rows: [
            labeledRow('Name of Employee', opts.staffName),
            labeledRow('Division', opts.division),
            labeledRow('Position', opts.position),
            labeledRow('Date(s) Requested', opts.dateFrom === opts.dateTo ? opts.dateFrom : `${opts.dateFrom} – ${opts.dateTo}`),
            labeledRow('Day Type', opts.dayType),
            labeledRow('Total Day(s)', opts.totalDays),
            labeledRow('Reason', opts.reason || '—'),
          ],
        }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('I certify that the above information is true and correct, and that the compensatory time-off requested is charged against my accumulated overtime credits.', 22)], spacing: { after: 400 } }),
        new Paragraph({ children: [normal('Applicant\u2019s Signature over Printed Name:', 22)], spacing: { after: 600 } }),
        new Paragraph({ children: [normal('_______________________________________', 22)] }),
        emptyParagraph(),
        new Paragraph({ children: [normal('Recommending Approval:', 22), ...tabs(6), normal('Approved by:', 22)] }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('_______________________________________', 22), ...tabs(2), normal('_______________________________________', 22)] }),
        new Paragraph({ children: [normal('Division Head', 22), ...tabs(9), normal('CEDO Department Head', 22)] }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `CTO_Application_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── 4. Pass Slip ──────────────────────────────────────────────
// PROVISIONAL layout — built from the standard CSC pass slip fields.
// Swap this for the official CEDO template once it's supplied.

export interface PassSlipFormOptions {
  staffName: string
  division: string
  position: string
  date: string        // display-formatted
  timeOut: string
  timeIn: string
  purpose: string
}

export async function generatePassSlipForm(opts: PassSlipFormOptions): Promise<void> {
  const header = await buildLetterheadHeader()
  const COL_LABEL = 3200
  const COL_VALUE = 9488 - COL_LABEL

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 431, bottom: 720, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({ children: [bold('OFFICIAL PASS SLIP', 32)], alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
        new Table({
          width: { size: 9488, type: WidthType.DXA },
          columnWidths: [COL_LABEL, COL_VALUE],
          rows: [
            labeledRow('Name of Employee', opts.staffName),
            labeledRow('Division', opts.division),
            labeledRow('Position', opts.position),
            labeledRow('Date', opts.date),
            labeledRow('Time Out', opts.timeOut),
            labeledRow('Time In (expected)', opts.timeIn),
            labeledRow('Purpose', opts.purpose || '—'),
          ],
        }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('This pass slip is limited to a maximum of three (3) hours and must be countersigned by the immediate supervisor.', 22)], spacing: { after: 400 } }),
        new Paragraph({ children: [normal('Requested by:', 22), ...tabs(6), normal('Approved by:', 22)] }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('_______________________________________', 22), ...tabs(2), normal('_______________________________________', 22)] }),
        new Paragraph({ children: [normal('Employee Signature', 22), ...tabs(10), normal('Division Head', 22)] }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Pass_Slip_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}
