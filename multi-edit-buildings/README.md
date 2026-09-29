# Multi-Edit Buildings

A [shapez](https://shapez.io/) mod: select buildings with the normal mass selector (Ctrl+drag), then edit their values **by building type, all at once**.

## Supported buildings

- Constant Signal (signal generators), including **Sequence Fill**
- Storage
- Custom Storage ([Skrip's](https://mod.io/g/shapez/m/custom-storage) or [Custom Storage v2](https://github.com/Star69995/Shapez.io-Mods))
- Teleporter input/output ([Item Teleporter](https://mod.io/g/shapez/m/item-teleporter))
- Pnmod Transceiver ([Pnmod Transceiver](https://mod.io/g/shapez/m/pnmod-transceiver))
- Note Building ([Skrip's In-Game Notes](https://github.com/derekShaheen/Shapez.io-Mods))

Buildings from other mods are only offered when that mod is installed.

## Sequence Fill

Fills the selected Signal Generators with a sequence of values. It only uses shapes and colors registered in the game, and lets you choose:

- shapes and colors
- quadrant pattern (`#` = filled, `-` = empty, e.g. `####`, `#---`, `#-#-`)
- order (colors change first or shapes change first)
- start item and how many buildings in a row repeat each value
- or a custom space-separated list of codes

## Installation

Download the `.js` file, put it in your shapez.io `mods` folder (on Windows: `%APPDATA%\shapez.io\mods`) and restart the game.

## Author

Made by **Star** ([Star69995](https://github.com/Star69995)). MIT License - see [LICENSE](../LICENSE).
