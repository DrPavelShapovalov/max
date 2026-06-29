---
name: pdf-reader
description: >
  Convert any uploaded PDF to Markdown and work with its content.
  MANDATORY TRIGGER: whenever the user uploads or references a PDF file,
  DOC, DOCX, PPTX, XLSX or any document file. Automatically run pdf2md.py
  on the file BEFORE attempting to read or analyze it. Never try to read
  binary document files directly — always convert first.
---

# PDF & Document Reader

## Rule: Always Convert Before Reading

When the user uploads or mentions a PDF (or any document), **immediately**:

1. Find the file path (usually `/root/.claude/uploads/<session>/<filename>`)
2. Run the converter:
   ```bash
   python3 /home/user/max/pdf2md.py "<path>" /tmp/converted.md
   ```
3. Read `/tmp/converted.md`
4. Work with the extracted text

## Supported Formats (PyMuPDF backend)

| Format | Command |
|--------|---------|
| PDF | `python3 pdf2md.py file.pdf` |
| DOCX | use `python-docx` |
| Images | PyMuPDF renders pages as images |

## Quick Convert Script

```bash
python3 /home/user/max/pdf2md.py /root/.claude/uploads/<session>/<file>.pdf /tmp/doc.md && cat /tmp/doc.md
```

## For Dissertation Work (Романенко А.П.)

When Павел Игоревич uploads a PDF (статья, глава, рецензия):
1. Convert immediately without asking
2. Extract key data: authors, year, title, findings relevant to МЧК/расщелина
3. Cross-reference with existing 149 sources in context
4. Flag if it's a new source worth adding to the bibliography

## Error Handling

- If PyMuPDF fails → try `pdftotext` (poppler): `pdftotext file.pdf -`
- If text is empty → PDF is scanned image, report to user
- Never report "cannot read PDF" without trying the converter first
