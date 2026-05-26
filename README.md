# .exd — Introduction Deck

Single-file HTML presentation deck for **.exd**, the agency that designs and builds modern growth engines.

## Run locally

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080/> in your browser.

## Structure

- `index.html` — the deck itself (25 slides)
- `deck-stage.js` — the `<deck-stage>` web component that drives layout, scaling, keyboard navigation and print
- `exd/` — design system assets (colors, type, fonts, logos, imagery)

## Keyboard

- `→` / `Space` / `PageDown` — next slide
- `←` / `PageUp` — previous slide
- `Home` / `End` — jump to first / last
- `R` — reset to slide 1
- `1`-`9` — jump to a specific slide

## Print to PDF

Use the browser's **Print → Save as PDF**. The deck-stage component automatically lays out each slide as a full page at the authored design size (1920×1080).
