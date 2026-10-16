// PDF.js ships no declarations for its worker half; only this is read from it.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
