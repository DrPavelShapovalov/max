#!/usr/bin/env python3
"""
PDF → Markdown converter (PyMuPDF backend).
Usage: python3 pdf2md.py file.pdf [output.md]
       python3 pdf2md.py file.pdf          # prints to stdout
"""
import sys
import fitz  # PyMuPDF


def pdf_to_markdown(path: str) -> str:
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        if text:
            pages.append(f"<!-- Page {i + 1} of {len(doc)} -->\n\n{text}")
    doc.close()
    return "\n\n---\n\n".join(pages)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 pdf2md.py input.pdf [output.md]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    md = pdf_to_markdown(pdf_path)

    if len(sys.argv) >= 3:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(md)
        print(f"Saved: {sys.argv[2]}")
    else:
        print(md)
