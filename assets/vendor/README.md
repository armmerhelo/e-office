# Vendored browser libraries

Pinned files used by the E-Office signing workspace and SIYA NEWS Studio. All
libraries are served from this origin so editors do not depend on a CDN at
runtime.

| File | Version | Source | License |
| --- | --- | --- | --- |
| `pdfjs/pdf.min.js` | 4.10.38 | https://mozilla.github.io/pdf.js/ | `PDFJS-LICENSE.txt` |
| `pdfjs/pdf.worker.min.js` | 4.10.38 | https://mozilla.github.io/pdf.js/ | `PDFJS-LICENSE.txt` |
| `pdf-lib.min.js` | 1.17.1 | https://pdf-lib.js.org/ | `PDFLIB-LICENSE.txt` |
| `lucide.min.js` | 0.468.0 | https://lucide.dev/ | `LUCIDE-LICENSE.txt` |
| `konva.min.js` | 10.9.1 | https://www.konvajs.org/ | `KONVA-LICENSE.txt` |
| `jspdf.umd.min.js` | 2.5.2 | https://github.com/parallax/jsPDF | `JSPDF-LICENSE.txt` |

Do not replace these files with an unversioned `latest` URL or load them from a
third-party origin without a separate security review. The signing page keeps a
CDN fallback for PDF.js, PDF-lib and Lucide so a missing deployment asset
produces a recoverable error instead of a blank editor.
