# shapez-mods

Star's own shapez mods. One folder per mod: `<mod>/<file>.js` (single-file mod, `METADATA` at the top), `README.md`, optional `images/`.
Mods by others live in sibling repos, not here. The game loads mods from `%APPDATA%\shapez.io\mods` - copy the `.js` there to test.
When adding or restructuring a mod, update the table in `README.md` too.

- `status-display` - wire values panel.
- `multi-edit-buildings` - batch edit of building settings.
- `balancer-variants-industries-compat` - balancer compat.
- `perf-monitor` - plain-language (en/he) load panel (F7 hide, F9 details), building-limit estimate, 15s system profiler (F8). Times `GameCore.updateLogic`/`draw` via before/after hooks; the profiler temporarily wraps `systemMgr.systems[id].update`. Panel needs z-index above the game canvas (100).
- `full-speed-ejectors` - patches `ItemEjectorComponent.tryEject` so items start at progress ~1 whenever the slot has a target (belt or building), removing the tick-rate/2 output cap. Belt readers are item processors, so reader-next-to-building links hit the cap too.
- `factory-compressor` - compresses a Ctrl+dragged factory (K) into one box that runs a live model of it. Saved in the savegame (`FactoryBox` component). Exposes the Building Costs hook `window.buildingCostsExtra`.
- `compact-saves` - optional writer for Factory Compressor: stores each box's buildings compressed. Factory Compressor reads these saves on its own.
- `shape-vault` - second storage next to the Hub (kept in the save's `modExtraData`), extractors, level sensor, F6 statistics. Pays through `window.shapeVaultWallet` for Building Costs.
- `hide-empty-stored-shapes` - deletes zero-stock keys from `hubGoals.storedShapes` when the Statistics list is rebuilt.
