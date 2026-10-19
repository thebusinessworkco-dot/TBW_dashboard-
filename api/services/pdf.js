import PDFDocument from 'pdfkit'

export function generateQuotationPdf(quotation, stream) {
  const doc = new PDFDocument({ margin: 45, size: 'A4' })
  doc.pipe(stream)

  // Brand Header
  doc.fillColor('#0f172a').fontSize(22).font('Helvetica-Bold').text('THE BUSINESS WORK', 45, 45)
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('We Make Business Simpler.', 45, 70)
  doc.text('hello@thebusinesswork.com  |  https://www.thebusinesswork.com', 45, 82)

  // Document Badge
  doc.rect(420, 45, 130, 26).fill('#0ea5e9')
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('OFFICIAL QUOTATION', 425, 52, { width: 120, align: 'center' })

  doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(`Quote #:`, 420, 80)
  doc.font('Helvetica').text(quotation.quotation_number, 470, 80)
  doc.font('Helvetica-Bold').text(`Date:`, 420, 93)
  doc.font('Helvetica').text(new Date(quotation.created_at).toLocaleDateString('en-IN'), 470, 93)
  if (quotation.valid_until) {
    doc.font('Helvetica-Bold').text(`Valid Until:`, 420, 106)
    doc.font('Helvetica').text(new Date(quotation.valid_until).toLocaleDateString('en-IN'), 470, 106)
  }

  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(45, 125).lineTo(550, 125).stroke()

  // Client Details
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('PREPARED FOR:', 45, 135)
  doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(quotation.client_name || 'Client', 45, 147)
  let curY = 162
  if (quotation.business_name) {
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(quotation.business_name, 45, curY)
    curY += 13
  }
  if (quotation.client_phone) {
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`Phone: +${quotation.client_phone}`, 45, curY)
    curY += 13
  }
  if (quotation.client_email) {
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`Email: ${quotation.client_email}`, 45, curY)
    curY += 13
  }

  // Package & Scope
  if (quotation.package_type || quotation.scope_of_work) {
    curY += 6
    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('SOLUTION PACKAGE & SCOPE:', 45, curY)
    curY += 12
    doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold').text(`Package: ${quotation.package_type || 'Custom Automation Solution'}`, 45, curY)
    curY += 14
    if (quotation.scope_of_work) {
      doc.fillColor('#334155').fontSize(9).font('Helvetica').text(quotation.scope_of_work, 45, curY, { width: 505 })
      curY += doc.heightOfString(quotation.scope_of_work, { width: 505 }) + 10
    }
  } else {
    curY += 15
  }

  // Items Table Header
  curY = Math.max(curY, 230)
  doc.rect(45, curY, 505, 22).fill('#f8fafc')
  doc.strokeColor('#cbd5e1').rect(45, curY, 505, 22).stroke()
  doc.fillColor('#334155').fontSize(8.5).font('Helvetica-Bold')
  doc.text('DESCRIPTION', 55, curY + 6)
  doc.text('QTY', 300, curY + 6, { width: 40, align: 'center' })
  doc.text('SETUP FEE (INR)', 350, curY + 6, { width: 95, align: 'right' })
  doc.text('MONTHLY FEE (INR)', 455, curY + 6, { width: 90, align: 'right' })
  curY += 22

  let totalSetup = 0
  let totalMonthly = 0

  // Items Rows
  const items = quotation.items || []
  for (const item of items) {
    const qty = Number(item.quantity) || 1
    const setup = (Number(item.setup_fee) || 0) * qty
    const monthly = (Number(item.monthly_fee) || 0) * qty
    totalSetup += setup
    totalMonthly += monthly

    doc.fillColor('#0f172a').fontSize(9).font('Helvetica')
    doc.text(item.description, 55, curY + 5, { width: 235 })
    const rowHeight = Math.max(20, doc.heightOfString(item.description, { width: 235 }) + 8)

    doc.text(String(qty), 300, curY + 5, { width: 40, align: 'center' })
    doc.text(`₹${setup.toLocaleString('en-IN')}`, 350, curY + 5, { width: 95, align: 'right' })
    doc.text(monthly > 0 ? `₹${monthly.toLocaleString('en-IN')}/mo` : '—', 455, curY + 5, { width: 90, align: 'right' })

    doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(45, curY + rowHeight).lineTo(550, curY + rowHeight).stroke()
    curY += rowHeight
  }

  // Totals Section
  curY += 10
  const discountVal = Number(quotation.discount_value) || 0
  let discountAmount = 0
  if (quotation.discount_type === 'percentage') {
    discountAmount = Math.round((totalSetup * discountVal) / 100)
  } else if (quotation.discount_type === 'fixed') {
    discountAmount = discountVal
  }

  const taxableSetup = Math.max(0, totalSetup - discountAmount)
  const taxRate = (quotation.tax_type === 'cgst_sgst' || quotation.tax_type === 'igst') ? (Number(quotation.tax_rate) || 0) : 0
  const taxAmount = Math.round((taxableSetup * taxRate) / 100)
  const netSetupDue = taxableSetup + taxAmount

  const summaryX = 330
  doc.strokeColor('#e2e8f0').rect(summaryX, curY, 220, 88).stroke()
  doc.fillColor('#475569').fontSize(8.5).font('Helvetica')

  doc.text('One-Time Setup Subtotal:', summaryX + 10, curY + 8)
  doc.text(`₹${totalSetup.toLocaleString('en-IN')}`, summaryX + 120, curY + 8, { width: 85, align: 'right' })

  if (discountAmount > 0) {
    doc.text(`Discount (${quotation.discount_type}):`, summaryX + 10, curY + 22)
    doc.text(`- ₹${discountAmount.toLocaleString('en-IN')}`, summaryX + 120, curY + 22, { width: 85, align: 'right' })
  }

  if (taxRate > 0) {
    doc.text(`GST (${taxRate}%):`, summaryX + 10, curY + 36)
    doc.text(`+ ₹${taxAmount.toLocaleString('en-IN')}`, summaryX + 120, curY + 36, { width: 85, align: 'right' })
  }

  doc.fillColor('#0f172a').font('Helvetica-Bold')
  doc.text('Total One-Time Due:', summaryX + 10, curY + 54)
  doc.text(`₹${netSetupDue.toLocaleString('en-IN')}`, summaryX + 120, curY + 54, { width: 85, align: 'right' })

  if (totalMonthly > 0) {
    doc.fillColor('#0369a1').font('Helvetica-Bold')
    doc.text('Recurring Monthly:', summaryX + 10, curY + 70)
    doc.text(`₹${totalMonthly.toLocaleString('en-IN')}/mo`, summaryX + 120, curY + 70, { width: 85, align: 'right' })
  }

  // Terms & Payment Milestones
  curY += 105
  if (curY < 720) {
    if (quotation.terms) {
      doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('TERMS & CONDITIONS:', 45, curY)
      curY += 10
      doc.fillColor('#475569').fontSize(8).font('Helvetica').text(quotation.terms, 45, curY, { width: 505 })
      curY += doc.heightOfString(quotation.terms, { width: 505 }) + 8
    }

    if (quotation.payment_milestones) {
      doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('PAYMENT MILESTONES:', 45, curY)
      curY += 10
      doc.fillColor('#475569').fontSize(8).font('Helvetica').text(quotation.payment_milestones, 45, curY, { width: 505 })
    }
  }

  // Acceptance Footer
  const footerY = 750
  doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(45, footerY).lineTo(550, footerY).stroke()
  doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(
    'To accept this quotation digitally, click the acceptance link shared via WhatsApp or sign below.',
    45,
    footerY + 8
  )
  doc.text('Accepted By: ___________________________   Date: _______________', 45, footerY + 24)

  doc.end()
}

export function generateInvoicePdf(invoice, stream) {
  const doc = new PDFDocument({ margin: 45, size: 'A4' })
  doc.pipe(stream)

  // Brand Header
  doc.fillColor('#0f172a').fontSize(22).font('Helvetica-Bold').text('THE BUSINESS WORK', 45, 45)
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('We Make Business Simpler.', 45, 70)
  doc.text('hello@thebusinesswork.com  |  https://thebusinesswork.com', 45, 82)

  // Document Badge
  doc.rect(420, 45, 130, 26).fill('#0ea5e9')
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('INVOICE', 425, 52, { width: 120, align: 'center' })

  doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text('Invoice #:', 420, 80)
  doc.font('Helvetica').text(invoice.invoice_number, 475, 80)
  doc.font('Helvetica-Bold').text('Date:', 420, 93)
  doc.font('Helvetica').text(new Date(invoice.issue_date || invoice.created_at).toLocaleDateString('en-IN'), 475, 93)
  doc.font('Helvetica-Bold').text('Due Date:', 420, 106)
  doc.font('Helvetica').text(new Date(invoice.due_date).toLocaleDateString('en-IN'), 475, 106)

  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(45, 125).lineTo(550, 125).stroke()

  // Bill To
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('BILLED TO:', 45, 135)
  doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(invoice.client_name || 'Client', 45, 147)
  let curY = 162
  if (invoice.business_name) {
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(invoice.business_name, 45, curY)
    curY += 13
  }
  if (invoice.client_phone) {
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`Phone: +${invoice.client_phone}`, 45, curY)
    curY += 13
  }

  // Items Table Header
  curY = Math.max(curY, 215)
  doc.rect(45, curY, 505, 22).fill('#f8fafc')
  doc.strokeColor('#cbd5e1').rect(45, curY, 505, 22).stroke()
  doc.fillColor('#334155').fontSize(8.5).font('Helvetica-Bold')
  doc.text('DESCRIPTION', 55, curY + 6)
  doc.text('QTY', 340, curY + 6, { width: 40, align: 'center' })
  doc.text('RATE (INR)', 390, curY + 6, { width: 75, align: 'right' })
  doc.text('AMOUNT (INR)', 470, curY + 6, { width: 75, align: 'right' })
  curY += 22

  const items = invoice.items || []
  let subtotal = 0
  for (const item of items) {
    const qty = Number(item.quantity) || 1
    const unitPrice = Number(item.unit_price) || 0
    const amount = Number(item.amount) || qty * unitPrice
    subtotal += amount

    doc.fillColor('#0f172a').fontSize(9).font('Helvetica')
    doc.text(item.description, 55, curY + 5, { width: 280 })
    const rowHeight = Math.max(20, doc.heightOfString(item.description, { width: 280 }) + 8)

    doc.text(String(qty), 340, curY + 5, { width: 40, align: 'center' })
    doc.text(`₹${unitPrice.toLocaleString('en-IN')}`, 390, curY + 5, { width: 75, align: 'right' })
    doc.text(`₹${amount.toLocaleString('en-IN')}`, 470, curY + 5, { width: 75, align: 'right' })

    doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(45, curY + rowHeight).lineTo(550, curY + rowHeight).stroke()
    curY += rowHeight
  }

  // Summary Box
  curY += 10
  const summaryX = 330
  const taxRate = (invoice.tax_type === 'cgst_sgst' || invoice.tax_type === 'igst') ? (Number(invoice.tax_rate) || 0) : 0
  const taxAmount = Number(invoice.tax_amount) || 0
  const boxHeight = (taxRate > 0 && taxAmount > 0) ? 100 : 85

  doc.strokeColor('#e2e8f0').rect(summaryX, curY, 220, boxHeight).stroke()
  doc.fillColor('#475569').fontSize(8.5).font('Helvetica')

  let boxY = curY + 8
  doc.text('Subtotal:', summaryX + 10, boxY)
  doc.text(`₹${(invoice.subtotal || subtotal).toLocaleString('en-IN')}`, summaryX + 120, boxY, { width: 85, align: 'right' })
  boxY += 14

  if (invoice.discount_value > 0) {
    doc.text(`Discount:`, summaryX + 10, boxY)
    doc.text(`- ₹${Number(invoice.discount_value).toLocaleString('en-IN')}`, summaryX + 120, boxY, { width: 85, align: 'right' })
    boxY += 14
  }

  if (taxRate > 0 && taxAmount > 0) {
    doc.text(`GST (${taxRate}%):`, summaryX + 10, boxY)
    doc.text(`+ ₹${taxAmount.toLocaleString('en-IN')}`, summaryX + 120, boxY, { width: 85, align: 'right' })
    boxY += 14
  }

  doc.fillColor('#0f172a').font('Helvetica-Bold')
  doc.text('Total Invoiced:', summaryX + 10, boxY)
  doc.text(`₹${(invoice.total || 0).toLocaleString('en-IN')}`, summaryX + 120, boxY, { width: 85, align: 'right' })
  boxY += 14

  doc.fillColor('#16a34a')
  doc.text('Amount Paid:', summaryX + 10, boxY)
  doc.text(`₹${(invoice.amount_paid || 0).toLocaleString('en-IN')}`, summaryX + 120, boxY, { width: 85, align: 'right' })
  boxY += 14

  doc.fillColor('#dc2626').font('Helvetica-Bold')
  doc.text('Balance Due:', summaryX + 10, boxY)
  doc.text(`₹${(invoice.balance_due ?? invoice.total).toLocaleString('en-IN')}`, summaryX + 120, boxY, { width: 85, align: 'right' })

  // Status Stamp if Paid
  if (invoice.status === 'paid' || invoice.balance_due === 0) {
    doc.save()
    doc.rotate(-15, { origin: [200, 360] })
    doc.rect(140, 340, 120, 36).strokeColor('#16a34a').lineWidth(3).stroke()
    doc.fillColor('#16a34a').fontSize(18).font('Helvetica-Bold').text('PAID', 145, 348, { width: 110, align: 'center' })
    doc.restore()
  }

  // Payment Instructions & Bank Details
  const footerY = 660
  doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(45, footerY).lineTo(550, footerY).stroke()
  doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold').text('PAYMENT DETAILS:', 45, footerY + 8)
  doc.fillColor('#475569').fontSize(8).font('Helvetica')
  doc.text('Bank: HDFC Bank  |  A/C Name: The Business Work  |  A/C No: 50200089123456  |  IFSC: HDFC0001234', 45, footerY + 20)
  doc.text('UPI ID: thebusinesswork@hdfcbank  |  Scan QR via PhonePe / GPay / Paytm', 45, footerY + 32)
  doc.text('Please share transaction reference / UTR upon transfer to accounts@thebusinesswork.com', 45, footerY + 44)

  doc.end()
}

export function generatePaymentReceiptPdf(payment, stream) {
  const doc = new PDFDocument({ margin: 45, size: 'A5', layout: 'landscape' })
  doc.pipe(stream)

  // Brand Header
  doc.fillColor('#0f172a').fontSize(18).font('Helvetica-Bold').text('THE BUSINESS WORK', 45, 40)
  doc.fillColor('#64748b').fontSize(8.5).font('Helvetica').text('We Make Business Simpler.', 45, 62)

  // Badge
  doc.rect(420, 40, 130, 24).fill('#16a34a')
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text('PAYMENT RECEIPT', 425, 46, { width: 120, align: 'center' })

  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(45, 80).lineTo(550, 80).stroke()

  doc.fillColor('#475569').fontSize(9).font('Helvetica')
  doc.text(`Receipt #: ${payment.receipt_number || 'TBW-RCP-' + payment.id}`, 45, 95)
  doc.text(`Payment Date: ${new Date(payment.payment_date || payment.created_at).toLocaleDateString('en-IN')}`, 45, 110)
  doc.text(`Payment Method: ${(payment.method || 'bank_transfer').toUpperCase()}`, 45, 125)
  if (payment.reference_id) {
    doc.text(`Transaction Reference (UTR): ${payment.reference_id}`, 45, 140)
  }

  doc.text(`Customer: ${payment.client_name || 'Valued Customer'}`, 320, 95)
  if (payment.business_name) doc.text(`Company: ${payment.business_name}`, 320, 110)
  if (payment.invoice_number) doc.text(`Invoice Ref: ${payment.invoice_number}`, 320, 125)

  // Amount Box
  doc.rect(45, 170, 505, 50).fill('#f0fdf4')
  doc.strokeColor('#86efac').rect(45, 170, 505, 50).stroke()
  doc.fillColor('#166534').fontSize(11).font('Helvetica-Bold').text('AMOUNT RECEIVED', 60, 182)
  doc.fontSize(18).text(`₹${Number(payment.amount).toLocaleString('en-IN')}`, 60, 196)

  doc.fillColor('#64748b').fontSize(8).font('Helvetica').text('This is an electronically generated receipt and does not require a physical signature.', 45, 250)
  doc.end()
}

export function generateExecutiveReportPdf(data, stream) {
  const doc = new PDFDocument({ margin: 45, size: 'A4' })
  doc.pipe(stream)

  // Header
  doc.fillColor('#0f172a').fontSize(22).font('Helvetica-Bold').text('THE BUSINESS WORK', 45, 45)
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Executive Business Intelligence & Financial Report', 45, 70)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}  |  Range: ${data.range || 'All Time'}`, 45, 82)

  doc.rect(380, 45, 170, 26).fill('#0f172a')
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text('EXECUTIVE REPORT', 385, 52, { width: 160, align: 'center' })

  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(45, 110).lineTo(550, 110).stroke()

  // 4 Top Metric Cards
  const cards = [
    { label: 'COLLECTED REVENUE', val: `₹${(data.finance?.total_collected || 0).toLocaleString('en-IN')}`, sub: `Net Profit: ₹${(data.finance?.net_profit || 0).toLocaleString('en-IN')}` },
    { label: 'LEAD PIPELINE', val: `${data.leads?.total || 0} Leads`, sub: `Conversion: ${data.leads?.conversion_rate || 0}%` },
    { label: 'RECURRING MRR', val: `₹${(data.finance?.mrr || 0).toLocaleString('en-IN')}/mo`, sub: `${data.projects?.total || 0} Projects Active` },
    { label: 'WHATSAPP CONVERSATIONS', val: `${data.whatsapp?.total_conversations || 0} Chats`, sub: `AI: ${data.whatsapp?.ai_count || 0} · Human: ${data.whatsapp?.human_count || 0}` }
  ]

  let startX = 45
  let startY = 125
  const cardW = 118
  const cardH = 65

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    const x = startX + i * (cardW + 11)
    doc.rect(x, startY, cardW, cardH).fill('#f8fafc')
    doc.strokeColor('#cbd5e1').rect(x, startY, cardW, cardH).stroke()

    doc.fillColor('#64748b').fontSize(7.5).font('Helvetica-Bold').text(c.label, x + 8, startY + 8, { width: cardW - 16 })
    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text(c.val, x + 8, startY + 24, { width: cardW - 16 })
    doc.fillColor('#3b82f6').fontSize(7.5).font('Helvetica').text(c.sub, x + 8, startY + 46, { width: cardW - 16 })
  }

  // Section 1: Financial Health
  let curY = 215
  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('1. Financial Performance & Cashflow', 45, curY)
  curY += 18

  const finRows = [
    ['Total Invoiced Amount', `₹${(data.finance?.total_invoiced || 0).toLocaleString('en-IN')}`],
    ['Total Confirmed Collections', `₹${(data.finance?.total_collected || 0).toLocaleString('en-IN')}`],
    ['Outstanding Receivables', `₹${(data.finance?.total_outstanding || 0).toLocaleString('en-IN')}`],
    ['Total Operating Expenses', `₹${(data.finance?.total_expenses || 0).toLocaleString('en-IN')}`],
    ['Net Profit Margin', `${data.finance?.profit_margin || 0}%`]
  ]

  for (const r of finRows) {
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(r[0], 55, curY)
    doc.fillColor('#0f172a').font('Helvetica-Bold').text(r[1], 420, curY, { width: 120, align: 'right' })
    doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(45, curY + 16).lineTo(550, curY + 16).stroke()
    curY += 20
  }

  // Section 2: Operational Health
  curY += 20
  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('2. Agency Operations & Pipelines', 45, curY)
  curY += 18

  const opRows = [
    ['Active Client Projects', `${data.projects?.in_development || 0} In Progress (${data.projects?.total || 0} Total)`],
    ['Project Deliverable Tasks', `${data.projects?.tasks_completed || 0} Completed / ${data.projects?.tasks_total || 0} Total`],
    ['Scheduled Appointments', `${data.appointments?.upcoming_count || 0} Upcoming`],
    ['Client Follow-up Reminders', `${data.appointments?.followups_due || 0} Due`],
    ['Automation Engine (n8n)', data.automation?.healthy ? '100% Operational (0 Errors)' : 'Review Workflow Errors']
  ]

  for (const r of opRows) {
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(r[0], 55, curY)
    doc.fillColor('#0f172a').font('Helvetica-Bold').text(r[1], 350, curY, { width: 190, align: 'right' })
    doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(45, curY + 16).lineTo(550, curY + 16).stroke()
    curY += 20
  }

  // Footer
  const footerY = 750
  doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(45, footerY).lineTo(550, footerY).stroke()
  doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(
    'The Business Work — Confidential Internal Management Document. Generated via automated analytics engine.',
    45,
    footerY + 10
  )

  doc.end()
}
