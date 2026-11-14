/** Synthetic two-page PDF; contains no user files or account data. */
export function pdfBytes() {
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>', '', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for (const [index, text] of [[3, 'First page independent fixture'], [5, 'Second page independent fixture']]) { const stream = `BT /F1 20 Tf 30 440 Td (${text}) Tj ET`; objects[index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`; }
 let pdf = '%PDF-1.7\n', offsets = [0]; objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
 pdf += '%' + 'padding '.repeat(75000) + '\n';
 const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(pdf);
}
