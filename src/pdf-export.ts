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

    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text(sanitizeForPDF(client.name), 14, yPos)
    yPos += 7

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
        headStyles: { fillColor: [15, 118, 110], font: 'helvetica' },
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
