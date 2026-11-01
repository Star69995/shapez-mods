// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/factory-compressor",
    author: "Star",
    name: "Factory Compressor",
    version: "0.8.19",
    id: "factory-compressor",
    description:
        "Select a factory and press K to compress it into one building that runs a light model of it, so the game no longer simulates every belt and machine in it. The box takes the shapes that really arrive (belts, teleporters, Hub) and puts out what the factory would, at the current upgrade speeds. Inputs and outputs that depend on the outside - Hub Extractors, teleporters and Micro Hubs - are never compressed; they stay real buildings at the edge of the box. It shows its name, what it takes and puts out, and whether it runs at full capacity or needs more of a shape. Click it to name it or unpack the original factory (or select several with Ctrl + drag and unpack them all at once); copy and paste it like a building. Compressing costs blueprint shapes, like pasting a blueprint.",
    minimumGameVersion: ">=1.5.0",
    doesNotAffectSavegame: false,
};

////////////////////////////////////////////////////////////////////////
// Constants

const BOX_COMPONENT_ID = "FactoryBox";
const BOX_BUILDING_ID = "factoryCompressorBox";

// Largest area (in tiles) a single compressed factory may cover
const MAX_REGION_TILES = 250000;

// Game seconds a factory is watched before compressing it with the measured recipe
const MEASURE_SECONDS = 60;

// Longest time unknown inputs are watched to learn which shapes come in
const OBSERVE_SECONDS = 10;

// Seconds over which a box's "how busy is it" figure is averaged, and the
// share of time running that counts as full capacity
const USAGE_SECONDS = 20;

// A line is sped up at most this much (to 1 / MIN_MACHINE_BUSY of the measured
// rate) when its machines were idle during measuring
const MIN_MACHINE_BUSY = 0.25;
const FULL_CAPACITY_USE = 0.95;

// Items per second one fake input teleporter is expected to hand out
const TELEPORTER_ITEMS_PER_LANE = 20;

// Component id -> readable name. A region containing any of these is refused,
// because they compute signals (only static wiring may be compressed).
const BLOCKING_COMPONENTS = {
    LogicGate: "logic gate / virtual processor",
    BeltReader: "belt reader",
    Memory: "memory / flip-flop (Wires+)",
    EdgeDetector: "edge detector (Wires+)",
    Adder: "adder (Wires+)",
    Multiplexer: "multiplexer (Wires+)",
    Diode: "diode / buffer (Wires+)",
    SmartProcessor: "smart processor (Wires+)",
    ColorProcessor: "color processor (Wires+)",
    VirtualMixer: "virtual mixer (Wires+)",
    RandomSignal: "random signal (Wires+)",
    Bundle: "bundle (Wires+)",
    BundledPins: "bundle (Wires+)",
    BundleInterface: "bundle interface (Wires+)",
    AdjustableDelay: "adjustable delay (Wires+ Community)",
    PassthruTransistor: "transistor (Wires+ Community)",
    Hub: "the Hub",
    FactoryBox: "another compressed factory",
};

const PORT_LABELS = {
    "belt-in": "belt input",
    "belt-out": "belt output",
    "tp-in": "teleporter input",
    "tp-out": "teleporter output",
    "hub-in": "from Hub",
    "hub-out": "to Hub",
};

const SOURCE_LABELS = {
    live: "a live model of its buildings - it processes whatever arrives, like the real factory, and upgrades apply immediately.",
    calc: "calculated from the buildings - it is worked out again by itself when you buy an upgrade.",
    measured: "measured while the factory ran. Upgrades do not change it - press Update recipe after one.",
    manual: "typed in.",
};

// Seconds between steps of a live box's model, and the longest a model that
// did not move anything waits before looking again
const LIVE_STEP = 1;

// How long the game's logic takes per tick, over the last couple of seconds
// (to tell what a box costs next to what its buildings would cost)
const tickStats = { active: false, start: 0, ms: 0, ticks: 0, excluded: 0 };
function tickStatsBegin() {
    if (tickStats.active) tickStats.start = performance.now();
}
function tickStatsEnd() {
    if (!tickStats.active) return;
    tickStats.ms += performance.now() - tickStats.start;
    tickStats.ticks++;
}
// How long a cost measurement runs (nothing is timed outside of it)
const COST_SECONDS = 15;
// What one building of each kind costs next to an average one (from the
// performance monitor's table: belts cost about half, machines about twice)
const COST_WEIGHT = { belt: 0.5, tunnel: 1, processor: 1.8, storage: 1.5, miner: 1, filter: 1 };
// Milliseconds per tick spent working out recipes after an upgrade
const RECALC_BUDGET_MS = 6;
// Making a live box calculated: its inputs are watched (only then) until each
// has carried this many shapes (so a rare shape is not missed), or until an
// input that carried nothing has been watched for UNUSED_AFTER_SECONDS (then it
// counts as unused)
const CONVERT_MIN_SEEN = 100;
const UNUSED_AFTER_SECONDS = 60;
// A slow input is accepted with fewer shapes after this long
const SLOW_INPUT_SECONDS = 120;
const LIVE_IDLE_RECHECK = 5;

const DIRECTION_LABELS = { top: "north", right: "east", bottom: "south", left: "west" };

////////////////////////////////////////////////////////////////////////
// Helpers

// A factory's inputs and outputs that depend on something outside it are never
// compressed: whatever brings shapes in from the Hub or a channel (Hub
// Extractors, item producers, teleporters) and whatever takes them away
// (teleporters, Micro Hubs) stays a real building next to the box, so the game
// handles them exactly as before. Miners make a fixed flow and are compressed.
function staysOutside(entity) {
    const c = entity.components;
    return !!(c.InputTeleporterComponent || c.OutputTeleporterComponent || c.SkHub ||
        c.HubExtraction || c.ItemProducer || c.ConstantProducer ||
        c.VaultInlet || c.VaultExtraction || c.VaultSensor);
}

// What a building that stays outside is, for messages
function outsideLabel(entity) {
    const c = entity.components;
    if (c.SkHub) return "a Micro Hub";
    if (c.HubExtraction) return "a Hub Extractor";
    if (c.VaultInlet) return "a Shape Vault";
    if (c.VaultExtraction) return "a Vault Extractor";
    if (c.VaultSensor) return "a Vault Level Sensor";
    if (c.ItemProducer || c.ConstantProducer) return "an item producer";
    return "a teleporter";
}

const OUTSIDE_KINDS = "Hub Extractors, item producers, teleporters, Micro Hubs and Shape Vault buildings";

function dirVec(dir) {
    return shapez.enumDirectionToVector[dir];
}

function isInputPort(port) {
    return port.kind.endsWith("-in");
}

function itemKey(item) {
    if (!item) return null;
    const type = item.getItemType();
    if (type === "shape") return item.definition.getHash();
    if (type === "color") return item.color;
    return null;
}

let colorKeys = null;
function isColorKey(key) {
    if (!colorKeys) colorKeys = new Set(Object.values(shapez.enumColors));
    return colorKeys.has(key);
}

function isValidKey(key) {
    return isColorKey(key) || shapez.ShapeDefinition.isValidShortKey(key);
}

function keyToItem(root, key) {
    if (isColorKey(key)) return shapez.COLOR_ITEM_SINGLETONS[key];
    return root.shapeDefinitionMgr.getShapeItemFromShortKey(key);
}

// Reading compact saves: with the "Compact Saves" mod installed, the buildings
// inside a box (state.blob) are written compressed (state.blobZ) instead of as
// escaped JSON text, which makes saving much faster. Reading is built in here
// so that those saves stay readable if that mod is removed; saves with the
// plain blob load as before. Boxes with the same blob share one string.
const unpackedBlobs = new Map(); // compressed -> blob

// Puts state.blob back when the saved state has it compressed; false if it cannot be read.
// The box remembers the pair (blobSrc / blobPacked) so a later save needs no compressing.
function restoreBlob(comp, st) {
    if (typeof st.blobZ !== "string") return true;
    let blob = unpackedBlobs.get(st.blobZ);
    if (blob === undefined) {
        blob = shapez.decompressX64(st.blobZ);
        if (typeof blob !== "string" || blob.length === 0) return false;
        unpackedBlobs.set(st.blobZ, blob);
    }
    st.blob = blob;
    comp.blobSrc = blob;
    comp.blobPacked = st.blobZ;
    delete st.blobZ;
    return true;
}

// Changes whenever a building is added or removed anywhere. A box looks up the
// building outside each of its output ports every tick; that building cannot
// change while this number stays the same.
let mapVersion = 0;
// port object -> { ver, ox, oy, tile } (the building on the tile outside it)
const outsideTiles = new WeakMap();

// Buffer size per recipe entry, in cycles. The slack absorbs the difference
// between measured and real rates, so neighbouring boxes do not stall each other.
const BUFFER_CYCLES = 4;

function entryCapacity(amount) {
    return Math.max(2, amount * BUFFER_CYCLES);
}

// Brings saved state from older versions to the current shape:
//   recipe.cycles[line], port.group = line, lines[line] = { progress, running }
function normalizeState(st) {
    if (!st.recipe.cycles) {
        st.recipe = { cycles: [st.recipe.cycle || 1], io: st.recipe.io || {} };
    }
    for (const port of st.ports) {
        if (typeof port.group !== "number") port.group = 0;
    }
    const lineCount = Math.max(st.recipe.cycles.length, ...st.ports.map(p => p.group + 1));
    while (st.recipe.cycles.length < lineCount) st.recipe.cycles.push(1);
    if (!st.lines) st.lines = [];
    while (st.lines.length < lineCount) st.lines.push({ progress: 0, running: false });
    delete st.progress;
    delete st.running;
    return st;
}

function portCycle(st, portIndex) {
    return st.recipe.cycles[st.ports[portIndex].group];
}

// "CuCuCuCu*2, red" -> [{ key: "CuCuCuCu", amount: 2 }, { key: "red", amount: 1 }]
// Returns null if the text is invalid.
function parseEntries(text, { shapesOnly = false } = {}) {
    const entries = [];
    const tokens = text.split(/[\s,]+/).filter(t => t.length > 0);
    for (const token of tokens) {
        const match = /^(.+?)(?:\*(\d+))?$/.exec(token);
        if (!match) return null;
        const key = match[1];
        const amount = match[2] ? parseInt(match[2], 10) : 1;
        if (!isValidKey(key) || amount < 1 || amount > 10000) return null;
        if (shapesOnly && isColorKey(key)) return null;
        if (entries.some(e => e.key === key)) return null;
        entries.push({ key, amount });
    }
    return entries;
}

function formatEntries(entries) {
    return (entries || []).map(e => (e.amount === 1 ? e.key : e.key + "*" + e.amount)).join(", ");
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// Totals per second over all ports: { inputs: [{ key, perSecond }], outputs: [...] }
function summarizeRecipe(st) {
    const inputs = [];
    const outputs = [];
    const hub = [];
    for (const portIndex in st.recipe.io) {
        const kind = st.ports[portIndex].kind;
        const list = isInputPort(st.ports[portIndex]) ? inputs : kind === "hub-out" ? hub : outputs;
        const cycle = portCycle(st, portIndex);
        for (const entry of st.recipe.io[portIndex]) {
            const existing = list.find(e => e.key === entry.key);
            if (existing) existing.perSecond += entry.amount / cycle;
            else list.push({ key: entry.key, perSecond: entry.amount / cycle });
        }
    }
    return { inputs, outputs, hub };
}

function formatPerSecond(value) {
    return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

// The shape (or color) as a small picture for the box dialog (HTML)
const shapePictureCache = new Map();
function shapePicture(root, key, size) {
    let html = shapePictureCache.get(key);
    if (!html) {
        try {
            if (isColorKey(key)) {
                html = '<span style="display:inline-block;width:' + size * 0.8 + "px;height:" + size * 0.8 +
                    "px;border-radius:50%;background:" + shapez.enumColorsToHexCode[key] +
                    ';border:1px solid rgba(0,0,0,0.35);vertical-align:middle;"></span>';
            } else {
                const canvas = root.shapeDefinitionMgr.getShapeFromShortKey(key).generateAsCanvas(64);
                html = '<img src="' + canvas.toDataURL() + '" width="' + size + '" height="' + size +
                    '" style="vertical-align:middle;" title="' + escapeHtml(key) + '">';
            }
        } catch (e) {
            html = escapeHtml(key);
        }
        shapePictureCache.set(key, html);
    }
    return html;
}

// Shapes with a number each, side by side: [{ key, perSecond | text }]
function chipsHtml(root, entries, { redWhenZero = false } = {}) {
    if (!entries || entries.length === 0) return '<span style="opacity:0.5;">-</span>';
    const shown = entries.slice(0, 8);
    const chips = shown.map(e => {
        const text = e.text !== undefined ? e.text : formatPerSecond(e.perSecond) + "/s";
        const red = redWhenZero && e.text === undefined && e.perSecond < 0.05;
        return '<span style="display:inline-block;white-space:nowrap;margin:0 12px 4px 0;' +
            (red ? "color:#d33;" : "") + '">' + shapePicture(root, e.key, 26) + " " + escapeHtml(text) + "</span>";
    });
    if (entries.length > shown.length) chips.push('<span style="opacity:0.6;">+' + (entries.length - shown.length) + " more</span>");
    return chips.join("");
}

const SOURCE_SHORT = {
    live: "Live model - reacts to what arrives, follows upgrades",
    calc: "Calculated recipe - follows upgrades by itself",
    measured: "Measured recipe - press Update recipe after an upgrade",
    manual: "Typed recipe",
};

// "in: ...; out: ..." at full speed, from a recipe
function capacityText(st) {
    const cap = summarizeRecipe(st);
    return "takes in " + formatRates(cap.inputs) + "; puts out " + formatRates(cap.outputs.concat(cap.hub || []));
}

function formatRates(entries) {
    if (entries.length === 0) return "nothing";
    return entries.map(e => e.key + " " + formatPerSecond(e.perSecond) + "/s").join(", ");
}

// Draws text where every word that is a shape or color code is drawn as that
// shape. Centered on x; the font must already be set on the context.
function drawRichText(root, parameters, text, x, y, size) {
    const ctx = parameters.context;
    const words = String(text).split(/\s+/).filter(Boolean);
    const space = ctx.measureText(" ").width;
    const parts = words.map(word => (isValidKey(word) ? { key: word, w: size * 1.15 } : { word, w: ctx.measureText(word).width }));
    const total = parts.reduce((s, p) => s + p.w, 0) + space * Math.max(0, parts.length - 1);
    let cx = x - total / 2;
    const align = ctx.textAlign;
    ctx.textAlign = "left";
    for (const part of parts) {
        if (part.key) keyToItem(root, part.key).drawItemCenteredClipped(cx + part.w / 2, y - size * 0.35, parameters, size);
        else ctx.fillText(part.word, cx, y);
        cx += part.w + space;
    }
    ctx.textAlign = align;
}

function explainStatus(status) {
    if (status.use === null && status.text === "full capacity") return "";
    if (status.why === "outdated") {
        return "This recipe was measured before the latest upgrade (or before upgrades were recorded), " +
            "so it still runs at the old speed. Press Update recipe to measure it again.";
    }
    if (status.why === "miners") {
        return "This copy stands on other deposits than the original: a miner has none, or a different shape, under it. " +
            "It does nothing until you press Update recipe (worked out again for the deposits here) or Unpack it and fix the miners.";
    }
    if (status.why === "wrong") {
        return "A shape this factory does not expect arrived at #" + (status.portIndex + 1) +
            " and blocks that belt. Only " + status.expected + " is let in there.";
    }
    if (status.why === "jam") {
        return "The belt into this input is full of " + status.key + ", and nothing inside takes it, so nothing " +
            "new can enter. Press Restart model to clear the belts inside, and check what should use " + status.key + ".";
    }
    if (status.use === null) return "";
    const percent = Math.round(status.use * 100);
    if (status.why === "input") {
        return "It runs " + percent + "% of the time: it waits for " + (status.key || "input") +
            ". Bring more of it and it produces more.";
    }
    if (status.why === "output") {
        return "Its output " + status.key + " is not taken away fast enough (the belt, teleporter or factory " +
            "after it is full), so it cannot produce more. Make room for it and it produces more.";
    }
    if (status.use >= FULL_CAPACITY_USE) return "It runs all the time: more input would not make it produce more.";
    return "It runs " + percent + "% of the time.";
}

function describePort(port, index, lineCount) {
    let where = "";
    if (port.kind.startsWith("belt")) {
        where = " (" + DIRECTION_LABELS[port.dir] + " edge, tile " + port.x + "," + port.y + ")";
    } else if (port.kind.startsWith("tp")) {
        where = " (channel \"" + port.channel + "\")";
    }
    const line = lineCount > 1 ? " - line " + (port.group + 1) : "";
    return "#" + (index + 1) + " " + PORT_LABELS[port.kind] + where + line;
}

////////////////////////////////////////////////////////////////////////
// Component - the whole compressed factory lives in one JSON state object:
//   w, h         - size in tiles
//   ports        - [{ kind, x, y, dir, channel, group }] (x/y local to the box)
//   recipe       - { cycles: [seconds per line], io: { portIndex: [{ key, amount }] } }
//   buf          - { portIndex: { key: count } } - buffered inputs / pending outputs
//   lines        - [{ progress, running }] - one per independent production line.
//                  A port belongs to line `port.group`; lines run separately, so
//                  one starved or backed-up line does not stop the others.
//   blob         - JSON string of the serialized original entities
//   count, fee   - number of buildings compressed, blueprint shapes paid

class FactoryBoxComponent extends shapez.Component {
    static getId() {
        return BOX_COMPONENT_ID;
    }

    static getSchema() {
        return { data: shapez.types.string };
    }

    constructor() {
        super();
        this.data = "null";
        this.state = null;
        this.entityRef = null;
        // Runtime only
        this.inSlotToPort = [];
        this.outSlotToPort = [];
        this.fakeTeleporters = [];
        this.status = "norecipe";
    }

    serialize() {
        if (this.sim && this.state) {
            this.state.stock = this.sim.exportStock();
            this.state.belts = this.sim.exportBuffers();
        }
        this.data = JSON.stringify(this.state);
        return super.serialize();
    }

    // Copying (blueprints): the whole factory comes along; running state does not
    copyAdditionalStateTo(other) {
        if (!this.state) return;
        const st = JSON.parse(JSON.stringify(this.state));
        st.buf = {};
        st.lines = null;
        st.stock = null;
        st.belts = null;
        other.state = normalizeState(st);
        other.applyLayout();
    }

    deserialize(data, root) {
        const error = super.deserialize(data, root);
        if (error) return error;
        try {
            this.state = JSON.parse(this.data);
        } catch (e) {
            return "Factory Compressor: bad saved data";
        }
        if (!this.state) return "Factory Compressor: empty saved data";
        if (!restoreBlob(this, this.state)) return "Factory Compressor: bad saved data";
        normalizeState(this.state);
        this.applyLayout();
    }

    // Sizes the entity and creates one acceptor / ejector slot per belt port.
    // Runs before the entity is placed, so the map sees the right size.
    applyLayout() {
        const entity = this.entityRef;
        const st = this.state;
        entity.components.StaticMapEntity.fcSize = new shapez.Vector(st.w, st.h);

        const acceptorSlots = [];
        const ejectorSlots = [];
        this.inSlotToPort = [];
        this.outSlotToPort = [];
        st.ports.forEach((port, index) => {
            const pos = new shapez.Vector(port.x, port.y);
            if (port.kind === "belt-in") {
                acceptorSlots.push({ pos, direction: port.dir });
                this.inSlotToPort.push(index);
            } else if (port.kind === "belt-out") {
                ejectorSlots.push({ pos, direction: port.dir });
                this.outSlotToPort.push(index);
            }
        });
        entity.components.ItemAcceptor.setSlots(acceptorSlots);
        entity.components.ItemEjector.setSlots(ejectorSlots);
    }
}

////////////////////////////////////////////////////////////////////////
// Building - never in the toolbar, only created by compressing

class MetaFactoryBoxBuilding extends shapez.ModMetaBuilding {
    constructor() {
        super(BOX_BUILDING_ID);
    }

    static getAllVariantCombinations() {
        return [
            {
                variant: shapez.defaultBuildingVariant,
                name: "Compressed factory",
                description: "A factory compressed into one building. Click it to edit the recipe or unpack it.",
            },
        ];
    }

    getSilhouetteColor() {
        return "#6d5bd0";
    }

    getIsUnlocked() {
        return false;
    }

    getIsRemovable() {
        return true;
    }

    getIsRotateable() {
        return false;
    }

    getSprite() {
        return null;
    }

    getBlueprintSprite() {
        return null;
    }

    setupEntityComponents(entity) {
        const comp = new FactoryBoxComponent();
        comp.entityRef = entity;
        // The box component must come first: its deserialize() sets up the
        // ejector slots before the ejector deserializes its fixed-size slot list.
        entity.addComponent(comp);
        entity.addComponent(new shapez.ItemAcceptorComponent({ slots: [] }));
        entity.addComponent(new shapez.ItemEjectorComponent({ slots: [] }));
    }
}

////////////////////////////////////////////////////////////////////////
// Accepting items from belts / ejectors

// What really goes in and out of a box, per shape and second: counted as the
// shapes pass, folded into rates once a second (both live and recipe boxes)
function ensureFlow(comp) {
    if (comp.flowIn) return;
    comp.flowIn = new Map();
    comp.flowOut = new Map();
    comp.flowHub = new Map();
    comp.flowCountIn = new Map();
    comp.flowCountOut = new Map();
    comp.flowCountHub = new Map();
    comp.flowTime = 0;
}

function countFlow(comp, kind, key, amount = 1) {
    ensureFlow(comp);
    const counts = kind === "in" ? comp.flowCountIn : kind === "hub" ? comp.flowCountHub : comp.flowCountOut;
    counts.set(key, (counts.get(key) || 0) + amount);
}

function foldFlows(comp, dt) {
    comp.flowTime += dt;
    if (comp.flowTime < 1) return;
    if (comp.flowIn.size + comp.flowOut.size + comp.flowHub.size + comp.flowCountIn.size + comp.flowCountOut.size + comp.flowCountHub.size === 0) {
        comp.flowTime = 0; // nothing passing: folding would change nothing
        return;
    }
    const fold =(rates, counts) => {
        for (const key of new Set([...rates.keys(), ...counts.keys()])) {
            const now = (counts.get(key) || 0) / comp.flowTime;
            const next = (rates.get(key) || 0) * 0.7 + now * 0.3;
            if (next < 0.01) rates.delete(key);
            else rates.set(key, next);
        }
        counts.clear();
    };
    fold(comp.flowIn, comp.flowCountIn);
    fold(comp.flowOut, comp.flowCountOut);
    fold(comp.flowHub, comp.flowCountHub);
    comp.flowTime = 0;
}

// While a live box is being made calculated (comp.watch), counts the shapes that
// come in at each input port. Nothing is counted at any other time.
function recordWatch(comp, portIndex, key) {
    const counts = comp.watch.counts;
    const row = counts[portIndex] || (counts[portIndex] = {});
    row[key] = (row[key] || 0) + 1;
}

function boxAcceptItem(entity, slotIndex, item) {
    const comp = entity.components.FactoryBox;
    const st = comp.state;
    if (comp.sim) {
        // Live: into the model's belt behind this input, if there is room
        const portIndex = comp.inSlotToPort[slotIndex];
        const edge = comp.sim.sourceByPort && comp.sim.sourceByPort.get(comp.portKeys[portIndex]);
        const key = itemKey(item);
        if (!edge || !key || totalAmount(edge.buf) + 1 > edge.cap) return false;
        addAmount(edge.buf, key, 1);
        // What has come in at each input, kept with the box: converting to a
        // calculated recipe needs to know it
        if (comp.watch) recordWatch(comp, portIndex, key);
        comp.lastInKey[portIndex] = key;
        comp.idle = false;
        comp.flowCountIn.set(key, (comp.flowCountIn.get(key) || 0) + 1);
        return true;
    }
    if (!st || !st.recipe || comp.status === "miners") return false;
    const portIndex = comp.inSlotToPort[slotIndex];
    // A belt waits at a full input and asks again every tick: answer that without
    // looking at the item (the flag is cleared when the box takes inputs)
    if (comp.portFull && comp.portFull[portIndex]) return false;
    const entries = st.recipe.io[portIndex];
    const key = itemKey(item);
    if (!entries) return false;
    // key -> entry per port, dropped whenever the recipe changes
    const maps = comp.entryMaps || (comp.entryMaps = []);
    const map = maps[portIndex] || (maps[portIndex] = new Map(entries.map(e => [e.key, e])));
    const entry = map.get(key);
    if (!entry) {
        // Not a shape this input expects: it stays on the belt
        comp.rejected = { portIndex, key, at: entity.root.time.now() };
        return false;
    }
    const buf = st.buf[portIndex] || (st.buf[portIndex] = {});
    const current = buf[key] || 0;
    if (current >= entryCapacity(entry.amount)) {
        if (entries.every(e => (buf[e.key] || 0) >= entryCapacity(e.amount))) {
            (comp.portFull || (comp.portFull = []))[portIndex] = true;
        }
        return false;
    }
    buf[key] = current + 1;
    comp.wake = true;
    countFlow(comp, "in", key);
    return true;
}

// True when boxAcceptItem is certain to refuse whatever shape comes, without
// anything else happening (no "rejected" note, no flag change): the conditions
// of boxAcceptItem that do not depend on the shape
function boxRefuses(entity, slotIndex) {
    const comp = entity.components.FactoryBox;
    const st = comp.state;
    const portIndex = comp.inSlotToPort[slotIndex];
    if (comp.sim) {
        const edge = comp.sim.sourceByPort && comp.sim.sourceByPort.get(comp.portKeys[portIndex]);
        return !edge || totalAmount(edge.buf) + 1 > edge.cap;
    }
    if (!st || !st.recipe || comp.status === "miners") return true;
    if (comp.portFull && comp.portFull[portIndex]) return true;
    return !st.recipe.io[portIndex];
}

// A belt whose first shape waits at the end, with every shape behind it packed
// against it, and a box in front that refuses: BeltPath.update would do
// nothing but ask the box again, so it is skipped until the box has room
function beltIsWaitingAtBox(path) {
    const acceptor = path.boundAcceptor;
    if (!acceptor || !acceptor.fcBox) return false;
    const items = path.items;
    const count = items.length;
    return (
        count > 0 &&
        items[count - 1][0] < 1e-7 &&
        path.numCompressedItemsAfterFirstItem >= count - 1 &&
        boxRefuses(acceptor.fcBox, acceptor.fcSlot)
    );
}

////////////////////////////////////////////////////////////////////////
// System - runs the recipes and draws the boxes

class FactoryBoxSystem extends shapez.GameSystemWithFilter {
    constructor(root) {
        super(root, [FactoryBoxComponent]);
        this.root.signals.entityAdded.add(this.onBoxAdded, this);
        this.root.signals.entityDestroyed.add(this.onBoxDestroyed, this);
        this.root.signals.entityAdded.add(() => ++mapVersion);
        this.root.signals.entityDestroyed.add(() => ++mapVersion);
        this.root.signals.upgradePurchased.add(this.recalculateAll, this);
    }

    // Replaces a box's recipe and resets what depends on it
    setRecipe(comp, recipe) {
        const st = comp.state;
        st.recipe = recipe;
        // Worked out (or typed in) where the box stands now
        const at = comp.entityRef.components.StaticMapEntity.origin;
        st.minersAt = at.x + "," + at.y;
        comp.minerChecked = null;
        st.upg = Object.assign({}, this.root.hubGoals.upgradeLevels);
        normalizeState(st);
        for (const portIndex in st.buf) {
            const keys = (recipe.io[portIndex] || []).map(e => e.key);
            for (const key in st.buf[portIndex]) {
                if (!keys.includes(key)) delete st.buf[portIndex][key];
            }
        }
        for (const line of st.lines) {
            line.running = false;
            line.progress = 0;
        }
        comp.plan = null;
        comp.entryMaps = null;
        comp.portFull = null;
        comp.lineInfo = null;
        comp.age = 0;
        this.registerFakeTeleporters(comp);
    }

    // Live boxes run a model of their buildings (FactoryCalculator in live
    // mode), stepped every LIVE_STEP seconds with the shapes that really arrive
    buildSim(entity, discardBelts = false) {
        const comp = entity.components.FactoryBox;
        const st = comp.state;
        const origin = entity.components.StaticMapEntity.origin;
        const rect = { x: origin.x, y: origin.y, w: st.w, h: st.h };
        // The new model starts from what the old one's storages hold
        // ... and from the shapes that lay on its belts (a restart or an upgrade
        // used to throw them away)
        // (or from the ones saved with the box / lying on the belts it came from)
        let carried = st.belts || null;
        st.belts = null;
        if (comp.sim) {
            st.stock = comp.sim.exportStock();
            // A restart starts the belts empty: it is what frees a jam (a shape
            // nothing takes, waiting at an input)
            carried = discardBelts ? null : comp.sim.exportBuffers();
        }
        comp.sim = null;
        try {
            const items = deserializeEntities(this.root, boxPayloads(entity));
            const sim = new FactoryCalculator(this.root, items, {
                rect,
                ports: st.ports,
                signals: st.signals || {},
                live: true,
                stepSize: LIVE_STEP,
            });
            sim.build();
            if (sim.problems.length > 0) {
                comp.simError = sim.problems[0];
                return;
            }
            sim.importBuffers(carried);
            comp.sim = sim;
            comp.ghost = null;
            comp.idle = false;
            comp.inPools = null;
            comp.outDirty = true;
            comp.portKeys = st.ports.map(p => portWorldKey(p, rect));
            // Spread the boxes' steps over the ticks
            comp.simDt = Math.random() * LIVE_STEP;
            comp.flowIn = new Map();
            comp.flowOut = new Map();
            comp.flowCountIn = new Map();
            comp.flowCountOut = new Map();
            comp.flowHub = new Map();
            comp.flowCountHub = new Map();
            comp.flowTime = 0;
            comp.lastInKey = [];
            this.registerFakeTeleporters(comp);
        } catch (e) {
            console.error("[Factory Compressor] building the model failed", e);
            comp.simError = String(e.message || e);
        }
    }

    countFlow(map, key, amount = 1) {
        map.set(key, (map.get(key) || 0) + amount);
    }

    tickLive(entity, comp, dt) {
        const sim = comp.sim;
        const hubGoals = this.root.hubGoals;

        // Teleporter channels that come from outside: pull real items into the
        // pools - like the original output teleporters, one per tick each, so
        // a box does not take more than its share of a shared channel
        if (!comp.inPools) comp.inPools = [...sim.pools.values()].filter(pool => pool.inPort);
        for (const pool of comp.inPools) {
            const inputs = this.getHeldByChannel().get(pool.channel) || [];
            // The model takes from the pool once per step: hold a step's worth
            const cap = Math.max(2, Math.ceil(1.5 * Math.max(1, pool.outputs.length) * sim.teleporterRate * LIVE_STEP));
            let pulled = 0;
            for (const e of inputs) {
                if (pulled >= Math.max(1, pool.outputs.length) || totalAmount(pool.buf) >= cap) break;
                if (e.fcFake && comp.fakeTeleporters.includes(e)) continue;
                const tp = e.components.InputTeleporterComponent;
                if (!tp.item) continue;
                const key = itemKey(tp.item);
                addAmount(pool.buf, key, 1);
                this.countFlow(comp.flowCountIn, key);
                if (comp.watch) {
                    const portIndex = comp.portKeys.indexOf(pool.inPort);
                    if (portIndex >= 0) recordWatch(comp, portIndex, key);
                }
                tp.item = null;
                pool.lastKey = key;
                pool.fillCap = cap;
                pulled++;
                comp.idle = false;
            }
        }

        // A model where nothing moved stays asleep until something arrives or
        // leaves (or a while passed - the Hub's stock may have changed)
        comp.simDt += dt;
        const asleep = comp.idle && comp.simDt < LIVE_IDLE_RECHECK;
        if (comp.simDt >= LIVE_STEP && !asleep) {
            sim.step(Math.min(comp.simDt, LIVE_STEP * 2));
            comp.simDt = 0;
            comp.outDirty = true;
            comp.idle = sim.lastMoved < 1e-6;
        }

        // What the model took from the Hub / delivered to it, in whole shapes
        // (the 1e-6 keeps sums like 0.9999999999999996 from staying unpaid)
        if (sim.hubDebt.size > 0) for (const [key, amount] of sim.hubDebt) {
            const n = Math.floor(amount + 1e-6);
            if (n <= 0) continue;
            hubGoals.takeShapeByKey(key, n);
            sim.hubDebt.set(key, amount - n);
            this.countFlow(comp.flowCountIn, key, n);
        }
        if (sim.hubOut.size > 0) for (const [key, amount] of sim.hubOut) {
            const n = Math.floor(amount + 1e-6);
            if (n <= 0) continue;
            const definition = this.root.shapeDefinitionMgr.getShapeFromShortKey(key);
            for (let i = 0; i < n; ++i) hubGoals.handleDefinitionDelivered(definition);
            sim.hubOut.set(key, amount - n);
            this.countFlow(comp.flowCountHub, key, n);
        }

        // Shapes waiting at the edge go out onto the real belts. Only the model's
        // step puts shapes there, so until it has, and while nothing is left
        // waiting, there is nothing to look at (outDirty)
        if (comp.outDirty !== false) {
            let waiting = false;
            const ejector = entity.components.ItemEjector;
            for (let slot = 0; slot < comp.outSlotToPort.length; ++slot) {
                const portIndex = comp.outSlotToPort[slot];
                const edge = sim.sinkByPort && sim.sinkByPort.get(comp.portKeys[portIndex]);
                if (!edge) continue;
                const key = nextWholeShape(edge.buf);
                if (!key) continue;
                waiting = true;
                if (!ejector.canEjectOnSlot(slot)) continue;
                const path = this.getTargetBeltPath(entity, comp.state.ports[portIndex]);
                if (path && !path.canAcceptItem()) continue; // no room: it would be refused
                const item = keyToItem(this.root, key);
                if (path ? path.tryAcceptItem(item) : ejector.tryEject(slot, item)) {
                    takeWholeShape(edge.buf, key);
                    this.countFlow(comp.flowCountOut, key);
                    comp.idle = false;
                }
            }
            // ... and into the fake teleporters of channels going outside
            for (const fake of comp.fakeTeleporters) {
                const tp = fake.components.InputTeleporterComponent;
                const pool = sim.pools.get(tp.channel);
                if (!pool || !pool.outBuf) continue;
                const key = nextWholeShape(pool.outBuf);
                if (!key) continue;
                waiting = true;
                if (tp.item) continue;
                takeWholeShape(pool.outBuf, key);
                tp.item = keyToItem(this.root, key);
                this.countFlow(comp.flowCountOut, key);
                comp.idle = false;
            }
            comp.outDirty = waiting;
        }

        // Rates for the display, averaged over a few seconds
        foldFlows(comp, dt);
        comp.status = "live";
    }

    // Status of a live box from its model
    getLiveStatus(comp) {
        const sim = comp.sim;
        if (comp.age < USAGE_SECONDS / 2) return { text: "starting ...", color: "#d8d2ff", use: null };
        // An exit that stays full: the outside does not take the shapes away
        // (a full exit buffer alone proves nothing: a box producing more than
        // its belt carries keeps it full while the belt runs at full speed, so
        // it counts only if what really left is well under what the exits take)
        let blockedKey = null;
        let fullRate = 0;
        for (const edge of sim.sinkByPort ? sim.sinkByPort.values() : []) {
            if (totalAmount(edge.buf) >= edge.cap * 0.9) {
                fullRate += edge.rate;
                for (const [k, v] of edge.buf) if (!blockedKey || v > (edge.buf.get(blockedKey) || 0)) blockedKey = k;
            }
        }
        if (blockedKey) {
            let out = 0;
            for (const v of (comp.flowOut || new Map()).values()) out += v;
            if (out >= fullRate * 0.7) blockedKey = null;
        }
        const machines = sim.nodes.filter(n => n.kind === "machine");
        const busiest = machines.length > 0 ? Math.max(...machines.map(n => n.busy || 0)) : null;
        // Nothing went in or out lately: the busiest machine alone does not make
        // the box "full capacity" (flows are only known once the box has run a while)
        const idle = !!comp.flowIn && comp.flowIn.size + comp.flowOut.size + comp.flowHub.size === 0;
        const use = idle ? 0 : busiest;
        if (blockedKey) {
            return {
                text: "output blocked: " + blockedKey + " is not taken away",
                label: "output blocked - not taken away:",
                color: "#ff7a7a",
                use,
                why: "output",
                key: blockedKey,
            };
        }
        // An input belt that is full while nothing goes in: a shape the model does
        // not take sits at its end. Restart model clears it.
        if (idle) {
            let jam = null;
            (comp.state.ports || []).forEach((port, index) => {
                if (jam || port.kind !== "belt-in") return;
                const edge = sim.sourceByPort && sim.sourceByPort.get(comp.portKeys[index]);
                if (!edge || totalAmount(edge.buf) < edge.cap * 0.9) return;
                let key = null;
                for (const [k, v] of edge.buf) if (!key || v > edge.buf.get(key)) key = k;
                jam = { index, key };
            });
            if (jam) {
                return {
                    text: "input #" + (jam.index + 1) + " is jammed: " + jam.key + " is not taken - press Restart model",
                    // Short, so the box shows it with the shape drawn after it
                    label: "#" + (jam.index + 1) + " jammed by",
                    color: "#ff7a7a",
                    use: 0,
                    why: "jam",
                    key: jam.key,
                };
            }
        }
        if (use === null || use >= FULL_CAPACITY_USE) {
            return { text: "full capacity", color: "#6fe38a", use: use === null ? 1 : use };
        }
        // The input whose belt into the model is emptiest is what it waits for
        let starving = null;
        let lowest = Infinity;
        (comp.state.ports || []).forEach((port, index) => {
            if (port.kind !== "belt-in") return;
            const edge = sim.sourceByPort && sim.sourceByPort.get(comp.portKeys[index]);
            if (!edge) return;
            const fill = totalAmount(edge.buf) / edge.cap;
            if (fill < lowest) {
                lowest = fill;
                starving = comp.lastInKey[index] || null;
            }
        });
        for (const pool of sim.pools.values()) {
            if (!pool.inPort) continue;
            const fill = totalAmount(pool.buf) / (pool.fillCap || 2);
            if (fill < lowest) {
                lowest = fill;
                starving = pool.lastKey || (isValidKey(pool.channel) ? pool.channel : null);
            }
        }
        if (!starving) starving = this.expectedInputKey(comp);
        const percent = Math.round(use * 100);
        return {
            text: percent + "% - needs more " + (starving || "input"),
            label: percent + "% - needs more",
            color: "#ffb454",
            use,
            why: "input",
            key: starving,
        };
    }

    // An input shape the box is expected to get but has nothing of
    expectedInputKey(comp) {
        const expected = (comp.state.capacity && comp.state.capacity.inputs) || [];
        const missing = expected.find(e => !(comp.flowIn && comp.flowIn.get(e.key) > 0.05));
        return missing ? missing.key : null;
    }

    // Per-second totals of what goes in and out: measured for live boxes (the
    // shapes it is expected to handle are listed even at 0/s), from the
    // recipe otherwise
    summarize(comp) {
        let capacity;
        let ownHub;
        if (comp.sim) {
            capacity = comp.state.capacity || {};
            // Only a box with a Micro Hub inside (made before 0.6) delivers to the Hub
            // itself; for the others, what an older estimate listed as "Hub" is an output
            ownHub = comp.state.ports.some(p => p.kind === "hub-out");
        } else {
            // A recipe box: what really went through it; the recipe lists what it should
            capacity = summarizeRecipe(comp.state);
            if (!comp.flowIn) return capacity;
            ownHub = true;
        }
        // A fixed order: the expected shapes first, then in the order they first
        // showed up - sorting by rate made them swap places all the time
        if (!comp.keyOrder) comp.keyOrder = new Map();
        const order = key => {
            if (!comp.keyOrder.has(key)) comp.keyOrder.set(key, comp.keyOrder.size);
            return comp.keyOrder.get(key);
        };
        for (const list of [capacity.inputs, capacity.outputs, capacity.hub]) for (const e of list || []) order(e.key);
        const list = (rates, expected) => {
            const rows = [...rates].map(([key, perSecond]) => ({ key, perSecond }));
            for (const e of expected || []) {
                if (!rows.some(r => r.key === e.key)) rows.push({ key: e.key, perSecond: 0, expected: true });
            }
            return rows.sort((a, b) => order(a.key) - order(b.key));
        };
        const expectedOut = ownHub ? capacity.outputs : [...(capacity.outputs || []), ...(capacity.hub || [])];
        return {
            inputs: list(comp.flowIn, capacity.inputs),
            outputs: list(comp.flowOut, expectedOut),
            hub: ownHub ? list(comp.flowHub, capacity.hub) : [],
        };
    }

    // After an upgrade: how many measured factories now run on an old recipe
    notifyOutdated() {
        let count = 0;
        for (const entity of this.allEntities) if (this.isOutdated(entity.components.FactoryBox)) count++;
        const hud = this.root.hud && this.root.hud.parts.factoryCompressor;
        if (count > 0 && hud) {
            hud.notify(
                count + (count === 1 ? " measured factory needs" : " measured factories need") + " an update (yellow)",
                shapez.enumNotificationType.warning
            );
        }
    }

    // Upgrades make machines, miners and belts faster: work the calculated
    // recipes out again with the new speeds
    recalculateAll(upgradeId) {
        this.recalcUpgrade = upgradeId;
        this.notifyOutdated();
        // One box after the other, a few milliseconds per tick: working out
        // hundreds of recipes at once froze the game
        this.recalcQueue = this.allEntities.filter(entity => {
            const st = entity.components.FactoryBox.state;
            return st && (st.source === "live" || st.source === "calc");
        });
        this.recalcJob = null;
        const calcCount = this.recalcQueue.filter(e => e.components.FactoryBox.state.source === "calc").length;
        if (calcCount > 0) {
            this.recalcActive = true;
            const hud = this.root.hud && this.root.hud.parts.factoryCompressor;
            if (hud) hud.notify("Working out up to " + calcCount + " recipes after the upgrade in the background - the game may run a bit slower until it is done");
        }
    }

    runRecalcQueue() {
        if (!this.recalcJob && !(this.recalcQueue && this.recalcQueue.length)) {
            if (this.recalcActive) {
                this.recalcActive = false;
                const hud = this.root.hud && this.root.hud.parts.factoryCompressor;
                if (hud) hud.notify("All recipes are up to date", shapez.enumNotificationType.success);
            }
            return;
        }
        const end = performance.now() + RECALC_BUDGET_MS;
        while (performance.now() < end) {
            if (!this.recalcJob) {
                const entity = this.recalcQueue.shift();
                if (!entity) return;
                if (entity.destroyed || entity.queuedForDestroy) continue;
                this.recalcJob = this.startRecalc(entity);
                continue;
            }
            const job = this.recalcJob;
            try {
                if (!job.calc.continueRun(Math.max(1, end - performance.now()))) return;
                const comp = job.entity.components.FactoryBox;
                const st = comp.state;
                if (st && st.source === "calc" && !job.entity.destroyed) {
                    this.setRecipe(comp, recipeFromCounts(st.ports, job.rect, job.calc.counts, CALC_AVERAGE_SECONDS));
                }
            } catch (e) {
                console.error("[Factory Compressor] recalculating failed", e);
            }
            this.recalcJob = null;
        }
    }

    // Live boxes are rebuilt at once (it is quick); calculated ones return a job
    // that runs in pieces
    // Does the upgrade that was just bought change anything in these buildings?
    // Only when it is certain it does not: a miner upgrade for a box without
    // miners, a painting upgrade for one without painters, a processor upgrade
    // for one without machines. Everything else is worked out again.
    upgradeAffects(upgradeId, payloads) {
        try {
            const idOf = payload => shapez.getBuildingDataFromCode(payload.components.StaticMapEntity.code).metaInstance.getId();
            if (upgradeId === "miner") return payloads.some(p => p.components.Miner);
            if (upgradeId === "painting") return payloads.some(p => p.components.ItemProcessor && idOf(p) === "painter");
            if (upgradeId === "processors") {
                return payloads.some(p => p.components.ItemProcessor && idOf(p) !== "painter" && idOf(p) !== "balancer");
            }
        } catch (e) {
            // unknown: work it out
        }
        return true;
    }

    startRecalc(entity) {
        const comp = entity.components.FactoryBox;
        const st = comp.state;
        if (this.recalcUpgrade && !this.upgradeAffects(this.recalcUpgrade, boxPayloads(entity))) return null;
        if (st.source === "live") {
            this.buildSim(entity);
            return null;
        }
        const origin = entity.components.StaticMapEntity.origin;
        const rect = { x: origin.x, y: origin.y, w: st.w, h: st.h };
        try {
            const items = deserializeEntities(this.root, boxPayloads(entity));
            const calc = new FactoryCalculator(this.root, items, {
                rect,
                ports: st.ports,
                expect: st.expect,
                signals: st.signals,
            });
            if (calc.beginRun()) return null;
            return { entity, calc, rect };
        } catch (e) {
            console.error("[Factory Compressor] recalculating failed", e);
            return null;
        }
    }

    // Builds a live box's model again from its buildings (its storages keep their
    // stock): frees a model that got stuck. Shapes on the belts inside are lost.
    restartModel(entity) {
        const comp = entity.components.FactoryBox;
        if (!comp || !comp.state || comp.state.source !== "live") return false;
        comp.simError = null;
        comp.age = 0;
        // The shapes listed at 0/s come from the estimate made when the factory was
        // compressed, and the order they were first shown in: start those afresh, so
        // only what really passes through the box from now on is listed
        comp.state.capacity = null;
        comp.keyOrder = null;
        this.buildSim(entity, true);
        return !!comp.sim;
    }

    restartModels(boxes) {
        const restarted = boxes.filter(box => this.restartModel(box)).length;
        this.root.hud.signals.notification.dispatch(
            restarted > 0
                ? "Restarted " + restarted + " live model" + (restarted === 1 ? "" : "s")
                : "Only live boxes can be restarted",
            restarted > 0 ? shapez.enumNotificationType.success : shapez.enumNotificationType.warning
        );
    }

    // Turns a calculated box back into a live model (the opposite of
    // convertToCalc). The recipe's rates become the box's capacity estimate; shapes
    // buffered at the inputs are dropped. Returns {} or { error } (box unchanged).
    convertToLive(entity) {
        const comp = entity.components.FactoryBox;
        const st = comp && comp.state;
        if (!st || comp.sim) return { error: "it is already a live model" };
        if (st.source !== "calc") return { error: "only a calculated recipe can be made live" };
        const before = {
            source: st.source, recipe: st.recipe, buf: st.buf, lines: st.lines, capacity: st.capacity,
            expect: st.expect, stock: st.stock, belts: st.belts,
        };
        st.capacity = summarizeRecipe(st);
        st.source = "live";
        st.recipe = emptyRecipe(st.ports);
        st.buf = {};
        st.lines = null;
        st.expect = null;
        st.stock = null;
        st.belts = null;
        normalizeState(st);
        comp.plan = null;
        comp.entryMaps = null;
        comp.lineInfo = null;
        comp.simError = null;
        comp.age = 0;
        this.buildSim(entity);
        if (comp.sim) return {};
        const error = comp.simError || "the model could not be built";
        Object.assign(st, before);
        comp.sim = null;
        comp.simError = null;
        this.registerFakeTeleporters(comp);
        return { error };
    }

    onBoxAdded(entity) {
        const comp = entity.components.FactoryBox;
        if (!comp || !comp.state) return;
        if (comp.state.ox === undefined) {
            comp.state.ox = entity.components.StaticMapEntity.origin.x;
            comp.state.oy = entity.components.StaticMapEntity.origin.y;
        }
        if (comp.state.source === "live") this.buildSim(entity);
        else this.registerFakeTeleporters(comp);
    }

    onBoxDestroyed(entity) {
        const comp = entity.components.FactoryBox;
        if (!comp) return;
        this.unregisterFakeTeleporters(comp);
    }

    // A "teleporter output" port is exposed to the Teleporter mod as fake input
    // teleporters, so real output teleporters elsewhere pull from it. Each fake
    // holds one item and each output takes one per tick, so fast ports get
    // several fakes.
    registerFakeTeleporters(comp) {
        this.unregisterFakeTeleporters(comp);
        const map = this.root.entityMgr.componentToEntity;
        const st = comp.state;
        st.ports.forEach((port, index) => {
            if (port.kind !== "tp-out") return;
            let lanes;
            if (comp.sim) {
                const pool = comp.sim.pools.get(port.channel);
                lanes = Math.max(1, pool ? pool.inputs.length : 1);
            } else {
                const perSecond = (st.recipe.io[index] || []).reduce((sum, e) => sum + e.amount, 0) / portCycle(st, index);
                lanes = Math.max(1, Math.ceil(perSecond / TELEPORTER_ITEMS_PER_LANE));
            }
            for (let lane = 0; lane < lanes; ++lane) {
                const fake = {
                    fcFake: true,
                    portIndex: index,
                    components: { InputTeleporterComponent: { channel: port.channel, item: null } },
                };
                if (!map.InputTeleporterComponent) map.InputTeleporterComponent = [];
                map.InputTeleporterComponent.push(fake);
                comp.fakeTeleporters.push(fake);
            }
        });
    }

    unregisterFakeTeleporters(comp) {
        this.heldByChannel = null;
        const list = this.root.entityMgr.componentToEntity.InputTeleporterComponent;
        if (list) {
            for (const fake of comp.fakeTeleporters) {
                const index = list.indexOf(fake);
                if (index >= 0) list.splice(index, 1);
            }
        }
        comp.fakeTeleporters = [];
    }

    update() {
        const measuring = !!this.costRun;
        if (measuring) {
            const recalcStart = performance.now();
            this.runRecalcQueue();
            tickStats.excluded += performance.now() - recalcStart;
        } else {
            this.runRecalcQueue();
        }
        const dt = this.root.dynamicTickrate.deltaSeconds;
        this.heldByChannel = null; // built on first use, once per tick
        if (!measuring) {
            for (let i = 0; i < this.allEntities.length; ++i) this.tickBox(this.allEntities[i], dt);
            return;
        }
        let last = performance.now();
        for (let i = 0; i < this.allEntities.length; ++i) {
            const entity = this.allEntities[i];
            this.tickBox(entity, dt);
            const after = performance.now();
            const comp = entity.components.FactoryBox;
            comp.costAcc = (comp.costAcc || 0) + (after - last);
            last = after;
        }
        if (last >= this.costRun.until) this.finishCostMeasure(last);
    }

    // Starts timing every box and the whole tick for COST_SECONDS. Nothing is
    // timed at any other moment.
    startCostMeasure() {
        if (this.costRun) return false;
        const now = performance.now();
        this.costRun = { start: now, until: now + COST_SECONDS * 1000 };
        tickStats.ms = 0;
        tickStats.ticks = 0;
        tickStats.excluded = 0;
        tickStats.active = true;
        for (const entity of this.allEntities) entity.components.FactoryBox.costAcc = 0;
        return true;
    }

    finishCostMeasure(now) {
        const run = this.costRun;
        this.costRun = null;
        tickStats.active = false;
        const seconds = (now - run.start) / 1000;
        let boxTotal = 0;
        for (const entity of this.allEntities) {
            const comp = entity.components.FactoryBox;
            comp.costRate = (comp.costAcc || 0) / seconds; // ms of work per real second
            comp.costAcc = 0;
            boxTotal += comp.costRate;
        }
        // What the game does per second apart from the boxes (and apart from the
        // recipes worked out in the background), per real building
        const totalMs = Math.max(0, tickStats.ms - tickStats.excluded) / seconds;
        const realCount = Math.max(1, this.root.entityMgr.entities.length - this.allEntities.length);
        this.costResult = { at: Date.now(), perBuilding: Math.max(0, totalMs - boxTotal) / realCount };
        const hud = this.root.hud && this.root.hud.parts.factoryCompressor;
        if (hud) hud.notify("Cost measured - open a compressed factory to see what it costs", shapez.enumNotificationType.success);
    }

    // What a box costs the game, next to what its buildings would cost as real
    // ones (estimated: an average real building times a weight per kind), from
    // the last measurement: { ready, boxMs (per second), realMs, ratio, verdict, count, minutesAgo }
    getCostReport(entity) {
        const comp = entity.components.FactoryBox;
        if (!this.costResult || comp.costRate === undefined) return { ready: false, running: !!this.costRun };
        let weighted = 0;
        let count = 0;
        for (const payload of JSON.parse(comp.state.blob)) {
            const c = payload.components;
            count++;
            weighted += c.Storage ? COST_WEIGHT.storage
                : c.ItemProcessor ? COST_WEIGHT.processor
                : c.UndergroundBelt ? COST_WEIGHT.tunnel
                : c.Miner ? COST_WEIGHT.miner
                : c.Filter ? COST_WEIGHT.filter
                : COST_WEIGHT.belt;
        }
        const realMs = weighted * this.costResult.perBuilding;
        const boxMs = comp.costRate;
        const ratio = boxMs > 0 ? realMs / boxMs : Infinity;
        const verdict = ratio >= 2 ? "good" : ratio >= 1.2 ? "small" : "bad";
        return { ready: true, boxMs, realMs, ratio, verdict, count, minutesAgo: Math.round((Date.now() - this.costResult.at) / 60000) };
    }

    // The input teleporters that hold a shape right now, grouped by channel (in
    // building order). Most inputs are empty, so a box asking for its channel's
    // shapes only walks the few that have one. Built once per tick; a shape that
    // arrives later in the tick is seen on the next one.
    getHeldByChannel() {
        if (this.heldByChannel) return this.heldByChannel;
        const map = new Map();
        for (const e of this.root.entityMgr.componentToEntity.InputTeleporterComponent || []) {
            const tp = e.components.InputTeleporterComponent;
            if (!tp || !tp.channel || !tp.item) continue;
            const list = map.get(tp.channel);
            if (list) list.push(e);
            else map.set(tp.channel, [e]);
        }
        return (this.heldByChannel = map);
    }

    // A recipe box with miners that stands on other deposits than the ones its
    // recipe was made for (a pasted copy): it fails until the recipe is
    // recalculated here (Update recipe) or the factory is unpacked. Live boxes
    // follow the deposits by themselves.
    minersMismatch(entity, comp) {
        const st = comp.state;
        const origin = entity.components.StaticMapEntity.origin;
        // The position strings are only rebuilt when the box or its recipe moved
        if (comp.mmX !== origin.x || comp.mmY !== origin.y || comp.mmAt !== st.minersAt) {
            comp.mmX = origin.x;
            comp.mmY = origin.y;
            comp.mmAt = st.minersAt;
            comp.mmHere = origin.x + "," + origin.y;
            comp.mmHome = comp.mmHere === (st.minersAt || st.ox + "," + st.oy);
        }
        if (comp.mmHome) return false;
        const here = comp.mmHere;
        if (comp.minerChecked !== here) {
            comp.minerChecked = here;
            comp.minerBad = minersMissingDeposit(this.root, entity, origin);
        }
        return comp.minerBad > 0;
    }

    tickBox(entity, dt) {
        const comp = entity.components.FactoryBox;
        const st = comp.state;
        if (!st) return;
        if (comp.sim) {
            comp.age = (comp.age || 0) + dt;
            if (comp.watch) {
                // The conversion lives in the HUD part (it shows the dialogs)
                const hud = this.root.hud && this.root.hud.parts.factoryCompressor;
                if (hud) hud.checkWatch(entity, comp);
            }
            this.tickLive(entity, comp, dt);
            return;
        }
        if (this.minersMismatch(entity, comp)) {
            comp.status = "miners";
            return;
        }
        const recipe = st.recipe;
        if (!recipe) {
            comp.status = "norecipe";
            return;
        }
        if (!comp.plan) this.getPlan(comp);
        if (!comp.hasIo) {
            comp.status = "norecipe";
            return;
        }

        this.pullFromTeleporters(comp, st);

        let running = 0;
        if (!comp.lineInfo) {
            comp.lineInfo = st.lines.map(() => ({ use: 1, why: null, key: null, active: false }));
            comp.wake = true;
        }
        // A line that is not running can only start after something arrived, was
        // taken away or was produced (each sets comp.wake), or when it draws from
        // the Hub; otherwise its blocker is what it was last time
        const look = comp.wake || comp.polls;
        comp.wake = false;
        let blocker = look ? null : comp.blocker || null;
        comp.age = (comp.age || 0) + dt;
        for (let line = 0; line < st.lines.length; ++line) {
            const state = st.lines[line];
            const info = comp.lineInfo[line];
            if (!state.running && look) {
                const block = this.getStartBlocker(comp, line);
                info.active = !block || block.why !== "idle";
                if (block) {
                    if (block.why !== "idle") {
                        blocker = blocker || block.why;
                        info.why = block.why;
                        info.key = block.key;
                    }
                } else {
                    this.consumeInputs(comp, line);
                    state.running = true;
                    state.progress = 0;
                }
            }
            // Share of time the line runs, averaged over about USAGE_SECONDS
            info.use += ((state.running ? 1 : 0) - info.use) * Math.min(1, dt / USAGE_SECONDS);
            if (state.running) {
                running++;
                state.progress += dt;
                if (state.progress >= recipe.cycles[line]) {
                    state.running = false;
                    state.progress = 0;
                    this.produceOutputs(comp, line);
                }
            }
        }
        comp.runningLines = running;
        if (look) comp.blocker = blocker;
        comp.status = running > 0 ? "running" : blocker || "input";

        this.flushOutputs(entity, comp, st);
        ensureFlow(comp);
        foldFlows(comp, dt);
    }

    pullFromTeleporters(comp, st) {
        // comp.tpIn: the teleporter inputs that have a recipe entry (from getPlan)
        for (let n = 0; n < comp.tpIn.length; ++n) {
            const portIndex = comp.tpIn[n];
            const port = st.ports[portIndex];
            const entries = st.recipe.io[portIndex];
            const inputs = this.getHeldByChannel().get(port.channel);
            if (!inputs) continue;
            const buf = st.buf[portIndex] || (st.buf[portIndex] = {});
            const hasRoom = () => entries.some(e => (buf[e.key] || 0) < entryCapacity(e.amount));
            if (!hasRoom()) continue;
            let pulled = 0;
            const perTick = Math.max(1, port.lanes || 1);
            for (let i = 0; i < inputs.length && pulled < perTick; ++i) {
                // Never feed the box its own teleporter output
                if (inputs[i].fcFake && comp.fakeTeleporters.includes(inputs[i])) continue;
                const tp = inputs[i].components.InputTeleporterComponent;
                if (!tp || tp.channel !== port.channel || !tp.item) continue;
                const key = itemKey(tp.item);
                const entry = entries.find(e => e.key === key);
                if (!entry || (buf[key] || 0) >= entryCapacity(entry.amount)) continue;
                buf[key] = (buf[key] || 0) + 1;
                comp.wake = true;
                countFlow(comp, "in", key);
                tp.item = null;
                pulled++;
                if (!hasRoom()) break;
            }
        }
    }

    // Per line and shape: which ports it comes in / goes out through. Ports of
    // one line carrying the same shape share the work, like a balancer would:
    // inputs are taken from whichever belt has them, and the share of a
    // backed-up output goes to another output of that shape.
    getPlan(comp) {
        if (comp.plan) return comp.plan;
        const st = comp.state;
        const plan = st.lines.map(() => ({ inputs: new Map(), hubInputs: [], outputs: new Map() }));
        // Per-box facts the tick would otherwise recompute every time; a new plan
        // (new recipe) also means everything has to be looked at again
        comp.hasIo = Object.keys(st.recipe.io).length > 0;
        comp.tpIn = [];
        st.ports.forEach((port, index) => {
            if (port.kind === "tp-in" && st.recipe.io[index]) comp.tpIn.push(index);
        });
        comp.entryMaps = [];
        comp.portFull = null;
        comp.wake = true;
        comp.outPending = true;
        for (const portIndex in st.recipe.io) {
            const port = st.ports[portIndex];
            const linePlan = plan[port.group];
            for (const entry of st.recipe.io[portIndex]) {
                if (port.kind === "hub-in") {
                    linePlan.hubInputs.push(entry);
                    continue;
                }
                const map = isInputPort(port) ? linePlan.inputs : linePlan.outputs;
                if (!map.has(entry.key)) map.set(entry.key, { total: 0, ports: [] });
                const group = map.get(entry.key);
                group.total += entry.amount;
                group.ports.push({ portIndex, amount: entry.amount, hub: port.kind === "hub-out" });
            }
        }
        // Hub inputs depend on the Hub's stock, nothing wakes the box for them
        comp.polls = plan.some(l => l.hubInputs.length > 0);
        return (comp.plan = plan);
    }

    // Returns null if the line can start a cycle, else { why, key }: why is
    // "input" (key = the shape it is short of), "output" (key = the shape
    // backed up) or "idle" for a line without any recipe
    getStartBlocker(comp, line) {
        const st = comp.state;
        const linePlan = this.getPlan(comp)[line];
        if (linePlan.inputs.size === 0 && linePlan.hubInputs.length === 0 && linePlan.outputs.size === 0) {
            return { why: "idle" };
        }
        const hubGoals = this.root.hubGoals;
        for (const entry of linePlan.hubInputs) {
            if (hubGoals.getShapesStoredByKey(entry.key) < entry.amount) return { why: "input", key: entry.key };
        }
        for (const [key, group] of linePlan.inputs) {
            let have = 0;
            for (const p of group.ports) have += (st.buf[p.portIndex] || {})[key] || 0;
            if (have < group.total) return { why: "input", key };
        }
        for (const [key, group] of linePlan.outputs) {
            if (group.ports.some(p => p.hub)) continue; // the Hub takes everything
            let pending = 0;
            for (const p of group.ports) pending += (st.buf[p.portIndex] || {})[key] || 0;
            // Some cycles of pending output are fine, more means it is backed up
            if (pending > group.total * (BUFFER_CYCLES - 1)) return { why: "output", key };
        }
        return null;
    }

    consumeInputs(comp, line) {
        const st = comp.state;
        comp.portFull = null;
        const linePlan = this.getPlan(comp)[line];
        for (const entry of linePlan.hubInputs) this.root.hubGoals.takeShapeByKey(entry.key, entry.amount);
        for (const [key, group] of linePlan.inputs) {
            let remaining = group.total;
            // Take from the fullest buffers first
            const sorted = group.ports
                .map(p => st.buf[p.portIndex] || (st.buf[p.portIndex] = {}))
                .sort((a, b) => (b[key] || 0) - (a[key] || 0));
            for (const buf of sorted) {
                const take = Math.min(remaining, buf[key] || 0);
                buf[key] = (buf[key] || 0) - take;
                remaining -= take;
                if (remaining <= 0) break;
            }
        }
    }

    produceOutputs(comp, line) {
        const st = comp.state;
        comp.outPending = true;
        comp.wake = true;
        const linePlan = this.getPlan(comp)[line];
        for (const [key, group] of linePlan.outputs) {
            let surplus = 0;
            const open = [];
            for (const p of group.ports) {
                if (p.hub) {
                    open.push(p);
                    continue;
                }
                const buf = st.buf[p.portIndex] || (st.buf[p.portIndex] = {});
                if ((buf[key] || 0) > p.amount * (BUFFER_CYCLES - 1)) {
                    surplus += p.amount; // this outlet is backed up
                } else {
                    open.push(p);
                }
            }
            if (open.length === 0) {
                // Everything is backed up: keep it where the recipe says
                open.push(...group.ports);
                surplus = 0;
            }
            open.forEach((p, i) => {
                // The first open outlet also takes the backed-up outlets' share
                const amount = p.amount + (i === 0 ? surplus : 0);
                if (p.hub) {
                    const definition = this.root.shapeDefinitionMgr.getShapeFromShortKey(key);
                    for (let n = 0; n < amount; ++n) this.root.hubGoals.handleDefinitionDelivered(definition);
                    countFlow(comp, "hub", key, amount);
                } else {
                    const buf = st.buf[p.portIndex] || (st.buf[p.portIndex] = {});
                    buf[key] = (buf[key] || 0) + amount;
                }
            });
        }
    }

    // The pending key with the most items on an output port, or null
    peekPendingKey(st, portIndex) {
        const buf = st.buf[portIndex];
        if (!buf) return null;
        let best = null;
        for (const key in buf) {
            if (buf[key] > 0 && (!best || buf[key] > buf[best])) best = key;
        }
        return best;
    }

    takePendingItem(st, portIndex) {
        const key = this.peekPendingKey(st, portIndex);
        if (!key) return null;
        st.buf[portIndex][key] -= 1;
        return keyToItem(this.root, key);
    }

    // The belt path right outside a belt output port, if a belt accepts from it
    getTargetBeltPath(entity, port) {
        const origin = entity.components.StaticMapEntity.origin;
        let seen = outsideTiles.get(port);
        if (!seen || seen.ver !== mapVersion || seen.ox !== origin.x || seen.oy !== origin.y) {
            const v = dirVec(port.dir);
            seen = {
                ver: mapVersion,
                ox: origin.x,
                oy: origin.y,
                tile: this.root.map.getLayerContentXY(origin.x + port.x + v.x, origin.y + port.y + v.y, "regular"),
            };
            outsideTiles.set(port, seen);
        }
        const target = seen.tile;
        if (!target || !target.components.Belt) return null;
        const forward = target.components.StaticMapEntity.localDirectionToWorld(shapez.enumDirection.top);
        return forward === port.dir ? target.components.Belt.assignedPath : null;
    }

    // comp.outPending is false while nothing waits at the exits (set again by
    // produceOutputs / getPlan), so an idle box skips the exit scan entirely
    flushOutputs(entity, comp, st) {
        if (comp.outPending === false) return;
        const ejector = entity.components.ItemEjector;
        for (let slot = 0; slot < comp.outSlotToPort.length; ++slot) {
            if (!ejector.canEjectOnSlot(slot)) continue;
            const portIndex = comp.outSlotToPort[slot];
            const key = this.peekPendingKey(st, portIndex);
            if (!key) continue;
            // Onto a belt directly: an ejector is slower than a full belt
            const path = this.getTargetBeltPath(entity, st.ports[portIndex]);
            if (path) {
                // A belt without room refuses the shape anyway
                if (!path.canAcceptItem()) continue;
                if (path.tryAcceptItem(keyToItem(this.root, key))) {
                    st.buf[portIndex][key] -= 1;
                    comp.wake = true;
                    countFlow(comp, "out", key);
                }
            } else if (ejector.tryEject(slot, keyToItem(this.root, key))) {
                st.buf[portIndex][key] -= 1;
                comp.wake = true;
                countFlow(comp, "out", key);
            }
        }
        for (const fake of comp.fakeTeleporters) {
            const tp = fake.components.InputTeleporterComponent;
            if (tp.item) continue;
            tp.item = this.takePendingItem(st, fake.portIndex);
            if (tp.item) {
                comp.wake = true;
                countFlow(comp, "out", itemKey(tp.item));
            }
        }
        let left = false;
        for (let slot = 0; slot < comp.outSlotToPort.length && !left; ++slot) {
            left = !!this.peekPendingKey(st, comp.outSlotToPort[slot]);
        }
        for (let i = 0; i < comp.fakeTeleporters.length && !left; ++i) {
            left = !!this.peekPendingKey(st, comp.fakeTeleporters[i].portIndex);
        }
        comp.outPending = left;
    }

    drawChunk(parameters, chunk) {
        const contents = chunk.containedEntitiesByLayer.regular;
        for (let i = 0; i < contents.length; ++i) {
            const comp = contents[i].components.FactoryBox;
            if (comp && comp.state) this.drawBox(parameters, chunk, contents[i], comp);
        }
    }

    drawBox(parameters, chunk, entity, comp) {
        const st = comp.state;
        const ctx = parameters.context;
        const bounds = entity.components.StaticMapEntity.getTileSpaceBounds();
        const x = bounds.x * 32;
        const y = bounds.y * 32;
        const w = bounds.w * 32;
        const h = bounds.h * 32;
        const clip = chunk.worldSpaceRectangle;

        // Clip to the part of the box inside this chunk, so text never spills out
        // (1px overlap with the neighbouring chunk avoids seams when zoomed)
        const left = Math.max(clip.x - 1, x);
        const top = Math.max(clip.y - 1, y);
        const right = Math.min(clip.x + clip.w + 1, x + w);
        const bottom = Math.min(clip.y + clip.h + 1, y + h);
        if (right <= left || bottom <= top) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();

        ctx.fillStyle = "#2c2550";
        ctx.fillRect(x, y, w, h);
        this.drawGhost(parameters, chunk, comp);
        ctx.strokeStyle = "#a99cff";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

        // Port arrows and numbers on the belt edges
        ctx.textAlign = "center";
        ctx.font = "bold 9px GameFont";
        st.ports.forEach((port, index) => {
            if (!port.kind.startsWith("belt")) return;
            const cx = x + port.x * 32 + 16;
            const cy = y + port.y * 32 + 16;
            const isIn = port.kind === "belt-in";
            const hasRecipe = !!comp.sim || !!st.recipe.io[index];
            // Arrow points in the direction items travel
            const travel = isIn ? shapez.enumInvertedDirections[port.dir] : port.dir;
            const v = dirVec(travel);
            const edge = dirVec(port.dir);
            const ax = cx + edge.x * 10;
            const ay = cy + edge.y * 10;
            ctx.fillStyle = hasRecipe ? (isIn ? "#6fe38a" : "#ffb454") : "#9a93b8";
            ctx.beginPath();
            ctx.moveTo(ax + v.x * 6, ay + v.y * 6);
            ctx.lineTo(ax - v.x * 4 + v.y * 6, ay - v.y * 4 + v.x * 6);
            ctx.lineTo(ax - v.x * 4 - v.y * 6, ay - v.y * 4 - v.x * 6);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.fillText(String(index + 1), cx - edge.x * 3, cy - edge.y * 3 + 3);
        });

        // Name, status, and rows of what goes in and comes out, scaled to fit
        const { inputs, outputs, hub } = this.summarize(comp);
        const stock = this.getStockEntries(comp);
        const rows = [inputs, outputs, hub, stock].filter(r => r && r.length > 0).length;
        const lineHeight = Math.max(8, Math.min(32, Math.min(w * 0.06, h / (2 + rows * 1.6))));
        const iconSize = lineHeight * 1.3;
        const blockHeight = lineHeight * 2 + rows * iconSize * 1.25;
        let lineY = y + h / 2 - blockHeight / 2 + lineHeight * 0.8;
        const centerX = x + w / 2;

        // Dark panel behind the text so it stays readable over the buildings
        const panelW = Math.min(w - 8, Math.max(lineHeight * 12, iconSize * 16));
        ctx.fillStyle = "rgba(20, 16, 40, 0.78)";
        ctx.fillRect(centerX - panelW / 2, lineY - lineHeight * 1.1, panelW, blockHeight + lineHeight * 0.6);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold " + lineHeight + "px GameFont";
        drawRichText(this.root, parameters, st.name || "Compressed factory", centerX, lineY, lineHeight);
        lineY += lineHeight;
        const status = this.getStatus(comp);
        ctx.font = "bold " + lineHeight * 0.7 + "px GameFont";
        ctx.fillStyle = status.color;
        if (status.key && status.label && isValidKey(status.key)) {
            // Long shape keys do not fit: draw the shape itself after the label
            const labelWidth = ctx.measureText(status.label).width;
            const icon = lineHeight * 1.1;
            const startX = centerX - (labelWidth + icon * 1.2) / 2;
            ctx.textAlign = "left";
            ctx.fillText(status.label, startX, lineY);
            ctx.textAlign = "center";
            keyToItem(this.root, status.key).drawItemCenteredClipped(
                startX + labelWidth + icon * 0.7,
                lineY - lineHeight * 0.25,
                parameters,
                icon
            );
        } else {
            ctx.fillText(status.text, centerX, lineY);
        }
        if (status.use !== null) {
            // Capacity bar
            const barW = Math.min(w * 0.6, lineHeight * 10);
            const barY = lineY + lineHeight * 0.3;
            ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.fillRect(centerX - barW / 2, barY, barW, lineHeight * 0.25);
            ctx.fillStyle = status.color;
            ctx.fillRect(centerX - barW / 2, barY, barW * Math.max(0, Math.min(1, status.use)), lineHeight * 0.25);
        }
        lineY += iconSize * 0.5;

        const drawRow = (label, color, entries) => {
            if (entries.length === 0) return;
            const shown = entries.slice(0, 6);
            const cell = iconSize * 2.6;
            const labelWidth = iconSize * 1.6;
            let cx = centerX - (labelWidth + shown.length * cell) / 2;
            const cy = lineY + iconSize * 0.6;
            ctx.textAlign = "left";
            ctx.font = "bold " + lineHeight * 0.65 + "px GameFont";
            ctx.fillStyle = color;
            ctx.fillText(label, cx, cy + lineHeight * 0.25);
            cx += labelWidth;
            for (const entry of shown) {
                keyToItem(this.root, entry.key).drawItemCenteredClipped(cx + iconSize / 2, cy, parameters, iconSize);
                ctx.fillStyle = entry.text === undefined && entry.perSecond < 0.05 ? "#ff7a7a" : "#ffffff";
                ctx.fillText(
                    entry.text !== undefined ? entry.text : formatPerSecond(entry.perSecond) + "/s",
                    cx + iconSize * 1.05,
                    cy + lineHeight * 0.25
                );
                cx += cell;
            }
            ctx.textAlign = "center";
            lineY += iconSize * 1.25;
        };
        drawRow("IN", "#6fe38a", inputs);
        drawRow("OUT", "#ffb454", outputs);
        drawRow("HUB", "#ffd84a", hub || []);
        drawRow("STOCK", "#9ad1ff", stock);

        ctx.restore();
    }

    // What a live box's storages hold, the biggest stocks first:
    // [{ key, count, text }]. Worked out once a second.
    getStockEntries(comp) {
        if (!comp.sim) return [];
        const now = performance.now();
        if (comp.stockCache && now - comp.stockCacheTime < 1000) return comp.stockCache;
        const totals = comp.sim.stockTotals();
        comp.stockCache = [...totals]
            .sort((a, b) => b[1] - a[1])
            .map(([key, count]) => ({ key, count: Math.round(count), text: formatCount(count) }));
        comp.stockCacheTime = now;
        return comp.stockCache;
    }

    // How close the box runs to its capacity, and what holds it back:
    // { text, color, use (0..1 or null), why, key }
    // A measured recipe is a fixed table: it does not change when an upgrade is
    // bought. Outdated when the upgrades differ from those it was measured with
    // (or it was made before they were recorded: then nobody knows).
    isOutdated(comp) {
        const st = comp.state;
        if (!st || comp.sim || st.source !== "measured") return false;
        const now = this.root.hubGoals.upgradeLevels;
        if (!st.upg) return true;
        return Object.keys(now).some(id => (now[id] || 0) !== (st.upg[id] || 0));
    }

    getStatus(comp) {
        if (comp.sim) return this.getLiveStatus(comp);
        if (comp.status === "miners") {
            return { text: "miners do not match the deposits - Update recipe or Unpack", color: "#ff5c5c", use: null, why: "miners" };
        }
        if (this.isOutdated(comp)) {
            return { text: "needs update - press Update recipe", color: "#ffd84a", use: null, why: "outdated" };
        }
        if (comp.status === "norecipe" || !comp.lineInfo) {
            return { text: "no recipe - click to set", color: "#b8b0e0", use: null };
        }
        const rejected = comp.rejected;
        if (rejected && this.root.time.now() - rejected.at < 1) {
            const expected = (comp.state.recipe.io[rejected.portIndex] || []).map(e => e.key).join(" / ");
            return {
                text: "#" + (rejected.portIndex + 1) + " blocked: got " + rejected.key + ", expects " + expected,
                label: "#" + (rejected.portIndex + 1) + " blocked by",
                color: "#ff5c5c",
                use: null,
                why: "wrong",
                key: rejected.key,
                portIndex: rejected.portIndex,
                expected,
            };
        }
        if (comp.age < USAGE_SECONDS / 2) {
            return { text: "starting ...", color: "#d8d2ff", use: null };
        }
        const active = comp.lineInfo.filter(l => l.active);
        if (active.length === 0) return { text: "idle", color: "#b8b0e0", use: 0 };
        const use = active.reduce((sum, l) => sum + l.use, 0) / active.length;
        const worst = active.reduce((a, b) => (b.use < a.use ? b : a));
        const percent = Math.round(use * 100);
        if (worst.use >= FULL_CAPACITY_USE) {
            return { text: "full capacity", color: "#6fe38a", use };
        }
        if (worst.why === "output") {
            return {
                text: "output blocked: " + worst.key + " is not taken away",
                label: "output blocked - not taken away:",
                color: "#ff7a7a",
                use,
                why: "output",
                key: worst.key,
            };
        }
        return {
            text: percent + "% - needs more " + (worst.key || "input"),
            label: percent + "% - needs more",
            color: "#ffb454",
            use,
            why: "input",
            key: worst.key,
        };
    }

    getStatusText(comp) {
        return this.getStatus(comp).text;
    }

    // The original buildings, faded, as a picture of what is inside
    drawGhost(parameters, chunk, comp) {
        if (!comp.ghost) {
            comp.ghost = [];
            try {
                const entities = comp.sim ? comp.sim.items : deserializeEntities(this.root, boxPayloads(comp.entityRef));
                for (const { entity } of entities) {
                    if (entity.layer !== "regular") continue;
                    const staticComp = entity.components.StaticMapEntity;
                    const sprite = staticComp.getSprite() || staticComp.getBlueprintSprite();
                    if (sprite) comp.ghost.push({ staticComp, sprite, bounds: staticComp.getTileSpaceBounds() });
                }
            } catch (e) {
                comp.ghost = [];
            }
        }
        const r = chunk.tileSpaceRectangle;
        const ctx = parameters.context;
        ctx.globalAlpha = 0.45;
        for (const g of comp.ghost) {
            const b = g.bounds;
            if (b.x + b.w <= r.x || b.y + b.h <= r.y || b.x >= r.x + r.w || b.y >= r.y + r.h) continue;
            g.staticComp.drawSpriteOnBoundsClipped(parameters, g.sprite, 0);
        }
        ctx.globalAlpha = 1;
    }

    // Status, worked out at most once a second per box (drawing asks every frame)
    getCachedStatus(comp) {
        const now = this.root.time.realtimeNow();
        if (!comp.statusCache || now - comp.statusCache.at > 1) {
            comp.statusCache = { at: now, value: this.getStatus(comp) };
        }
        return comp.statusCache.value;
    }

    // A box's zoomed-out label (name + main products), drawn into a small
    // canvas every couple of seconds instead of every frame
    getLabelCanvas(comp) {
        const now = this.root.time.realtimeNow();
        if (comp.labelCache && now - comp.labelCache.at < 2) return comp.labelCache;
        const { outputs, hub } = this.summarize(comp);
        const products = [...(hub || []), ...(outputs || [])].slice(0, 4);
        const status = this.getCachedStatus(comp);
        const size = 20;
        const canvas = (comp.labelCache && comp.labelCache.canvas) || document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        ctx.font = "bold " + size + "px GameFont";
        const name = comp.state.name || "Compressed factory";
        const width = Math.ceil(Math.max(ctx.measureText(name).width + size * 2, products.length * size * 1.7 + size));
        const height = Math.ceil(size * (products.length > 0 ? 3.3 : 1.9));
        canvas.width = width;
        canvas.height = height;
        ctx.font = "bold " + size + "px GameFont";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(20, 16, 40, 0.85)";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = status.color || "#ffffff";
        ctx.fillRect(0, 0, size * 0.3, height);
        ctx.fillStyle = "#ffffff";
        const parameters = {
            context: ctx,
            visibleRect: new shapez.Rectangle(-1e6, -1e6, 2e6, 2e6),
            desiredAtlasScale: "0.5",
            zoomLevel: 1,
            root: this.root,
        };
        drawRichText(this.root, parameters, name, width / 2, size * 1.25, size);
        products.forEach((p, i) => {
            keyToItem(this.root, p.key).drawItemCenteredClipped(
                width / 2 + (i - (products.length - 1) / 2) * size * 1.7,
                size * 2.4,
                parameters,
                size * 1.3
            );
        });
        comp.labelCache = { at: now, canvas, width, height };
        return comp.labelCache;
    }

    // Zoomed out: boxes big enough on screen get their label (name and main
    // products); smaller ones just a square in their status color, so labels
    // never pile up
    drawFarLabels(parameters) {
        const zoom = this.root.camera.zoomLevel;
        if (zoom > 0.7 && !this.root.camera.getIsMapOverlayActive()) return;
        const ctx = parameters.context;
        const labelScreenWidth = 150;
        for (const entity of this.allEntities) {
            const comp = entity.components.FactoryBox;
            if (!comp.state) continue;
            const b = entity.components.StaticMapEntity.getTileSpaceBounds();
            const cx = (b.x + b.w / 2) * 32;
            const cy = (b.y + b.h / 2) * 32;
            if (!parameters.visibleRect.containsCircle(cx, cy, Math.max(b.w, b.h) * 32)) continue;
            const screenWidth = b.w * 32 * zoom;
            if (screenWidth < labelScreenWidth) {
                const side = Math.min(b.w, b.h) * 32 * 0.45;
                ctx.fillStyle = this.getCachedStatus(comp).color || "#ffffff";
                ctx.fillRect(cx - side / 2, cy - side / 2, side, side);
                continue;
            }
            const label = this.getLabelCanvas(comp);
            // Shown at about its own pixel size, but never wider than the box
            const scale = Math.min(1 / zoom, (b.w * 32 * 0.9) / label.width);
            ctx.drawImage(label.canvas, cx - (label.width * scale) / 2, cy - (label.height * scale) / 2, label.width * scale, label.height * scale);
        }
    }
}

////////////////////////////////////////////////////////////////////////
// Region analysis - collects the buildings, checks them and finds the ports

class RegionAnalyzer {
    constructor(root) {
        this.root = root;
    }

    // Grows the selection's bounding box until no building sticks out of it,
    // and collects every building (both layers) inside it.
    collect(selectedEntities) {
        let rect = null;
        const kept = selectedEntities.filter(e => staysOutside(e));
        for (const entity of selectedEntities) {
            if (staysOutside(entity)) continue;
            rect = this.union(rect, entity.components.StaticMapEntity.getTileSpaceBounds());
        }
        const entities = new Set();
        const blockedInside = new Set();
        if (!rect) return { rect: { x: 0, y: 0, w: 0, h: 0 }, entities, kept, blockedInside, nothing: true };
        // Each pass only reads the tiles the last pass added, so every tile is
        // read once even when the area grows many times
        let scanned = null;
        for (;;) {
            if (rect.w * rect.h > MAX_REGION_TILES) return { rect, entities, tooLarge: true };
            let grown = false;
            const area = rect;
            for (let x = area.x; x < area.x + area.w; ++x) {
                const columnScanned = scanned && x >= scanned.x && x < scanned.x + scanned.w;
                for (let y = area.y; y < area.y + area.h; ++y) {
                    if (columnScanned && y >= scanned.y && y < scanned.y + scanned.h) {
                        y = scanned.y + scanned.h - 1;
                        continue;
                    }
                    for (const content of this.root.map.getLayersContentsMultipleXY(x, y)) {
                        if (entities.has(content) || blockedInside.has(content)) continue;
                        if (staysOutside(content)) {
                            blockedInside.add(content);
                            continue;
                        }
                        entities.add(content);
                        const bounds = content.components.StaticMapEntity.getTileSpaceBounds();
                        if (!this.contains(rect, bounds)) {
                            rect = this.union(rect, bounds);
                            grown = true;
                        }
                    }
                }
            }
            if (!grown) break;
            scanned = area;
        }
        return { rect, entities, kept, blockedInside, tooLarge: false };
    }

    union(a, b) {
        if (!a) return { x: b.x, y: b.y, w: b.w, h: b.h };
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const right = Math.max(a.x + a.w, b.x + b.w);
        const bottom = Math.max(a.y + a.h, b.y + b.h);
        return { x, y, w: right - x, h: bottom - y };
    }

    contains(rect, b) {
        return b.x >= rect.x && b.y >= rect.y && b.x + b.w <= rect.x + rect.w && b.y + b.h <= rect.y + rect.h;
    }

    inside(rect, tile) {
        return tile.x >= rect.x && tile.y >= rect.y && tile.x < rect.x + rect.w && tile.y < rect.y + rect.h;
    }

    // Returns a list of problems (empty if the region may be compressed)
    validate(rect, entities) {
        const problems = [];
        const add = text => {
            if (!problems.includes(text)) problems.push(text);
        };

        for (const entity of entities) {
            const staticComp = entity.components.StaticMapEntity;
            const where = " at " + staticComp.origin.x + "," + staticComp.origin.y;
            for (const id in BLOCKING_COMPONENTS) {
                if (entity.components[id]) add("Contains " + BLOCKING_COMPONENTS[id] + where);
            }
            if (!entity.components.Hub && !entity.components.FactoryBox && !this.root.logic.canDeleteBuilding(entity)) {
                add("Contains a building that cannot be removed" + where);
            }
        }

        this.checkWireNetworks(entities, add);
        this.checkTunnels(rect, entities, add);
        this.checkTransceivers(entities, add);
        this.checkMinerChains(rect, entities, add);

        const buyChunks = this.root.buyChunksData;
        if (buyChunks && typeof buyChunks.isTileOwned === "function") {
            let unowned = false;
            for (let x = rect.x; x < rect.x + rect.w && !unowned; ++x) {
                for (let y = rect.y; y < rect.y + rect.h && !unowned; ++y) {
                    if (!buyChunks.isTileOwned(x, y)) unowned = true;
                }
            }
            if (unowned) add("The area includes chunks you have not bought");
        }
        return problems;
    }

    // Wire-layer buildings that stay on the map instead of being compressed.
    // - Always: a wire network that leaves the area but has no pin on anything
    //   being compressed has nothing to do with the factory, so its wires, tunnels
    //   (and insulators, which decide what touches what) stay, instead of
    //   blocking the compression.
    // - With keepAll ("keep the wire layer"): everything on the wires layer stays
    //   (wires, constant signals, displays, logic gates ...) except what is tied to
    //   a compressed building's pins: such a network, and every wire-layer building
    //   on it, is compressed as before (and must be entirely inside the area).
    // Removes them from `entities`; returns how many.
    releaseThroughWires(entities, keepAll) {
        const onWires = e => e.layer === "wires";
        const nets = new Set();
        const addNet = n => {
            if (n) nets.add(n);
        };
        for (const e of entities) {
            if (e.components.Wire) addNet(e.components.Wire.linkedNetwork);
            if (e.components.WireTunnel) (e.components.WireTunnel.linkedNetworks || []).forEach(addNet);
            if (e.components.WiredPins) for (const slot of e.components.WiredPins.slots) addNet(slot.linkedNetwork);
        }
        // Networks that stay compressed
        const anchored = new Set();
        for (const n of nets) {
            const slotEntities = n.allSlots.map(s => s.entity);
            const leaves = [...n.wires, ...n.tunnels, ...slotEntities].some(e => !entities.has(e));
            if (!keepAll && !leaves) anchored.add(n);
            else if (slotEntities.some(e => entities.has(e) && (!keepAll || !onWires(e)))) anchored.add(n);
        }
        // Wire-layer buildings on such a network are compressed with it, and so is
        // every other network they are on
        const tied = new Set();
        if (keepAll) {
            for (let changed = true; changed; ) {
                changed = false;
                for (const e of entities) {
                    if (!onWires(e) || tied.has(e) || !e.components.WiredPins) continue;
                    const slots = e.components.WiredPins.slots;
                    if (!slots.some(s => s.linkedNetwork && anchored.has(s.linkedNetwork))) continue;
                    tied.add(e);
                    changed = true;
                    for (const s of slots) if (s.linkedNetwork) anchored.add(s.linkedNetwork);
                }
            }
        }
        const release = new Set();
        for (const e of entities) {
            if (!onWires(e) || tied.has(e)) continue;
            const c = e.components;
            if (c.Wire) {
                const n = c.Wire.linkedNetwork;
                if (n ? !anchored.has(n) : keepAll) release.add(e);
            } else if (c.WireTunnel) {
                const list = c.WireTunnel.linkedNetworks || [];
                if (list.length > 0 ? !list.some(n => anchored.has(n)) : keepAll) release.add(e);
            } else if (keepAll) {
                release.add(e); // other wire-layer buildings that are not on a compressed network
            }
        }
        if (release.size === 0) return 0;
        if (!keepAll) {
            // Insulators decide which wires touch: they stay too, or the wires
            // left behind could connect to each other
            for (const e of entities) if (e.components.WireInsulator) release.add(e);
        }
        for (const e of release) entities.delete(e);
        return release.size;
    }

    // Wires may only connect buildings that are all being compressed
    checkWireNetworks(entities, add) {
        const seen = new Set();
        const checkNetwork = network => {
            if (!network || seen.has(network)) return;
            seen.add(network);
            const members = [
                ...network.wires,
                ...network.tunnels,
                ...network.allSlots.map(s => s.entity),
            ];
            const outside = members.find(e => !entities.has(e));
            if (outside) {
                const origin = outside.components.StaticMapEntity.origin;
                add("A wire network leaves the area (at " + origin.x + "," + origin.y + ")");
            }
        };
        for (const entity of entities) {
            if (entity.components.Wire) checkNetwork(entity.components.Wire.linkedNetwork);
            if (entity.components.WiredPins) {
                for (const slot of entity.components.WiredPins.slots) checkNetwork(slot.linkedNetwork);
            }
            if (entity.components.WireTunnel) {
                for (const network of entity.components.WireTunnel.linkedNetworks || []) checkNetwork(network);
            }
        }
    }

    // Underground belts must not connect the area with the outside
    checkTunnels(rect, entities, add) {
        const system = this.root.systemMgr.systems.undergroundBelt;
        if (!system) return;
        const isSender = e => e.components.UndergroundBelt.mode === shapez.enumUndergroundBeltMode.sender;
        for (const entity of entities) {
            if (!entity.components.UndergroundBelt || !isSender(entity)) continue;
            const link = system.findRecieverForSender(entity);
            if (link.entity && !entities.has(link.entity)) add("A tunnel leaves the area");
        }
        const margin = 10;
        for (let x = rect.x - margin; x < rect.x + rect.w + margin; ++x) {
            for (let y = rect.y - margin; y < rect.y + rect.h + margin; ++y) {
                if (this.inside(rect, { x, y })) continue;
                const content = this.root.map.getLayerContentXY(x, y, "regular");
                if (!content || !content.components.UndergroundBelt || !isSender(content)) continue;
                const link = system.findRecieverForSender(content);
                if (link.entity && entities.has(link.entity)) add("A tunnel enters the area");
            }
        }
    }

    // A chain of miners passes its shapes from miner to miner: it must be
    // compressed as a whole
    checkMinerChains(rect, entities, add) {
        const chainTarget = miner => {
            const c = miner.components;
            if (!c.Miner || !c.Miner.chainable || !c.ItemEjector) return null;
            const staticComp = c.StaticMapEntity;
            const slot = c.ItemEjector.slots[0];
            const tile = staticComp.localTileToWorld(slot.pos).add(dirVec(staticComp.localDirectionToWorld(slot.direction)));
            const target = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
            return target && target.components.Miner && target.components.Miner.chainable ? target : null;
        };
        for (const entity of entities) {
            const target = chainTarget(entity);
            if (target && !entities.has(target)) {
                const o = entity.components.StaticMapEntity.origin;
                add("A chain of miners continues outside the area (at " + o.x + "," + o.y + ") - include the whole chain");
            }
        }
        for (let x = rect.x - 1; x <= rect.x + rect.w; ++x) {
            for (let y = rect.y - 1; y <= rect.y + rect.h; ++y) {
                if (this.inside(rect, { x, y })) continue;
                const content = this.root.map.getLayerContentXY(x, y, "regular");
                const target = content && !entities.has(content) && chainTarget(content);
                if (target && entities.has(target)) {
                    add("A chain of miners comes in from outside the area (at " + x + "," + y + ") - include the whole chain");
                }
            }
        }
    }

    // Wireless transceivers (Pnmod Transceiver) must stay inside the area
    checkTransceivers(entities, add) {
        const all = this.root.entityMgr.componentToEntity.TransceiverComponent || [];
        for (const entity of entities) {
            const comp = entity.components.TransceiverComponent;
            if (!comp || !comp.channel) continue;
            const partner = all.find(
                e => !entities.has(e) && e.components.TransceiverComponent.channel === comp.channel
            );
            if (partner) add("A wireless transceiver talks to the outside (channel \"" + comp.channel + "\")");
        }
    }

    // Does the building at `tile` push items travelling in world direction `dir`?
    feedsInto(tile, dir) {
        const entity = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
        if (!entity) return false;
        const staticComp = entity.components.StaticMapEntity;
        if (entity.components.Belt) {
            return staticComp.localDirectionToWorld(entity.components.Belt.direction) === dir;
        }
        const ejector = entity.components.ItemEjector;
        if (!ejector) return false;
        return ejector.slots.some(
            slot =>
                staticComp.localTileToWorld(slot.pos).equals(tile) &&
                staticComp.localDirectionToWorld(slot.direction) === dir
        );
    }

    // Does the building at `tile` accept items travelling in world direction `dir`?
    acceptsFrom(tile, dir) {
        const entity = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
        if (!entity) return false;
        const staticComp = entity.components.StaticMapEntity;
        if (entity.components.Belt) {
            return staticComp.localDirectionToWorld(shapez.enumDirection.top) === dir;
        }
        const acceptor = entity.components.ItemAcceptor;
        if (!acceptor) return false;
        const side = shapez.enumInvertedDirections[dir];
        return acceptor.slots.some(
            slot =>
                staticComp.localTileToWorld(slot.pos).equals(tile) &&
                staticComp.localDirectionToWorld(slot.direction) === side
        );
    }

    findPorts(rect, entities) {
        const ports = [];
        const seen = new Set();
        const addPort = port => {
            const id = port.kind + "|" + port.x + "|" + port.y + "|" + port.dir + "|" + (port.channel || "");
            if (seen.has(id)) return;
            seen.add(id);
            ports.push(port);
        };
        const addBelt = (kind, tile, dir) =>
            addPort({ kind, x: tile.x - rect.x, y: tile.y - rect.y, dir });

        for (const entity of entities) {
            if (entity.layer !== "regular") continue;
            const staticComp = entity.components.StaticMapEntity;

            if (entity.components.Belt) {
                const tile = staticComp.origin;
                const forward = staticComp.localDirectionToWorld(entity.components.Belt.direction);
                const target = tile.add(dirVec(forward));
                if (!this.inside(rect, target) && this.acceptsFrom(target, forward)) {
                    addBelt("belt-out", tile, forward);
                }
                const back = staticComp.localDirectionToWorld(shapez.enumDirection.bottom);
                const source = tile.add(dirVec(back));
                if (!this.inside(rect, source) && this.feedsInto(source, shapez.enumInvertedDirections[back])) {
                    addBelt("belt-in", tile, back);
                }
            }

            const ejector = entity.components.ItemEjector;
            if (ejector) {
                for (const slot of ejector.slots) {
                    const tile = staticComp.localTileToWorld(slot.pos);
                    const dir = staticComp.localDirectionToWorld(slot.direction);
                    const target = tile.add(dirVec(dir));
                    if (!this.inside(rect, target) && this.acceptsFrom(target, dir)) addBelt("belt-out", tile, dir);
                }
            }

            const acceptor = entity.components.ItemAcceptor;
            if (acceptor) {
                for (const slot of acceptor.slots) {
                    const tile = staticComp.localTileToWorld(slot.pos);
                    const side = staticComp.localDirectionToWorld(slot.direction);
                    const source = tile.add(dirVec(side));
                    if (!this.inside(rect, source) && this.feedsInto(source, shapez.enumInvertedDirections[side])) {
                        addBelt("belt-in", tile, side);
                    }
                }
            }
        }

        this.findTeleporterPorts(entities, addPort);

        // Outputs that end up in a Micro Hub or the Hub (over belts or directly)
        for (const port of ports) {
            if (port.kind !== "belt-out") continue;
            let tile = new shapez.Vector(port.x + rect.x, port.y + rect.y).add(dirVec(port.dir));
            for (let n = 0; n < 500; ++n) {
                const content = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
                if (!content) break;
                if (content.components.SkHub || content.components.Hub) {
                    port.toHub = true;
                    break;
                }
                if (!content.components.Belt) break;
                const forward = content.components.StaticMapEntity.localDirectionToWorld(content.components.Belt.direction);
                tile = tile.add(dirVec(forward));
            }
        }

        // Split into independent production lines and give every port its line
        const { find, channelMember } = this.computeLines(entities);
        const roots = [];
        const lineOfRoot = root => {
            let index = roots.indexOf(root);
            if (index < 0) index = roots.push(root) - 1;
            return index;
        };
        for (const port of ports) {
            let member = null;
            if (port.kind.startsWith("belt")) {
                member = this.root.map.getLayerContentXY(port.x + rect.x, port.y + rect.y, "regular");
            } else if (port.kind.startsWith("tp")) {
                member = channelMember.get(port.channel);
            }
            port.group = member ? lineOfRoot(find(member)) : lineOfRoot(port);
        }
        // Hub ports: one "to Hub" port per line that feeds a Micro Hub (known by
        // the Micro Hub input slots it arrives at), one "from Hub" port per line
        // with Hub Extractors
        this.hubLineOf = new Map();
        this.hubSlotPort = new Map();
        const hubPort = (kind, group) => {
            let port = ports.find(p => p.kind === kind && p.group === group);
            if (!port) ports.push((port = { kind, x: 0, y: 0, dir: "top", group, uids: [], hubSlots: [] }));
            return port;
        };
        for (const entity of entities) {
            if (entity.components.HubExtraction) {
                const group = lineOfRoot(find(entity));
                this.hubLineOf.set(entity, group);
                hubPort("hub-in", group).uids.push(entity.uid);
            }
            if (!entity.components.SkHub || !entity.components.ItemAcceptor) continue;
            const staticComp = entity.components.StaticMapEntity;
            entity.components.ItemAcceptor.slots.forEach((slot, index) => {
                const tile = staticComp.localTileToWorld(slot.pos);
                const from = tile.add(dirVec(staticComp.localDirectionToWorld(slot.direction)));
                const feeder = this.root.map.getLayerContentXY(from.x, from.y, "regular");
                if (!feeder) return;
                // Fed from outside the area: the Micro Hub's own line (with that input port)
                const port = hubPort("hub-out", lineOfRoot(find(entities.has(feeder) ? feeder : entity)));
                port.hubSlots.push(entity.uid + ":" + index);
                this.hubSlotPort.set(entity.uid + ":" + index, port);
            });
        }
        // Line of every building, for measuring how busy each line's machines are
        this.entityLine = new Map();
        for (const entity of entities) {
            if (entity.layer !== "regular") continue;
            const line = roots.indexOf(find(entity));
            if (line >= 0) this.entityLine.set(entity, line);
        }
        return ports;
    }

    // Union-find over the buildings: two buildings are on the same line if
    // items can move between them (belts, ejectors, tunnels, teleporter channels)
    computeLines(entities) {
        const parent = new Map();
        const find = e => {
            let root = e;
            while (parent.get(root) !== root) root = parent.get(root);
            let node = e;
            while (parent.get(node) !== root) {
                const next = parent.get(node);
                parent.set(node, root);
                node = next;
            }
            return root;
        };
        const union = (a, b) => {
            if (!parent.has(a) || !parent.has(b)) return;
            const ra = find(a);
            const rb = find(b);
            if (ra !== rb) parent.set(ra, rb);
        };
        for (const e of entities) if (e.layer === "regular") parent.set(e, e);

        // A Micro Hub or trash takes everything from every belt: it does not tie
        // the lines feeding it together
        const isSink = e => e.components.ItemProcessor && ["hub", "trash"].includes(e.components.ItemProcessor.type);
        const linkTo = (entity, tile, dir) => {
            const target = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
            if (target && target !== entity && !isSink(target) && this.acceptsFrom(tile, dir)) union(entity, target);
        };
        const tunnels = this.root.systemMgr.systems.undergroundBelt;
        const channelMember = new Map();
        for (const entity of parent.keys()) {
            const staticComp = entity.components.StaticMapEntity;
            if (entity.components.Belt) {
                const forward = staticComp.localDirectionToWorld(entity.components.Belt.direction);
                linkTo(entity, staticComp.origin.add(dirVec(forward)), forward);
            }
            const ejector = entity.components.ItemEjector;
            if (ejector) {
                for (const slot of ejector.slots) {
                    const dir = staticComp.localDirectionToWorld(slot.direction);
                    linkTo(entity, staticComp.localTileToWorld(slot.pos).add(dirVec(dir)), dir);
                }
            }
            const tunnel = entity.components.UndergroundBelt;
            if (tunnel && tunnels && tunnel.mode === shapez.enumUndergroundBeltMode.sender) {
                const link = tunnels.findRecieverForSender(entity);
                if (link.entity) union(entity, link.entity);
            }
            const tp = entity.components.InputTeleporterComponent || entity.components.OutputTeleporterComponent;
            if (tp && tp.channel) {
                if (channelMember.has(tp.channel)) union(entity, channelMember.get(tp.channel));
                else channelMember.set(tp.channel, entity);
            }
        }
        return { find: e => (parent.has(e) ? find(e) : e), channelMember };
    }

    // A teleporter inside the area becomes a port only if it talks to the outside
    findTeleporterPorts(entities, addPort) {
        const map = this.root.entityMgr.componentToEntity;
        const allInputs = map.InputTeleporterComponent || [];
        const allOutputs = map.OutputTeleporterComponent || [];
        const outsideInputs = new Set();
        const outsideOutputs = new Set();
        for (const e of allInputs) {
            if (!entities.has(e)) outsideInputs.add(e.components.InputTeleporterComponent.channel);
        }
        const outsideOutputCount = new Map();
        for (const e of allOutputs) {
            if (entities.has(e)) continue;
            const channel = e.components.OutputTeleporterComponent.channel;
            outsideOutputs.add(channel);
            outsideOutputCount.set(channel, (outsideOutputCount.get(channel) || 0) + 1);
        }
        // Other compressed factories that receive from teleporters count as outside outputs
        for (const box of map.FactoryBox || []) {
            if (entities.has(box)) continue;
            for (const port of box.components.FactoryBox.state.ports) {
                if (port.kind === "tp-in") outsideOutputs.add(port.channel);
            }
        }

        for (const entity of entities) {
            const input = entity.components.InputTeleporterComponent;
            if (input && input.channel && outsideOutputs.has(input.channel)) {
addPort({
                    kind: "tp-out",
                    x: 0,
                    y: 0,
                    dir: "top",
                    channel: input.channel,
                    outsideOutputs: outsideOutputCount.get(input.channel) || 1,
                });
            }
            const output = entity.components.OutputTeleporterComponent;
            if (output && output.channel && outsideInputs.has(output.channel)) {
                addPort({ kind: "tp-in", x: 0, y: 0, dir: "top", channel: output.channel });
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////
// Measuring - counts what crosses the edge of each area while it still runs.
// Belt ports are counted where items leave an ejector or cross a point on a
// belt path; teleporter and Hub ports by watching those systems.

function portWorldKey(port, rect) {
    if (port.kind.startsWith("belt")) {
        return port.kind + "|" + (port.x + rect.x) + "|" + (port.y + rect.y) + "|" + port.dir;
    }
    if (port.kind.startsWith("tp")) return port.kind + "|" + port.channel;
    return port.kind + "|" + port.group;
}

function beltKey(kind, tile, dir) {
    return kind + "|" + tile.x + "|" + tile.y + "|" + dir;
}

function lineCount(ports) {
    return Math.max(1, ...ports.map(p => p.group + 1));
}

function emptyRecipe(ports) {
    return { cycles: new Array(lineCount(ports)).fill(1), io: {} };
}

// Builds a recipe from measured counts. Each line gets the shortest cycle
// (up to 2 minutes) whose whole-number amounts are within 2% of every rate
// measured on that line.
function recipeFromCounts(ports, rect, counts, seconds, capacity = null) {
    const recipe = emptyRecipe(ports);
    const rates = [];
    ports.forEach((port, index) => {
        const measured = counts[portWorldKey(port, rect)];
        if (!measured) return;
        for (const key in measured) {
            if (port.kind.startsWith("hub") && isColorKey(key)) continue;
            const rate = measured[key] / seconds;
            if (rate >= 0.01) rates.push({ index, line: port.group, key, rate });
        }
    });

    recipe.cycles = recipe.cycles.map((_, line) => {
        const lineRates = rates.filter(r => r.line === line);
        for (let c = 1; c <= 120; ++c) {
            const fits = lineRates.every(r => {
                const amount = Math.round(r.rate * c);
                return amount >= 1 && Math.abs(amount / c - r.rate) <= 0.02 * r.rate;
            });
            if (fits) return c;
        }
        return 120;
    });

    for (const r of rates) {
        const amount = Math.max(1, Math.round(r.rate * recipe.cycles[r.line]));
        (recipe.io[r.index] || (recipe.io[r.index] = [])).push({ key: r.key, amount });
    }

    // A line whose busiest machine was idle part of the time can run faster
    // when more input arrives: shorten its cycle accordingly
    if (capacity) {
        recipe.cycles = recipe.cycles.map((cycle, line) => {
            const busy = capacity.busy.get(line);
            if (capacity.noBoost.has(line) || busy === undefined || busy >= 0.9) return cycle;
            return Math.max(0.05, Math.round(cycle * Math.max(MIN_MACHINE_BUSY, busy) * 100) / 100);
        });
    }
    return recipe;
}

class FlowMeter {
    constructor(root, regions) {
        this.root = root;
        this.regions = regions;
        this.seconds = 0;
        this.undo = [];
        this.entityRegion = new Map();
        regions.forEach(region => {
            region.counts = {};
            region.entities.forEach(e => this.entityRegion.set(e, region));
        });
    }

    regionOfTile(tile) {
        for (const region of this.regions) {
            const r = region.rect;
            if (tile.x >= r.x && tile.y >= r.y && tile.x < r.x + r.w && tile.y < r.y + r.h) return region;
        }
        return null;
    }

    count(region, portKey, key, amount = 1) {
        if (!region || !key || amount <= 0) return;
        const port = region.counts[portKey] || (region.counts[portKey] = {});
        port[key] = (port[key] || 0) + amount;
    }

    // Replaces a method on one object until stop()
    wrap(object, name, makeWrapper) {
        if (!object || typeof object[name] !== "function") return;
        const hadOwn = Object.prototype.hasOwnProperty.call(object, name);
        const previous = object[name];
        object[name] = makeWrapper(previous.bind(object));
        this.undo.push(() => {
            if (hadOwn) object[name] = previous;
            else delete object[name];
        });
    }

    start() {
        const systems = this.root.systemMgr.systems;
        this.setupEjectors();
        this.setupPaths();

        this.wrap(systems.itemEjector, "update", original => () => {
            for (const e of this.ejectors) e.before = e.slots[e.index].item;
            original();
            for (const e of this.ejectors) {
                if (e.before && e.slots[e.index].item !== e.before) this.count(e.region, e.portKey, itemKey(e.before));
            }
        });

        // How busy each machine is: a line whose busiest machine was often idle
        // was held back by its inputs and can run faster than measured
        this.machines = [];
        this.ticks = 0;
        for (const region of this.regions) {
            region.entityLine.forEach((line, entity) => {
                const processor = entity.components.ItemProcessor;
                if (processor) this.machines.push({ region, line, processor, busy: 0 });
            });
        }

        this.wrap(systems.belt, "update", original => () => {
            this.seconds += this.root.dynamicTickrate.deltaSeconds;
            this.ticks++;
            for (const m of this.machines) {
                if (m.processor.ongoingCharges.length > 0 || m.processor.queuedEjects.length > 0) m.busy++;
            }
            for (const tracked of this.paths) this.measurePath(tracked);
            original();
        });

        if (systems.OutputTeleporterSystem) {
            this.wrap(systems.OutputTeleporterSystem, "update", original => () => this.measureTeleporters(original));
        }

        // Micro Hub deliveries, by the input slot the shape arrives at
        this.entityRegion.forEach((region, entity) => {
            if (!entity.components.SkHub || !entity.components.ItemProcessor || !region.hubSlotPort) return;
            this.wrap(entity.components.ItemProcessor, "tryTakeItem", original => (item, slot) => {
                const taken = original(item, slot);
                const port = taken && region.hubSlotPort.get(entity.uid + ":" + slot);
                if (port) this.count(region, portWorldKey(port, region.rect), itemKey(item));
                return taken;
            });
        });

        // Hub Extractor: an ejector slot that gets filled took a shape from the Hub
        if (systems.HubExtraction) {
            const extractors = [];
            this.entityRegion.forEach((region, entity) => {
                if (entity.components.HubExtraction && entity.components.ItemEjector) {
                    extractors.push({ region, portKey: "hub-in|" + region.hubLineOf.get(entity), slot: entity.components.ItemEjector.slots[0] });
                }
            });
            this.wrap(systems.HubExtraction, "update", original => () => {
                for (const x of extractors) x.before = x.slot.item;
                original();
                for (const x of extractors) {
                    if (!x.before && x.slot.item) this.count(x.region, x.portKey, itemKey(x.slot.item));
                }
            });
        }
    }

    stop() {
        while (this.undo.length > 0) this.undo.pop()();
        // Busiest machine per line; lines fed by miners or the Hub keep their
        // measured speed (they were not held back by their inputs)
        for (const region of this.regions) {
            const busy = new Map();
            for (const m of this.machines) {
                if (m.region !== region) continue;
                busy.set(m.line, Math.max(busy.get(m.line) || 0, m.busy / Math.max(1, this.ticks)));
            }
            const noBoost = new Set(region.ports.filter(p => p.kind === "hub-in").map(p => p.group));
            region.entityLine.forEach((line, entity) => {
                if (entity.components.Miner) noBoost.add(line);
            });
            region.capacity = { busy, noBoost };
        }
    }

    // Ejector slots that push items across an edge, in either direction
    setupEjectors() {
        this.ejectors = [];
        const seen = new Set();
        const add = (entity, index, region, portKey) => {
            const id = entity.uid + ":" + index + ":" + portKey;
            if (seen.has(id)) return;
            seen.add(id);
            this.ejectors.push({ slots: entity.components.ItemEjector.slots, index, region, portKey, before: null });
        };
        const consider = entity => {
            const ejector = entity.components.ItemEjector;
            if (!ejector || entity.components.Belt) return;
            const staticComp = entity.components.StaticMapEntity;
            const from = this.entityRegion.get(entity) || null;
            ejector.slots.forEach((slot, index) => {
                const tile = staticComp.localTileToWorld(slot.pos);
                const dir = staticComp.localDirectionToWorld(slot.direction);
                const target = tile.add(dirVec(dir));
                const to = this.regionOfTile(target);
                if (to === from) return;
                if (from) add(entity, index, from, beltKey("belt-out", tile, dir));
                if (to) add(entity, index, to, beltKey("belt-in", target, shapez.enumInvertedDirections[dir]));
            });
        };
        this.entityRegion.forEach((region, entity) => consider(entity));
        // Buildings just outside each area that eject into it
        for (const region of this.regions) {
            const r = region.rect;
            for (let x = r.x - 1; x <= r.x + r.w; ++x) {
                for (let y = r.y - 1; y <= r.y + r.h; ++y) {
                    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) continue;
                    const content = this.root.map.getLayerContentXY(x, y, "regular");
                    if (content && !this.entityRegion.has(content)) consider(content);
                }
            }
        }
    }

    // Belt paths that cross an edge somewhere along them or at their end
    setupPaths() {
        this.paths = [];
        const pathSet = new Set();
        const addPathOf = entity => {
            if (entity && entity.components.Belt && entity.components.Belt.assignedPath) {
                pathSet.add(entity.components.Belt.assignedPath);
            }
        };
        this.entityRegion.forEach((region, entity) => addPathOf(entity));
        for (const region of this.regions) {
            const r = region.rect;
            for (let x = r.x - 1; x <= r.x + r.w; ++x) {
                for (let y = r.y - 1; y <= r.y + r.h; ++y) {
                    addPathOf(this.root.map.getLayerContentXY(x, y, "regular"));
                }
            }
        }

        for (const path of pathSet) {
            const transitions = [];
            const belts = path.entityPath;
            let offset = 0;
            let previous = null;
            belts.forEach((belt, j) => {
                const staticComp = belt.components.StaticMapEntity;
                const region = this.regionOfTile(staticComp.origin);
                if (j > 0 && region !== previous) {
                    const prevStatic = belts[j - 1].components.StaticMapEntity;
                    if (previous) {
                        const forward = prevStatic.localDirectionToWorld(belts[j - 1].components.Belt.direction);
                        transitions.push({ at: offset, region: previous, portKey: beltKey("belt-out", prevStatic.origin, forward) });
                    }
                    if (region) {
                        const back = staticComp.localDirectionToWorld(shapez.enumDirection.bottom);
                        transitions.push({ at: offset, region, portKey: beltKey("belt-in", staticComp.origin, back) });
                    }
                }
                previous = region;
                offset += belt.components.Belt.getEffectiveLengthTiles();
            });

            // The end of the path feeding a building in another area (or outside)
            const last = belts[belts.length - 1];
            const lastStatic = last.components.StaticMapEntity;
            const forward = lastStatic.localDirectionToWorld(last.components.Belt.direction);
            const target = lastStatic.origin.add(dirVec(forward));
            const targetRegion = this.regionOfTile(target);
            if (targetRegion !== previous && this.root.map.getLayerContentXY(target.x, target.y, "regular")) {
                if (previous) transitions.push({ at: -1, region: previous, portKey: beltKey("belt-out", lastStatic.origin, forward) });
                if (targetRegion) {
                    transitions.push({
                        at: -1,
                        region: targetRegion,
                        portKey: beltKey("belt-in", target, shapez.enumInvertedDirections[forward]),
                    });
                }
            }
            if (transitions.length === 0) continue;

            const tracked = { path, transitions, previous: null };
            this.wrap(path, "tryAcceptItem", original => (item, progress) => {
                const accepted = original(item, progress);
                if (accepted) tracked.inserted = (tracked.inserted || 0) + 1;
                return accepted;
            });
            this.paths.push(tracked);
        }
    }

    // Runs once per tick: compares the path with the previous tick.
    // Items only enter at the start and leave at the end, so
    //   left at end = before + inserted - now
    //   crossed a point = (items past it now - items past it before) + left at end
    measurePath(tracked) {
        const items = tracked.path.items;
        const positions = new Array(items.length);
        let pos = tracked.path.spacingToFirstItem;
        for (let i = 0; i < items.length; ++i) {
            positions[i] = pos;
            pos += items[i][0];
        }
        const firstPast = at => {
            let i = 0;
            while (i < positions.length && positions[i] < at) ++i;
            return i;
        };
        const snapshot = {
            length: items.length,
            past: tracked.transitions.map(t => (t.at < 0 ? 0 : items.length - firstPast(t.at))),
            firstPast: tracked.transitions.map(t => (t.at < 0 ? items.length : firstPast(t.at))),
            tail: items.slice(-4).map(i => itemKey(i[1])),
        };

        const prev = tracked.previous;
        const inserted = tracked.inserted || 0;
        tracked.inserted = 0;
        tracked.previous = snapshot;
        if (!prev) return;
        const left = prev.length + inserted - snapshot.length;
        if (left < 0) return; // the path was rebuilt meanwhile

        tracked.transitions.forEach((t, n) => {
            if (t.at < 0) {
                // Crossing at the very end: the items that left
                for (let k = 0; k < left; ++k) this.count(t.region, t.portKey, prev.tail[prev.tail.length - 1 - k]);
                return;
            }
            const crossed = snapshot.past[n] - prev.past[n] + left;
            for (let k = 0; k < crossed; ++k) {
                const item = items[snapshot.firstPast[n] + k];
                this.count(t.region, t.portKey, item ? itemKey(item[1]) : prev.tail[prev.tail.length - 1]);
            }
        });
    }

    // A teleporter transfer is an input losing its item while an output on the
    // same channel gets one; it crosses an edge if they are in different areas
    measureTeleporters(original) {
        const map = this.root.entityMgr.componentToEntity;
        const inputs = map.InputTeleporterComponent || [];
        const outputs = map.OutputTeleporterComponent || [];
        const before = inputs.map(e => e.components.InputTeleporterComponent.item);
        const outBefore = outputs.map(e => e.components.ItemEjector && e.components.ItemEjector.slots[0].item);
        original();

        const byChannel = new Map();
        const get = channel => {
            if (!byChannel.has(channel)) byChannel.set(channel, { lost: [], filled: [] });
            return byChannel.get(channel);
        };
        inputs.forEach((e, i) => {
            const comp = e.components.InputTeleporterComponent;
            if (before[i] && !comp.item) get(comp.channel).lost.push({ region: this.entityRegion.get(e) || null, key: itemKey(before[i]) });
        });
        outputs.forEach((e, i) => {
            const slot = e.components.ItemEjector && e.components.ItemEjector.slots[0];
            if (slot && !outBefore[i] && slot.item) {
                get(e.components.OutputTeleporterComponent.channel).filled.push({ region: this.entityRegion.get(e) || null, key: itemKey(slot.item) });
            }
        });

        byChannel.forEach(({ lost, filled }, channel) => {
            for (const region of this.regions) {
                const lostHere = lost.filter(x => x.region === region);
                const filledElsewhere = filled.filter(x => x.region !== region);
                const sent = Math.min(lostHere.length, filledElsewhere.length);
                for (let k = 0; k < sent; ++k) this.count(region, "tp-out|" + channel, lostHere[k].key);

                const filledHere = filled.filter(x => x.region === region);
                const lostElsewhere = lost.filter(x => x.region !== region);
                const received = Math.min(filledHere.length, lostElsewhere.length);
                for (let k = 0; k < received; ++k) this.count(region, "tp-in|" + channel, filledHere[k].key);
            }
        });
    }
}

////////////////////////////////////////////////////////////////////////
// Calculating - works the recipe out from the buildings instead of watching
// them run: what every machine does to a shape (with the game's own shape
// operations) and how fast (processor, miner and belt speeds from the current
// upgrades). Items are simulated as amounts per shape that move through the
// area in small time steps until the flows settle; then the flows crossing
// the edge are the recipe. Areas with a building it does not know are
// measured instead.

const CALC_STEP = 0.1;
const CALC_SETTLE_SECONDS = 60;
const CALC_AVERAGE_SECONDS = 60;
const MAX_COMBINATIONS = 64;
// Steps' worth an edge to the outside (or a teleporter channel) holds
const TRANSIT_STEPS = 1;

const SINGLE_INPUT_PROCESSORS = ["cutter", "cutterQuad", "rotater", "rotaterCCW", "rotater180"];
const PASS_THROUGH_COMPONENTS = ["Storage", "CustomStorage", "QueueStorage", "StackStorage"];

function formatCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
    if (n >= 1e4) return Math.round(n / 1e3) + "k";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n));
}

// How many shapes a storage holds at most (Custom Storage keeps it as text)
function storageMax(c) {
    if (c.CustomStorage) {
        const text = c.CustomStorage.CustomStorageText;
        if (text === "∞") return Number.MAX_SAFE_INTEGER;
        if (text) {
            const parsed = parseInt(text);
            return isNaN(parsed) ? 100 : parsed;
        }
    }
    return c.Storage.maximumStorage || 1000;
}

function addAmount(map, key, amount) {
    if (amount > 0) map.set(key, (map.get(key) || 0) + amount);
}

function totalAmount(map) {
    let sum = 0;
    for (const v of map.values()) sum += v;
    return sum;
}

// Takes `amount` out of the buffer, from every shape in proportion.
// Returns what was taken as Map key -> amount.
function takeProportional(map, amount) {
    const taken = new Map();
    const total = totalAmount(map);
    if (total <= 0 || amount <= 0) return taken;
    const factor = Math.min(1, amount / total);
    for (const [key, value] of map) {
        const t = value * factor;
        if (t <= 0) continue;
        taken.set(key, t);
        if (value - t <= 1e-9) map.delete(key);
        else map.set(key, value - t);
    }
    return taken;
}

// The model moves fractions of shapes, so an exit can hold 0.6 of one shape and
// 0.6 of another: no whole shape of one kind, yet together more than one. Looking
// only for a count of 1 left such an exit full of crumbs for ever ("output not
// taken away"), and the box stopped taking new shapes. Returns the shape to hand
// out next (the largest share), or null while less than a whole shape waits.
function nextWholeShape(buf) {
    if (totalAmount(buf) < 1 - 1e-6) return null;
    let key = null;
    for (const [k, v] of buf) if (!key || v > buf.get(key)) key = k;
    return key;
}

// Takes one shape of `key` out; if there was less than one of it, the rest comes
// from the other shapes waiting there
function takeWholeShape(buf, key) {
    const own = Math.min(1, buf.get(key) || 0);
    if (buf.get(key) - own <= 1e-9) buf.delete(key);
    else buf.set(key, buf.get(key) - own);
    if (1 - own > 1e-9) takeProportional(buf, 1 - own);
}

// Shapes lying on real belts. A belt path keeps its items as
// [distance to the next item towards the end, item], from the one nearest the
// start; spacingToFirstItem is the free length from the start to the first.
function beltPathStarts(path) {
    const starts = [];
    let at = 0;
    for (const belt of path.entityPath) {
        starts.push(at);
        at += belt.components.Belt.getEffectiveLengthTiles();
    }
    return starts;
}

// { tiles: { "x,y": [[key, n]] } } for the items lying on the given belt entities
function harvestBeltItems(entities) {
    const inside = new Set(entities);
    const tiles = {};
    const seen = new Set();
    for (const entity of entities) {
        const belt = entity.components.Belt;
        const path = belt && belt.assignedPath;
        if (!path || seen.has(path)) continue;
        seen.add(path);
        const starts = beltPathStarts(path);
        let pos = path.spacingToFirstItem;
        let index = 0;
        for (const [distance, item] of path.items) {
            while (index + 1 < starts.length && starts[index + 1] <= pos) index++;
            const holder = path.entityPath[index];
            const key = itemKey(item);
            if (inside.has(holder) && key) {
                const origin = holder.components.StaticMapEntity.origin;
                const tile = origin.x + "," + origin.y;
                const list = tiles[tile] || (tiles[tile] = []);
                const row = list.find(r => r[0] === key);
                if (row) row[1]++;
                else list.push([key, 1]);
            }
            pos += distance;
        }
    }
    return Object.keys(tiles).length > 0 ? { tiles } : null;
}

// Puts shapes back on the real belts of an unpacked factory, at the end of each
// run of belts. A shape that would overlap another one on the belt is dropped.
function restoreBeltItems(root, runs) {
    const spacing = shapez.globalConfig.itemSpacingOnBelts;
    let placed = 0;
    let dropped = 0;
    for (const run of runs) {
        const [x, y] = run.tileKeys[run.tileKeys.length - 1].split(",").map(Number);
        const holder = root.map.getTileContent(new shapez.Vector(x, y), "regular");
        const path = holder && holder.components.Belt && holder.components.Belt.assignedPath;
        if (!path) {
            for (const [, n] of run.items) dropped += n;
            continue;
        }
        const starts = beltPathStarts(path);
        const index = path.entityPath.indexOf(holder);
        let pos = starts[index] + holder.components.Belt.getEffectiveLengthTiles();
        const list = [];
        let at = path.spacingToFirstItem;
        for (const [distance, item] of path.items) {
            list.push({ pos: at, item });
            at += distance;
        }
        for (const [key, n] of run.items) {
            for (let i = 0; i < n; ++i) {
                if (pos < 0 || list.some(o => Math.abs(o.pos - pos) < spacing - 1e-6)) {
                    dropped++;
                } else {
                    list.push({ pos, item: keyToItem(root, key) });
                    placed++;
                }
                pos -= spacing;
            }
        }
        list.sort((a, b) => a.pos - b.pos);
        path.items = list.map((o, i) => [(i < list.length - 1 ? list[i + 1].pos : path.totalLength) - o.pos, o.item]);
        path.spacingToFirstItem = list.length > 0 ? list[0].pos : path.totalLength;
    }
    return { placed, dropped };
}

// Wire signals are stored with the box (the buildings inside are off the map
// then): { k: shape/color key } or { b: boolean }
function encodeSignal(value) {
    if (!value) return null;
    if (value.getItemType() === "boolean") return { b: !!value.value };
    const key = itemKey(value);
    return key ? { k: key } : null;
}

function signalTruthy(signal) {
    return !!signal && (signal.b === undefined || signal.b);
}

// Signals of the buildings whose behaviour depends on them
function captureSignals(entities) {
    const signals = {};
    for (const entity of entities) {
        const pins = entity.components.WiredPins;
        if (!pins) continue;
        const processor = entity.components.ItemProcessor;
        const relevant = entity.components.Filter || entity.components.HubExtraction ||
            (processor && processor.type === "painterQuad");
        if (!relevant) continue;
        signals[entity.uid] = pins.slots.map(slot =>
            slot.linkedNetwork && slot.linkedNetwork.hasValue() ? encodeSignal(slot.linkedNetwork.currentValue) : null
        );
    }
    return signals;
}

// The box's buildings as serialized data, moved to where the box is now
// (a pasted copy stands somewhere else than the original)
// What a live box's storages hold now ({ uid: { k: shape key, c: count } }, saved
// with the box) replaces what the blob had when the factory was compressed
function applyStock(payloads, stock) {
    if (!stock) return;
    for (const payload of payloads) {
        const entry = stock[payload.uid];
        const storage = payload.components.Storage;
        if (!entry || !storage) continue;
        storage.storedCount = entry.c;
        storage.storedItem = entry.k ? { $: isColorKey(entry.k) ? "color" : "shape", data: entry.k } : null;
    }
}

function boxPayloads(entity, origin = entity.components.StaticMapEntity.origin) {
    const st = entity.components.FactoryBox.state;
    const payloads = JSON.parse(st.blob);
    const comp = entity.components.FactoryBox;
    applyStock(payloads, comp.sim ? comp.sim.exportStock() : st.stock);
    const dx = origin.x - (st.ox === undefined ? origin.x : st.ox);
    const dy = origin.y - (st.oy === undefined ? origin.y : st.oy);
    if (dx !== 0 || dy !== 0) {
        for (const payload of payloads) {
            const o = payload.components.StaticMapEntity.origin;
            payload.components.StaticMapEntity.origin = { x: o.x + dx, y: o.y + dy };
        }
    }
    return payloads;
}

// How many miners inside a box have no deposit of the kind they mined originally
// under them where the box stands now (a pasted copy lands somewhere else). A
// recipe was worked out for the original deposits, so such a box must not run.
function minersMissingDeposit(root, entity, origin) {
    const comp = entity.components.FactoryBox;
    const st = comp.state;
    if (comp.minerBlob !== st.blob) {
        comp.minerBlob = st.blob;
        comp.minerPayloads = JSON.parse(st.blob).filter(p => p.components.Miner);
    }
    if (comp.minerPayloads.length === 0) return 0;
    const dx = origin.x - (st.ox === undefined ? origin.x : st.ox);
    const dy = origin.y - (st.oy === undefined ? origin.y : st.oy);
    let missing = 0;
    for (const payload of comp.minerPayloads) {
        const o = payload.components.StaticMapEntity.origin;
        const here = root.map.getLowerLayerContentXY(o.x + dx, o.y + dy);
        const was = root.map.getLowerLayerContentXY(o.x, o.y);
        if (!here || (was && itemKey(was) !== itemKey(here))) missing++;
    }
    return missing;
}

// A box's state turned 90 degrees clockwise: its size, its ports and the
// buildings inside (their tiles relative to where the box was compressed)
const ROTATED_CW = { top: "right", right: "bottom", bottom: "left", left: "top" };
function rotateBoxStateCw(st) {
    const h = st.h;
    const turn = (x, y) => ({ x: h - 1 - y, y: x });
    for (const port of st.ports) {
        if (port.kind.startsWith("belt")) {
            const p = turn(port.x, port.y);
            port.x = p.x;
            port.y = p.y;
            port.dir = ROTATED_CW[port.dir];
        }
    }
    const payloads = JSON.parse(st.blob);
    for (const payload of payloads) {
        const s = payload.components.StaticMapEntity;
        const p = turn(s.origin.x - st.ox, s.origin.y - st.oy);
        s.origin = { x: st.ox + p.x, y: st.oy + p.y };
        s.rotation = (s.rotation + 90) % 360;
        s.originalRotation = (s.originalRotation + 90) % 360;
    }
    st.blob = JSON.stringify(payloads);
    st.h = st.w;
    st.w = h;
    st.expect = null; // keyed by world tiles, no longer valid
    return st;
}

// What the buildings inside a box cost with the Building Costs mod:
// { shapeKey: amount }, empty without that mod
function contentsCost(st) {
    const table = window.buildingCosts;
    const costs = {};
    if (!table) return costs;
    for (const payload of JSON.parse(st.blob)) {
        try {
            const data = shapez.getBuildingDataFromCode(payload.components.StaticMapEntity.code);
            const entry = table[data.metaInstance.getId() + "_" + data.variant];
            if (entry) costs[entry.shape] = (costs[entry.shape] || 0) + entry.amount;
        } catch (e) {
            // unknown building: no cost
        }
    }
    return costs;
}

// Creates buildings from serialized data without placing them.
// Returns [{ entity, uid }]; throws if one cannot be restored.
function deserializeEntities(root, payloads) {
    const serializer = new shapez.SerializerInternal();
    return payloads.map(payload => {
        const staticData = payload.components.StaticMapEntity;
        const buildingData = shapez.getBuildingDataFromCode(staticData.code);
        const entity = buildingData.metaInstance.createEntity({
            root,
            origin: shapez.Vector.fromSerializedObject(staticData.origin),
            rotation: staticData.rotation,
            originalRotation: staticData.originalRotation,
            rotationVariant: buildingData.rotationVariant,
            variant: buildingData.variant,
        });
        const error = serializer.deserializeComponents(root, entity, payload.components);
        if (error) throw new Error(error);
        return { entity, uid: payload.uid };
    });
}

class FactoryCalculator {
    // items: [{ entity, uid }] - the area's buildings, on the map or not.
    // info: { rect, ports, expect, signals } as stored with a box
    constructor(root, items, info) {
        this.root = root;
        this.items = items;
        this.rect = info.rect;
        this.ports = info.ports;
        this.expect = info.expect || {};
        this.signals = info.signals || {};
        this.problems = [];
        // Live: the model runs inside a box. Inputs are the shapes that really
        // arrive, outputs wait at the edge until the box hands them out, and
        // Hub / teleporter sources take what is really there.
        this.live = !!info.live;
        this.stepSize = info.stepSize || CALC_STEP;
        this.hubOut = new Map();
        this.hubDebt = new Map();
    }

    // Returns { counts, seconds } (like a measurement) or { problems }
    run() {
        const failed = this.beginRun();
        if (failed) return failed;
        this.continueRun(Infinity);
        return { counts: this.counts, seconds: CALC_AVERAGE_SECONDS, calculator: this };
    }

    // The same run in pieces, so many boxes can be worked out one after the other
    // without freezing the game. beginRun returns { problems } or null.
    beginRun() {
        this.build();
        if (this.problems.length > 0) return { problems: this.problems };
        this.runSteps = Math.round((CALC_SETTLE_SECONDS + CALC_AVERAGE_SECONDS) / CALC_STEP);
        this.runSettle = Math.round(CALC_SETTLE_SECONDS / CALC_STEP);
        this.runStep = 0;
        return null;
    }

    // Steps for at most `budgetMs`; true when the run is done
    continueRun(budgetMs) {
        const end = performance.now() + budgetMs;
        while (this.runStep < this.runSteps) {
            this.recording = this.runStep >= this.runSettle;
            this.step(CALC_STEP);
            this.runStep++;
            if (this.runStep < this.runSteps && performance.now() >= end) return false;
        }
        return true;
    }

    problem(text) {
        if (!this.problems.includes(text)) this.problems.push(text);
    }

    record(portKey, key, amount) {
        if (!this.recording || !portKey || amount <= 0) return;
        const port = this.counts[portKey] || (this.counts[portKey] = {});
        port[key] = (port[key] || 0) + amount;
    }

    inside(tile) {
        const r = this.rect;
        return tile.x >= r.x && tile.y >= r.y && tile.x < r.x + r.w && tile.y < r.y + r.h;
    }

    build() {
        const hubGoals = this.root.hubGoals;
        this.counts = {};
        this.beltSpeed = hubGoals.getBeltBaseSpeed();
        this.ejectorRate = Math.max(this.beltSpeed, 2 * this.beltSpeed * shapez.globalConfig.itemSpacingOnBelts);
        this.teleporterRate = Math.max(this.ejectorRate, this.root.dynamicTickrate.currentTickRate || 60);
        this.portKeys = new Set(this.ports.map(p => portWorldKey(p, this.rect)));

        // Tile index of the area (the buildings may not be on the map)
        this.at = new Map();
        this.uidOf = new Map();
        for (const { entity, uid } of this.items) {
            this.uidOf.set(entity, uid);
            if (entity.layer !== "regular") continue;
            const b = entity.components.StaticMapEntity.getTileSpaceBounds();
            for (let x = b.x; x < b.x + b.w; ++x) {
                for (let y = b.y; y < b.y + b.h; ++y) this.at.set(x + "," + y, entity);
            }
        }

        // Hub ports by the buildings behind them
        this.hubPortOf = new Map();
        for (const port of this.ports) {
            if (!port.kind.startsWith("hub")) continue;
            const key = portWorldKey(port, this.rect);
            for (const uid of port.uids || []) this.hubPortOf.set(uid, key);
            for (const slot of port.hubSlots || []) this.hubPortOf.set(slot, key);
        }

        this.nodes = [];
        this.nodeOf = new Map();
        this.pools = new Map();
        for (const { entity, uid } of this.items) {
            if (entity.layer !== "regular") continue;
            const node = this.makeNode(entity, uid);
            if (node) {
                this.nodes.push(node);
                this.nodeOf.set(entity, node);
            }
        }
        if (this.problems.length > 0) return;

        // Connect every ejector slot along its belt to where the items end up
        for (const node of this.nodes) {
            const ejector = node.entity.components.ItemEjector;
            if (!ejector || node.kind === "tunnelIn") continue;
            const staticComp = node.entity.components.StaticMapEntity;
            node.outputs = ejector.slots.map(slot => {
                const tile = staticComp.localTileToWorld(slot.pos);
                const dir = staticComp.localDirectionToWorld(slot.direction);
                if (node.kind === "miner") {
                    const chained = this.chainedMiner(node.entity, tile.add(dirVec(dir)));
                    if (chained) {
                        node.chainTo = chained;
                        return null;
                    }
                }
                return this.follow(tile, dir);
            });
        }
        for (const node of this.nodes) {
            if (node.kind === "tunnelIn") {
                node.receiver = this.findTunnelReceiver(node.entity);
            }
            // A channel hands its shapes over after the buildings stepped
            if (node.kind === "tpOut") node.outputs.forEach(e => this.makeTransit(e));
        }

        // Inputs from outside: belts with the shape that is expected there
        this.sources = [];
        for (const port of this.ports) {
            if (port.kind !== "belt-in") continue;
            const key = portWorldKey(port, this.rect);
            const shares = this.expect[key];
            if (this.live) {
                const start = new shapez.Vector(port.x + this.rect.x, port.y + this.rect.y).add(dirVec(port.dir));
                const edge = this.follow(start, shapez.enumInvertedDirections[port.dir]);
                this.makeTransit(edge);
                (this.sourceByPort || (this.sourceByPort = new Map())).set(key, edge);
                continue;
            }
            if (!shares) {
                this.problem("It is not known which shape enters at #" + (this.ports.indexOf(port) + 1));
                continue;
            }
            if (Object.keys(shares).length === 0) continue; // watched, but nothing came in: not used
            const start = new shapez.Vector(port.x + this.rect.x, port.y + this.rect.y).add(dirVec(port.dir));
            const edge = this.follow(start, shapez.enumInvertedDirections[port.dir]);
            this.makeTransit(edge);
            this.sources.push({ edge, portKey: key, shares });
        }

        // Teleporter channels: which ports connect them to the outside
        for (const port of this.ports) {
            if (!port.kind.startsWith("tp")) continue;
            const pool = this.getPool(port.channel);
            const key = portWorldKey(port, this.rect);
            if (port.kind === "tp-in") {
                pool.inPort = key;
                pool.inShares = this.expect[key];
                if (this.live) pool.inShares = null; // the box pulls real items into the pool
                else if (pool.inShares && Object.keys(pool.inShares).length === 0) pool.inShares = null; // not used
                else if (!pool.inShares) this.problem("It is not known which shape comes in on channel \"" + port.channel + "\"");
            } else {
                // How much the outside takes is not known: assume it takes all
                pool.outPort = key;
                pool.outRate = Infinity;
                pool.outBuf = new Map();
            }
        }
        this.sortNodes();
    }

    makeNode(entity, uid) {
        const c = entity.components;
        const name = c.StaticMapEntity.getMetaBuilding().getId();
        if (c.Belt) return null;
        const inputs = c.ItemAcceptor ? c.ItemAcceptor.slots.map(() => []) : [];
        const node = { entity, uid, inputs, outputs: [], carry: 0 };

        if (c.Miner) {
            node.kind = "miner";
            const origin = c.StaticMapEntity.origin;
            node.resource = itemKey(this.root.map.getLowerLayerContentXY(origin.x, origin.y));
            node.chainIn = new Map();
            return node;
        }
        if (c.HubExtraction) {
            if (c.HubExtraction.singles) {
                // Count variant: empties every shape the Hub holds a chosen
                // number of, so what it puts out depends on the Hub's stock
                if (!this.live) {
                    this.problem("Hub Extractor (Count) depends on the Hub's stock and cannot be calculated");
                    return null;
                }
                node.kind = "hubSource";
                node.portKey = this.hubPortOf.get(uid);
                node.counted = { target: c.HubExtraction.targetCount, orFewer: c.HubExtraction.orFewer, key: null, left: 0, queue: [] };
                return node;
            }
            if (c.StaticMapEntity.getVariant() !== shapez.defaultBuildingVariant) {
                this.problem("Hub Extractor variant \"" + c.StaticMapEntity.getVariant() + "\" cannot be calculated");
                return null;
            }
            const signal = (this.signals[uid] || [])[0];
            node.kind = "hubSource";
            node.key = signal && signal.k ? signal.k : null;
            node.portKey = this.hubPortOf.get(uid);
            return node;
        }
        if (c.OutputTeleporterComponent) {
            node.kind = "tpOut";
            this.getPool(c.OutputTeleporterComponent.channel).outputs.push(node);
            return node;
        }
        if (c.UndergroundBelt) {
            node.kind = c.UndergroundBelt.mode === shapez.enumUndergroundBeltMode.sender ? "tunnelIn" : "tunnelOut";
            return node;
        }
        if (c.Filter) {
            node.kind = "filter";
            node.signal = (this.signals[uid] || [])[0] || null;
            return node;
        }
        // A live box keeps what its storages hold: they fill from what arrives and
        // hand their stock out like the real building
        if (this.live && c.Storage) {
            node.kind = "storage";
            node.key = itemKey(c.Storage.storedItem);
            node.count = node.key ? c.Storage.storedCount || 0 : 0;
            node.max = storageMax(c);
            return node;
        }
        if (PASS_THROUGH_COMPONENTS.some(id => c[id])) {
            node.kind = "pass";
            return node;
        }
        if (c.ItemProcessor) {
            const type = c.ItemProcessor.type;
            node.type = type;
            node.speed = this.root.hubGoals.getProcessorBaseSpeed(type);
            if (c.InputTeleporterComponent) {
                node.kind = "tpIn";
                node.channel = c.InputTeleporterComponent.channel;
                if (node.channel) this.getPool(node.channel).inputs.push(node);
                return node;
            }
            if (type === "hub") {
                node.kind = "hubSink";
                node.portKey = this.hubPortOf.get(uid);
                return node;
            }
            if (type === "trash") {
                node.kind = "trash";
                return node;
            }
            // Mod variants of the balancer (Balancer Variants, Smart Merger / Splitter)
            if (type === "balancer" || String(type).startsWith("Balancer ") || name === "balancer") {
                node.kind = "balancer";
                return node;
            }
            if (type === "reader") {
                node.kind = "pass";
                return node;
            }
            if (SINGLE_INPUT_PROCESSORS.includes(type) ||
                ["stacker", "mixer", "painter", "painterDouble", "painterQuad"].includes(type)) {
                node.kind = "machine";
                if (type === "painterQuad") {
                    const pins = this.signals[uid] || [];
                    node.quadEnabled = [0, 1, 2, 3].map(q => signalTruthy(pins[q]));
                }
                return node;
            }
            // Machines added by mods (e.g. Shapez Expanded): run the mod's own
            // handler when every input slot is needed for one charge
            const handler = shapez.MOD_ITEM_PROCESSOR_HANDLERS && shapez.MOD_ITEM_PROCESSOR_HANDLERS[type];
            if (handler && inputs.length > 0 && c.ItemProcessor.inputsPerCharge === inputs.length) {
                node.kind = "machine";
                node.handler = handler;
                return node;
            }
            this.problem("\"" + name + "\" (" + type + ") cannot be calculated");
            return null;
        }
        if (c.ItemAcceptor || c.ItemEjector) {
            this.problem("\"" + name + "\" cannot be calculated");
        }
        return null;
    }

    getPool(channel) {
        if (!this.pools.has(channel)) {
            this.pools.set(channel, { channel, inputs: [], outputs: [], buf: new Map() });
        }
        return this.pools.get(channel);
    }

    // Follows items leaving `tile` towards `dir` over belts. Returns an edge:
    // { buf, cap, rate, dest: { node, slot } | { port } | null }
    follow(tile, dir) {
        let current = tile.add(dirVec(dir));
        let last = tile;
        let d = dir;
        let belts = 0;
        // id: where it starts (stable across rebuilds); tileKeys: the belt tiles it runs over
        const edge = { buf: new Map(), dest: null, id: tile.x + "," + tile.y + "," + dir, tileKeys: [] };
        for (let n = 0; n < 5000; ++n) {
            if (!this.inside(current)) {
                const key = beltKey("belt-out", last, d);
                if (this.portKeys.has(key)) edge.dest = { port: key };
                break;
            }
            const entity = this.at.get(current.x + "," + current.y);
            if (!entity) break;
            const staticComp = entity.components.StaticMapEntity;
            if (entity.components.Belt) {
                if (staticComp.localDirectionToWorld(shapez.enumDirection.top) !== d) break;
                belts++;
                edge.tileKeys.push(current.x + "," + current.y);
                last = current;
                d = staticComp.localDirectionToWorld(entity.components.Belt.direction);
                current = current.add(dirVec(d));
                continue;
            }
            const acceptor = entity.components.ItemAcceptor;
            const node = this.nodeOf.get(entity);
            if (acceptor && node) {
                const side = shapez.enumInvertedDirections[d];
                const slot = acceptor.slots.findIndex(
                    s => staticComp.localTileToWorld(s.pos).equals(current) && staticComp.localDirectionToWorld(s.direction) === side
                );
                if (slot >= 0) {
                    edge.dest = { node, slot };
                    node.inputs[slot].push(edge);
                }
            }
            break;
        }
        edge.rate = belts > 0 ? this.beltSpeed : this.ejectorRate;
        // What the belts and the ejector really hold. What the next building
        // takes in the same step passes through on top of that (see room()).
        edge.cap = 1 + belts / shapez.globalConfig.itemSpacingOnBelts;
        // Leading nowhere: holds what fits on its belt, or the one item an unused
        // output keeps (a balancer then skips that output), and nothing more
        if (!edge.dest) edge.cap = belts > 0 ? belts / shapez.globalConfig.itemSpacingOnBelts : 1;
        (this.allEdges || (this.allEdges = [])).push(edge);
        if (edge.dest && edge.dest.port) {
            this.makeTransit(edge);
            (this.sinkByPort || (this.sinkByPort = new Map())).set(edge.dest.port, edge);
        }
        return edge;
    }

    // An edge filled or emptied between steps (by the box, the outside or a
    // teleporter channel) must hold a step's worth, or the step size would cap
    // the flow
    makeTransit(edge) {
        if (edge) edge.cap = Math.max(edge.cap, TRANSIT_STEPS * edge.rate * this.stepSize);
    }

    // Upstream buildings first, so shapes pass a whole chain in one step
    // instead of piling up between the buildings. Buildings in a loop come
    // last; their edges hold a step's worth like the edges to the outside.
    sortNodes() {
        const next = node => {
            const list = node.outputs.map(e => e && e.dest && e.dest.node);
            if (node.kind === "tunnelIn" && node.receiver) list.push(...node.receiver.outputs.map(e => e && e.dest && e.dest.node));
            if (node.chainTo) list.push(node.chainTo);
            return list.filter(Boolean);
        };
        const incoming = new Map(this.nodes.map(n => [n, 0]));
        for (const node of this.nodes) for (const n of next(node)) incoming.set(n, incoming.get(n) + 1);
        const order = this.nodes.filter(n => incoming.get(n) === 0);
        for (let i = 0; i < order.length; ++i) {
            for (const n of next(order[i])) {
                incoming.set(n, incoming.get(n) - 1);
                if (incoming.get(n) === 0) order.push(n);
            }
        }
        for (const node of this.nodes) {
            if (incoming.get(node) === 0) continue;
            order.push(node);
            for (const e of node.outputs) this.makeTransit(e);
            for (const edges of node.inputs) for (const e of edges) this.makeTransit(e);
        }
        this.order = order;
    }

    chainedMiner(entity, tile) {
        const target = this.at.get(tile.x + "," + tile.y);
        if (!target || !target.components.Miner || !target.components.Miner.chainable) return null;
        if (!this.root.map.getLowerLayerContentXY(tile.x, tile.y)) return null;
        return this.nodeOf.get(target) || null;
    }

    findTunnelReceiver(entity) {
        const staticComp = entity.components.StaticMapEntity;
        const tunnel = entity.components.UndergroundBelt;
        const dir = staticComp.localDirectionToWorld(shapez.enumDirection.top);
        const angle = shapez.enumDirectionToAngle[dir];
        let tile = staticComp.origin;
        for (let i = 0; i < shapez.globalConfig.undergroundBeltMaxTilesByTier[tunnel.tier]; ++i) {
            tile = tile.add(dirVec(dir));
            const other = this.at.get(tile.x + "," + tile.y);
            if (!other || !other.components.UndergroundBelt) continue;
            const o = other.components.UndergroundBelt;
            if (o.tier === tunnel.tier && other.components.StaticMapEntity.rotation === angle) {
                return o.mode === shapez.enumUndergroundBeltMode.receiver ? this.nodeOf.get(other) || null : null;
            }
        }
        return null;
    }

    // Free space of an edge this step (holding room and belt speed). What the
    // next building still takes this step (edge.demand, less what it took
    // already) passes through without being held.
    room(edge, dt) {
        if (!edge) return 0;
        if (edge.pushed === undefined) edge.pushed = 0;
        const total = totalAmount(edge.buf);
        const taken = Math.max(0, (edge.start || 0) + edge.pushed - total);
        const passing = Math.max(0, (edge.demand || 0) - taken);
        return Math.max(0, Math.min(edge.cap - total + passing, edge.rate * dt - edge.pushed));
    }

    // How much a node can take from each of its input edges this step, worked
    // out from the room behind it (whose demand is already set: this runs
    // downstream first)
    setDemand(node, dt) {
        let amount = 0;
        let slots = null; // the input slots it takes from; null: all
        switch (node.kind) {
            case "machine": {
                slots = this.requiredSlots(node);
                if (node.type === "painterQuad" && slots.length === 1) break;
                amount = node.speed * dt + node.carry;
                const perSlot = node.perSlot || new Map(node.outputs.map((_, slot) => [slot, 1]));
                for (const [slot, perCharge] of perSlot) amount = Math.min(amount, this.room(node.outputs[slot], dt) / perCharge);
                break;
            }
            case "balancer":
            case "pass":
                amount = Math.min(this.passLimit(node, dt), node.outputs.reduce((s, e) => s + this.room(e, dt), 0));
                break;
            case "storage":
                amount = Math.min(this.passLimit(node, dt), Math.max(0, node.max - node.count));
                break;
            case "filter":
                slots = [0];
                if (node.signal) amount = Math.min(this.passLimit(node, dt), this.room(node.outputs[0], dt) + this.room(node.outputs[1], dt));
                break;
            case "tunnelIn":
                amount = this.room(node.receiver && node.receiver.outputs[0], dt);
                break;
            case "hubSink":
            case "trash":
                amount = Infinity;
                break;
            case "tpIn": {
                if (!node.channel) break;
                const pool = this.getPool(node.channel);
                amount = Math.min(this.teleporterRate * dt, Math.max(0, pool.inputs.length * this.teleporterRate * dt - totalAmount(pool.buf)));
                break;
            }
        }
        node.inputs.forEach((edges, slot) => {
            const demand = !slots || slots.includes(slot) ? amount : 0;
            for (const edge of edges) edge.demand = demand;
        });
    }

    // Most a balancer, filter or storage passes on in one step
    passLimit(node, dt) {
        return node.kind === "balancer" ? Math.max(this.beltSpeed, node.speed || 0) * 2 * dt : this.beltSpeed * dt * 2;
    }

    push(edge, key, amount) {
        addAmount(edge.buf, key, amount);
        edge.pushed = (edge.pushed || 0) + amount;
        if (this.recording) edge.total = (edge.total || 0) + amount;
    }

    // Everything waiting at one input slot of a node, merged
    slotContents(node, slot) {
        const merged = new Map();
        for (const edge of node.inputs[slot] || []) for (const [k, v] of edge.buf) addAmount(merged, k, v);
        return merged;
    }

    takeFromSlot(node, slot, amount) {
        const edges = node.inputs[slot] || [];
        const total = edges.reduce((s, e) => s + totalAmount(e.buf), 0);
        const taken = new Map();
        if (total <= 0) return taken;
        for (const edge of edges) {
            const share = (totalAmount(edge.buf) / total) * amount;
            for (const [k, v] of takeProportional(edge.buf, share)) addAmount(taken, k, v);
        }
        return taken;
    }

    takeFromAllInputs(node, amount) {
        const total = node.inputs.reduce((s, _, slot) => s + totalAmount(this.slotContents(node, slot)), 0);
        const taken = new Map();
        if (total <= 0) return taken;
        node.inputs.forEach((_, slot) => {
            const share = (totalAmount(this.slotContents(node, slot)) / total) * amount;
            for (const [k, v] of this.takeFromSlot(node, slot, share)) addAmount(taken, k, v);
        });
        return taken;
    }

    // Spreads items evenly over the given edges as far as they have room;
    // returns how much was placed
    spread(items, edges, dt) {
        const total = totalAmount(items);
        const open = edges.filter(e => e && this.room(e, dt) > 1e-9);
        if (total <= 0 || open.length === 0) return 0;
        let remaining = total;
        let placed = 0;
        let pending = open.slice();
        while (remaining > 1e-9 && pending.length > 0) {
            const share = remaining / pending.length;
            const next = [];
            for (const edge of pending) {
                const amount = Math.min(share, this.room(edge, dt));
                for (const [k, v] of items) this.push(edge, k, (v / total) * amount);
                placed += amount;
                remaining -= amount;
                if (this.room(edge, dt) > 1e-9) next.push(edge);
            }
            if (next.length === pending.length && share <= 1e-9) break;
            pending = next;
        }
        return placed;
    }

    // What one charge of a machine produces for one combination of inputs:
    // [{ slot, key }]
    produce(node, combo) {
        const mgr = this.root.shapeDefinitionMgr;
        // A mod's handler may depend on its building, so cache per building
        const cacheKey = node.type + "|" + combo.join("|") + "|" + (node.quadEnabled || "").toString() + (node.handler ? "|" + node.uid : "");
        this.productCache = this.productCache || new Map();
        if (this.productCache.has(cacheKey)) return this.productCache.get(cacheKey);
        const shape = key => mgr.getShapeFromShortKey(key);
        let out = [];
        try {
            switch (node.type) {
                case "cutter":
                case "cutterQuad": {
                    const parts = node.type === "cutter" ? mgr.shapeActionCutHalf(shape(combo[0])) : mgr.shapeActionCutQuad(shape(combo[0]));
                    parts.forEach((def, slot) => {
                        if (!def.isEntirelyEmpty()) out.push({ slot, key: def.getHash() });
                    });
                    break;
                }
                case "rotater":
                    out = [{ slot: 0, key: mgr.shapeActionRotateCW(shape(combo[0])).getHash() }];
                    break;
                case "rotaterCCW":
                    out = [{ slot: 0, key: mgr.shapeActionRotateCCW(shape(combo[0])).getHash() }];
                    break;
                case "rotater180":
                    out = [{ slot: 0, key: mgr.shapeActionRotate180(shape(combo[0])).getHash() }];
                    break;
                case "stacker":
                    out = [{ slot: 0, key: mgr.shapeActionStack(shape(combo[0]), shape(combo[1])).getHash() }];
                    break;
                case "mixer": {
                    const mixed = shapez.enumColorMixingResults[combo[0]][combo[1]];
                    out = [{ slot: 0, key: mixed || combo[0] }];
                    break;
                }
                case "painter":
                    out = [{ slot: 0, key: mgr.shapeActionPaintWith(shape(combo[0]), combo[1]).getHash() }];
                    break;
                case "painterDouble":
                    out = [
                        { slot: 0, key: mgr.shapeActionPaintWith(shape(combo[0]), combo[2]).getHash() },
                        { slot: 0, key: mgr.shapeActionPaintWith(shape(combo[1]), combo[2]).getHash() },
                    ];
                    break;
                case "painterQuad": {
                    const colors = [0, 1, 2, 3].map(q => (node.quadEnabled[q] ? combo[1 + q] || null : null));
                    out = [{ slot: 0, key: mgr.shapeActionPaintWith4Colors(shape(combo[0]), colors).getHash() }];
                    break;
                }
                default:
                    if (node.handler) out = this.produceWithHandler(node, combo);
            }
        } catch (e) {
            out = [];
        }
        this.productCache.set(cacheKey, out);
        return out;
    }

    // Runs a mod's processor handler the way the game's item processor does.
    // Empty shapes (e.g. a corner cut from where there is none) are dropped.
    produceWithHandler(node, combo) {
        const items = new Map();
        combo.forEach((key, slot) => items.set(slot, keyToItem(this.root, key)));
        const payload = { entity: node.entity, items, inputCount: items.size, outItems: [] };
        node.handler.call({ root: this.root }, payload);
        return payload.outItems
            .map(o => ({
                slot: o.requiredSlot !== undefined && o.requiredSlot !== null ? o.requiredSlot : o.preferredSlot || 0,
                key: itemKey(o.item),
            }))
            .filter(o => o.key && isValidKey(o.key));
    }

    requiredSlots(node) {
        if (node.handler) return node.inputs.map((_, slot) => slot);
        switch (node.type) {
            case "stacker":
            case "mixer":
            case "painter":
                return [0, 1];
            case "painterDouble":
                return [0, 1, 2];
            case "painterQuad":
                return [0, ...[0, 1, 2, 3].filter(q => node.quadEnabled[q]).map(q => 1 + q)];
            default:
                return [0];
        }
    }

    stepMachine(node, dt) {
        const slots = this.requiredSlots(node);
        if (node.type === "painterQuad" && slots.length === 1) return; // no quadrant enabled
        const contents = slots.map(slot => this.slotContents(node, slot));
        let charges = Math.min(node.speed * dt + node.carry, ...contents.map(totalAmount));
        if (charges <= 1e-9) {
            node.carry = Math.min(node.carry + node.speed * dt, 1);
            if (this.live) node.busy = (node.busy || 0) * (1 - Math.min(1, dt / USAGE_SECONDS));
            return;
        }

        // Every combination of the shapes waiting at the required slots
        let combos = [{ keys: [], weight: 1 }];
        for (const content of contents) {
            const total = totalAmount(content);
            const next = [];
            for (const combo of combos) {
                for (const [key, amount] of content) next.push({ keys: [...combo.keys, key], weight: combo.weight * (amount / total) });
            }
            combos = next;
            if (combos.length > MAX_COMBINATIONS) {
                combos.sort((a, b) => b.weight - a.weight);
                combos = combos.slice(0, MAX_COMBINATIONS);
            }
        }
        const results = combos.map(combo => {
            const full = [];
            slots.forEach((slot, i) => (full[slot] = combo.keys[i]));
            return { weight: combo.weight, out: this.produce(node, full) };
        });

        // Room at the outputs limits the charges
        const perSlot = new Map();
        for (const r of results) for (const o of r.out) perSlot.set(o.slot, (perSlot.get(o.slot) || 0) + r.weight);
        for (const [slot, perCharge] of perSlot) {
            charges = Math.min(charges, this.room(node.outputs[slot], dt) / perCharge);
        }
        node.perSlot = perSlot;
        if (charges <= 1e-9) return;

        if (this.live) node.busy = (node.busy || 0) + (charges / (node.speed * dt) - (node.busy || 0)) * Math.min(1, dt / USAGE_SECONDS);
        node.carry = Math.max(0, node.carry + node.speed * dt - charges);
        node.carry = Math.min(node.carry, 1);
        for (const slot of slots) this.takeFromSlot(node, slot, charges);
        for (const r of results) {
            for (const o of r.out) {
                const edge = node.outputs[o.slot];
                if (edge) this.push(edge, o.key, charges * r.weight);
            }
        }
    }

    // A storage takes only the shape it holds (the first one that arrives when it
    // is empty) until it is full, and puts its stock out on its outputs
    stepStorage(node, dt) {
        if (node.key && node.count > 0) {
            const outputs = node.outputs.filter(Boolean);
            const room = outputs.reduce((s, e) => s + this.room(e, dt), 0);
            const amount = Math.min(node.count, this.passLimit(node, dt), room);
            if (amount > 1e-9) {
                node.count -= this.spread(new Map([[node.key, amount]]), outputs, dt);
                if (node.count <= 1e-9) {
                    node.count = 0;
                    node.key = null;
                }
            }
        }
        let key = node.key;
        const waiting = new Map();
        node.inputs.forEach((_, slot) => {
            for (const [k, v] of this.slotContents(node, slot)) addAmount(waiting, k, v);
        });
        if (!key) {
            for (const [k, v] of waiting) if (!key || v > waiting.get(key)) key = k;
        }
        if (!key) return;
        const amount = Math.min(waiting.get(key) || 0, Math.max(0, node.max - node.count), this.passLimit(node, dt));
        if (amount <= 1e-9) return;
        const total = waiting.get(key);
        node.inputs.forEach((edges, slot) => {
            for (const edge of edges) {
                const have = edge.buf.get(key) || 0;
                if (have <= 0) continue;
                const take = (have / total) * amount;
                if (have - take <= 1e-9) edge.buf.delete(key);
                else edge.buf.set(key, have - take);
            }
        });
        node.key = key;
        node.count += amount;
    }

    // What the storages hold, in whole shapes: { uid: { k, c } }
    // The whole shapes lying on the belts inside (and waiting at the exits and in
    // teleporter channels), so a rebuilt model, a saved game or an unpacked
    // factory can start from them. Fractions are dropped.
    exportBuffers() {
        const whole = buf => {
            const out = [];
            for (const [k, v] of buf) if (Math.floor(v + 1e-6) >= 1) out.push([k, Math.floor(v + 1e-6)]);
            return out;
        };
        const edges = {};
        for (const e of this.allEdges || []) {
            const list = whole(e.buf);
            if (list.length > 0) edges[e.id] = list;
        }
        const pools = [];
        for (const [channel, pool] of this.pools) {
            const buf = whole(pool.buf);
            const outBuf = pool.outBuf ? whole(pool.outBuf) : [];
            if (buf.length > 0 || outBuf.length > 0) pools.push([channel, buf, outBuf]);
        }
        return { edges, pools };
    }

    // saved: { edges: { edge id: [[key, n]] }, tiles: { "x,y": [[key, n]] }, pools }.
    // `tiles` is what lay on real belts when a factory was compressed.
    importBuffers(saved) {
        if (!saved) return;
        const edges = this.allEdges || [];
        const byId = new Map(edges.map(e => [e.id, e]));
        for (const id in saved.edges || {}) {
            const edge = byId.get(id);
            if (edge) for (const [k, n] of saved.edges[id]) addAmount(edge.buf, k, n);
        }
        const tiles = saved.tiles || {};
        for (const edge of edges) {
            for (const tile of edge.tileKeys) {
                for (const [k, n] of tiles[tile] || []) addAmount(edge.buf, k, n);
                delete tiles[tile];
            }
        }
        for (const [channel, buf, outBuf] of saved.pools || []) {
            const pool = this.pools.get(channel);
            if (!pool) continue;
            for (const [k, n] of buf) addAmount(pool.buf, k, n);
            if (pool.outBuf) for (const [k, n] of outBuf || []) addAmount(pool.outBuf, k, n);
        }
    }

    // What lies on each run of belts: [{ tileKeys, items: [[key, n]] }]
    exportEdgeItems() {
        const saved = this.exportBuffers();
        return (this.allEdges || [])
            .filter(e => saved.edges[e.id] && e.tileKeys.length > 0)
            .map(e => ({ tileKeys: e.tileKeys, items: saved.edges[e.id] }));
    }

    exportStock() {
        const stock = {};
        for (const node of this.nodes) {
            if (node.kind !== "storage") continue;
            const count = Math.round(node.count);
            stock[node.uid] = { k: count > 0 ? node.key : null, c: count };
        }
        return stock;
    }

    // Totals of what the storages hold: Map shape key -> count
    stockTotals() {
        const totals = new Map();
        for (const node of this.nodes) {
            if (node.kind === "storage" && node.key && node.count >= 0.5) addAmount(totals, node.key, node.count);
        }
        return totals;
    }

    stepNode(node, dt) {
        switch (node.kind) {
            case "machine":
                this.stepMachine(node, dt);
                return;
            case "storage":
                this.stepStorage(node, dt);
                return;
            case "balancer":
            case "pass":
            case "filter": {
                const available = node.inputs.reduce((s, _, slot) => s + totalAmount(this.slotContents(node, slot)), 0);
                if (available <= 0) return;
                const limit = this.passLimit(node, dt);
                if (node.kind === "filter") {
                    // Matching shapes go straight through (slot 0), others to the side (slot 1)
                    const waiting = this.slotContents(node, 0);
                    const signal = node.signal;
                    if (!signal) return;
                    let moved = 0;
                    for (const [key, amount] of waiting) {
                        const pass = signal.b === true || signal.k === key;
                        const edge = node.outputs[pass ? 0 : 1];
                        const amountNow = Math.min(amount, this.room(edge, dt), limit - moved);
                        if (amountNow <= 0) continue;
                        for (const e of node.inputs[0]) {
                            const have = e.buf.get(key) || 0;
                            if (!have) continue;
                            const left = have - (have / amount) * amountNow;
                            if (left <= 1e-9) e.buf.delete(key);
                            else e.buf.set(key, left);
                        }
                        this.push(edge, key, amountNow);
                        moved += amountNow;
                    }
                    return;
                }
                const outputs = node.outputs.filter(Boolean);
                const room = outputs.reduce((s, e) => s + this.room(e, dt), 0);
                const amount = Math.min(available, limit, room);
                if (amount <= 0) return;
                const taken = this.takeFromAllInputs(node, amount);
                this.spread(taken, outputs, dt);
                return;
            }
            case "tunnelIn": {
                const receiver = node.receiver;
                const edge = receiver && receiver.outputs[0];
                const amount = Math.min(totalAmount(this.slotContents(node, 0)), this.room(edge, dt));
                if (amount <= 0) return;
                for (const [k, v] of this.takeFromSlot(node, 0, amount)) this.push(edge, k, v);
                return;
            }
            case "miner": {
                // A chain of miners passes everything on to the last one, which
                // ejects it; what does not fit waits (a little), a blocked miner
                // just stops mining
                const own = node.resource ? this.root.hubGoals.getMinerBaseSpeed() * dt : 0;
                const chain = node.chainIn;
                node.chainIn = new Map();
                if (node.chainTo) {
                    for (const [k, v] of chain) addAmount(node.chainTo.chainIn, k, v);
                    if (own > 0) addAmount(node.chainTo.chainIn, node.resource, own);
                    return;
                }
                const edge = node.outputs[0];
                let room = this.room(edge, dt);
                const chainTotal = totalAmount(chain);
                const fromChain = Math.min(chainTotal, room);
                for (const [k, v] of chain) {
                    const part = chainTotal > 0 ? (v / chainTotal) * fromChain : 0;
                    if (part > 0) this.push(edge, k, part);
                    const left = Math.min(v - part, 2);
                    if (left > 1e-9) addAmount(node.chainIn, k, left);
                }
                room -= fromChain;
                if (own > 0 && room > 0) this.push(edge, node.resource, Math.min(own, room));
                return;
            }
            case "hubSource": {
                const edge = node.outputs[0];
                if (!edge) return;
                let amount = Math.min(this.room(edge, dt), this.ejectorRate * dt);
                if (node.counted) {
                    this.stepCountedExtractor(node, edge, amount);
                    return;
                }
                if (!node.key) return;
                if (this.live && isColorKey(node.key)) {
                    this.stepColorExtractor(node, edge, amount);
                    return;
                }
                if (this.live) {
                    const stored = this.root.hubGoals.getShapesStoredByKey(node.key) - (this.hubDebt.get(node.key) || 0);
                    amount = Math.max(0, Math.min(amount, stored));
                    addAmount(this.hubDebt, node.key, amount);
                }
                this.push(edge, node.key, amount);
                this.record(node.portKey, node.key, amount);
                return;
            }
            case "hubSink":
            case "trash":
                node.inputs.forEach((_, slot) => {
                    const taken = this.takeFromSlot(node, slot, Infinity);
                    if (node.kind !== "hubSink") return;
                    const portKey = this.hubPortOf.get(node.uid + ":" + slot) || node.portKey;
                    for (const [k, v] of taken) {
                        this.record(portKey, k, v);
                        if (this.live) addAmount(this.hubOut, k, v);
                    }
                });
                return;
            case "tpIn": {
                if (!node.channel) return;
                const pool = this.getPool(node.channel);
                // Each input teleporter hands one item per tick to the outputs
                const room = Math.max(0, pool.inputs.length * this.teleporterRate * dt - totalAmount(pool.buf));
                const taken = this.takeFromSlot(node, 0, Math.min(room, this.teleporterRate * dt));
                for (const [k, v] of taken) addAmount(pool.buf, k, v);
                return;
            }
        }
    }

    // Shapes of `key` the Hub still holds after what the model already took
    hubStock(key) {
        return (this.root.hubGoals.storedShapes[key] || 0) - (this.hubDebt.get(key) || 0);
    }

    // Live Hub Extractor (Count): like the real one, empties one shape the Hub
    // holds the chosen number of (or fewer) after the other
    stepCountedExtractor(node, edge, amount) {
        if (!this.live) return;
        const c = node.counted;
        const matches = n => (c.orFewer ? n >= 1 && n <= c.target : n === c.target);
        let rescanned = false;
        while (amount > 1e-9) {
            if (!c.key) {
                if (c.queue.length === 0) {
                    if (rescanned) return;
                    rescanned = true;
                    c.queue = Object.keys(this.root.hubGoals.storedShapes).filter(key => matches(Math.round(this.hubStock(key))));
                    continue;
                }
                const key = c.queue.pop();
                const n = Math.round(this.hubStock(key));
                if (!matches(n)) continue; // the amount changed since it was queued
                c.key = key;
                c.left = n;
            }
            const take = Math.min(amount, c.left, Math.max(0, this.hubStock(c.key)));
            if (take > 0) {
                this.push(edge, c.key, take);
                addAmount(this.hubDebt, c.key, take);
                amount -= take;
                c.left -= take;
            }
            if (c.left <= 1e-9 || this.hubStock(c.key) <= 1e-9) c.key = null;
        }
    }

    // Live Hub Extractor with a color signal: each color costs two of a shape
    // the Hub holds at least two of, painted only in that color. Whole items
    // only, so a pair is never split.
    stepColorExtractor(node, edge, amount) {
        let left = Math.floor(amount + 1e-9);
        if (left <= 0) return;
        const code = shapez.enumColorToShortcode[node.key];
        for (const key in this.root.hubGoals.storedShapes) {
            const painted = key.split(":").every(layer => {
                for (let i = 1; i < 8; i += 2) {
                    const ch = layer.charAt(i);
                    if (ch !== code && ch !== "-" && ch !== "_") return false;
                }
                return true;
            });
            if (!painted) continue;
            const take = Math.min(left, Math.floor(this.hubStock(key) / 2));
            if (take <= 0) continue;
            addAmount(this.hubDebt, key, 2 * take);
            this.push(edge, node.key, take);
            left -= take;
            if (left <= 0) return;
        }
    }

    // Teleporter channels: hand the pooled items to the outputs (inside, and
    // outside through a port), then top up from outside if the channel has
    // an input port
    stepPool(pool, dt) {
        const outputs = pool.outputs.map(node => node.outputs[0]).filter(Boolean);
        const wanted = outputs.reduce((s, e) => s + Math.min(this.room(e, dt), this.teleporterRate * dt), 0) +
            (pool.outPort ? totalAmount(pool.buf) + pool.inputs.length * this.teleporterRate * dt : 0);
        if (this.live && pool.outPort && totalAmount(pool.buf) === 0) return;
        if (pool.inPort && pool.inShares && totalAmount(pool.buf) < wanted) {
            const missing = wanted - totalAmount(pool.buf);
            for (const key in pool.inShares) {
                addAmount(pool.buf, key, missing * pool.inShares[key]);
                this.record(pool.inPort, key, missing * pool.inShares[key]);
            }
        }
        const available = totalAmount(pool.buf);
        if (available <= 0) return;
        const items = takeProportional(pool.buf, Math.min(available, wanted));
        const total = totalAmount(items);
        const placed = this.spread(items, outputs, dt);
        if (pool.outPort && total > placed) {
            const out = this.live
                ? Math.min(total - placed, Math.max(0, this.outBufCap(pool) - totalAmount(pool.outBuf)))
                : Math.min(total - placed, pool.outRate * dt);
            if (this.live) for (const [k, v] of items) addAmount(pool.outBuf, k, (v / total) * out);
            for (const [k, v] of items) this.record(pool.outPort, k, (v / total) * out);
            // Anything neither placed nor sent out goes back into the pool
            const back = total - placed - out;
            if (back > 1e-9) for (const [k, v] of items) addAmount(pool.buf, k, (v / total) * back);
        } else if (total > placed) {
            for (const [k, v] of items) addAmount(pool.buf, k, (v / total) * (total - placed));
        }
    }

    // Live: shapes waiting to leave through a teleporter channel. Each input
    // teleporter of the channel hands out one per tick, so hold a step's worth.
    outBufCap(pool) {
        return Math.max(4, 1.5 * Math.max(1, pool.inputs.length) * this.teleporterRate * this.stepSize);
    }

    step(dt) {
        const edges = this.allEdges || [];
        for (const e of edges) e.pushed = 0;

        // Items leaving the area (live: the box hands them out itself)
        if (!this.live) {
            for (const edge of edges) {
                if (!edge.dest || !edge.dest.port) continue;
                const taken = takeProportional(edge.buf, edge.rate * dt);
                for (const [k, v] of taken) this.record(edge.dest.port, k, v);
            }
        }
        for (const e of edges) e.start = totalAmount(e.buf);
        for (let i = this.order.length - 1; i >= 0; --i) this.setDemand(this.order[i], dt);
        // Belts ending nowhere just fill up
        for (const node of this.order) this.stepNode(node, dt);
        for (const pool of this.pools.values()) this.stepPool(pool, dt);

        let moved = 0;
        for (const e of edges) moved += e.pushed || 0;
        this.lastMoved = moved;

        // Items entering the area, as fast as there is room
        for (const source of this.sources) {
            const amount = this.room(source.edge, dt);
            if (amount <= 0) continue;
            for (const key in source.shares) {
                this.push(source.edge, key, amount * source.shares[key]);
                this.record(source.portKey, key, amount * source.shares[key]);
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////
// HUD - compress key, click to edit / unpack

class HUDFactoryCompressor extends shapez.BaseHUDPart {
    createElements(parent) {
        this.panel = document.createElement("div");
        this.panel.id = "fc-panel";
        Object.assign(this.panel.style, {
            position: "fixed",
            bottom: "74px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(28, 22, 52, 0.95)",
            border: "1px solid rgba(169, 156, 255, 0.45)",
            borderRadius: "10px",
            padding: "9px 14px 9px",
            color: "#ece9ff",
            fontFamily: "'GameFont', 'Roboto Condensed', sans-serif",
            fontSize: "13px",
            zIndex: "2000",
            display: "none",
            minWidth: "300px",
            maxWidth: "560px",
            userSelect: "none",
            boxShadow: "0 4px 22px rgba(0,0,0,0.55)",
            pointerEvents: "auto",
            lineHeight: "1.5",
        });
        parent.appendChild(this.panel);
        try {
            this.keepWireLayer = localStorage.getItem("factoryCompressor.keepWireLayer") === "1";
        } catch (e) {
            this.keepWireLayer = false;
        }
        this.panel.addEventListener("click", event => {
            const action = event.target && event.target.getAttribute && event.target.getAttribute("data-fc");
            if (action) this.onPanelAction(action);
        });
    }

    initialize() {
        this.root.camera.downPreHandler.add(this.onMouseDown, this);
        // Pipette on the box would select a building that cannot be placed.
        // A top handler instead of a method patch, because Pipette on Wire
        // Layer replaces startPipette without calling the original.
        this.root.keyMapper
            .getBinding(shapez.KEYMAPPINGS.placement.pipette)
            .addToTop(this.onPipette, this);
        this.selectionKey = "";
        this.selectionInfo = null;
        this.analyzeAt = 0;
        this.panelHtml = "";
    }

    onPipette() {
        const mousePos = this.root.app.mousePosition;
        if (!mousePos || this.root.camera.getIsMapOverlayActive()) return;
        const tile = this.root.camera.screenToWorld(mousePos).toTileSpace();
        const contents = this.root.map.getTileContent(tile, this.root.currentLayer);
        if (contents && contents.components.FactoryBox) return shapez.STOP_PROPAGATION;
    }

    onMouseDown(pos, button) {
        if (button !== shapez.enumMouseButton.left) return;
        if (this.root.currentLayer !== "regular") return;
        if (this.root.camera.getIsMapOverlayActive()) return;
        const placer = this.root.hud.parts.buildingPlacer;
        if (placer && placer.currentMetaBuilding.get()) return;
        const blueprintPlacer = this.root.hud.parts.blueprintPlacer;
        if (blueprintPlacer && blueprintPlacer.currentBlueprint.get()) return;

        const tile = this.root.camera.screenToWorld(pos).toTileSpace();
        const contents = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
        if (!contents || !contents.components.FactoryBox) return;
        this.openBoxDialog(contents);
        return shapez.STOP_PROPAGATION;
    }

    showProblem(title, text) {
        this.root.hud.parts.dialogs.showWarning(title, text);
    }

    notify(text, type = shapez.enumNotificationType.info) {
        this.root.hud.signals.notification.dispatch(text, type);
    }

    // Collects and checks the area around the given buildings.
    // Returns { rect, entities, ports } or { error, problems }
    analyzeEntities(selected) {
        const analyzer = new RegionAnalyzer(this.root);
        const { rect, entities, tooLarge, kept, blockedInside, nothing } = analyzer.collect(selected);
        if (nothing) {
            const error = "Only inputs / outputs are selected. " + OUTSIDE_KINDS + " are never compressed.";
            return { error, problems: [error] };
        }
        if (blockedInside.size > 0) {
            const first = [...blockedInside][0];
            const o = first.components.StaticMapEntity.origin;
            const error = "There is " + outsideLabel(first) + " inside the area (at " + o.x + "," + o.y + "). " + OUTSIDE_KINDS +
                " are never compressed - they must be at the edge of the factory, outside the selection.";
            return { error: escapeHtml(error), problems: [error] };
        }
        if (tooLarge) {
            const error = "The area is too large (max " + MAX_REGION_TILES + " tiles).";
            return { error, problems: [error] };
        }
        const keptWires = analyzer.releaseThroughWires(entities, !!this.keepWireLayer);
        const problems = analyzer.validate(rect, entities);
        if (problems.length > 0) {
            const shown = problems.slice(0, 8).map(escapeHtml).join("<br>");
            const more = problems.length > 8 ? "<br>... and " + (problems.length - 8) + " more" : "";
            return { error: shown + more, problems };
        }
        const ports = analyzer.findPorts(rect, entities);
        return {
            rect,
            entities,
            keptOutside: kept.length,
            keptWires,
            ports,
            hubLineOf: analyzer.hubLineOf,
            hubSlotPort: analyzer.hubSlotPort,
            entityLine: analyzer.entityLine,
        };
    }

    // Costs what pasting this factory as a blueprint would cost.
    // Returns { fee } or { error }
    computeFee(entities) {
        const hubGoals = this.root.hubGoals;
        if (this.root.gameMode.getHasFreeCopyPaste()) return { fee: 0 };
        if (!hubGoals.isRewardUnlocked(shapez.enumHubGoalRewards.reward_blueprints)) {
            return { error: "Compressing needs blueprints to be unlocked." };
        }
        const fee = new shapez.Blueprint([...entities]).getCost();
        const stored = hubGoals.getShapesStoredByKey(this.root.gameMode.getBlueprintShapeKey());
        if (stored < fee) {
            return {
                fee,
                error: "Compressing " + entities.size + " buildings costs " + fee +
                    " blueprint shapes, but the Hub has only " + stored + ".",
            };
        }
        return { fee };
    }

    // The current mass selection. Multi Layer Copy keeps it in
    // `selectedEntities`, the base game in `selectedUids`.
    getSelectedEntities() {
        const massSelector = this.root.hud.parts.massSelector;
        if (!massSelector) return [];
        if (Array.isArray(massSelector.selectedEntities)) {
            return massSelector.selectedEntities.filter(e => e && !e.destroyed && !e.queuedForDestroy);
        }
        const selected = [];
        if (massSelector.selectedUids instanceof Set) {
            for (const uid of massSelector.selectedUids) {
                const entity = this.root.entityMgr.findByUid(uid, false);
                if (entity) selected.push(entity);
            }
        }
        return selected;
    }

    clearSelection() {
        const massSelector = this.root.hud.parts.massSelector;
        if (!massSelector) return;
        if (typeof massSelector.clearSelection === "function") massSelector.clearSelection();
        if (Array.isArray(massSelector.selectedEntities)) massSelector.selectedEntities = [];
        if (massSelector.selectedUids instanceof Set) massSelector.selectedUids = new Set();
    }

    // K: measure the selected factory, then compress it with the measured recipe
    // Which shapes are coming in at each input port right now: what is on the
    // belt outside it, or in the teleporters of its channel.
    // Returns { expect: { portKey: { key: share } }, missing: [port numbers] }
    detectExpected(rect, ports) {
        const expect = {};
        const missing = [];
        const addCounts = (key, counts) => {
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            if (total <= 0) return false;
            expect[key] = {};
            for (const k in counts) expect[key][k] = counts[k] / total;
            return true;
        };
        ports.forEach((port, index) => {
            const key = portWorldKey(port, rect);
            const counts = {};
            const count = item => {
                const k = itemKey(item);
                if (k) counts[k] = (counts[k] || 0) + 1;
            };
            if (port.kind === "belt-in") {
                const inner = new shapez.Vector(port.x + rect.x, port.y + rect.y);
                const tile = inner.add(dirVec(port.dir));
                const outside = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
                if (outside && outside.components.Belt && outside.components.Belt.assignedPath) {
                    for (const [, item] of outside.components.Belt.assignedPath.items) count(item);
                } else if (outside && outside.components.ItemEjector) {
                    // Only the output that faces this input (a cutter has two halves)
                    const staticComp = outside.components.StaticMapEntity;
                    for (const slot of outside.components.ItemEjector.slots) {
                        const from = staticComp.localTileToWorld(slot.pos);
                        const to = from.add(dirVec(staticComp.localDirectionToWorld(slot.direction)));
                        if (to.equals(inner)) count(slot.item || slot.lastItem);
                    }
                }
                // Or what the building just inside is holding or has just taken in
                const inside = Object.keys(counts).length === 0 && this.root.map.getLayerContentXY(inner.x, inner.y, "regular");
                if (inside && inside.components.Belt && inside.components.Belt.assignedPath) {
                    for (const [, item] of inside.components.Belt.assignedPath.items) count(item);
                } else if (inside) {
                    // Only the input slot this port feeds (a painter's other slot takes the color)
                    const staticComp = inside.components.StaticMapEntity;
                    const acceptor = inside.components.ItemAcceptor;
                    const slot = acceptor
                        ? acceptor.slots.findIndex(
                              s => staticComp.localTileToWorld(s.pos).equals(inner) && staticComp.localDirectionToWorld(s.direction) === port.dir
                          )
                        : -1;
                    if (slot >= 0) {
                        for (const anim of acceptor.itemConsumptionAnimations || []) if (anim.slotIndex === slot) count(anim.item);
                        const processor = inside.components.ItemProcessor;
                        if (processor && processor.inputSlots) count(processor.inputSlots.get(slot));
                    }
                }
            } else if (port.kind === "tp-in") {
                // Channels are often named after the shape they carry
                if (isValidKey(port.channel)) {
                    counts[port.channel] = 1;
                } else {
                    for (const e of this.root.entityMgr.componentToEntity.InputTeleporterComponent || []) {
                        const tp = e.components.InputTeleporterComponent;
                        if (tp && tp.channel === port.channel) count(tp.item);
                    }
                    for (const e of this.root.entityMgr.componentToEntity.OutputTeleporterComponent || []) {
                        if (e.components.OutputTeleporterComponent.channel !== port.channel) continue;
                        for (const slot of e.components.ItemEjector.slots) count(slot.item || slot.lastItem);
                    }
                }
            } else {
                return;
            }
            if (!addCounts(key, counts)) missing.push(index + 1);
        });
        return { expect, missing };
    }

    // What the area takes in and puts out at full speed, with the input shapes
    // seen now: { inputs, outputs, hub } (for display), or null
    estimateCapacity(region) {
        const result = this.calculateRegion(region);
        if (!result.recipe) return null;
        return summarizeRecipe({ ports: region.ports, recipe: result.recipe });
    }

    // Works the recipe out from the buildings. Returns { recipe, calc } or { problems }
    calculateRegion(region, observed = {}) {
        const { rect, ports, entities } = region;
        const detected = this.detectExpected(rect, ports);
        const expect = Object.assign(detected.expect, observed);
        const missing = detected.missing.filter(n => !(portWorldKey(ports[n - 1], rect) in observed));
        const signals = captureSignals(entities);
        const items = [...entities].map(entity => ({ entity, uid: entity.uid }));
        const result = new FactoryCalculator(this.root, items, { rect, ports, expect, signals }).run();
        if (result.problems) {
            // Only unknown input shapes: watching the inputs briefly can tell
            const onlyMissing = missing.length > 0 && result.problems.every(p => p.startsWith("It is not known"));
            return { problems: result.problems, missing: onlyMissing ? missing : null };
        }
        return { recipe: recipeFromCounts(ports, rect, result.counts, result.seconds), calc: { expect, signals } };
    }

    // Can the area run as a live model? Returns { signals } or { problems }
    checkLive(region) {
        const signals = captureSignals(region.entities);
        const items = [...region.entities].map(entity => ({ entity, uid: entity.uid }));
        const sim = new FactoryCalculator(this.root, items, { rect: region.rect, ports: region.ports, signals, live: true, stepSize: LIVE_STEP });
        sim.build();
        return sim.problems.length > 0 ? { problems: sim.problems } : { signals };
    }

    // Compresses into a live box, or measures when a building is not supported.
    // Returns the box, { measuring: true } or { error }
    compressAuto(region, selected) {
        const live = this.checkLive(region);
        if (live.signals) {
            // Worked out while the buildings still stand
            const calc = this.calculateRegion(region);
            const capacity = calc.recipe ? summarizeRecipe({ ports: region.ports, recipe: calc.recipe }) : null;
            const compressLive = () => {
                const box = this.compressRegion(region, emptyRecipe(region.ports), {
                    source: "live",
                    calc: { expect: null, signals: live.signals },
                });
                if (!box.error) box.components.FactoryBox.state.capacity = capacity;
                return box;
            };
            // Every input is known and nothing inside keeps a stock: a calculated
            // recipe does the same for much less work. Ask which one to use.
            if (calc.recipe && ![...region.entities].some(e => e.components.Storage)) {
                const answer = this.root.hud.parts.dialogs.showWarning(
                    "Compress as a calculated recipe?",
                    "Every input of this factory is known. A <b>calculated recipe</b> costs the game much less " +
                        "and follows upgrades by itself; the <b>live model</b> also reacts when what arrives changes.<br><br>" +
                        "<b>Takes in</b>: " + escapeHtml(formatRates(capacity.inputs)) + "<br>" +
                        "<b>Puts out</b>: " + escapeHtml(formatRates(capacity.outputs.concat(capacity.hub || []))),
                    ["cancel:bad:escape", "fcLive:misc", "fcCalc:good:enter"]
                );
                answer.fcCalc.add(() => {
                    const box = this.compressRegion(region, calc.recipe, { calc: calc.calc });
                    if (box.error) this.showProblem("Cannot compress", box.error);
                });
                answer.fcLive.add(() => {
                    const box = compressLive();
                    if (box.error) this.showProblem("Cannot compress", box.error);
                });
                return { pending: true };
            }
            return compressLive();
        }
        this.notify("Cannot model this factory (" + live.problems[0] + ") - measuring it instead", shapez.enumNotificationType.warning);
        this.measureAndCompress([selected], MEASURE_SECONDS).then(report => {
            if (report[0].error) this.showProblem("Cannot compress", report[0].error);
        });
        return { measuring: true };
    }

    compressSelection(mode = "auto") {
        if (this.measuring || this.observing) {
            this.notify("A factory is being measured - wait until it is done.", shapez.enumNotificationType.warning);
            return;
        }
        const selected = this.getSelectedEntities();
        if (selected.length === 0) {
            this.notify("Select a factory first (Ctrl + drag), then press K.", shapez.enumNotificationType.warning);
            return;
        }
        if (selected.some(e => e.components.FactoryBox)) {
            this.notify("Compressed factories are selected - use the Unpack button to unpack them.", shapez.enumNotificationType.warning);
            return;
        }
        const region = this.analyzeEntities(selected);
        if (region.error) {
            this.showProblem("Cannot compress", region.error);
            return;
        }
        const cost = this.computeFee(region.entities);
        if (cost.error) {
            this.showProblem("Cannot compress", cost.error);
            return;
        }
        this.clearSelection();
        if (mode === "now") {
            const box = this.compressRegion(region, emptyRecipe(region.ports));
            if (box.error) this.showProblem("Cannot compress", box.error);
            else this.openRecipeDialog(box);
            return;
        }
        if (mode === "auto") {
            const box = this.compressAuto(region, selected);
            if (box.error) this.showProblem("Cannot compress", box.error);
            return;
        }
        this.measureAndCompress([selected], MEASURE_SECONDS).then(report => {
            if (report[0].error) this.showProblem("Cannot compress", report[0].error);
        });
    }

    onPanelAction(action) {
        if (action === "auto") this.compressSelection("auto");
        else if (action === "measure") this.compressSelection("measure");
        else if (action === "now") this.compressSelection("now");
        else if (action === "cancel") this.cancelMeasuring();
        else if (action === "unpackAll") this.unpackMany(this.selectedBoxes || []);
        else if (action === "toCalc") this.convertManyToCalc(this.selectedBoxes || []);
        else if (action === "toLive") this.convertManyToLive(this.selectedBoxes || []);
        else if (action === "restart") this.root.systemMgr.systems.factoryBox.restartModels(this.selectedBoxes || []);
        else if (action === "wires") {
            this.keepWireLayer = !this.keepWireLayer;
            try {
                localStorage.setItem("factoryCompressor.keepWireLayer", this.keepWireLayer ? "1" : "0");
            } catch (e) {}
            this.selectionInfo = null;
            this.analyzeAt = 0;
        }
        this.selectionKey = ""; // refresh the panel
    }

    // Replaces the region's buildings with a box running `recipe`.
    // Returns the box entity or { error }
    compressRegion(region, recipe, { name = "", free = false, calc = null, source = null } = {}) {
        const { rect, entities, ports } = region;
        for (const entity of entities) {
            if (entity.destroyed || entity.queuedForDestroy) return { error: "The factory changed meanwhile." };
        }
        const cost = free ? { fee: 0 } : this.computeFee(entities);
        if (cost.error) return { error: cost.error };
        const entityList = [...entities];

        const state = {
            v: 1,
            name,
            w: rect.w,
            h: rect.h,
            ports,
            recipe,
            buf: {},
            blob: JSON.stringify(entityList.map(e => e.serialize())),
            count: entityList.length,
            fee: cost.fee,
            ox: rect.x,
            oy: rect.y,
            // "calc": worked out from the buildings (redone on upgrades),
            // "measured" or "manual"
            source: source || (calc ? "calc" : "manual"),
            // The upgrades the recipe was made with: a measured recipe does not
            // follow later ones (see isOutdated)
            upg: Object.assign({}, this.root.hubGoals.upgradeLevels),
            expect: calc ? calc.expect : null,
            signals: calc ? calc.signals : null,
            // Shapes on the belts now: a live box starts from them
            belts: source === "live" ? harvestBeltItems(entityList) : null,
        };

        const meta = shapez.gMetaBuildingRegistry.findByClass(MetaFactoryBoxBuilding);
        const box = meta.createEntity({
            root: this.root,
            origin: new shapez.Vector(rect.x, rect.y),
            rotation: 0,
            originalRotation: 0,
            rotationVariant: 0,
            variant: shapez.defaultBuildingVariant,
        });
        box.components.FactoryBox.state = normalizeState(state);
        box.components.FactoryBox.applyLayout();

        this.changeBuildings(() => {
            // Removed directly (not via tryDeleteBuilding), so Building Costs
            // does not refund them - they still exist inside the box.
            for (const entity of entityList) {
                this.root.map.removeStaticEntity(entity);
                this.root.entityMgr.destroyEntity(entity);
            }
            this.root.entityMgr.processDestroyList();
            this.root.map.placeStaticEntity(box);
            this.root.entityMgr.registerEntity(box);
        });
        if (cost.fee > 0) this.root.hubGoals.takeShapeByKey(this.root.gameMode.getBlueprintShapeKey(), cost.fee);

        this.notify(
            "Compressed " + entityList.length + " buildings" + (cost.fee > 0 ? " for " + cost.fee + " blueprint shapes" : ""),
            shapez.enumNotificationType.success
        );
        return box;
    }

    // Measures every selection for `seconds` of game time, then compresses each
    // with the measured recipe. Resolves with one report per selection:
    // { box } or { error }. Selections must not overlap.
    measureAndCompress(selections, seconds, options = {}) {
        const report = selections.map(() => ({}));
        const regions = [];
        const used = new Set();
        selections.forEach((selected, index) => {
            const region = this.analyzeEntities(selected);
            if (region.error) {
                report[index] = { error: region.error };
                return;
            }
            const r = region.rect;
            const rectsOverlap = regions.some(
                o => r.x < o.rect.x + o.rect.w && o.rect.x < r.x + r.w && r.y < o.rect.y + o.rect.h && o.rect.y < r.y + r.h
            );
            if (rectsOverlap || [...region.entities].some(e => used.has(e))) {
                report[index] = { error: "Overlaps another area being measured." };
                return;
            }
            region.entities.forEach(e => used.add(e));
            region.reportIndex = index;
            regions.push(region);
        });
        if (regions.length === 0) return Promise.resolve(report);

        const meter = new FlowMeter(this.root, regions);
        meter.start();
        this.notify(
            "Measuring " + regions.length + " factor" + (regions.length === 1 ? "y" : "ies") + " for " + seconds + " seconds ..."
        );
        return new Promise(resolve => {
            this.measuring = { meter, regions, seconds, resolve, report, options };
        });
    }

    // Watches inputs whose shapes are not known until a shape passed each (or
    // OBSERVE_SECONDS are over), then calculates. Only the kinds of shapes
    // are taken from this, the speed is still calculated.
    observeInputs(region, missing) {
        const keys = missing.map(n => portWorldKey(region.ports[n - 1], region.rect));
        const meter = new FlowMeter(this.root, [region]);
        meter.start();
        this.observing = { meter, region, keys };
        this.notify("Checking which shapes come in at #" + missing.join(", #") + " ...");
    }

    finishObserving() {
        const { meter, region, keys } = this.observing;
        this.observing = null;
        meter.stop();
        const observed = {};
        for (const key of keys) {
            const counts = region.counts[key] || {};
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            observed[key] = {};
            for (const k in counts) observed[key][k] = counts[k] / total;
        }
        const result = this.calculateRegion(region, observed);
        if (result.recipe) {
            const box = this.compressRegion(region, result.recipe, { calc: result.calc });
            if (box.error) this.showProblem("Cannot compress", box.error);
            return;
        }
        this.notify("Cannot calculate (" + result.problems[0] + ") - measuring instead", shapez.enumNotificationType.warning);
        this.measureAndCompress([[...region.entities]], MEASURE_SECONDS).then(report => {
            if (report[0].error) this.showProblem("Cannot compress", report[0].error);
        });
    }

    cancelMeasuring() {
        const measuring = this.measuring;
        if (!measuring) return;
        this.measuring = null;
        measuring.meter.stop();
        measuring.regions.forEach(r => (measuring.report[r.reportIndex] = { error: "Measuring was cancelled." }));
        measuring.resolve(measuring.report);
        this.notify("Measuring cancelled - nothing was compressed.");
    }

    update() {
        // The HUD only draws its own parts in world space, so piggyback on the mass selector
        const massSelector = this.root.hud.parts.massSelector;
        if (massSelector && !massSelector.fcDrawHooked) {
            massSelector.fcDrawHooked = true;
            const originalDraw = massSelector.draw.bind(massSelector);
            massSelector.draw = parameters => {
                originalDraw(parameters);
                this.draw(parameters);
            };
        }

        const observing = this.observing;
        if (observing) {
            const seenAll = observing.keys.every(k => observing.region.counts[k]);
            if (seenAll || observing.meter.seconds >= OBSERVE_SECONDS) this.finishObserving();
        }

        const measuring = this.measuring;
        if (measuring && measuring.meter.seconds >= measuring.seconds) {
            this.measuring = null;
            const { meter, regions, resolve, report, options } = measuring;
            meter.stop();
            for (const region of regions) {
                const recipe = recipeFromCounts(region.ports, region.rect, region.counts, meter.seconds, region.capacity);
                const box = this.compressRegion(region, recipe, Object.assign({ source: "measured" }, options));
                report[region.reportIndex] = box.error ? { error: box.error } : { box };
            }
            resolve(report);
        }

        this.updatePanel();
    }

    // The bottom panel: what is selected, what compressing it costs, buttons
    updatePanel() {
        if (!this.panel) return;
        const measuring = this.measuring;
        const selected = measuring ? [] : this.getSelectedEntities();
        const boxes = selected.filter(e => e.components.FactoryBox);
        this.selectedBoxes = boxes;
        const now = performance.now();

        // Re-check the selection only after it stopped changing for a moment
        const key = selected.length + ":" + (selected[0] ? selected[0].uid : "") + ":" +
            (selected.length ? selected[selected.length - 1].uid : "");
        if (key !== this.selectionKey) {
            this.selectionKey = key;
            this.selectionInfo = null;
            this.analyzeAt = now + 250;
        }
        if (!measuring && selected.length > 0 && boxes.length === 0 && !this.selectionInfo && now >= this.analyzeAt) {
            const region = this.analyzeEntities(selected);
            const info = { count: selected.length };
            if (region.error) {
                info.problem = region.problems[0] + (region.problems.length > 1 ? " (+" + (region.problems.length - 1) + " more)" : "");
            } else {
                const cost = this.computeFee(region.entities);
                info.count = region.entities.size;
                info.kept = region.keptOutside || 0;
                info.keptWires = region.keptWires || 0;
                info.size = region.rect.w + "x" + region.rect.h;
                info.ports = region.ports.length;
                info.fee = cost.fee;
                info.problem = cost.error || null;
            }
            this.selectionInfo = info;
        }

        let html = "";
        const button = (action, text, color) =>
            '<button data-fc="' + action + '" style="background:' + color +
            ';border:none;border-radius:5px;color:#fff;padding:3px 12px;margin:0 6px 0 0;cursor:pointer;font-size:12px;font-family:inherit;">' +
            text + "</button>";
        if (measuring) {
            const left = Math.max(0, Math.ceil(measuring.seconds - measuring.meter.seconds));
            html =
                "<b>Factory Compressor</b> - measuring " + measuring.regions.length + " factor" +
                (measuring.regions.length === 1 ? "y" : "ies") + ", " + left + "s left" +
                '<div style="margin-top:6px;">' + button("cancel", "Cancel", "#a8455a") + "</div>";
        } else if (boxes.length > 0) {
            const buildings = boxes.reduce((sum, box) => sum + (box.components.FactoryBox.state.count || 0), 0);
            const others = selected.length - boxes.length;
            html =
                "<b>Factory Compressor</b>" +
                '<div style="opacity:0.85;">' + boxes.length + " compressed factor" + (boxes.length === 1 ? "y" : "ies") +
                " selected (" + buildings + " buildings inside)" +
                (others > 0 ? " - the other " + others + " selected buildings are not changed" : "") + "</div>" +
                '<div style="margin-top:6px;">' +
                button("unpackAll", boxes.length === 1 ? "Unpack" : "Unpack all " + boxes.length, "#2d6ecf") +
                (boxes.some(b => b.components.FactoryBox.sim)
                    ? " " + button("toCalc", "Make calculated", "#2d8a5f") + button("restart", "Restart model", "#8a6d2d")
                    : "") +
                (boxes.some(b => !b.components.FactoryBox.sim && b.components.FactoryBox.state.source === "calc")
                    ? " " + button("toLive", "Make live", "#2d8a8a")
                    : "") + "</div>" +
                '<div style="opacity:0.6;font-size:11px;margin-top:4px;">Puts the original buildings back. ' +
                "Compressing them again costs blueprint shapes.</div>";
        } else if (selected.length > 0) {
            const info = this.selectionInfo;
            let line = selected.length + " selected ...";
            if (info && info.size) {
                line = info.count + " buildings, " + info.size + " tiles, " + info.ports + " connections" +
                    (info.fee ? " - costs " + info.fee + " blueprint shapes" : "") +
                    (info.kept ? " (" + info.kept + " inputs / outputs stay as they are)" : "") +
                    (info.keptWires ? " (" + info.keptWires + " wire-layer buildings stay)" : "");
            }
            const canCompress = info && !info.problem;
            html =
                "<b>Factory Compressor</b>" +
                '<div style="opacity:0.85;">' + escapeHtml(line) + "</div>" +
                (info && info.problem
                    ? '<div style="color:#ff9d9d;">Cannot compress: ' + escapeHtml(info.problem) + "</div>"
                    : "") +
                '<div style="margin-top:4px;">' +
                button("wires", (this.keepWireLayer ? "[ ]" : "[x]") + " Compress the wires", this.keepWireLayer ? "#5a5380" : "#2d8a5f") +
                '<div style="opacity:0.6;font-size:11px;margin-top:2px;">' +
                (this.keepWireLayer
                    ? "Off: wires, signals and displays stay as real buildings (only what the factory's own buildings are wired to is compressed)."
                    : "On: wires and everything on the wires layer are compressed with the factory.") +
                "</div></div>" +
                (canCompress
                    ? '<div style="margin-top:6px;">' + button("auto", "Compress (K)", "#2d6ecf") + "</div>" +
                      '<div style="opacity:0.6;font-size:11px;margin-top:4px;">Turns these buildings into one building that ' +
                      "works like them, so the game has less to simulate. Click it later to unpack.</div>"
                    : "");
        }

        if (html !== this.panelHtml) {
            this.panelHtml = html;
            this.panel.innerHTML = html;
        }
        this.panel.style.display = html ? "block" : "none";
        if (!html) return;

        // Sit above the Multi-Edit panel when both are open
        const multiEdit = document.getElementById("sk-multi-edit-panel");
        const multiEditOpen = multiEdit && multiEdit.style.display !== "none";
        this.panel.style.bottom = (multiEditOpen ? 74 + multiEdit.offsetHeight + 8 : 74) + "px";
    }

    draw(parameters) {
        this.root.systemMgr.systems.factoryBox.drawFarLabels(parameters);
        const measuring = this.measuring;
        if (!measuring) return;
        const ctx = parameters.context;
        const left = Math.max(0, Math.ceil(measuring.seconds - measuring.meter.seconds));
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#ffb454";
        ctx.fillStyle = "rgba(255, 180, 84, 0.12)";
        ctx.textAlign = "center";
        ctx.font = "bold 14px GameFont";
        for (const { rect } of measuring.regions) {
            ctx.fillRect(rect.x * 32, rect.y * 32, rect.w * 32, rect.h * 32);
            ctx.strokeRect(rect.x * 32, rect.y * 32, rect.w * 32, rect.h * 32);
            ctx.fillStyle = "#ffb454";
            ctx.fillText("Measuring ... " + left + "s", (rect.x + rect.w / 2) * 32, rect.y * 32 - 8);
            ctx.fillStyle = "rgba(255, 180, 84, 0.12)";
        }
    }

    // Clicking a box: name, what it does, and what to do with it
    openBoxDialog(entity) {
        const comp = entity.components.FactoryBox;
        const st = comp.state;
        const uid = entity.uid;
        const nameInput = new shapez.FormElementInput({
            id: "name",
            label: "Name",
            placeholder: "Compressed factory",
            defaultValue: st.name || "",
            validator: val => val.length <= 60,
        });

        const system = this.root.systemMgr.systems.factoryBox;
        const live = !!comp.sim;
        // Already on its way: no second click on Make calculated
        const becoming = live && !!(comp.watch || comp.converting);
        const { inputs, outputs, hub } = system.summarize(comp);
        const hasRecipe = live || Object.keys(st.recipe.io).length > 0;
        const stock = live ? system.getStockEntries(comp) : [];
        const stockText = stock.length
            ? formatCount(stock.reduce((sum, e) => sum + e.count, 0)) + " shapes of " + stock.length + " kinds - " +
              stock.slice(0, 6).map(e => e.key + " " + e.text).join(", ") + (stock.length > 6 ? ", ..." : "")
            : "";
        const status = system.getStatus(comp);
        const lineCount = st.lines.length;
        const root = this.root;
        // What it should handle at full speed: the recipe's, or a live box's estimate
        const cap = live ? st.capacity : summarizeRecipe(st);
        const th = (text, opacity) => '<th style="text-align:left;font-weight:normal;opacity:' + opacity + ';padding:0 12px 4px 0;">' + text + "</th>";
        const row = (label, now, full) =>
            '<tr style="vertical-align:top;"><td style="padding:2px 14px 2px 0;opacity:0.7;white-space:nowrap;">' + label +
            '</td><td style="padding:2px 0;">' + now + "</td>" + (cap ? '<td style="padding:2px 0 2px 16px;opacity:0.85;">' + full + "</td>" : "") + "</tr>";
        const capIn = cap && cap.inputs;
        const capOut = cap && (live && !st.ports.some(p => p.kind === "hub-out") ? (cap.outputs || []).concat(cap.hub || []) : cap.outputs);
        const rows = [
            row("IN", chipsHtml(root, inputs, { redWhenZero: true }), chipsHtml(root, capIn)),
            row("OUT", chipsHtml(root, outputs, { redWhenZero: true }), chipsHtml(root, capOut)),
            (hub || []).length > 0 || (cap && (cap.hub || []).length > 0 && !live)
                ? row("HUB", chipsHtml(root, hub, { redWhenZero: true }), chipsHtml(root, cap && cap.hub))
                : "",
            stock.length > 0
                ? '<tr><td style="padding:2px 14px 2px 0;opacity:0.7;white-space:nowrap;">STORED</td><td colspan="2" style="padding:2px 0;">' +
                  chipsHtml(root, stock) + "<br>" + escapeHtml(formatCount(stock.reduce((sum, e) => sum + e.count, 0)) + " shapes in total") + "</td></tr>"
                : "",
        ].join("");
        const explanation = explainStatus(status);
        const cost = system.getCostReport(entity);
        let costHtml;
        if (!cost.ready) {
            costHtml = '<div style="opacity:0.6;margin-top:10px;">Cost to the game: ' +
                (cost.running
                    ? "measuring right now ... (open this again in a few seconds)"
                    : "not measured. Press <b>Measure cost</b> to time every factory for " + COST_SECONDS + " seconds.") + "</div>";
        } else {
            const worth = cost.verdict === "good" ? "#2a9d4a" : cost.verdict === "small" ? "#b8860b" : "#d33";
            const times = cost.ratio >= 10 ? Math.round(cost.ratio) : cost.ratio.toFixed(1);
            const verdict = cost.verdict === "good"
                ? "Worth it: about " + times + " times cheaper than the real buildings"
                : cost.verdict === "small"
                ? "A small gain (about " + times + " times cheaper)"
                : "Not worth it: it costs about as much as the real buildings" +
                  (live ? " - try Make calculated, or Unpack" : " - Unpack it");
            costHtml =
                '<div style="margin-top:10px;"><span style="color:' + worth + ';"><b>' + escapeHtml(verdict) + "</b></span><br>" +
                '<span style="opacity:0.7;">This box costs the game about ' + cost.boxMs.toFixed(2) + " ms per second; its " +
                cost.count + " buildings as real ones would cost about " + cost.realMs.toFixed(2) + " ms per second (an estimate" +
                (cost.minutesAgo > 0 ? ", measured " + cost.minutesAgo + " min ago" : ", just measured") + ").</span></div>";
        }
        const desc =
            '<div style="font-size:0.82em;line-height:1.4;">' +
            '<div style="margin-bottom:4px;"><span style="display:inline-block;width:0.7em;height:0.7em;border-radius:50%;' +
            "background:" + status.color + ';border:1px solid rgba(0,0,0,0.35);margin-right:8px;"></span><b>' + escapeHtml(status.text) + "</b></div>" +
            (explanation ? '<div style="opacity:0.75;margin-bottom:10px;">' + escapeHtml(explanation) + "</div>" : '<div style="margin-bottom:10px;"></div>') +
            '<table style="border-collapse:collapse;width:100%;"><tr><th></th>' + th("Right now", 0.7) + (cap ? th("At full speed", 0.7) : "") + "</tr>" +
            rows + "</table>" + (live ? this.becomingCalculatedHtml(comp, st) : "") + costHtml +
            (st.ports.some(p => p.toHub) ? '<div style="opacity:0.65;margin-top:6px;">Its output goes over belts into a Micro Hub (or the Hub).</div>' : "") +
            (live && comp.simError ? '<div style="color:#d33;margin-top:8px;"><b>The model could not be built</b>: ' + escapeHtml(comp.simError) + "</div>" : "") +
            (hasRecipe
                ? ""
                : '<div style="margin-top:8px;"><b>No recipe yet.</b> Press <b>Update recipe</b> while the factory\'s inputs are running, or <b>Edit recipe</b> to type it in.</div>') +
            '<div style="opacity:0.55;margin-top:10px;">' + st.count + " buildings, " + st.w + "x" + st.h + " tiles" +
            (!live && lineCount > 1 ? ", " + lineCount + " production lines" : "") + " &middot; " + escapeHtml(SOURCE_SHORT[st.source || "manual"]) + "</div>" +
            "</div>";

        const dialog = new shapez.DialogWithForm({
            app: this.root.app,
            title: st.name || "Compressed factory",
            desc,
            formElements: [nameInput],
            buttons: live
                ? ["cancel:bad:escape", "fcDelete:bad", "fcUnpack:misc"]
                      .concat(becoming ? [] : ["fcToCalc:misc"])
                      .concat(["fcRestart:misc", "fcCost:misc", "ok:good:enter"])
                : ["cancel:bad:escape", "fcDelete:bad", "fcUnpack:misc", "fcRemeasure:misc"]
                      .concat(st.source === "calc" ? ["fcToLive:misc"] : [])
                      .concat(["fcEditRecipe:misc", "fcCost:misc", "ok:good:enter"]),
            closeButton: false,
        });
        this.root.hud.parts.dialogs.internalShowDialog(dialog);

        const saveName = () => {
            const box = this.getLiveBox(uid);
            if (box) box.components.FactoryBox.state.name = nameInput.getValue().trim();
            return box;
        };
        dialog.buttonSignals.ok.add(saveName);
        dialog.buttonSignals.fcCost.add(() => {
            if (system.startCostMeasure()) this.notify("Timing every factory for " + COST_SECONDS + " seconds ...");
            else this.notify("A measurement is already running");
        });
        if (live && !becoming) dialog.buttonSignals.fcToCalc.add(async () => {
            const box = this.getLiveBox(uid);
            if (!box) return;
            this.notify("Working out the recipe ...");
            const outcome = await this.convertToCalc(box);
            if (outcome.error) this.showProblem("Stays live", escapeHtml(outcome.error));
            else if (outcome.waiting) {
                this.notify("Watching input #" + outcome.waiting.join(", #") + " first - it becomes calculated by itself once it has seen enough shapes");
            } else {
                this.notify(
                    "Now a calculated recipe" +
                        (outcome.unused.length > 0 ? " (input #" + outcome.unused.join(", #") + " carried nothing: unused)" : ""),
                    shapez.enumNotificationType.success
                );
            }
        });
        if (!live && st.source === "calc") dialog.buttonSignals.fcToLive.add(() => {
            const box = saveName();
            if (!box) return;
            const outcome = system.convertToLive(box);
            if (outcome.error) this.showProblem("Stays calculated", escapeHtml(outcome.error));
            else this.notify("Now a live model", shapez.enumNotificationType.success);
        });
        if (live) dialog.buttonSignals.fcRestart.add(() => {
            const box = saveName();
            if (box) system.restartModels([box]);
        });
        if (!live) dialog.buttonSignals.fcEditRecipe.add(() => {
            const box = saveName();
            if (box) this.openRecipeDialog(box);
        });
        if (!live) dialog.buttonSignals.fcRemeasure.add(() => {
            const box = saveName();
            if (box) this.updateRecipe(box);
        });
        dialog.buttonSignals.fcUnpack.add(() => {
            const box = this.getLiveBox(uid);
            if (box) this.unpack(box);
        });
        dialog.buttonSignals.fcDelete.add(() => {
            const box = this.getLiveBox(uid);
            if (!box) return;
            const { ok } = this.root.hud.parts.dialogs.showWarning(
                "Delete compressed factory?",
                "This removes <b>" + escapeHtml(st.name || "the compressed factory") + "</b> and all " + st.count +
                    " buildings in it. They are refunded like deleted buildings.<br><br>" +
                    "To get the buildings back on the map instead, choose <b>Unpack</b>.",
                ["cancel:good:escape", "ok:bad"]
            );
            ok.add(() => {
                const live = this.getLiveBox(uid);
                if (live && this.root.logic.tryDeleteBuilding(live)) {
                    this.root.soundProxy.playUi(shapez.SOUNDS.destroyBuilding);
                }
            });
        });
    }

    // The detailed recipe: cycle per line and what passes each port per cycle
    openRecipeDialog(entity) {
        const comp = entity.components.FactoryBox;
        const st = comp.state;
        const uid = entity.uid;
        const lineCount = st.lines.length;
        const cycleInputs = st.recipe.cycles.map(
            (cycle, line) =>
                new shapez.FormElementInput({
                    id: "cycle" + line,
                    label: lineCount > 1 ? "Line " + (line + 1) + ": cycle length in seconds" : "Cycle length in seconds",
                    placeholder: "1",
                    defaultValue: String(cycle),
                    validator: val => {
                        const n = parseFloat(val);
                        return isFinite(n) && n >= 0.05 && n <= 3600;
                    },
                })
        );
        const portInputs = st.ports.map(
            (port, index) =>
                new shapez.FormElementInput({
                    id: "port" + index,
                    label: describePort(port, index, lineCount),
                    placeholder: "empty = not used",
                    defaultValue: formatEntries(st.recipe.io[index]),
                    validator: val =>
                        parseEntries(val, { shapesOnly: port.kind.startsWith("hub") }) !== null,
                })
        );

        const desc =
            "Every cycle, a line takes its inputs at the start and puts out its outputs at the end.<br>" +
            "The numbers <b>#1, #2 ...</b> are the connections drawn on the building's edges. " +
            "For each one, write what passes through it per cycle, e.g. <b>CuCuCuCu*2, red</b> " +
            "(2 of that shape and 1 red). Leave it empty if it is not used." +
            (lineCount > 1 ? "<br>This factory has " + lineCount + " independent lines; each has its own cycle." : "") +
            (st.ports.length === 0 ? "<br><b>This factory has no connections to the outside.</b>" : "");

        const dialog = new shapez.DialogWithForm({
            app: this.root.app,
            title: "Recipe - " + (st.name || "Compressed factory"),
            desc,
            formElements: [...cycleInputs, ...portInputs],
            buttons: ["cancel:bad:escape", "ok:good:enter"],
            closeButton: false,
        });
        this.root.hud.parts.dialogs.internalShowDialog(dialog);

        dialog.buttonSignals.ok.add(() => {
            const box = this.getLiveBox(uid);
            if (!box) return;
            const boxState = box.components.FactoryBox.state;
            const io = {};
            boxState.ports.forEach((port, index) => {
                const entries = parseEntries(portInputs[index].getValue(), {
                    shapesOnly: port.kind.startsWith("hub"),
                });
                if (entries && entries.length > 0) io[index] = entries;
            });
            boxState.source = "manual";
            this.root.systemMgr.systems.factoryBox.setRecipe(box.components.FactoryBox, {
                cycles: cycleInputs.map(input => parseFloat(input.getValue())),
                io,
            });
        });
    }

    getLiveBox(uid) {
        if (!this.root || !this.root.entityMgr) return null;
        const entity = this.root.entityMgr.findByUid(uid, false);
        return entity && entity.components.FactoryBox ? entity : null;
    }

    // The numbers of the inputs that have not carried enough yet since the watch
    // began to know what comes in at them: enough shapes, or (for a slow one) a
    // long wait; an input that carried nothing for UNUSED_AFTER_SECONDS is unused.
    inputsWaiting(comp, st) {
        return this.watchProgress(comp, st).rows.filter(r => !r.known).map(r => r.number);
    }

    // Per input of a box being watched: { number, total (shapes seen), known }
    watchProgress(comp, st) {
        const watched = this.root.time.now() - comp.watch.start;
        const rows = [];
        st.ports.forEach((port, index) => {
            if (port.kind !== "belt-in" && port.kind !== "tp-in") return;
            const counts = comp.watch.counts[index];
            let total = 0;
            if (counts) for (const k in counts) total += counts[k];
            const known = total >= CONVERT_MIN_SEEN || (total > 0 ? watched >= SLOW_INPUT_SECONDS : watched >= UNUSED_AFTER_SECONDS);
            rows.push({ number: index + 1, total, known });
        });
        return { rows, watched };
    }

    // The dialog's line about a live box that is becoming calculated ("" if not)
    becomingCalculatedHtml(comp, st) {
        let text = "";
        if (comp.converting) {
            text = "Working out the recipe from the buildings now (a big factory takes a while; the game keeps running).";
        } else if (comp.watch) {
            const { rows, watched } = this.watchProgress(comp, st);
            text = "Watching what its inputs carry, to work out the recipe (" + Math.round(watched) + " s so far; it keeps running live). " +
                rows.map(r => "#" + r.number + ": " + (r.known ? "done" : Math.min(r.total, CONVERT_MIN_SEEN) + " of " + CONVERT_MIN_SEEN + " shapes")).join(", ") +
                ". It becomes calculated by itself - open this window again to see how far it is.";
        }
        return text
            ? '<div style="margin:8px 0;padding:6px 10px;border-radius:6px;background:rgba(45,138,95,0.15);"><b>Becoming a calculated recipe.</b> ' + escapeHtml(text) + "</div>"
            : "";
    }

    // Once a second, only for a box that was asked to become calculated: when its
    // inputs have been watched enough, it is worked out
    checkWatch(entity, comp) {
        const now = this.root.time.now();
        if (comp.watchCheckAt && now - comp.watchCheckAt < 1) return;
        comp.watchCheckAt = now;
        if (comp.converting || this.inputsWaiting(comp, comp.state).length > 0) return;
        this.convertToCalc(entity).then(outcome => {
            const hud = this.root.hud && this.root.hud.parts.factoryCompressor;
            const name = comp.state && comp.state.name ? comp.state.name + ": " : "";
            if (outcome.error) {
                if (hud) hud.showProblem("Stays live", escapeHtml(name + outcome.error));
            } else if (hud) {
                hud.notify(name + "now a calculated recipe", shapez.enumNotificationType.success);
            }
        });
    }

    // Turns a live box into a calculated one. Returns { unused }, { waiting } (the
    // inputs it still has to watch), or { error } (why it stays live).
    // Works out the recipe in short pieces so a big factory does not freeze the
    // game, so this returns a promise.
    async convertToCalc(box) {
        const comp = box.components.FactoryBox;
        const st = comp.state;
        if (!comp.sim) return { error: "it is not a live model" };
        if (comp.converting) return { error: "it is already being calculated" };
        if (comp.sim.nodes.some(n => n.kind === "storage")) {
            return { error: "its storages keep a stock, which needs the live model" };
        }
        // A recipe made from a guess would refuse the shapes it did not expect:
        // the inputs are watched from now on (nothing is counted before), and the
        // box becomes calculated by itself once each has carried enough
        if (!comp.watch) comp.watch = { start: this.root.time.now(), counts: {} };
        const waiting = this.inputsWaiting(comp, st);
        if (waiting.length > 0) return { waiting };
        const watched = comp.watch.counts;
        comp.watch = null;
        const origin = box.components.StaticMapEntity.origin;
        const rect = { x: origin.x, y: origin.y, w: st.w, h: st.h };
        const detected = this.detectExpected(rect, st.ports);
        const expect = detected.expect;
        // What each belt input has already taken in is the best answer; else what
        // lies on the belt now. An input that has carried nothing counts as unused.
        const unused = [];
        st.ports.forEach((port, index) => {
            if (port.kind !== "belt-in" && port.kind !== "tp-in") return;
            const key = portWorldKey(port, rect);
            const row = watched[index] || {};
            const total = Object.values(row).reduce((a, b) => a + b, 0);
            if (total > 0) {
                expect[key] = {};
                for (const k in row) expect[key][k] = row[k] / total;
            } else if (!expect[key]) {
                expect[key] = {};
                unused.push(index + 1);
            }
        });
        const missing = detected.missing.filter(n => st.ports[n - 1].kind !== "belt-in" && st.ports[n - 1].kind !== "tp-in");
        let result;
        comp.converting = true;
        // One box is worked out at a time, however many are ready together
        const turn = this.convertTail || Promise.resolve();
        let release;
        this.convertTail = new Promise(resolve => (release = resolve));
        try {
            await turn;
            if (box.destroyed || box.queuedForDestroy || !comp.sim) return { error: "the box changed while it waited" };
            const items = deserializeEntities(this.root, boxPayloads(box));
            const calc = new FactoryCalculator(this.root, items, { rect, ports: st.ports, expect, signals: st.signals || {} });
            result = calc.beginRun();
            if (!result) {
                // A few milliseconds per slice, then let the game draw a frame
                while (!calc.continueRun(RECALC_BUDGET_MS)) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    if (box.destroyed || box.queuedForDestroy) return { error: "the box was removed" };
                }
                result = { counts: calc.counts, seconds: CALC_AVERAGE_SECONDS };
            }
        } catch (e) {
            return { error: String(e.message || e) };
        } finally {
            comp.converting = false;
            release();
        }
        // The box may have changed while it was being worked out
        if (!comp.sim) return { error: "it is no longer a live model" };
        if (result.problems) {
            return { error: missing.length > 0 ? "nothing is known about input #" + missing.join(", #") : result.problems[0] };
        }
        st.expect = expect;
        st.source = "calc";
        st.stock = null;
        comp.sim = null;
        comp.inPools = null;
        this.root.systemMgr.systems.factoryBox.setRecipe(comp, recipeFromCounts(st.ports, rect, result.counts, result.seconds));
        return { unused };
    }

    // Asks, then converts the given live boxes one after the other (each takes a
    // moment to work out); the ones that cannot be calculated stay live
    convertManyToCalc(boxes) {
        const live = boxes.filter(b => b && !b.destroyed && !b.queuedForDestroy && b.components.FactoryBox && b.components.FactoryBox.sim);
        if (live.length === 0) {
            this.notify("No live factories selected.", shapez.enumNotificationType.warning);
            return;
        }
        const answer = this.root.hud.parts.dialogs.showWarning(
            "Make " + live.length + " factor" + (live.length === 1 ? "y" : "ies") + " calculated?",
            "A calculated recipe costs the game much less and follows upgrades by itself. It works out what " +
                "goes in and out from what each input takes in from now on: the factory keeps running live " +
                "while its inputs are watched (about a minute), and becomes calculated by itself after that. " +
                "An input that carries nothing for a minute counts as unused. " +
                "Factories that cannot be calculated stay as they are, and you get the reasons.<br><br>" +
                "This takes a moment for each factory.",
            ["cancel:bad:escape", "fcCalc:good:enter"]
        );
        answer.fcCalc.add(async () => {
            const reasons = new Map();
            let done = 0;
            let withUnused = 0;
            let watching = 0;
            for (let i = 0; i < live.length; ++i) {
                const box = live[i];
                if (box.destroyed || box.queuedForDestroy) continue;
                const outcome = await this.convertToCalc(box);
                if (outcome.error) reasons.set(outcome.error, (reasons.get(outcome.error) || 0) + 1);
                else if (outcome.waiting) watching++;
                else {
                    done++;
                    if (outcome.unused.length > 0) withUnused++;
                }
                if (i % 10 === 9) {
                    this.notify("Made " + done + " of " + live.length + " calculated ...");
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            this.notify(
                done + " of " + live.length + " factories are calculated now" +
                    (watching > 0 ? ", " + watching + " still watching their inputs (they become calculated by themselves)" : "") +
                    (live.length - done - watching > 0 ? ", " + (live.length - done - watching) + " stay live" : "") +
                    (withUnused > 0 ? " (" + withUnused + " have inputs that carried nothing: treated as unused)" : ""),
                done + watching > 0 ? shapez.enumNotificationType.success : shapez.enumNotificationType.warning
            );
            if (reasons.size > 0) {
                const list = [...reasons].sort((a, b) => b[1] - a[1]).map(([why, n]) => escapeHtml(n + " x " + why));
                this.showProblem("Stayed live", list.slice(0, 8).join("<br>"));
            }
        });
    }

    // Turns the given calculated boxes back into live models, one after the other
    convertManyToLive(boxes) {
        const calc = boxes.filter(b => b && !b.destroyed && !b.queuedForDestroy && b.components.FactoryBox &&
            !b.components.FactoryBox.sim && b.components.FactoryBox.state.source === "calc");
        if (calc.length === 0) {
            this.notify("No calculated factories selected.", shapez.enumNotificationType.warning);
            return;
        }
        const system = this.root.systemMgr.systems.factoryBox;
        const reasons = new Map();
        let done = 0;
        (async () => {
            for (let i = 0; i < calc.length; ++i) {
                const box = calc[i];
                if (box.destroyed || box.queuedForDestroy) continue;
                const outcome = system.convertToLive(box);
                if (outcome.error) reasons.set(outcome.error, (reasons.get(outcome.error) || 0) + 1);
                else done++;
                if (i % 10 === 9) {
                    this.notify("Made " + done + " of " + calc.length + " live ...");
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            this.notify(
                done + " of " + calc.length + " factories are live now" +
                    (reasons.size > 0 ? ", " + (calc.length - done) + " stay calculated" : ""),
                done > 0 ? shapez.enumNotificationType.success : shapez.enumNotificationType.warning
            );
            if (reasons.size > 0) {
                const list = [...reasons].sort((a, b) => b[1] - a[1]).map(([why, n]) => escapeHtml(n + " x " + why));
                this.showProblem("Stayed calculated", list.slice(0, 8).join("<br>"));
            }
        })();
    }

    // Unpacks, then measures and compresses the same factory again (no fee)
    // Works the recipe out again; measures it if it cannot be calculated
    updateRecipe(box) {
        const comp = box.components.FactoryBox;
        const st = comp.state;
        const origin = box.components.StaticMapEntity.origin;
        const rect = { x: origin.x, y: origin.y, w: st.w, h: st.h };
        const { expect, missing } = this.detectExpected(rect, st.ports);
        let result;
        try {
            const items = deserializeEntities(this.root, boxPayloads(box));
            result = new FactoryCalculator(this.root, items, { rect, ports: st.ports, expect, signals: st.signals || {} }).run();
        } catch (e) {
            result = { problems: [String(e.message || e)] };
        }
        if (result.problems) {
            const reason = missing.length > 0 ? "nothing is on the belt at input #" + missing.join(", #") : result.problems[0];
            this.notify("Cannot calculate (" + reason + ") - measuring instead", shapez.enumNotificationType.warning);
            this.remeasure(box);
            return;
        }
        st.expect = expect;
        st.source = "calc";
        this.root.systemMgr.systems.factoryBox.setRecipe(comp, recipeFromCounts(st.ports, rect, result.counts, result.seconds));
        this.notify("Recipe updated", shapez.enumNotificationType.success);
    }

    remeasure(box) {
        if (this.measuring) {
            this.notify("A factory is being measured - wait until it is done.", shapez.enumNotificationType.warning);
            return;
        }
        const name = box.components.FactoryBox.state.name || "";
        const restored = this.unpack(box);
        if (!restored) return;
        this.measureAndCompress([restored], MEASURE_SECONDS, { name, free: true }).then(report => {
            if (report[0].error) this.showProblem("Cannot compress again", report[0].error);
        });
    }

    // Removes / places buildings the way pasting a blueprint does: as one bulk
    // operation, and immutable so the game does not re-rotate the belts around
    // every changed building (which would break belts next to the area).
    changeBuildings(fn) {
        const logic = this.root.logic;
        return logic.performBulkOperation(() => logic.performImmutableOperation(fn));
    }

    // Creates the buildings from serialized data without placing them yet.
    // Throws if one cannot be restored (e.g. its mod was removed).
    deserializePayloads(payloads) {
        return deserializeEntities(this.root, payloads);
    }

    // Puts restored buildings on the map one by one, like the game's own
    // tryPlaceBuilding: each goes on the map and is then registered, so the
    // systems reacting to it (belt paths, ejector targets, tunnels) can see it
    // and its already restored neighbours.
    placeRestored(restored) {
        for (const { entity, uid } of restored) {
            this.root.map.placeStaticEntity(entity);
            const reuseUid = uid && !this.root.entityMgr.findByUid(uid, false);
            this.root.entityMgr.registerEntity(entity, reuseUid ? uid : null);
        }
    }

    // Puts the original buildings back. Returns them, or null if it failed.
    unpack(box) {
        const result = this.tryUnpack(box);
        if (result.error) {
            this.showProblem("Cannot unpack", result.error);
            return null;
        }
        this.notify(
            "Unpacked " + result.restored.length + " buildings (" + result.bounds.w + "x" + result.bounds.h + ")",
            shapez.enumNotificationType.success
        );
        return result.restored;
    }

    // Unpacks every given box. Boxes that cannot be unpacked stay, and the
    // reasons are shown together in one dialog.
    unpackMany(boxes) {
        if (this.measuring || this.observing) {
            this.notify("A factory is being measured - wait until it is done.", shapez.enumNotificationType.warning);
            return;
        }
        const live = boxes.filter(box => box && !box.destroyed && !box.queuedForDestroy && box.components.FactoryBox);
        let done = 0;
        let buildings = 0;
        const errors = [];
        for (const box of live) {
            const name = box.components.FactoryBox.state.name;
            const origin = box.components.StaticMapEntity.origin;
            const result = this.tryUnpack(box);
            if (result.error) {
                errors.push("<b>" + escapeHtml(name || "Factory at " + origin.x + "," + origin.y) + "</b>: " + result.error);
            } else {
                done++;
                buildings += result.restored.length;
            }
        }
        this.clearSelection();
        if (done > 0) {
            this.notify(
                "Unpacked " + done + " factor" + (done === 1 ? "y" : "ies") + " (" + buildings + " buildings)",
                shapez.enumNotificationType.success
            );
        }
        if (errors.length > 0) {
            this.showProblem(
                "Cannot unpack " + errors.length + " factor" + (errors.length === 1 ? "y" : "ies"),
                errors.slice(0, 8).join("<br><br>") + (errors.length > 8 ? "<br><br>... and " + (errors.length - 8) + " more" : "")
            );
        }
    }

    // Returns { restored, bounds } or { error } (HTML)
    tryUnpack(box) {
        let restored;
        try {
            restored = this.deserializePayloads(boxPayloads(box));
        } catch (e) {
            console.error("[Factory Compressor] unpack failed", e);
            return { error: "Could not restore the buildings (was a mod they belong to removed?).<br>" + escapeHtml(e.message || e) };
        }

        // Things built on the wires layer above the box would be overwritten
        const boxBounds = box.components.StaticMapEntity.getTileSpaceBounds();
        const blockers = new Set();
        for (const { entity } of restored) {
            const bounds = entity.components.StaticMapEntity.getTileSpaceBounds();
            for (let x = bounds.x; x < bounds.x + bounds.w; ++x) {
                for (let y = bounds.y; y < bounds.y + bounds.h; ++y) {
                    const content = this.root.map.getLayerContentXY(x, y, entity.layer);
                    if (content && content !== box) blockers.add(content);
                }
            }
        }
        if (blockers.size > 0) {
            const first = [...blockers][0].components.StaticMapEntity.origin;
            return {
                error:
                    blockers.size + " building(s) were built on top of the compressed factory (for example on the wires layer at " +
                    first.x + "," + first.y + "). Remove them first.",
            };
        }

        const onBelts = box.components.FactoryBox.sim ? box.components.FactoryBox.sim.exportEdgeItems() : null;
        this.changeBuildings(() => {
            this.root.map.removeStaticEntity(box);
            this.root.entityMgr.destroyEntity(box);
            this.root.entityMgr.processDestroyList();
            this.placeRestored(restored);
        });
        // The shapes that were on the belts inside go back onto them
        if (onBelts && onBelts.length > 0) {
            const result = restoreBeltItems(this.root, onBelts);
            if (result.dropped > 0) console.log("[Factory Compressor] " + result.dropped + " shapes did not fit back on the belts");
        }
        return { restored: restored.map(r => r.entity), bounds: boxBounds };
    }
}

////////////////////////////////////////////////////////////////////////
// Mod

class Mod extends shapez.Mod {
    init() {
        // For testing from the dev tools console
        window.factoryCompressorDebug = { harvestBeltItems, restoreBeltItems, emptyRecipe, FactoryCalculator, FlowMeter, RegionAnalyzer, captureSignals, recipeFromCounts, portWorldKey };
        this.modInterface.registerComponent(FactoryBoxComponent);
        this.modInterface.registerNewBuilding({ metaClass: MetaFactoryBoxBuilding });
        this.modInterface.registerGameSystem({
            id: "factoryBox",
            systemClass: FactoryBoxSystem,
            before: "constantSignal",
            drawHooks: ["staticAfter"],
        });
        this.modInterface.registerHudElement("factoryCompressor", HUDFactoryCompressor);
        this.modInterface.runBeforeMethod(shapez.GameCore, "updateLogic", tickStatsBegin);
        this.modInterface.runAfterMethod(shapez.GameCore, "updateLogic", tickStatsEnd);

        this.modInterface.registerTranslations("en", {
            dialogs: { buttons: { fcUnpack: "Unpack", fcDelete: "Delete", fcRemeasure: "Update recipe", fcEditRecipe: "Edit recipe", fcToCalc: "Make calculated", fcToLive: "Make live", fcRestart: "Restart model", fcCost: "Measure cost", fcCalc: "Calculated recipe", fcLive: "Live model" } },
        });

        this.modInterface.registerIngameKeybinding({
            id: "factory_compressor_compress",
            keyCode: shapez.keyToKeyCode("K"),
            translation: "Compress selected factory",
            handler: root => {
                const hud = root.hud.parts.factoryCompressor;
                if (hud) hud.compressSelection();
                return shapez.STOP_PROPAGATION;
            },
        });

        // The box has a size chosen at compress time instead of a fixed one
        this.modInterface.replaceMethod(shapez.StaticMapEntityComponent, "getTileSize", function ($original) {
            return this.fcSize || $original();
        });

        // The box has no sprite. Mods that draw any building's sprite (Multi Layer
        // Copy's selection, blueprint previews) would crash every frame on it and
        // freeze the game, so draw the box as a plain purple area instead.
        this.modInterface.replaceMethod(
            shapez.StaticMapEntityComponent,
            "drawSpriteOnBoundsClipped",
            function ($original, [parameters, sprite, extrudePixels = 0, overridePosition = null]) {
                if (sprite) return $original(parameters, sprite, extrudePixels, overridePosition);
                if (!this.fcSize) return;
                const pos = overridePosition || this.origin;
                const ctx = parameters.context;
                const fill = ctx.fillStyle;
                ctx.fillStyle = "rgba(109, 91, 208, 0.55)";
                ctx.fillRect(pos.x * 32, pos.y * 32, this.fcSize.x * 32, this.fcSize.y * 32);
                ctx.fillStyle = fill;
            }
        );

        // Belts ending at the box hand their items to it
        let lastBoxSlot = -1;
        this.modInterface.replaceMethod(
            shapez.BeltPath,
            "computePassOverFunctionWithoutBelts",
            function ($original, [entity, matchingSlotIndex]) {
                if (entity.components.FactoryBox) {
                    lastBoxSlot = matchingSlotIndex;
                    return item => boxAcceptItem(entity, matchingSlotIndex, item);
                }
                return $original(entity, matchingSlotIndex);
            }
        );
        // ... and the belt remembers which box input that is
        this.modInterface.replaceMethod(shapez.BeltPath, "computeAcceptingEntityAndSlot", function ($original, args) {
            lastBoxSlot = -1;
            const result = $original(...args);
            if (lastBoxSlot >= 0 && result.acceptor && result.entity && result.entity.components.FactoryBox) {
                result.acceptor.fcBox = result.entity;
                result.acceptor.fcSlot = lastBoxSlot;
            }
            return result;
        });
        this.modInterface.replaceMethod(shapez.BeltPath, "update", function ($original) {
            if (beltIsWaitingAtBox(this)) return;
            return $original();
        });

        // Buildings ejecting directly into the box
        this.modInterface.replaceMethod(
            shapez.ItemEjectorSystem,
            "tryPassOverItem",
            function ($original, [item, receiver, slotIndex]) {
                if (receiver.components.FactoryBox) {
                    return boxAcceptItem(receiver, slotIndex, item);
                }
                return $original(item, receiver, slotIndex);
            }
        );

        // Copying compressed factories: a box counts as all the buildings inside
        // it, both for the blueprint shapes and for Building Costs
        const boxesOf = blueprint => blueprint.entities.filter(e => e.components.FactoryBox && e.components.FactoryBox.state);
        this.modInterface.replaceMethod(shapez.Blueprint, "getCost", function ($original) {
            const boxes = boxesOf(this);
            if (boxes.length === 0) return $original();
            const count = this.entities.length - boxes.length + boxes.reduce((s, b) => s + b.components.FactoryBox.state.count, 0);
            return shapez.findNiceIntegerValue(4 * Math.pow(count, 1.1));
        });
        // The buildings inside a box cost what they cost with Building Costs: it
        // shows, charges and refunds them through its extra-cost hook
        window.buildingCostsExtra = entity => {
            const comp = entity.components && entity.components.FactoryBox;
            return comp && comp.state ? contentsCost(comp.state) : null;
        };
        // Rotating a blueprint (counter-clockwise is three clockwise turns): the
        // game turns every building; a box is then set back to unrotated and its
        // contents are turned instead, so it stays an upright rectangle
        this.modInterface.replaceMethod(shapez.Blueprint, "rotateCw", function ($original) {
            $original();
            for (const box of boxesOf(this)) {
                const staticComp = box.components.StaticMapEntity;
                const bounds = staticComp.getTileSpaceBounds();
                const comp = box.components.FactoryBox;
                comp.state = rotateBoxStateCw(comp.state);
                staticComp.rotation = 0;
                staticComp.originalRotation = 0;
                staticComp.origin = new shapez.Vector(bounds.x, bounds.y);
                comp.applyLayout();
                comp.ghost = null;
            }
        });
        // The box has no sprite: show where a pasted one goes
        this.modInterface.replaceMethod(shapez.Blueprint, "draw", function ($original, [parameters, tile]) {
            $original(parameters, tile);
            for (const box of boxesOf(this)) {
                const b = box.components.StaticMapEntity.getTileSpaceBounds();
                const ok = parameters.root.logic.checkCanPlaceEntity(box, { offset: tile });
                parameters.context.fillStyle = ok ? "rgba(109, 91, 208, 0.55)" : "rgba(255, 80, 80, 0.45)";
                parameters.context.fillRect((b.x + tile.x) * 32, (b.y + tile.y) * 32, b.w * 32, b.h * 32);
            }
        });
        // Right-click / right-drag deleting (the placer's delete mode, active while
        // the right button is held) skips boxes: one stray click would throw a
        // whole factory away. They are deleted from the box's dialog instead.
        // (Building Costs refunds a deleted box's contents.)
        this.modInterface.replaceMethod(shapez.GameLogic, "tryDeleteBuilding", function ($original, [entity]) {
            const placer = this.root.hud.parts.buildingPlacer;
            if (entity && entity.components.FactoryBox && placer && placer.currentlyDeleting) {
                const now = performance.now();
                if (!(now < this.fcRightClickNoticeUntil)) {
                    this.fcRightClickNoticeUntil = now + 3000;
                    this.root.hud.signals.notification.dispatch(
                        "Compressed factories are not deleted by right-click - click one and choose Delete.",
                        shapez.enumNotificationType.info
                    );
                }
                return false;
            }
            return $original(entity);
        });
        // Load the box state first, whatever order the save lists components in:
        // the ejector's fixed-size slot list depends on it
        this.modInterface.replaceMethod(
            shapez.SerializerInternal,
            "deserializeComponents",
            function ($original, [root, entity, data]) {
                const comp = entity.components.FactoryBox;
                if (!comp || !data.FactoryBox) return $original(root, entity, data);
                const error = comp.deserialize(data.FactoryBox, root);
                if (error) return error;
                const rest = Object.assign({}, data);
                delete rest.FactoryBox;
                return $original(root, entity, rest);
            }
        );
    }
}
