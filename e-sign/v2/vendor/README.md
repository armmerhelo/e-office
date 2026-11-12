# e-sign v2 browser dependencies

Vendored so the isolated test page does not depend on a CDN or on files that
belong to the in-flight v1 work.

| File | Version | License |
| --- | --- | --- |
| `pdf.min.js` | PDF.js 4.10.38 | Apache-2.0 (license header retained) |
| `pdf.worker.min.js` | PDF.js 4.10.38 | Apache-2.0 (license header retained) |
| `pdf-lib.min.js` | PDF-lib 1.17.1 | MIT (license header retained) |

`pdf.min.js` is the ES-module build. It is imported from `app.js` and the
worker URL is resolved with `import.meta.url`. The files keep the `.js`
extension because the deployment allowlist accepts `.js` but not `.mjs`.
