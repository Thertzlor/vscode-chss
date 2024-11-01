# Change Log

All notable changes to the "vscode-chss" extension will be documented in this file.  
Some less notable ones too.

## [0.4.3]
- Added support for selecting multiple types and modifiers with a single selector by separating them with slashes.
  * For example: `[property/variable]` or `:declaration/readonly`
  * (I would have loved to implement this with `|` instead, but it would have broken the syntax highlighting.)
- Added support for the `::dark` and `::light` pseudo-classes to style light- and dark-themed versions of tokens respectively.
- Implemented a debouncer to limit style refreshes to once every 100ms.
- The `random()` color transformation no longer requires a preexisting color.
## [0.4.2]
- Huge performance improvements:
  * Reapplying styles without recalculating them if there was no change in an inactive editor.
  * Global caching of TextDecorations to eliminate duplicate styles
- Match rules now support quoted content, e.g `<*="variableName">`. In fact, quoting is now the preferred approach.
## [0.4.1]
- Initial public release.
