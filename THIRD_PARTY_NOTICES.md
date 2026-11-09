# Third-party notices

## Temporary bot mascot

The temporary SVG mascot vendors the framework-independent engine from
[`jeremy-prt/bloub`](https://github.com/jeremy-prt/bloub), Copyright (c) 2026 Jérémy Perret,
made available under the MIT License. Bloub recreates the visual behaviour of the x.ai bot avatar;
Grok and x.ai belong to their respective owners. The mascot in nod is intentionally isolated so it
can be replaced by nod's own identity.

Source revision: b4bb3c1b5f93c7b87a2e8d620f667c4093d97749.
Sources and full MIT license: web/vendor/bloub/.
Local adaptations: explicit .ts import extensions; optional animateRest parameter in
BotEngine.sample (default unchanged) to disable wandering/blinking/breathing for nod's fixed idle pose.
The neutral expression is calibrated in web/lib/mascote-pose.ts to the supplied static reference.
The SVG renderer and DOM lifecycle adapter live in web/lib/mascote-svg.ts and
web/lib/mascote-elemento.ts. No Vue runtime is included.

## Geist and Geist Mono fonts

The web interface serves the Geist and Geist Mono variable fonts (latin and latin-ext subsets,
`web/public/fontes/`), Copyright 2024 The Geist Project Authors
(https://github.com/vercel/geist-font), licensed under the SIL Open Font License 1.1. Files taken from
the `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` packages, version 5.3.0.
Full license: web/public/fontes/OFL-geist.txt.

## PDF.js (file preview)

The in-browser PDF preview (ADR-120) uses [`pdfjs-dist`](https://github.com/mozilla/pdf.js) version 6.4.299,
Copyright Mozilla Foundation and contributors, licensed under the Apache License 2.0
(https://www.apache.org/licenses/LICENSE-2.0). It is a web runtime dependency loaded on demand (dynamic `import()`)
only when a PDF preview is opened; the worker is served as a static asset. No modifications. Full license ships
with the package in node_modules/pdfjs-dist/LICENSE.

## ws (WebSocket server)

The voice call channels (ADR-071) use [`ws`](https://github.com/websockets/ws), Copyright (c) 2011 Einar Otto
Stangvik, Copyright (c) 2013 Arnout Kazemier and contributors, licensed under the MIT License, as a server-side runtime
dependency only (the desktop app uses the built-in WebSocket client).

## whisper.cpp and macOS `say` (development only)

The free local voice provider for development (`NOD_VOZ_STT=local`, `NOD_VOZ_TTS=local`) calls a separately installed
[`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) (`brew install whisper-cpp`, MIT License) with the
`ggml-base-q5_1.bin` model, and the macOS `say` command. Neither is bundled with nod or used in production.

## Mermaid (diagrams in the bot's message, NOD-328)

The web interface draws ```` ```mermaid ```` blocks with [`mermaid`](https://github.com/mermaid-js/mermaid) 12.2.0,
Copyright (c) 2014-2022 Knut Sveidqvist, licensed under the MIT License. It runs only inside a sandboxed iframe and
ships as a separate bundle (`dist/web/diagrama/sandbox.js` plus chunks in `dist/web/assets/`), loaded on demand. The
bundle includes code from mermaid's runtime dependencies, under their own licenses:

- MIT: `@mermaid-js/parser`, `@braintree/sanitize-url`, `@iconify/utils`, `@upsetjs/venn.js`, `cytoscape`,
  `cytoscape-cose-bilkent`, `cytoscape-fcose`, `cose-base`, `layout-base`, `dagre-d3-es`, `dayjs`, `es-toolkit`,
  `katex`, `khroma`, `lodash-es`, `marked`, `roughjs` (with `hachure-fill`, `path-data-parser`, `points-on-curve`,
  `points-on-path`), `stylis`, `ts-dedent`, `uuid`.
- ISC: `d3` and its `d3-*` modules, `internmap`, `delaunator`.
- BSD-3-Clause: `d3-ease`, `d3-sankey`, `rw`.
- Apache-2.0: `chevrotain` and its `@chevrotain/*` modules.
- MPL-2.0 OR Apache-2.0 (used under Apache-2.0): `dompurify`.
- EPL-2.0: `elkjs` (unmodified; source at https://github.com/kieler/elkjs). nod locks the layout to dagre, so the ELK
  chunk is shipped but not loaded.
- Unlicense: `robust-predicates`.

Full license texts are in each package under `node_modules/` at the versions pinned in `package-lock.json`.

## Lima (local VM on macOS)

When built with `NOD_VM_LOCAL=1` (NOD-93, ADR-123, ADR-127), the macOS app bundles, in `Contents/Resources/vm-local`,
[Lima](https://github.com/lima-vm/lima) 2.2.1 (`limactl` and the Linux guest agent), Copyright The Lima Authors, licensed under the
Apache License 2.0 and redistributed unmodified (re-signed for notarization). Pinned by sha256 in
`scripts/desktop/vm-local-binarios.ts`. Full license: `Contents/Resources/vm-local/LICENSE`.

## noVNC

The live screen of the bot's computer (`web/lib/tela-vivo.ts`, NOD-95, ADR-138) uses the noVNC client
(`@novnc/novnc` 1.7.0, https://github.com/novnc/noVNC), Copyright (C) 2019 The noVNC Authors, licensed
under the Mozilla Public License 2.0. It is consumed unmodified as an npm dependency; the MPL-2.0 text
ships in `node_modules/@novnc/novnc/LICENSE.txt`. The server side uses `x11vnc` (GPL-2.0) as a separate
process on the person's machine, never linked into nod.
