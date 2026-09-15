# Hallmark review — 2026-09-15

- Pre-emit critique: Philosophy 4, Hierarchy 5, Execution 4, Specificity 5, Restraint 5, Variety 4.
- Terminal / Workbench live-tool adaptation; first Hallmark run. Nav N8, footer Ft4.
- Applicable visual, typography, interaction, token, contrast and mobile checks passed.
- Checked actual Unraid Chromium screenshots at 320 / 375 / 414 / 768 / 1440 px; laptop CTA visible at 1280×800.
- Fixed missing Linux font glyphs by replacing the conversion arrow and copy glyph with inline SVG.
- 20 Playwright checks passed with no retries, plus 2 production LAN HTTP smoke checks.
- 53 existing core tests passed; core lines coverage 92.87%.
- Font notices emitted as dist/licenses assets by vite.config.ts.
- Core conversion code, package versions, Dockerfile and nginx.conf remain at upstream 0b1486c.
- Unraid compose settings moved into ignored compose.override.yaml; upstream compose.yaml restored exactly before redesign.
