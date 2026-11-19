/**
 * Create test fixture PDFs for Phase 5 test suite.
 * Run once: npx tsx src/scripts/fixtures/createFixtures.ts
 */
import fs from 'fs';
import path from 'path';

const fixtureDir = path.join(__dirname);

// Ensure fixture directory exists
fs.mkdirSync(fixtureDir, { recursive: true });

// ----------------------------------------------------------------
// Fixture 1: Minimal valid 2-page PDF with extractable text
// ----------------------------------------------------------------
// Raw PDF generated manually using correct byte offsets
// Using simple page content streams with Helvetica font
function buildTwoPagePdf(): Buffer {
  const lines: string[] = [];

  const push = (s: string) => lines.push(s);

  push('%PDF-1.4');
  // Object 1: Catalog
  const off1 = lines.join('\n').length + 1;
  push('1 0 obj');
  push('<< /Type /Catalog /Pages 2 0 R >>');
  push('endobj');
  push('');

  // Object 2: Pages
  const off2 = lines.join('\n').length + 1;
  push('2 0 obj');
  push('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  push('endobj');
  push('');

  // Stream for page 1
  const stream1 = 'BT /F1 12 Tf 72 720 Td (Page one test content here.) Tj ET\n';
  // Object 3: Page 1
  const off3 = lines.join('\n').length + 1;
  push('3 0 obj');
  push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]');
  push('   /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
  push('endobj');
  push('');

  // Object 4: Stream for page 1
  const off4 = lines.join('\n').length + 1;
  push('4 0 obj');
  push(`<< /Length ${stream1.length} >>`);
  push('stream');
  push(stream1 + 'endstream');
  push('endobj');
  push('');

  // Object 5: Page 2
  const stream2 = 'BT /F1 12 Tf 72 720 Td (Page two test content here.) Tj ET\n';
  const off5 = lines.join('\n').length + 1;
  push('5 0 obj');
  push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]');
  push('   /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
  push('endobj');
  push('');

  // Object 6: Stream for page 2
  const off6 = lines.join('\n').length + 1;
  push('6 0 obj');
  push(`<< /Length ${stream2.length} >>`);
  push('stream');
  push(stream2 + 'endstream');
  push('endobj');
  push('');

  // Object 7: Font
  const off7 = lines.join('\n').length + 1;
  push('7 0 obj');
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  push('endobj');
  push('');

  const xrefOffset = lines.join('\n').length + 1;
  push('xref');
  push('0 8');
  const fmt = (n: number) => String(n).padStart(10, '0');
  push(`0000000000 65535 f `);
  push(`${fmt(off1)} 00000 n `);
  push(`${fmt(off2)} 00000 n `);
  push(`${fmt(off3)} 00000 n `);
  push(`${fmt(off4)} 00000 n `);
  push(`${fmt(off5)} 00000 n `);
  push(`${fmt(off6)} 00000 n `);
  push(`${fmt(off7)} 00000 n `);
  push('');
  push('trailer');
  push('<< /Size 8 /Root 1 0 R >>');
  push('startxref');
  push(String(xrefOffset));
  push('%%EOF');

  return Buffer.from(lines.join('\n'));
}

// Write fixture files
fs.writeFileSync(path.join(fixtureDir, 'valid-two-page.pdf'), buildTwoPagePdf());
console.log('Created: valid-two-page.pdf');

// Malformed PDF (truncated/corrupt structure)
fs.writeFileSync(
  path.join(fixtureDir, 'malformed.pdf'),
  Buffer.from('%PDF-1.4\n1 0 obj\n<< INVALID GARBAGE >>\nendobj\n%%EOF')
);
console.log('Created: malformed.pdf');

// PDF with no text layer (image-only / empty page)
// Valid structure but content stream draws nothing (no text operators)
const emptyStream = 'q Q\n'; // push/pop graphics state only
const emptyPdfLines = [
  '%PDF-1.4',
  '1 0 obj',
  '<< /Type /Catalog /Pages 2 0 R >>',
  'endobj',
  '2 0 obj',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  'endobj',
  '3 0 obj',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>',
  'endobj',
  '4 0 obj',
  `<< /Length ${emptyStream.length} >>`,
  'stream',
  emptyStream + 'endstream',
  'endobj',
  'xref',
  '0 5',
  '0000000000 65535 f ',
  '0000000009 00000 n ',
  '0000000058 00000 n ',
  '0000000111 00000 n ',
  '0000000230 00000 n ',
  '',
  'trailer',
  '<< /Size 5 /Root 1 0 R >>',
  'startxref',
  '295',
  '%%EOF',
];
fs.writeFileSync(
  path.join(fixtureDir, 'no-text.pdf'),
  Buffer.from(emptyPdfLines.join('\n'))
);
console.log('Created: no-text.pdf');

console.log('\nAll test fixtures created successfully in:', fixtureDir);
