const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../lib/pricing');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

function orderFrom(items, coupon, total) {
  const checkout = pricing.computeTotals(items, coupon || '');
  return {
    id: 7001,
    date: '21/11/2026',
    customer: 'Characterization Customer',
    paymentMode: 'cash',
    status: 'completed',
    items: items,
    coupon: coupon || '',
    subtotal: checkout.subtotal,
    discount: checkout.discount,
    tax: checkout.tax,
    total: total === undefined ? checkout.total : total
  };
}

test('CURRENT BEHAVIOUR: checkout pricing applies HSN GST to post-discount line values', () => {
  const items = [
    { id: 1, name: 'Rice', hsn: '1006', price: 640, qty: 1 },
    { id: 8, name: 'Tea', hsn: '0902', price: 140, qty: 1 }
  ];

  assert.deepEqual(pricing.computeTotals(items, ''), {
    subtotal: 780,
    discount: 0,
    taxable: 780,
    tax: 57.2,
    cgst: 28.6,
    sgst: 28.6,
    total: 837.2,
    lines: [
      {
        id: 1,
        name: 'Rice',
        hsn: '1006',
        gstPercent: 5,
        gross: 640,
        discount: 0,
        taxable: 640,
        tax: 32,
        net: 672
      },
      {
        id: 8,
        name: 'Tea',
        hsn: '0902',
        gstPercent: 18,
        gross: 140,
        discount: 0,
        taxable: 140,
        tax: 25.2,
        net: 165.2
      }
    ]
  });
});

test('invoice total and GST breakdown match the amount billed', () => {
  const items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 640, qty: 1 },
    { id: 8, name: 'Tea', sku: 'BEV-001', hsn: '0902', price: 140, qty: 1 }
  ];
  const billed = pricing.computeTotals(items, '');
  const invoiceFigures = invoice.computeInvoiceFigures(orderFrom(items));

  assert.equal(invoiceFigures.subtotal, billed.subtotal);
  assert.equal(invoiceFigures.discount, billed.discount);
  assert.equal(invoiceFigures.tax, billed.tax);
  assert.equal(invoiceFigures.cgst, billed.cgst);
  assert.equal(invoiceFigures.sgst, billed.sgst);
  assert.equal(invoiceFigures.total, billed.total);
  assert.deepEqual(invoiceFigures.rows.map((row) => ({
    gstPercent: row.gstPercent,
    lineTax: row.lineTax
  })), billed.lines.map((line) => ({
    gstPercent: line.gstPercent,
    lineTax: line.tax
  })));
});

test('CURRENT BEHAVIOUR: printable invoice uses the HSN GST rates stored on order lines', () => {
  const items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 640, qty: 1 },
    { id: 8, name: 'Tea', sku: 'BEV-001', hsn: '0902', price: 140, qty: 1 }
  ];
  const figures = invoice.computeInvoiceFigures(orderFrom(items));

  assert.equal(figures.subtotal, 780);
  assert.equal(figures.tax, 57.2);
  assert.equal(figures.cgst, 28.6);
  assert.equal(figures.sgst, 28.6);
  assert.equal(figures.total, 837.2);
  assert.deepEqual(figures.rows.map((row) => ({ gstPercent: row.gstPercent, lineTax: row.lineTax })), [
    { gstPercent: 5, lineTax: 32 },
    { gstPercent: 18, lineTax: 25.2 }
  ]);
});

test('CURRENT BEHAVIOUR: SAVE10 invoice discount matches the checkout discount and total', () => {
  const items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 1020, qty: 1 }
  ];
  const checkout = pricing.computeTotals(items, 'SAVE10');
  const figures = invoice.computeInvoiceFigures(orderFrom(items, 'SAVE10'));

  assert.deepEqual({
    subtotal: checkout.subtotal,
    discount: checkout.discount,
    tax: checkout.tax,
    total: checkout.total
  }, {
    subtotal: 1020,
    discount: 102,
    tax: 45.9,
    total: 963.9
  });
  assert.deepEqual({
    subtotal: figures.subtotal,
    discount: figures.discount,
    tax: figures.tax,
    total: figures.total
  }, {
    subtotal: 1020,
    discount: 102,
    tax: 45.9,
    total: 963.9
  });
});

test('CURRENT BEHAVIOUR: GST reconciliation matches an invoice to the stored checkout totals', () => {
  const items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 640, qty: 1 }
  ];
  const order = orderFrom(items);
  const db = {
    orders: [order],
    products: [],
    customers: [],
    settlements: [],
    auditLog: []
  };

  const reconciliation = reports.getGstReconciliation(db);

  assert.equal(reconciliation.totalChecked, 1);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.equal(reconciliation.rows[0].ledgerTax, 32);
  assert.equal(reconciliation.rows[0].invoiceTax, 32);
  assert.equal(reconciliation.rows[0].ledgerTotal, 672);
  assert.equal(reconciliation.rows[0].invoiceTotal, 672);
  assert.equal(reconciliation.rows[0].matched, true);
});

test('CURRENT BEHAVIOUR: invoice HTML omits the reconciliation warning when totals match', () => {
  const items = [
    { id: 1, name: 'Rice', sku: 'GRN-001', hsn: '1006', price: 640, qty: 1 }
  ];
  const order = orderFrom(items);

  const html = invoice.render(order);

  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
  assert.match(html, /Invoice Total/);
});
