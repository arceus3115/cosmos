# Graph visualization package evaluation

*Evaluated 6 November 2026 for the Religion Almanac browser map.*

## Current graph and constraints

The Explore interface in `app.js` draws the graph directly in SVG. It uses curated node coordinates, custom node cards and labels, curved directed links, tradition-group outlines, evidence-aware filters, a synchronized inspector, and URL-backed pan/zoom state. The current sample is small (18 records), and its editorial arrangement is part of the reading experience.

A renderer should preserve the difference between `part_of` context and cited influence, keep node identity and selection stable, and make room for readable labels and tradition clusters. An automatic layout should suggest coordinates; it should not silently rewrite curated positions.

## Candidate packages

| Package | What it provides | Fit here | Tradeoff |
| --- | --- | --- | --- |
| **D3 modules** (`d3-selection`, `d3-zoom`, optionally `d3-force`) | Low-level SVG/Canvas interaction and layout building blocks. `d3-zoom` handles mouse, touch, pan, and zoom across SVG, HTML, or Canvas; `d3-force` computes force-directed positions. | **Best incremental option.** Add `d3-zoom` to improve gesture handling while keeping the custom SVG and hand-positioned map. Add `d3-force` only for an optional “suggest layout” mode. | D3 does not provide a complete graph widget. We keep responsibility for semantic filters, node/edge styling, selection, labels, keyboard behavior, and the inspector. Force simulations mutate node coordinates, so they should not overwrite the saved editorial layout. |
| **Cytoscape.js** | A complete interactive network renderer, graph selectors and events, built-in gestures, graph algorithms, and pluggable layouts. Its `preset` layout accepts curated coordinates. | **Best full-renderer candidate** if graph filtering, selection, and graph analysis become difficult to maintain in the custom renderer. A prototype can map existing node coordinates and edge semantics directly. | Recreating the current card-like nodes, tradition envelopes, typography, and custom curve treatment would be a visual migration. It can retain preset positions, but the current design still needs styling and behavior work. |
| **Sigma.js + Graphology** | Sigma renders graphology data with WebGL; Graphology supplies directed/mixed graph structures, algorithms, layout helpers, and change events. Sigma targets graphs with thousands of nodes and edges. | **Scale-up option** if graph size or redraw cost becomes a measured problem. Graphology could also become a shared graph model if client-side graph algorithms grow. | WebGL favors dense networks; it is not a drop-in replacement for the current detailed SVG labels and cluster outlines. For 18 curated records it adds complexity without solving a current problem. |
| **Dagre or ELK.js** | Layout engines only. Dagre arranges directed graphs; ELK.js computes layered and other diagram layouts, including layouts suitable for directed links and ports. | **Useful for layout suggestions** on adaptation chains or an import/review view. Keep the existing renderer and project generated coordinates back into its SVG. | Neither package renders the map or handles the Almanac's interaction model. ELK.js is the heavier choice; use it only when Dagre's layered layout is not expressive enough. |

## Recommendation

Keep the custom SVG renderer for the current product surface. Vite now provides the module workflow and hot reload needed to experiment safely. If pan/zoom behavior needs improvement, try `d3-zoom` first as a small isolated change. Consider Dagre for an optional directed-layout suggestion. Revisit Cytoscape.js if graph operations become the main maintenance burden, and Sigma.js only if the graph grows enough to justify a WebGL renderer.

No graph-renderer dependency is installed yet. That keeps the current visual map intact while making future experiments straightforward through Vite's npm module imports.

## Official references

- [Vite features and HMR](https://vite.dev/guide/features)
- [D3 zoom](https://d3js.org/d3-zoom)
- [D3 force simulation](https://d3js.org/d3-force/simulation)
- [Cytoscape.js documentation](https://js.cytoscape.org/)
- [Sigma.js quickstart](https://www.sigmajs.org/get-started/quickstart/)
- [Graphology documentation](https://graphology.github.io/)
- [Dagre](https://github.com/dagrejs/dagre)
- [ELK.js](https://github.com/kieler/elkjs)
