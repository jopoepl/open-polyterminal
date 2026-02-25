# PolyTerminal Color Themes

## Design Principles

Based on terminal color research (see: blog.xoria.org/terminal-colors/):

1. **Contrast is king** - Text must be readable, not just aesthetically pleasing
2. **Avoid problematic combinations** - Light yellows on white, blues that disappear
3. **Trading colors (green/red)** - Must be instantly distinguishable and high contrast
4. **Dim text** - Should still meet minimum contrast ratios (~4.5:1 for WCAG AA)
5. **Accent colors** - Should pop without being harsh on the eyes

---

## Option C: High Contrast (Purple Accent)

**Status**: Approved candidate

```css
html[data-theme='light'] {
  --bg: #f8fafc;
  --bg-elev: #ffffff;
  --panel: #ffffff;
  --panel-2: #f1f5f9;
  --border: #cbd5e1;
  --text: #0f172a;
  --text-dim: #475569;
  --text-bright: #020617;
  --accent: #8b5cf6;
  --accent-2: #06b6d4;
  --green: #22c55e;
  --red: #ef4444;
  --yellow: #eab308;
  --shadow: rgba(15, 23, 42, 0.1);
}
```

**Characteristics**:
- Sharp, high contrast for readability
- Purple/violet primary accent (`#8b5cf6`)
- Cyan secondary accent (`#06b6d4`)
- Bright, vibrant green and red for trading signals
- Slate-based neutrals with good definition
- Stronger shadow for depth

**Hardcoded accent rgba**: `rgba(139, 92, 246, ...)`

**Contrast notes**:
- `--text` (#0f172a) on white: ~15:1 ✓ Excellent
- `--text-dim` (#475569) on white: ~6:1 ✓ Good
- `--green` (#22c55e) on white: ~2.5:1 ⚠️ Marginal for text
- `--red` (#ef4444) on white: ~3.5:1 ⚠️ Acceptable but could be stronger

---

## Option C-Refined: High Contrast (Improved Readability)

**Status**: Candidate - darker trading colors for better contrast

```css
html[data-theme='light'] {
  --bg: #f8fafc;
  --bg-elev: #ffffff;
  --panel: #ffffff;
  --panel-2: #f1f5f9;
  --border: #cbd5e1;
  --text: #0f172a;
  --text-dim: #475569;
  --text-bright: #020617;
  --accent: #7c3aed;       /* Slightly deeper violet */
  --accent-2: #0891b2;     /* Deeper cyan */
  --green: #15803d;        /* Darker green - 4.5:1 contrast */
  --red: #dc2626;          /* Darker red - 4.5:1 contrast */
  --yellow: #ca8a04;       /* Darker yellow */
  --shadow: rgba(15, 23, 42, 0.1);
}
```

**Changes from C**:
- Green: #22c55e → #15803d (better contrast for text)
- Red: #ef4444 → #dc2626 (better contrast for text)
- Accent: #8b5cf6 → #7c3aed (slightly richer purple)
- Cyan: #06b6d4 → #0891b2 (deeper, more readable)

**Hardcoded accent rgba**: `rgba(124, 58, 237, ...)`

---

## Option E: GitHub Light (Primer)

**Status**: Candidate

```css
html[data-theme='light'] {
  --bg: #f6f8fa;
  --bg-elev: #ffffff;
  --panel: #ffffff;
  --panel-2: #f6f8fa;
  --border: #d1d9e0;
  --text: #1f2328;
  --text-dim: #59636e;
  --text-bright: #1f2328;
  --accent: #0969da;
  --accent-2: #8250df;
  --green: #1a7f37;
  --red: #cf222e;
  --yellow: #9a6700;
  --shadow: rgba(31, 35, 40, 0.08);
}
```

**Characteristics**:
- GitHub's official Primer design system
- Blue primary accent (`#0969da`) - familiar, trustworthy
- Purple secondary (`#8250df`) - used for "done" states
- High contrast green (`#1a7f37`) and red (`#cf222e`)
- Clean, professional, widely tested for accessibility

**Hardcoded accent rgba**: `rgba(9, 105, 218, ...)`

Source: [GitHub Primer Primitives](https://github.com/primer/primitives)
