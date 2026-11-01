// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/compact-saves",
    author: "Star",
    name: "Compact Saves",
    version: "1.0.1",
    id: "compact-saves",
    description:
        "Makes saving and loading a game with many compressed factories much faster: the buildings inside each factory are written compressed instead of as text. Needs the Factory Compressor mod, which also reads these saves if this mod is removed.",
    minimumGameVersion: ">=1.5.0",
    doesNotAffectSavegame: false,
};

const BOX_ID = "FactoryBox"; // the id of the Factory Compressor's component
const MIN_LENGTH = 2000; // smaller factories are not worth compressing

const packed = new Map(); // blob -> compressed, so each blob is compressed once

function compressedBlob(comp, blob) {
    // The box remembers its pair (also after loading a compact save)
    if (comp.blobSrc === blob && typeof comp.blobPacked === "string") return comp.blobPacked;
    let z = packed.get(blob);
    if (z === undefined) {
        z = shapez.compressX64(blob);
        packed.set(blob, z);
    }
    comp.blobSrc = blob;
    comp.blobPacked = z;
    return z;
}

let patched = false;

// Wraps the box's serialize(): the original runs without the blob (so the big
// text is never turned into JSON again), then the compressed blob is put in front
function patchBox() {
    if (patched) return;
    const registry = shapez.gComponentRegistry;
    if (!registry || !registry.hasId(BOX_ID)) return;
    const box = registry.idToEntry[BOX_ID];
    if (!box || !box.prototype || typeof box.prototype.serialize !== "function") return;
    patched = true;
    const original = box.prototype.serialize;
    box.prototype.serialize = function () {
        const state = this.state;
        if (!state || typeof state.blob !== "string" || state.blob.length < MIN_LENGTH) {
            return original.call(this);
        }
        const blob = state.blob;
        let payload;
        state.blob = undefined; // JSON leaves it out
        try {
            payload = original.call(this);
        } finally {
            state.blob = blob;
        }
        const rest = payload && payload.data;
        if (typeof rest !== "string" || rest.charAt(0) !== "{") {
            return original.call(this); // not the shape we know: write it the usual way
        }
        const z = JSON.stringify(compressedBlob(this, blob));
        payload.data = '{"blobZ":' + z + (rest.length > 2 ? "," : "") + rest.slice(1);
        this.data = payload.data;
        return payload;
    };
}

class Mod extends shapez.Mod {
    init() {
        patchBox();
        // The Factory Compressor may start after this mod: look again before every save
        this.modInterface.replaceMethod(shapez.SavegameSerializer, "generateDumpFromGameRoot", function ($original, args) {
            patchBox();
            return $original(...args);
        });
    }
}
