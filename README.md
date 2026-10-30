# HP Bar Numbers v0.5.0

Displays current/max HP inside the native D&D 5e token HP bar, with the existing visual-only height adjustment.

## Compatibility target
- Foundry VTT v14
- D&D 5e system 6.x

## Changes in v0.5.0
- Updated the manifest for Foundry v14.
- Adapted rendering-hook installation to support Foundry v14's generic Token `_drawBar` method, while retaining the legacy `_drawHPBar` fallback.
- In the generic renderer, the label and visual adjustment are applied only when the configured bar attribute is `attributes.hp`.
- Reset the module's saved visual transform before redrawing to prevent cumulative vertical scaling/position drift.

## Installation
1. Extract the `hp-bar-numbers` folder into your Foundry `Data/modules` directory.
2. Reload the world.
3. Enable **HP Bar Numbers** in Manage Modules.

Runtime compatibility still needs testing in Foundry v14 with D&D 5e 6.x.
