// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/hide-empty-stored-shapes",
    author: "Star",
    name: "Hide Empty Stored Shapes",
    version: "1.1.1",
    id: "hide-empty-stored-shapes",
    description: "Removes shapes with zero stock from storage when the Statistics list is rebuilt.",
    minimumGameVersion: ">=1.5.0",
};

// Deletes shapes with zero stock from hubGoals.storedShapes whenever the Statistics list is rebuilt.
// The game never removes a key once a shape was stored, so the savegame and every scan over the
// keys keep growing. A missing key reads as 0 everywhere (`storedShapes[key] || 0`).
class Mod extends shapez.Mod {
    init() {
        this.modInterface.replaceMethod(shapez.HUDStatistics, "rerenderFull", function ($original, args) {
            const stored = this.root.hubGoals.storedShapes;
            for (const key of Object.keys(stored)) {
                if (!(stored[key] > 0)) {
                    delete stored[key];
                }
            }
            return $original.apply(this, args);
        });
    }
}
