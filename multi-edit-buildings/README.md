# Multi-Edit Buildings

**Change the settings of dozens of buildings in one go instead of clicking them one by one.**

## Why you want it

In shapez, every Signal Generator, Teleporter, Transceiver, Custom Storage and Note has its own setting, and the only way to change it is to click each building and type the value again. Copy a big blueprint and you end up with 40 teleporters still on the old channel, or 16 signal generators that all need a different shape - and a lot of tedious clicking.

With this mod you select them all with the normal mass selector (Ctrl+drag) and edit them together:

- **Re-channel a copied blueprint in seconds** - Find & Replace on teleporter/transceiver channels, e.g. turn `A1`, `A2`, `A3` into `B1`, `B2`, `B3` in one step.
- **Set many signal generators at once** - give them all the same value, or Find & Replace inside the shape code (Find `u`, Replace `R` turns `CuCuCuCu` into `CRCRCRCR`).
- **Fill a row of signal generators with a sequence (Seq Fill)** - every generator gets the next shape/color automatically. Great for testing a machine against many shapes, building shape libraries, or sorting setups.
- **Set the limit of many Custom Storages** at once (a number or ∞).
- **Rewrite many notes** at once (text and font size).

## How to use

1. Select buildings with **Ctrl+drag** (also works with the [Multi Layer Copy](https://github.com/Star69995/shapezmod_multilayercopy) mod's selection).
2. A panel appears listing the editable building types in your selection, with their count.
3. Click **Edit all** next to a type, enter the new value, and confirm. Only buildings of that type are changed.

### Seq Fill options (Signal Generators)

- Which shapes and colors to use - only ones that exist in your game are offered.
- Quadrant pattern: `#` = filled, `-` = empty (e.g. `####`, `#---`, `#-#-`), or the 1q-4q quick buttons.
- Fill direction on the map: ← L, R →, ↑ U, ↓ D.
- Whether colors or shapes change first, which item to start at, how many generators in a row repeat each value.
- Or just type a custom space-separated list of codes.

Your last Seq Fill settings are remembered.

## Supported buildings

| Building | What you can edit | Needs mod |
|---|---|---|
| Signal Generator | Value (overwrite or Find & Replace), Seq Fill | - (base game) |
| Teleporter input / output | Channel (overwrite or Find & Replace) | [Item Teleporter](https://mod.io/g/shapez/m/item-teleporter) |
| Transceiver | Channel (overwrite or Find & Replace) | [Pnmod Transceiver](https://mod.io/g/shapez/m/pnmod-transceiver) |
| Custom Storage | Storage limit (1-99999 or ∞) | [Custom Storage v2](https://github.com/Star69995/Shapez.io-Mods) |
| Note Building | Text and font size | [In-Game Notes](https://github.com/derekShaheen/Shapez.io-Mods) |

Types from other mods only show up when that mod is installed.

## Installation

Download the `.js` file, put it in your shapez.io `mods` folder (on Windows: `%APPDATA%\shapez.io\mods`) and restart the game.

## Author

Made by **Star** ([Star69995](https://github.com/Star69995)). MIT License - see [LICENSE](../LICENSE).
