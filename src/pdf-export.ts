import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { exportAllData } from './db'
import type { Client, Loan } from './types'
import {
  formatCurrencyPDF,
  formatDatePDF,
  getOutstanding,
  getLoanStatus,
  sanitizeForPDF,
} from './utils'

function buildBackupPDF(clients: Client[], loans: Loan[]): jsPDF {
  const doc = new jsPDF()
  const now = new Date()
  const generatedAt = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}, ${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`

  doc.setFontSize(18)
  doc.text('Collection Manager - Database Backup', 14, 20)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Generated: ${generatedAt}`, 14, 28)
  doc.text(`Total Clients: ${clients.length}  |  Total Loans: ${loans.length}`, 14, 34)
  doc.setTextColor(0)

  let yPos = 42

  if (clients.length === 0) {
    doc.setFontSize(12)
    doc.text('No clients in database.', 14, yPos)
    return doc
  }

  for (const client of clients) {
    const clientLoans = loans.filter((l) => l.clientId === client.id)
    const totalLent = clientLoans.reduce((s, l) => s + l.amount, 0)
    const totalRepaid = clientLoans.reduce((s, l) => s + l.amountRepaid, 0)
    const totalOutstanding = clientLoans.reduce((s, l) => s + getOutstanding(l), 0)

    if (yPos > 240) {
      doc.addPage()
      yPos = 20
    }

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(29, 78, 216)
    doc.text('Client ID', 14, yPos)
    doc.setTextColor(0)
    doc.text(String(client.clientNumber), 42, yPos)
    yPos += 6

    doc.setTextColor(29, 78, 216)
    doc.text('Client Name', 14, yPos)
    doc.setTextColor(0)
    doc.setFontSize(13)
    doc.text(sanitizeForPDF(client.name), 42, yPos)
    yPos += 8

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80)

    const infoParts: string[] = []
    if (client.phone) infoParts.push(`Phone: ${sanitizeForPDF(client.phone)}`)
    infoParts.push(`Added: ${formatDatePDF(client.createdAt)}`)
    infoParts.push(`Lent: ${formatCurrencyPDF(totalLent)}`)
    infoParts.push(`Repaid: ${formatCurrencyPDF(totalRepaid)}`)
    infoParts.push(`Outstanding: ${formatCurrencyPDF(totalOutstanding)}`)

    const infoLines = doc.splitTextToSize(infoParts.join('  |  '), 180)
    doc.text(infoLines, 14, yPos)
    yPos += infoLines.length * 4 + 2

    if (client.notes) {
      const noteLines = doc.splitTextToSize(`Notes: ${sanitizeForPDF(client.notes)}`, 180)
      doc.text(noteLines, 14, yPos)
      yPos += noteLines.length * 4 + 2
    }

    doc.setTextColor(0)

    if (clientLoans.length > 0) {
      autoTable(doc, {
        startY: yPos,
        head: [['Date Given', 'Amount', 'Due Date', 'Repaid', 'Outstanding', 'Status', 'Notes']],
        body: clientLoans.map((loan) => {
          const status = getLoanStatus(loan)
          const statusLabel =
            status === 'paid' ? 'Paid' : status === 'overdue' ? 'OVERDUE' : status === 'due-soon' ? 'Due Soon' : 'Active'
          return [
            formatDatePDF(loan.dateGiven),
            formatCurrencyPDF(loan.amount),
            formatDatePDF(loan.dueDate),
            formatCurrencyPDF(loan.amountRepaid),
            formatCurrencyPDF(getOutstanding(loan)),
            statusLabel,
            sanitizeForPDF(loan.notes) || '-',
          ]
        }),
        margin: { left: 14, right: 14 },
        styles: { fontSize: 8, cellPadding: 2, font: 'helvetica' },
        headStyles: { fillColor: [29, 78, 216], font: 'helvetica' },
        columnStyles: {
          6: { cellWidth: 30 },
        },
      })
      yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
    } else {
      doc.setFontSize(9)
      doc.setTextColor(120)
      doc.text('No loans recorded.', 14, yPos)
      yPos += 14
      doc.setTextColor(0)
    }
  }

  return doc
}

export async function exportToPDF(): Promise<void> {
  const { clients, loans } = await exportAllData()
  const doc = buildBackupPDF(clients, loans)
  const filename = `collection-backup-${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(filename)
}

function xmlCellText(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function dateOnlyISO(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.split('T')[0] ?? value
  return date.toISOString().split('T')[0]
}

function excelTextCell(value: string | number, style = 'Text'): string {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${xmlCellText(value)}</Data></Cell>`
}

function excelNumberCell(value: number): string {
  return `<Cell ss:StyleID="Number"><Data ss:Type="Number">${value}</Data></Cell>`
}

function excelDateCell(value: string): string {
  if (!value) return '<Cell />'
  const isoDate = dateOnlyISO(value)
  return `<Cell ss:StyleID="Date"><Data ss:Type="DateTime">${isoDate}T00:00:00.000</Data></Cell>`
}

export async function exportToExcelSheet(): Promise<void> {
  const { clients, loans } = await exportAllData()
  const rows: string[] = []
  const headers = [
    'Client ID',
    'Client Name',
    'Phone',
    'Added',
    'Loan Date',
    'Loan Amount',
    'Due Date',
    'Repaid',
    'Outstanding',
    'Status',
    'Notes',
  ]

  rows.push(`<Row>${headers.map((header) => excelTextCell(header, 'Header')).join('')}</Row>`)

  for (const client of clients) {
    const clientLoans = loans.filter((loan) => loan.clientId === client.id)
    if (clientLoans.length === 0) {
      rows.push(`<Row>${
        [
          excelNumberCell(client.clientNumber),
          excelTextCell(client.name),
          excelTextCell(client.phone),
          excelDateCell(client.createdAt),
          '<Cell />',
          '<Cell />',
          '<Cell />',
          '<Cell />',
          '<Cell />',
          '<Cell />',
          excelTextCell(client.notes),
        ].join('')
      }</Row>`)
      continue
    }

    for (const loan of clientLoans) {
      const status = getLoanStatus(loan)
      const statusLabel =
        status === 'paid' ? 'Paid' : status === 'overdue' ? 'Overdue' : status === 'due-soon' ? 'Due Soon' : 'Active'
      rows.push(`<Row>${
        [
          excelNumberCell(client.clientNumber),
          excelTextCell(client.name),
          excelTextCell(client.phone),
          excelDateCell(client.createdAt),
          excelDateCell(loan.dateGiven),
          excelNumberCell(loan.amount),
          excelDateCell(loan.dueDate),
          excelNumberCell(loan.amountRepaid),
          excelNumberCell(getOutstanding(loan)),
          excelTextCell(statusLabel),
          excelTextCell(loan.notes || client.notes),
        ].join('')
      }</Row>`)
    }
  }

  const worksheet = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1" />
      <Interior ss:Color="#D9EAFD" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="Text">
      <NumberFormat ss:Format="@" />
    </Style>
    <Style ss:ID="Date">
      <NumberFormat ss:Format="dd\\-mmm\\-yy" />
    </Style>
    <Style ss:ID="Number">
      <NumberFormat ss:Format="#,##0" />
    </Style>
  </Styles>
  <Worksheet ss:Name="Collection Backup">
    <Table>
      <Column ss:Width="70" />
      <Column ss:Width="150" />
      <Column ss:Width="120" />
      <Column ss:Width="95" />
      <Column ss:Width="95" />
      <Column ss:Width="95" />
      <Column ss:Width="95" />
      <Column ss:Width="90" />
      <Column ss:Width="100" />
      <Column ss:Width="80" />
      <Column ss:Width="180" />
      ${rows.join('\n')}
    </Table>
  </Worksheet>
</Workbook>`

  const blob = new Blob([worksheet], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `collection-backup-${new Date().toISOString().split('T')[0]}.xls`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function sharePDF(): Promise<void> {
  const { clients, loans } = await exportAllData()
  const doc = buildBackupPDF(clients, loans)
  const filename = `collection-backup-${new Date().toISOString().split('T')[0]}.pdf`

  const blob = doc.output('blob')
  const file = new File([blob], filename, { type: 'application/pdf' })

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: 'Collection Database Backup',
      text: 'Backup of collection database',
      files: [file],
    })
  } else {
    doc.save(filename)
  }
}
