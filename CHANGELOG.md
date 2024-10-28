# Change Log

All notable changes to the "vscode-chss" extension will be documented in this file.  
Some less notable ones too.

## [0.4.2]
- Huge performance improvements:
  * Reapplying styles without recalculating them if there was no change in an inactive editor.
  * Global caching of TextDecorations to eliminate duplicate styles
- Match rules now support quoted content, e.g `<*="variableName">`. In fact, quoting is now the preferred approach.
## [0.4.1]
- Initial public release.
