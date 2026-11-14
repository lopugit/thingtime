import * as pdfjs from 'pdfjs-dist';

/** Keep initialization on the executed path: this package is sideEffects:false,
 * so production bundlers may discard a top-level assignment beside a re-export. */
export function getPdfRuntime() {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  return pdfjs;
}
