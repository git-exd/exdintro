#!/usr/bin/env python3
"""Pages of the PDF of the deck: one page per slide, full page, with the animations over.

    python3 tools/pdf.py

As tools/pdf.py in git-exd/exd-presentazioni: every slide is photographed with Chrome at 2880×1620 and made a page.
Here every slide is saved as its own one-page PDF in pdf/pages, with pdf/manifest.json (slide label → pages;
alt: the case slides without their number, for the visitors who see the cases in another order):
server.js (/deck.pdf) joins them in the order of the cases of each visitor, without the hidden ones.
To be run again after every change to views/deck.html, before the push.

Needs: Google Chrome; Node.js with playwright-core (once: cd tools && npm install); Python with Pillow
(pip install pillow); the .env with JWT_SECRET. Chrome elsewhere: CHROME=/path/to/chrome.
"""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit("Pillow is needed: pip install pillow")
    out = ROOT / "pdf"
    pages = out / "pages"
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["node", str(ROOT / "tools" / "pdf-capture.mjs"), tmp], check=True)
        shots = json.loads((Path(tmp) / "shots.json").read_text())
        if pages.exists():
            shutil.rmtree(pages)
        pages.mkdir(parents=True)
        manifest, alt = {}, {}
        def page(f):
            name = Path(f).stem + ".pdf"
            Image.open(Path(tmp) / f).convert("RGB").save(pages / name, resolution=216, quality=88)
            return name
        for s in shots:
            manifest[s["label"]] = [page(f) for f in s["files"]]
            if s.get("alt"):
                alt[s["label"]] = [page(f) for f in s["alt"]]
        title = re.search(r"<title>(.*?)</title>", (ROOT / "views" / "deck.html").read_text(encoding="utf-8"))
        (out / "manifest.json").write_text(json.dumps({"title": title.group(1) if title else ".exd", "pages": manifest, "alt": alt}, indent=1, ensure_ascii=False))
    size = sum(f.stat().st_size for f in pages.glob("*.pdf"))
    print(f"pdf/pages: {len(list(pages.glob('*.pdf')))} pages, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
