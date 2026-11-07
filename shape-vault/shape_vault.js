// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/shape-vault",
    author: "Star",
    name: "Shape Vault",
    version: "1.5.0",
    id: "shape-vault",
    description:
        "A second storage next to the Hub: the Vault takes shapes from belts and keeps them apart from the Hub (and its goals). Comes with its own Vault Extractors (by wire signal, by a typed shape code, everything above an amount, or everything below an amount), a Vault Level Sensor that puts the stock on the wires layer, and a small indicator that tells you if what you take out of the Vault keeps arriving. Costs almost nothing per tick and adds a few lines to the save.",
    minimumGameVersion: ">=1.5.0",
    doesNotAffectSavegame: false,
};

////////////////////////////////////////////////////////////////////////
// Settings

const SAVE_KEY = "shapeVault"; // where the Vault is kept inside the save's modExtraData
const BUCKET_SECONDS = 5;
const FLOW_BUCKETS = 60; // history kept for the graphs: FLOW_BUCKETS * BUCKET_SECONDS game seconds
const RATE_BUCKETS = 12; // the rates are averaged over the last RATE_BUCKETS buckets
const MIN_MEASURE_SECONDS = 10; // rates are shown after this long in a game
const STARVE_SECONDS = 10; // a shape an extractor asked for and the Vault did not have counts as "ran out" this long
const SCAN_BUDGET = 100; // stored shapes looked at per tick by an extractor / sensor that scans the Vault
const DEFAULT_AMOUNT = 100; // starting amount of a new Overflow Extractor / Level Sensor
const MAX_AMOUNT = 2000000000;
const HUD_REFRESH_MS = 1000;
const STATS_ROWS = 200; // most shapes listed in the statistics window
const ICON_PIXELS = 100;
const STEADY_ITEMS = 4; // an inlet shows the stock once this many of the same item arrived in a row
const INLET_IDLE_SECONDS = 2; // ...and hides it again when nothing arrived for this long
const INLET_REFRESH_SECONDS = 0.5; // the shown amount is re-read this often, so it does not flicker
const COLORS = { ok: "#7ee08a", warn: "#ffd84a", bad: "#ff7070", idle: "#9aa8bc", gain: "#2e9e45" };

const VARIANT_SINGLE = "single"; // Vault, 1x1
const VARIANT_OVERFLOW = "overflow"; // Vault Extractor that releases everything above an amount
const VARIANT_UNDERFLOW = "underflow"; // Vault Extractor that releases every shape the Vault holds less than an amount of
const VARIANT_FIXED = "fixed"; // Vault Extractor that releases one shape, typed in as text

////////////////////////////////////////////////////////////////////////
// Texts (English / Hebrew)

const STRINGS = {
    en: {
        title: "Shape Vault",
        measuring: "measuring...",
        allGood: "all good",
        problems: n => n + " shape(s) short",
        tabAll: "Overview",
        tabStored: "Stored",
        tabIn: "Incoming",
        tabOut: "Outgoing",
        colStored: "In Vault",
        colIn: "Incoming",
        colOut: "Outgoing",
        colNet: "Net",
        colTotal: "Total",
        descAll: "Stock, incoming and outgoing of every shape in one place. Net = incoming minus outgoing: green means the stock grows, red means it shrinks.",
        descStored: "All the shapes stored in the Vault.",
        descIn: "Shapes entering the Vault right now.",
        descOut: "Shapes leaving the Vault right now. Red: asked for, but the Vault ran out.",
        noShapes: "Nothing here yet.",
        copyHint: "Click to copy the shape code",
        copied: key => "Copied: " + key,
        buttonHint: "Click for details (F6)",
        shapeLabel: "Shape or color code (e.g. CuCuCuCu or r):",
        fixedTitle: "Vault Shape Extractor",
        fixedDesc: "Ejects, one by one, the shape or color whose code you type, for as long as the Vault holds it. Needs no wires.<br>You can copy a code by clicking it in the Vault statistics window.",
        keepLabel: "Amount to keep in the Vault, per shape:",
        sensorLabel: "Amount in the Vault:",
        belowLabel: "Eject shapes the Vault holds less than this amount of:",
        belowTitle: "Vault Low-Stock Extractor",
        belowDesc: "Ejects, one by one, every shape the Vault holds fewer of than the amount you set, until that shape is gone from the Vault. Needs no wires.",
        extractorTitle: "Vault Overflow Extractor",
        extractorDesc: "Ejects extra shapes from the Vault, one by one, until only the amount you set is left of each shape. Needs no wires.",
        sensorTitle: "Vault Level Sensor",
        sensorDesc: "Sends a signal to the wires based on what the Vault holds.<br>With a shape on the input pin: sends 1 if the Vault holds more of it than the amount you set, otherwise 0.<br>With nothing connected: sends the shape the Vault holds the most of, but only if it is above the amount you set.",
        keyF6: "Show / hide the Vault statistics",
    },
    he: {
        title: "כספת צורות",
        measuring: "בודק אם הצורות נכנסות...",
        allGood: "הכול תקין",
        problems: n => n + " צורות במחסור",
        tabAll: "סיכום",
        tabStored: "מאוכסן",
        tabIn: "נכנס",
        tabOut: "יוצא",
        colStored: "בכספת",
        colIn: "נכנס",
        colOut: "יוצא",
        colNet: "הפרש",
        colTotal: "סה״כ",
        descAll: "המלאי, מה שנכנס ומה שיוצא מכל צורה, במקום אחד. הפרש = נכנס פחות יוצא: ירוק – המלאי גדל, אדום – המלאי קטן.",
        descStored: "כל הצורות שמאוכסנות בכספת.",
        descIn: "צורות שנכנסות לכספת ברגע זה.",
        descOut: "צורות שיוצאות מהכספת ברגע זה. באדום: ביקשו אותה והכספת התרוקנה ממנה.",
        noShapes: "אין כאן עדיין צורות.",
        copyHint: "לחץ להעתקת קוד הצורה",
        copied: key => "הועתק: " + key,
        buttonHint: "לחץ לפרטים (F6)",
        shapeLabel: "קוד צורה או צבע (למשל CuCuCuCu או r):",
        fixedTitle: "מוציא צורה מהכספת",
        fixedDesc: "מוציא מהכספת, אחת אחת, את הצורה או הצבע שתכתוב כאן, כל עוד יש ממנו בכספת. לא צריך חוטים.<br>את הקוד אפשר להעתיק בלחיצה עליו בחלון הסטטיסטיקה של הכספת.",
        keepLabel: "כמות להשאיר בכספת מכל צורה:",
        sensorLabel: "כמות בכספת:",
        belowLabel: "להוציא צורות שבכספת יש מהן פחות מכמות זו:",
        belowTitle: "מוציא מלאי נמוך מהכספת",
        belowDesc: "מוציא מהכספת, אחת אחת, כל צורה שיש ממנה בכספת פחות מהכמות שהגדרת, עד שהצורה נגמרת בכספת. לא צריך חוטים.",
        extractorTitle: "מוציא עודף מהכספת",
        extractorDesc: "מוציא מהכספת צורות עודפות, אחת אחת, עד שנשארת בכספת רק הכמות שהגדרת מכל צורה. לא צריך חוטים.",
        sensorTitle: "חיישן מלאי כספת",
        sensorDesc: "החיישן שולח אות לחוטים לפי המלאי בכספת.<br>עם צורה מחוברת לכניסה: שולח 1 אם בכספת יש ממנה יותר מהכמות שהגדרת, ואחרת 0.<br>בלי חיבור: שולח את הצורה שיש ממנה הכי הרבה בכספת, אבל רק אם יש ממנה יותר מהכמות שהגדרת.",
        keyF6: "הצג / הסתר את סטטיסטיקת הכספת",
    },
};

////////////////////////////////////////////////////////////////////////
// Shapes and colors share the Vault, each kept under the game's own copyable key: a shape's
// code ("CuCuCuCu") or a color's name ("red"), so the two can never clash.

function colorOfKey(key) {
    return shapez.COLOR_ITEM_SINGLETONS.hasOwnProperty(key) ? key : undefined;
}

function isValidKey(key) {
    return !!colorOfKey(key) || shapez.ShapeDefinition.isValidShortKey(key);
}

// What the player typed -> the stored key (a color's one-letter code "r" becomes "red")
function normalizeKey(text) {
    const key = text.trim();
    return (key.length === 1 && shapez.enumShortcodeToColor[key]) || key;
}

function isStorable(item) {
    const type = item.getItemType();
    return type === "shape" || type === "color";
}

function itemFromKey(root, key) {
    const color = colorOfKey(key);
    return color ? shapez.COLOR_ITEM_SINGLETONS[color] : root.shapeDefinitionMgr.getShapeItemFromShortKey(key);
}

////////////////////////////////////////////////////////////////////////
// The Vault's contents and arrival counting

// One counter per shape: how many are stored and how many arrived in each of the
// last few time slices. All of it is plain numbers, so adding a shape is a single
// Map lookup and a few additions. "hist" is the stored amount at the end of each slice.
class VaultStore {
    constructor() {
        this.entries = new Map(); // shape key -> { n, id, last, slices }
        this.total = 0;
        this.version = 0; // changes whenever the contents change
        this.now = 0; // game seconds, set once per tick
        this.slice = 0;
        this.startedAt = 0; // game seconds when this game was loaded
    }

    tick(now) {
        this.now = now;
        this.slice = (now / BUCKET_SECONDS) | 0;
    }

    entry(key) {
        let e = this.entries.get(key);
        if (!e) {
            e = { n: 0, id: this.slice, last: -1, starved: -1e9, slices: new Uint32Array(FLOW_BUCKETS), out: new Uint32Array(FLOW_BUCKETS), hist: new Float64Array(FLOW_BUCKETS) };
            this.entries.set(key, e);
        }
        return e;
    }

    // Clears the slices that passed since this entry was last touched
    roll(e) {
        const steps = this.slice - e.id;
        if (steps >= FLOW_BUCKETS || steps < 0) {
            e.slices.fill(0);
            e.out.fill(0);
            e.hist.fill(e.n);
        } else {
            for (let i = 1; i <= steps; ++i) {
                const idx = (e.id + i) % FLOW_BUCKETS;
                e.slices[idx] = 0;
                e.out[idx] = 0;
                e.hist[idx] = e.n;
            }
        }
        e.id = this.slice;
    }

    add(key, amount) {
        const e = this.entry(key);
        if (e.id !== this.slice) this.roll(e);
        const idx = this.slice % FLOW_BUCKETS;
        e.slices[idx] += amount;
        e.n += amount;
        e.hist[idx] = e.n;
        e.last = this.now;
        this.total += amount;
        this.version++;
    }

    count(key) {
        const e = this.entries.get(key);
        return e ? e.n : 0;
    }

    // An extractor was ready to eject this shape and the Vault had none
    markStarved(key) {
        this.entry(key).starved = this.now;
    }

    take(key, amount) {
        const e = this.entries.get(key);
        if (!e || e.n < amount) return false;
        if (e.id !== this.slice) this.roll(e);
        const idx = this.slice % FLOW_BUCKETS;
        e.out[idx] += amount;
        e.n -= amount;
        e.hist[idx] = e.n;
        this.total -= amount;
        this.version++;
        return true;
    }

    // Seconds the arrival window covers right now (less right after loading a game)
    windowSeconds() {
        const full = (RATE_BUCKETS - 1) * BUCKET_SECONDS + (this.now % BUCKET_SECONDS);
        return Math.max(1, Math.min(full, this.now - this.startedAt));
    }

    // True once enough time passed in this game for the rates to mean something
    measured() {
        return this.now - this.startedAt >= MIN_MEASURE_SECONDS;
    }

    // Shapes that arrived during the last window
    arrivedOf(e) {
        if (e.id !== this.slice) this.roll(e);
        let sum = 0;
        for (let i = 0; i < RATE_BUCKETS; ++i) sum += e.slices[(this.slice - i + FLOW_BUCKETS) % FLOW_BUCKETS];
        return sum;
    }

    // Shapes taken out of the Vault during the last window
    tookOf(e) {
        if (e.id !== this.slice) this.roll(e);
        let sum = 0;
        for (let i = 0; i < RATE_BUCKETS; ++i) sum += e.out[(this.slice - i + FLOW_BUCKETS) % FLOW_BUCKETS];
        return sum;
    }

    // The finished slices of one entry, oldest first, for the graphs: kind 0 = stored,
    // 1 = arriving per second, 2 = leaving per second. Fills buf (FLOW_BUCKETS - 1 long).
    fillSeries(e, kind, buf) {
        if (e.id !== this.slice) this.roll(e);
        const src = kind === 0 ? e.hist : kind === 1 ? e.slices : e.out;
        const scale = kind === 0 ? 1 : 1 / BUCKET_SECONDS;
        const len = FLOW_BUCKETS - 1;
        for (let j = 0; j < len; ++j) {
            buf[j] = src[(this.slice - (len - j) + FLOW_BUCKETS * 2) % FLOW_BUCKETS] * scale;
        }
        return buf;
    }

    // Rates per second for every shape that moved in the last window, and the indicator's
    // verdict: a shape is a problem if an extractor asked for it and the Vault had none ("empty"),
    // or it is taken out faster than it arrives and the stock no longer covers it ("low").
    // No fixed targets, the demand is simply what the extractors ask for.
    report() {
        const rows = [];
        const bad = [];
        const measured = this.measured();
        let totalIn = 0;
        let totalOut = 0;
        if (measured) {
            const perSec = 1 / this.windowSeconds();
            for (const [key, e] of this.entries) {
                const arrived = this.arrivedOf(e);
                const took = this.tookOf(e);
                const ranOut = e.n <= 0 && this.now - e.starved <= STARVE_SECONDS;
                if (arrived === 0 && took === 0 && !ranOut) continue;
                totalIn += arrived;
                totalOut += took;
                const row = { key, stored: e.n, rate: arrived * perSec, need: took * perSec, status: "ok" };
                if (ranOut) {
                    row.status = "empty";
                    bad.push(row);
                } else if (arrived < took * 0.9 && e.n < took) {
                    row.status = "low";
                    bad.push(row);
                }
                rows.push(row);
            }
            rows.sort((a, b) => b.rate + b.need - (a.rate + a.need));
            totalIn *= perSec;
            totalOut *= perSec;
        }
        return { measured, rows, bad, totalIn, totalOut };
    }

    // Only what is needed to bring the Vault back: the stock and the needed shapes
    serialize() {
        const stock = {};
        for (const [key, e] of this.entries) {
            if (e.n > 0) stock[key] = e.n;
        }
        return { v: 1, stock };
    }

    deserialize(data) {
        this.entries.clear();
        this.total = 0;
        if (!data || typeof data !== "object") return;
        const stock = data.stock;
        if (stock && typeof stock === "object") {
            for (const key in stock) {
                const n = stock[key];
                if (!Number.isFinite(n) || n < 1 || !isValidKey(key)) continue;
                const e = this.entry(key);
                e.n = Math.floor(n);
                e.hist.fill(e.n);
                this.total += e.n;
            }
        }
        this.version++;
    }
}

// The Vault of the game that is running (only one game runs at a time)
let activeStore = null;
let pendingFixedShapes = null; // typed shapes read from a save, applied once the game has started

////////////////////////////////////////////////////////////////////////
// Components

// Marks a Vault building. Its input is an item processor whose "take" puts the
// shape into the Vault at once, so nothing is queued, processed or saved per item.
class VaultInletComponent extends shapez.Component {
    static getId() {
        return "VaultInlet";
    }

    static getSchema() {
        return {};
    }

    constructor() {
        super();
        // Runtime only, not saved: what has been arriving lately, to show its stock once
        // the input is steady (the same item several times in a row)
        this.key = null;
        this.streak = 0;
        this.lastAt = -1e9; // game time of the last arrival
        this.text = ""; // the shown amount, refreshed at most every INLET_REFRESH_SECONDS
        this.textAt = -1e9;
    }
}

// The Vault's item processor takes shapes and colors straight into the Vault. It is the game's own
// component with this one method replaced on the instance (a subclass would clash in the save)
function vaultTakeItem(item, inlet) {
    if (!activeStore || !isStorable(item)) return false;
    const key = item.getAsCopyableKey();
    activeStore.add(key, 1);
    if (inlet.key === key) {
        if (inlet.streak < STEADY_ITEMS) inlet.streak++;
    } else {
        inlet.key = key;
        inlet.streak = 1;
    }
    inlet.lastAt = activeStore.now;
    return true;
}

class VaultExtractionComponent extends shapez.Component {
    static getId() {
        return "VaultExtraction";
    }

    static getSchema() {
        return {
            overflow: shapez.types.bool,
            keep: shapez.types.uint,
        };
    }

    constructor() {
        super();
        this.overflow = false; // false: by wire signal; true: by amount, everything above "keep" (or below it, see "below")
        this.keep = DEFAULT_AMOUNT;
        this.below = false; // with "overflow": everything the Vault holds less than "keep" of. Like "fixed", set from the building code
        // The "typed shape" variant. Not part of the entity's schema (that would break saves that
        // already have extractors): the variant comes from the building code, the shape is saved
        // with the Vault's data
        this.starveMark = -1e9; // game time this extractor last reported an empty Vault
        this.fixed = false;
        this.shapeKey = null;
        this.item = null; // the shape item of shapeKey, made once
        this.resetScan();
    }

    setKey(key) {
        this.shapeKey = key;
        this.item = null;
    }

    // Runtime scan state, not saved
    resetScan() {
        this.scanKeys = null;
        this.scanCursor = 0;
        this.queue = [];
        this.queueHead = 0;
        this.queued = new Set();
        this.drainKey = null;
        this.roundVersion = -1; // Vault version when the scan round in progress started
    }

    copyAdditionalStateTo(other) {
        other.overflow = this.overflow;
        other.keep = this.keep;
        other.below = this.below;
        other.fixed = this.fixed;
        other.setKey(this.shapeKey);
    }
}

class VaultSensorComponent extends shapez.Component {
    static getId() {
        return "VaultSensor";
    }

    static getSchema() {
        return {
            threshold: shapez.types.uint,
        };
    }

    constructor() {
        super();
        this.threshold = DEFAULT_AMOUNT;
        this.resetScan();
    }

    resetScan() {
        this.scanKeys = null;
        this.scanCursor = 0;
        this.bestKey = null; // the answer of the scan in progress
        this.bestCount = 0;
        this.outKey = null; // the answer of the last finished scan
        this.roundVersion = -1;
        this.resumeVersion = -1; // Vault version a finished round saw, while the sensor waits for a change
    }

    copyAdditionalStateTo(other) {
        other.threshold = this.threshold;
    }
}

////////////////////////////////////////////////////////////////////////
// Buildings

class MetaVaultBuilding extends shapez.ModMetaBuilding {
    constructor() {
        super("ShapeVaultBuilding");
    }

    static getAllVariantCombinations() {
        return [
            {
                name: "Shape Vault",
                description: "(2x2) Stores the shapes you feed it, apart from the Hub. Take them out with a Vault Extractor.",
                variant: shapez.defaultBuildingVariant,
                regularImageBase64: RESOURCES.vault.base,
                blueprintImageBase64: RESOURCES.vault.blueprint,
                tutorialImageBase64: RESOURCES.vault.tutorial,
            },
            {
                name: "Shape Vault",
                description: "(1x1) Stores the shapes you feed it, apart from the Hub. Take them out with a Vault Extractor.",
                variant: VARIANT_SINGLE,
                regularImageBase64: RESOURCES.vault1.base,
                blueprintImageBase64: RESOURCES.vault1.blueprint,
                tutorialImageBase64: RESOURCES.vault1.tutorial,
            },
        ];
    }

    isRotateable() {
        return false;
    }

    getSilhouetteColor() {
        return "#3fb6a8";
    }

    getDimensions(variant) {
        return variant === VARIANT_SINGLE ? new shapez.Vector(1, 1) : new shapez.Vector(2, 2);
    }

    getAvailableVariants() {
        return [shapez.defaultBuildingVariant, VARIANT_SINGLE];
    }

    updateVariants(entity, rotationVariant, variant) {
        const slots = [];
        const size = variant === VARIANT_SINGLE ? 1 : 2;
        for (let i = 0; i < size; ++i) {
            slots.push(
                { pos: new shapez.Vector(i, 0), direction: shapez.enumDirection.top },
                { pos: new shapez.Vector(i, size - 1), direction: shapez.enumDirection.bottom },
                { pos: new shapez.Vector(0, i), direction: shapez.enumDirection.left },
                { pos: new shapez.Vector(size - 1, i), direction: shapez.enumDirection.right }
            );
        }
        entity.components.ItemAcceptor.setSlots(slots);
    }

    getIsUnlocked() {
        return true;
    }

    setupEntityComponents(entity) {
        const processor = new shapez.ItemProcessorComponent({
            inputsPerCharge: 1,
            processorType: VAULT_PROCESSOR_TYPE,
        });
        const inlet = new VaultInletComponent();
        processor.tryTakeItem = item => vaultTakeItem(item, inlet);
        entity.addComponent(processor);
        entity.addComponent(new shapez.ItemAcceptorComponent({ slots: [] }));
        entity.addComponent(inlet);
    }
}

class MetaVaultExtractorBuilding extends shapez.ModMetaBuilding {
    constructor() {
        super("VaultExtractorBuilding");
    }

    static getAllVariantCombinations() {
        return [
            {
                name: "Vault Extractor",
                description: "Takes shapes out of the Vault: send it the shape on the wires layer and it ejects that shape.",
                variant: shapez.defaultBuildingVariant,
                regularImageBase64: RESOURCES.extractor.base,
                blueprintImageBase64: RESOURCES.extractor.blueprint,
                tutorialImageBase64: RESOURCES.extractor.tutorial,
            },
            {
                name: "Overflow Extractor",
                description:
                    "Ejects the extra shapes, keeping only the amount you set of each. Click it to set the amount. No wires needed.",
                variant: VARIANT_OVERFLOW,
                regularImageBase64: RESOURCES.extractor.base,
                blueprintImageBase64: RESOURCES.extractor.blueprint,
                tutorialImageBase64: RESOURCES.extractor.tutorial,
            },
            {
                name: "Low-Stock Extractor",
                description:
                    "Ejects every shape the Vault holds less than the amount you set of, until it is gone. Click it to set the amount. No wires needed.",
                variant: VARIANT_UNDERFLOW,
                regularImageBase64: RESOURCES.extractor.base,
                blueprintImageBase64: RESOURCES.extractor.blueprint,
                tutorialImageBase64: RESOURCES.extractor.tutorial,
            },
            {
                name: "Shape Extractor",
                description: "Ejects the shape whose code you type, for as long as the Vault holds it. Click it to set the shape. No wires needed.",
                variant: VARIANT_FIXED,
                regularImageBase64: RESOURCES.extractor.base,
                blueprintImageBase64: RESOURCES.extractor.blueprint,
                tutorialImageBase64: RESOURCES.extractor.tutorial,
            },
        ];
    }

    getSilhouetteColor() {
        return "#3fb6a8";
    }

    getAvailableVariants() {
        return [shapez.defaultBuildingVariant, VARIANT_OVERFLOW, VARIANT_UNDERFLOW, VARIANT_FIXED];
    }

    updateVariants(entity, rotationVariant, variant) {
        const below = variant === VARIANT_UNDERFLOW;
        const overflow = variant === VARIANT_OVERFLOW || below;
        entity.components.VaultExtraction.overflow = overflow;
        entity.components.VaultExtraction.below = below;
        entity.components.VaultExtraction.fixed = variant === VARIANT_FIXED;
        // The amount and Shape variants need no wires, so they have no pin
        entity.components.WiredPins.setSlots(
            overflow || variant === VARIANT_FIXED
                ? []
                : [
                      {
                          pos: new shapez.Vector(0, 0),
                          type: shapez.enumPinSlotType.logicalAcceptor,
                          direction: shapez.enumDirection.bottom,
                      },
                  ]
        );
    }

    getIsUnlocked() {
        return true;
    }

    setupEntityComponents(entity) {
        entity.addComponent(
            new shapez.ItemEjectorComponent({
                slots: [{ pos: new shapez.Vector(0, 0), direction: shapez.enumDirection.top }],
            })
        );
        entity.addComponent(
            new shapez.WiredPinsComponent({
                slots: [
                    {
                        pos: new shapez.Vector(0, 0),
                        type: shapez.enumPinSlotType.logicalAcceptor,
                        direction: shapez.enumDirection.bottom,
                    },
                ],
            })
        );
        entity.addComponent(new VaultExtractionComponent());
    }
}

class MetaVaultSensorBuilding extends shapez.ModMetaBuilding {
    constructor() {
        super("VaultSensorBuilding");
    }

    static getAllVariantCombinations() {
        return [
            {
                name: "Vault Sensor",
                description:
                    "Wires layer. Shape on the bottom pin: outputs 1 if the Vault holds more of it than the amount you set, else 0. Click it to set the amount.",
                variant: shapez.defaultBuildingVariant,
                regularImageBase64: RESOURCES.sensor.base,
                blueprintImageBase64: RESOURCES.sensor.blueprint,
                tutorialImageBase64: RESOURCES.sensor.tutorial,
            },
        ];
    }

    getSilhouetteColor() {
        return "#3fb6a8";
    }

    getIsUnlocked(root) {
        return root.hubGoals.isRewardUnlocked(shapez.enumHubGoalRewards.reward_wires_painter_and_levers);
    }

    getLayer() {
        return "wires";
    }

    getDimensions() {
        return new shapez.Vector(1, 1);
    }

    getRenderPins() {
        return true;
    }

    setupEntityComponents(entity) {
        entity.addComponent(
            new shapez.WiredPinsComponent({
                slots: [
                    {
                        pos: new shapez.Vector(0, 0),
                        direction: shapez.enumDirection.bottom,
                        type: shapez.enumPinSlotType.logicalAcceptor,
                    },
                    {
                        pos: new shapez.Vector(0, 0),
                        direction: shapez.enumDirection.top,
                        type: shapez.enumPinSlotType.logicalEjector,
                    },
                ],
            })
        );
        entity.addComponent(new VaultSensorComponent());
    }
}

const VAULT_PROCESSOR_TYPE = "vault";

////////////////////////////////////////////////////////////////////////
// Systems

// Tells the Vault what time it is, before anything can deliver into it
class VaultClockSystem extends shapez.GameSystem {
    update() {
        if (activeStore) activeStore.tick(this.root.time.now());
    }
}

// Small label on a building: the text in a rounded box, offset from the building's center
function drawBadge(parameters, center, offsetY, text, color) {
    const context = parameters.context;
    context.font = "7px GameFont";
    const width = context.measureText(text).width + 4;
    context.fillStyle = "rgba(250, 250, 250, 0.85)";
    context.beginRoundedRect(center.x - width / 2, center.y + offsetY, width, 8, 2);
    context.fill();
    context.fillStyle = color;
    context.textAlign = "center";
    context.fillText(text, center.x, center.y + offsetY + 7);
}

// Keeps the list of Vault buildings (to know whether the Vault is in use) and shows, on the
// ones with a steady input, how much of that item the Vault holds
class VaultInletSystem extends shapez.GameSystemWithFilter {
    constructor(root) {
        super(root, [VaultInletComponent]);
    }

    drawChunk(parameters, chunk) {
        const store = activeStore;
        if (!store) return;
        const contents = chunk.containedEntitiesByLayer.regular;
        for (let i = 0; i < contents.length; ++i) {
            const entity = contents[i];
            const inlet = entity.components.VaultInlet;
            if (!inlet || inlet.streak < STEADY_ITEMS || store.now - inlet.lastAt > INLET_IDLE_SECONDS) continue;
            const center = entity.components.StaticMapEntity.getTileSpaceBounds().getCenter().toWorldSpace();
            if (!parameters.visibleRect.containsCircle(center.x, center.y, 40)) continue;
            if (store.now - inlet.textAt >= INLET_REFRESH_SECONDS || store.now < inlet.textAt) {
                inlet.textAt = store.now;
                inlet.text = shapez.formatBigNumber(store.count(inlet.key));
            }
            drawBadge(parameters, center, -4, inlet.text, "#333");
        }
    }
}

class VaultExtractorSystem extends shapez.GameSystemWithFilter {
    constructor(root) {
        super(root, [VaultExtractionComponent]);
    }

    // Whether an amount-based extractor should eject a shape the Vault holds this many of
    static wants(comp, count) {
        return comp.below ? count > 0 && count < comp.keep : count > comp.keep;
    }

    // Looks at a limited number of stored shapes per tick and queues the ones the extractor wants out
    scan(comp, store) {
        if (!comp.scanKeys || comp.scanCursor >= comp.scanKeys.length) {
            // Nothing was added or taken since the last round started: it would find the same
            if (comp.scanKeys && comp.roundVersion === store.version) return;
            comp.roundVersion = store.version;
            comp.scanKeys = Array.from(store.entries.keys());
            comp.scanCursor = 0;
        }
        const end = Math.min(comp.scanCursor + SCAN_BUDGET, comp.scanKeys.length);
        for (; comp.scanCursor < end; ++comp.scanCursor) {
            const key = comp.scanKeys[comp.scanCursor];
            if (VaultExtractorSystem.wants(comp, store.count(key)) && !comp.queued.has(key)) {
                comp.queued.add(key);
                comp.queue.push(key);
            }
        }
    }

    // Keeps emptying one shape down to the amount to keep, then takes the next queued one
    ejectOverflow(entity, comp, store) {
        if (!comp.drainKey) {
            while (comp.queueHead < comp.queue.length) {
                const key = comp.queue[comp.queueHead++];
                comp.queued.delete(key);
                if (comp.queueHead >= comp.queue.length) {
                    comp.queue.length = 0;
                    comp.queueHead = 0;
                }
                if (VaultExtractorSystem.wants(comp, store.count(key))) {
                    comp.drainKey = key;
                    break;
                }
            }
            if (!comp.drainKey) return;
        }
        const key = comp.drainKey;
        if (!VaultExtractorSystem.wants(comp, store.count(key))) {
            comp.drainKey = null;
            return;
        }
        const ejector = entity.components.ItemEjector;
        if (ejector.slots[0].item) return;
        if (ejector.tryEject(0, itemFromKey(this.root, key))) {
            store.take(key, 1);
        }
    }

    update() {
        const store = activeStore;
        if (!store) return;
        const entities = this.allEntities;
        for (let i = 0; i < entities.length; ++i) {
            const entity = entities[i];
            const comp = entity.components.VaultExtraction;
            if (comp.overflow) {
                if (store.total > 0) {
                    this.scan(comp, store);
                    this.ejectOverflow(entity, comp, store);
                }
                continue;
            }
            const ejector = entity.components.ItemEjector;
            if (ejector.slots[0].item) continue;
            let key;
            let item;
            if (comp.fixed) {
                key = comp.shapeKey;
                if (!key) continue;
                if (!comp.item) comp.item = itemFromKey(this.root, key);
                item = comp.item;
            } else {
                const pin = entity.components.WiredPins.slots[0];
                const network = pin && pin.linkedNetwork;
                if (!network || !network.hasValue() || !isStorable(network.currentValue)) continue;
                item = network.currentValue;
                key = item.getAsCopyableKey();
            }
            if (store.count(key) > 0) {
                if (ejector.tryEject(0, item)) store.take(key, 1);
            } else if (store.now - comp.starveMark >= 1) {
                comp.starveMark = store.now;
                store.markStarved(key);
            }
        }
    }

    // Shows how much the Vault holds of the requested shape (wire variant) or the amount kept (Overflow)
    drawChunk(parameters, chunk) {
        const store = activeStore;
        const contents = chunk.containedEntitiesByLayer.regular;
        for (let i = 0; i < contents.length; ++i) {
            const entity = contents[i];
            const comp = entity.components.VaultExtraction;
            if (!comp) continue;
            let text;
            let color = "#333";
            let item = null; // the typed shape, drawn on the building
            if (comp.overflow) {
                text = (comp.below ? "<" : ">") + shapez.formatBigNumber(comp.keep);
            } else if (comp.fixed) {
                if (comp.shapeKey) {
                    if (!comp.item) comp.item = itemFromKey(this.root, comp.shapeKey);
                    item = comp.item;
                    const amount = store ? store.count(comp.shapeKey) : 0;
                    text = shapez.formatBigNumber(amount);
                    if (amount <= 0) color = "#d33";
                } else {
                    text = "?";
                    color = "#d33";
                }
            } else {
                const pin = entity.components.WiredPins.slots[0];
                const network = pin && pin.linkedNetwork;
                if (!store || !network || !network.hasValue() || !isStorable(network.currentValue)) {
                    continue;
                }
                const amount = store.count(network.currentValue.getAsCopyableKey());
                text = shapez.formatBigNumber(amount);
                if (amount <= 0) color = "#d33";
            }
            const center = entity.components.StaticMapEntity.getTileSpaceBounds().getCenter().toWorldSpace();
            if (!parameters.visibleRect.containsCircle(center.x, center.y, 40)) continue;
            if (item) item.drawItemCenteredClipped(center.x, center.y - 3, parameters, 14);
            drawBadge(parameters, center, 7, text, color);
        }
    }
}

class VaultSensorSystem extends shapez.GameSystemWithFilter {
    constructor(root) {
        super(root, [VaultSensorComponent]);
    }

    // Looks at a limited number of stored shapes per tick; when the round is over
    // the shape with the largest stock above the threshold becomes the output
    scan(comp, store) {
        if (!comp.scanKeys || comp.scanCursor >= comp.scanKeys.length) {
            if (comp.scanKeys) {
                comp.outKey = comp.bestKey;
                // Nothing was added or taken since the last round started: it would find the same
                if (comp.roundVersion === store.version) {
                    comp.scanKeys = null;
                    comp.scanCursor = 0;
                    comp.resumeVersion = store.version;
                    return;
                }
            } else if (comp.resumeVersion === store.version) {
                return;
            }
            comp.roundVersion = store.version;
            comp.scanKeys = Array.from(store.entries.keys());
            comp.scanCursor = 0;
            comp.bestKey = null;
            comp.bestCount = comp.threshold;
        }
        const end = Math.min(comp.scanCursor + SCAN_BUDGET, comp.scanKeys.length);
        for (; comp.scanCursor < end; ++comp.scanCursor) {
            const key = comp.scanKeys[comp.scanCursor];
            if (colorOfKey(key)) continue; // colors are left out of "the shape held the most of"
            const count = store.count(key);
            if (count > comp.bestCount) {
                comp.bestCount = count;
                comp.bestKey = key;
            }
        }
    }

    update() {
        const store = activeStore;
        const entities = this.allEntities;
        for (let i = 0; i < entities.length; ++i) {
            const entity = entities[i];
            const comp = entity.components.VaultSensor;
            const slots = entity.components.WiredPins.slots;
            const network = slots[0].linkedNetwork;
            const out = slots[1];
            if (!store) {
                out.value = null;
                continue;
            }
            if (network && network.hasValue() && isStorable(network.currentValue)) {
                const key = network.currentValue.getAsCopyableKey();
                out.value = store.count(key) > comp.threshold ? shapez.BOOL_TRUE_SINGLETON : shapez.BOOL_FALSE_SINGLETON;
                continue;
            }
            this.scan(comp, store);
            // The shape found by the last round, as long as it is still above the threshold
            if (comp.outKey && store.count(comp.outKey) > comp.threshold) {
                out.value = itemFromKey(this.root, comp.outKey);
            } else {
                out.value = null;
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////
// HUD

function makeEl(parent, style = {}, tag = "div") {
    const el = document.createElement(tag);
    Object.assign(el.style, style);
    parent.appendChild(el);
    return el;
}

// Rates per second: 12, 3.4, 0.25
function fmtRate(v) {
    return v >= 10 ? String(Math.round(v)) : v.toFixed(v >= 1 ? 1 : 2);
}

function languageOf(root) {
    let lang = "en";
    try {
        lang = String(root.app.settings.getLanguage() || "en");
    } catch (_) {}
    return lang.toLowerCase().startsWith("he") ? "he" : "en";
}

// Left-click an Overflow Extractor or a Level Sensor to set its amount
class HUDVaultAmountEdit extends shapez.BaseHUDPart {
    initialize() {
        this.root.camera.downPreHandler.add(this.downPreHandler, this);
        this.S = STRINGS[languageOf(this.root)];
    }

    downPreHandler(pos, button) {
        if (button !== shapez.enumMouseButton.left) return;
        const placer = this.root.hud.parts.buildingPlacer;
        if (placer && placer.currentMetaBuilding.get()) return;
        const layer = this.root.currentLayer;
        const tile = this.root.camera.screenToWorld(pos).toTileSpace();
        const contents = this.root.map.getLayerContentXY(tile.x, tile.y, layer);
        if (!contents) return;
        const c = contents.components;
        if ((layer === "regular" && (c.VaultExtraction && (c.VaultExtraction.overflow || c.VaultExtraction.fixed))) || (layer === "wires" && c.VaultSensor)) {
            this.edit(contents);
            return shapez.STOP_PROPAGATION;
        }
    }

    // Type in the shape a Vault Shape Extractor ejects
    editShape(entity) {
        const uid = entity.uid;
        const S = this.S;
        const input = new shapez.FormElementInput({
            id: "vaultShape",
            label: S.shapeLabel,
            placeholder: "CuCuCuCu",
            defaultValue: entity.components.VaultExtraction.shapeKey || "",
            validator: val => isValidKey(normalizeKey(val)),
        });
        const dialog = new shapez.DialogWithForm({
            app: this.root.app,
            title: S.fixedTitle,
            desc: S.fixedDesc,
            formElements: [input],
            buttons: ["cancel:bad:escape", "ok:good:enter"],
            closeButton: false,
        });
        this.root.hud.parts.dialogs.internalShowDialog(dialog);
        dialog.buttonSignals.ok.add(() => {
            const ref = this.root.entityMgr.findByUid(uid, false);
            const target = ref && ref.components.VaultExtraction;
            if (target) target.setKey(normalizeKey(input.getValue()));
        });
    }

    edit(entity) {
        if (entity.components.VaultExtraction && entity.components.VaultExtraction.fixed) return this.editShape(entity);
        const uid = entity.uid;
        const S = this.S;
        const isSensor = !!entity.components.VaultSensor;
        const comp = isSensor ? entity.components.VaultSensor : entity.components.VaultExtraction;
        const input = new shapez.FormElementInput({
            id: "vaultAmount",
            label: isSensor ? S.sensorLabel : comp.below ? S.belowLabel : S.keepLabel,
            placeholder: "100, 1000 ...",
            defaultValue: String(isSensor ? comp.threshold : comp.keep),
            validator: val => /^\d+$/.test(val.trim()) && parseInt(val, 10) <= MAX_AMOUNT,
        });
        const dialog = new shapez.DialogWithForm({
            app: this.root.app,
            title: isSensor ? S.sensorTitle : comp.below ? S.belowTitle : S.extractorTitle,
            desc: isSensor ? S.sensorDesc : comp.below ? S.belowDesc : S.extractorDesc,
            formElements: [input],
            buttons: ["cancel:bad:escape", "ok:good:enter"],
            closeButton: false,
        });
        this.root.hud.parts.dialogs.internalShowDialog(dialog);
        dialog.buttonSignals.ok.add(() => {
            const ref = this.root.entityMgr.findByUid(uid, false);
            if (!ref) return;
            const target = isSensor ? ref.components.VaultSensor : ref.components.VaultExtraction;
            if (!target) return;
            const amount = parseInt(input.getValue().trim(), 10);
            if (isSensor) target.threshold = amount;
            else target.keep = amount;
            target.resetScan();
        });
    }
}

// What the indicator says, from the store's report
function verdict(S, report) {
    if (!report.measured) return { text: S.measuring, color: COLORS.idle };
    if (report.bad.length > 0) return { text: "⚠ " + S.problems(report.bad.length), color: COLORS.bad };
    return { text: "✔ " + S.allGood, color: COLORS.ok };
}

// The Vault button in the game's top bar. It shows the verdict as a dot and a tooltip,
// and opens the statistics window.
class HUDVaultStats extends shapez.BaseHUDPart {
    initialize() {
        this.S = STRINGS[languageOf(this.root)];
        this.lastRefresh = 0;
        this.shown = "";
        this.button = null;
        this.dot = null;
    }

    // It loads a moment after the HUD, so this is retried from refresh() until the bar exists.
    ensureButton() {
        if (this.button && this.button.isConnected) return true;
        const menu = document.getElementById("ingame_HUD_GameMenu");
        if (!menu) return false;
        const svg =
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='none' stroke='#4a4d54' stroke-width='5' stroke-linejoin='round' stroke-linecap='round'>" +
            "<rect x='8' y='10' width='48' height='40' rx='6'/><circle cx='32' cy='30' r='9'/><path d='M32 30l5-5M18 50v6M46 50v6'/></svg>";
        const btn = document.createElement("button");
        btn.id = "shape_vault_button";
        btn.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
        btn.style.backgroundSize = "70%";
        btn.style.backgroundRepeat = "no-repeat";
        btn.style.backgroundPosition = "center";
        btn.style.position = "relative";
        btn.style.display = "none";
        this.dot = makeEl(btn, {
            position: "absolute",
            right: "2px",
            bottom: "2px",
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            border: "2px solid #fff",
            pointerEvents: "none",
        });
        btn.addEventListener("click", e => {
            e.preventDefault();
            this.togglePanel();
        });
        menu.appendChild(btn);
        this.button = btn;
        this.shown = "";
        return true;
    }

    togglePanel() {
        const dialog = this.root.hud.parts.vaultStatsDialog;
        if (!dialog) return;
        if (dialog.visible) dialog.close();
        else dialog.show();
    }

    inUse() {
        const store = activeStore;
        if (!store) return false;
        const inlets = this.root.systemMgr.systems.vaultInlet;
        return store.total > 0 || (inlets && inlets.allEntities.length > 0);
    }

    update() {
        const now = performance.now();
        if (now - this.lastRefresh < HUD_REFRESH_MS) return;
        this.lastRefresh = now;
        this.refresh();
    }

    refresh() {
        if (!this.ensureButton()) return;
        if (!this.inUse()) {
            this.button.style.display = "none";
            return;
        }
        this.button.style.display = "";
        const v = verdict(this.S, activeStore.report());
        const text = this.S.title + ": " + v.text;
        if (text === this.shown) return;
        this.shown = text;
        this.button.title = text + "\n" + this.S.buttonHint;
        this.dot.style.background = v.color;
    }
}

// The statistics window of the Vault. It is built from the same elements and class names
// as the game's own Statistics window, so the game's styling gives it the same look:
// "Stored" / "Incoming" / "Outgoing" tabs (the game's "produced" / "delivered" / "stored"
// classes are reused for the styling), a list or an icon grid, graphs, and a unit toggle.
const SOURCE_ALL = "all"; // the overview: stored, incoming, outgoing and the difference side by side
const SOURCE_STORED = "stored";
const SOURCE_IN = "delivered";
const SOURCE_OUT = "produced";
const UNIT_SECONDS = { second: 1, minute: 60, hour: 3600 };

// The overview draws its own rows (the game's row styling is made for one number and a graph):
// a picture at the start, then four columns. Styles are inline so they only apply to this tab.
const OVERVIEW_ROW = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minHeight: "44px",
    boxSizing: "border-box",
    padding: "4px 8px",
    paddingInlineStart: "52px",
};
const OVERVIEW_CELL = { flex: "1 1 0", minWidth: "0", textAlign: "end", fontSize: "16px", whiteSpace: "nowrap" };
const OVERVIEW_ICON = "position:absolute;inset-inline-start:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;";

// The four columns of an overview row: stored, incoming, outgoing, net
function makeCells(row) {
    const cells = [];
    for (let i = 0; i < 4; ++i) cells.push(makeEl(row, OVERVIEW_CELL, "span"));
    return cells;
}

// Net is green when the stock grows, red when it shrinks
function netColor(net) {
    return net > 0 ? COLORS.gain : net < 0 ? COLORS.bad : COLORS.idle;
}

class HUDVaultStatistics extends shapez.BaseHUDPart {
    createElements(parent) {
        const S = (this.S = STRINGS[languageOf(this.root)]);
        const makeDiv = shapez.makeDiv;
        this.background = makeDiv(parent, "ingame_HUD_Statistics", ["ingameDialog"]);
        this.dialogInner = makeDiv(this.background, null, ["dialogInner"]);
        this.title = makeDiv(this.dialogInner, null, ["title"], S.title);
        this.closeButton = makeDiv(this.title, null, ["closeButton"]);
        this.trackClicks(this.closeButton, this.close);
        this.filterHeader = makeDiv(this.dialogInner, null, ["filterHeader"]);
        this.sourceExplanation = makeDiv(this.dialogInner, null, ["sourceExplanation"]);
        this.filtersDataSource = makeDiv(this.filterHeader, null, ["filtersDataSource"]);
        this.filtersDisplayMode = makeDiv(this.filterHeader, null, ["filtersDisplayMode"]);

        const tabs = [
            [SOURCE_ALL, S.tabAll],
            [SOURCE_OUT, S.tabOut],
            [SOURCE_IN, S.tabIn],
            [SOURCE_STORED, S.tabStored],
        ];
        for (const [source, label] of tabs) {
            const name = "mode" + source.charAt(0).toUpperCase() + source.slice(1);
            const button = shapez.makeButton(this.filtersDataSource, [name], label);
            this.trackClicks(button, () => this.setDataSource(source));
            if (source === SOURCE_ALL) this.allButton = button;
        }
        const unit = shapez.makeButton(this.filtersDisplayMode, ["displayIterateUnit"]);
        const sort = shapez.makeButton(this.filtersDisplayMode, ["displaySorted"]);
        this.detailedButton = shapez.makeButton(this.filtersDisplayMode, ["displayDetailed"]);
        this.iconsButton = shapez.makeButton(this.filtersDisplayMode, ["displayIcons"]);
        this.trackClicks(unit, () => this.iterateUnit());
        this.trackClicks(sort, () => this.setSorted(!this.sorted));
        this.trackClicks(this.detailedButton, () => this.setDisplayMode("detailed"));
        this.trackClicks(this.iconsButton, () => this.setDisplayMode("icons"));

        // Overview only: column titles and the totals, above the list
        this.summary = makeEl(this.dialogInner, { display: "none", fontWeight: "bold", borderBottom: "1px solid #c8ccd2" });
        this.headCells = makeCells(makeEl(this.summary, OVERVIEW_ROW));
        const totalsRow = makeEl(this.summary, OVERVIEW_ROW);
        const totalLabel = makeEl(totalsRow, { position: "absolute", insetInlineStart: "8px", fontSize: "13px" }, "span");
        totalLabel.textContent = S.colTotal;
        this.totalCells = makeCells(totalsRow);
        this.contentDiv = makeDiv(this.dialogInner, null, ["content"]);
        this.contentDiv.style.overflowX = "hidden";
        this.toast = makeEl(this.background, {
            display: "none",
            position: "fixed",
            bottom: "48px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 22px",
            borderRadius: "8px",
            background: "rgba(40, 44, 52, 0.95)",
            color: COLORS.ok,
            fontWeight: "bold",
            fontSize: "20px",
            zIndex: "1000",
            pointerEvents: "none",
        });
    }

    initialize() {
        this.domAttach = new shapez.DynamicDomAttach(this.root, this.background, { attachClass: "visible" });
        this.inputReciever = new shapez.InputReceiver("vault_statistics");
        this.keyActionMapper = new shapez.KeyActionMapper(this.root, this.inputReciever);
        const keys = shapez.KEYMAPPINGS;
        this.keyActionMapper.getBinding(keys.general.back).add(this.close, this);
        this.keyActionMapper.getBinding(keys.ingame.menuClose).add(this.close, this);
        this.keyActionMapper.getBinding(keys.ingame.menuOpenStats).add(this.close, this);

        this.handles = new Map(); // shape key -> { element, counter, key, visible, icon, graph, context }
        this.order = ""; // the shape keys in the order they are attached
        this.unit = "second";
        this.icons = new Map(); // shape key -> data url
        this.series = new Float64Array(FLOW_BUCKETS - 1);
        this.lastRender = 0;
        this.visible = false;
        this.observer = new IntersectionObserver(entries => this.onIntersect(entries), { root: this.contentDiv });
        this.setSorted(true);
        this.setDataSource(SOURCE_ALL);
        this.setDisplayMode("detailed");
        this.close();
    }

    isBlockingOverlay() {
        return this.visible;
    }

    setDataSource(source) {
        this.dataSource = source;
        this.dialogInner.setAttribute("data-datasource", source);
        // The game's styling only knows its own three tabs, so the overview tab marks itself
        this.allButton.style.backgroundColor = source === SOURCE_ALL ? "#3e3f47" : "";
        this.allButton.style.color = source === SOURCE_ALL ? "#fff" : "";
        this.rerender(true);
    }

    setDisplayMode(mode) {
        this.displayMode = mode;
        this.dialogInner.setAttribute("data-displaymode", mode);
        this.rerender(true);
    }

    setSorted(sorted) {
        this.sorted = sorted;
        this.dialogInner.setAttribute("data-sorted", String(sorted));
        this.rerender(true);
    }

    iterateUnit() {
        const units = Object.keys(UNIT_SECONDS);
        this.unit = units[(units.indexOf(this.unit) + 1) % units.length];
        this.rerender(true);
    }

    show() {
        this.visible = true;
        this.root.app.inputMgr.makeSureAttachedAndOnTop(this.inputReciever);
        this.rerender(true);
        this.update();
    }

    close() {
        this.visible = false;
        this.root.app.inputMgr.makeSureDetached(this.inputReciever);
        this.update();
    }

    update() {
        this.domAttach.update(this.visible);
        if (!this.visible) return;
        const now = performance.now();
        if (now - this.lastRender >= HUD_REFRESH_MS) this.rerender(false);
    }

    onIntersect(entries) {
        for (const entry of entries) {
            const h = this.handles.get(entry.target.getAttribute("data-shape-key"));
            if (h) this.setHandleVisible(h, entry.intersectionRatio > 0);
        }
    }

    iconFor(key) {
        let url = this.icons.get(key);
        if (!url) {
            try {
                const color = colorOfKey(key);
                if (color) {
                    const canvas = document.createElement("canvas");
                    canvas.width = canvas.height = ICON_PIXELS;
                    const ctx = canvas.getContext("2d");
                    ctx.beginPath();
                    ctx.arc(ICON_PIXELS / 2, ICON_PIXELS / 2, ICON_PIXELS * 0.32, 0, Math.PI * 2);
                    ctx.fillStyle = shapez.enumColorsToHexCode[color];
                    ctx.fill();
                    ctx.lineWidth = ICON_PIXELS * 0.04;
                    ctx.strokeStyle = "#555";
                    ctx.stroke();
                    url = canvas.toDataURL();
                } else {
                    url = this.root.shapeDefinitionMgr.getShapeFromShortKey(key).generateAsCanvas(ICON_PIXELS).toDataURL();
                }
            } catch (_) {
                url = "";
            }
            if (this.icons.size > 500) this.icons.clear();
            this.icons.set(key, url);
        }
        return url;
    }

    // The shape's picture is only made while its row is on screen
    setHandleVisible(h, visible) {
        if (visible === h.visible) return;
        h.visible = visible;
        if (visible) {
            if (!h.icon) {
                h.icon = document.createElement("img");
                h.icon.classList.add("icon");
                h.icon.src = this.iconFor(h.key);
                if (h.overview) h.icon.style.cssText = OVERVIEW_ICON;
                h.element.insertBefore(h.icon, h.graph || null);
            }
        } else {
            if (h.icon) h.icon.remove();
            if (h.graph) h.graph.remove();
            h.icon = h.graph = h.context = null;
        }
    }

    makeHandle(key) {
        const element = document.createElement("div");
        element.setAttribute("data-shape-key", key);
        element.style.cursor = "pointer";
        element.title = this.S.copyHint;
        element.addEventListener("click", () => this.copyKey(key));
        const counter = document.createElement("span");
        counter.classList.add("counter");
        element.appendChild(counter);
        return { key, element, counter, visible: false, icon: null, graph: null, context: null, overview: false, cells: null };
    }

    // Switches a row between the game's look (a number and a graph) and the overview's
    // columns. Only does anything when the tab changed.
    setOverview(h, overview) {
        if (h.overview === overview) return;
        h.overview = overview;
        h.element.style.cssText = "cursor: pointer;";
        h.counter.style.display = overview ? "none" : "";
        if (h.icon) h.icon.style.cssText = overview ? OVERVIEW_ICON : "";
        if (overview) {
            Object.assign(h.element.style, OVERVIEW_ROW);
            if (h.graph) h.graph.remove();
            h.graph = h.context = null;
            if (!h.cells) h.cells = makeCells(h.element);
        }
        if (h.cells) for (const cell of h.cells) cell.style.display = overview ? "" : "none";
    }

    fillCells(h, stored, arrived, took, perSec, ranOut) {
        const cells = h.cells;
        const net = (arrived - took) * perSec;
        cells[0].textContent = shapez.formatBigNumber(stored);
        cells[1].textContent = this.rateNumber(arrived * perSec);
        cells[2].textContent = this.rateNumber(took * perSec);
        cells[2].style.color = ranOut ? COLORS.bad : "";
        cells[3].textContent = this.netText(net);
        cells[3].style.color = netColor(net);
    }

    // Feedback inside the window (the game's own notifications would sit behind it):
    // the row lights up and a small message shows for a moment
    flashCopied(key) {
        const h = this.handles.get(key);
        if (h) {
            h.element.style.outline = "3px solid " + COLORS.ok;
            clearTimeout(h.flashTimer);
            h.flashTimer = setTimeout(() => (h.element.style.outline = ""), 900);
        }
        this.toast.textContent = "✔ " + this.S.copied(key);
        this.toast.style.display = "block";
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => (this.toast.style.display = "none"), 1800);
    }

    // Click a shape to copy its code (e.g. CuCuCuCu)
    copyKey(key) {
        const done = () => this.flashCopied(key);
        const fallback = () => {
            const box = document.createElement("textarea");
            box.value = key;
            document.body.appendChild(box);
            box.select();
            try {
                document.execCommand("copy");
                done();
            } catch (_) {}
            box.remove();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(key).then(done, fallback);
        else fallback();
    }

    destroyHandle(h) {
        this.observer.unobserve(h.element);
        h.element.remove();
    }

    // "<shapes> / s" in the game's wording for the chosen unit
    unitTemplate() {
        try {
            return shapez.T.ingame.statistics.shapesDisplayUnits[this.unit];
        } catch (_) {
            return "<shapes> / " + this.unit;
        }
    }

    // A per-second value in the chosen unit, without the unit's name
    rateNumber(perSecond) {
        return shapez.formatBigNumber(perSecond * UNIT_SECONDS[this.unit]);
    }

    netText(net) {
        if (Math.abs(net) < 1e-9) net = 0; // rounding noise of the totals
        return (net > 0 ? "+" : "") + this.rateNumber(net);
    }

    counterText(value) {
        if (this.dataSource === SOURCE_STORED) return shapez.formatBigNumber(value);
        return this.unitTemplate().replace("<shapes>", this.rateNumber(value));
    }

    // The same graph as the game's: a filled line of the last few minutes
    drawGraph(h, e, store) {
        if (this.displayMode !== "detailed") {
            if (h.graph) h.graph.remove();
            h.graph = h.context = null;
            return;
        }
        if (!h.graph) {
            const dpi = (shapez.globalConfig && shapez.globalConfig.statisticsGraphDpi) || 2;
            h.graph = document.createElement("canvas");
            h.graph.width = 270 * dpi;
            h.graph.height = 40 * dpi;
            h.graph.classList.add("graph");
            h.context = h.graph.getContext("2d");
            h.context.scale(dpi, dpi);
            h.element.appendChild(h.graph);
        }
        const kind = this.dataSource === SOURCE_STORED ? 0 : this.dataSource === SOURCE_IN ? 1 : 2;
        const values = store.fillSeries(e, kind, this.series);
        const ctx = h.context;
        ctx.clearRect(0, 0, 270, 40);
        ctx.fillStyle = "#bee0db";
        ctx.strokeStyle = "#66ccbc";
        ctx.lineWidth = 1.5;
        let max = 1;
        for (let i = 0; i < values.length; ++i) if (values[i] > max) max = values[i];
        const step = 270 / (values.length - 1);
        ctx.beginPath();
        ctx.moveTo(0.75, 45);
        for (let i = 0; i < values.length; ++i) {
            const y = Math.min(39.25, Math.max(0.75, 40 * (1 - values[i] / max)));
            if (i === 0) ctx.lineTo(0.75, y);
            ctx.lineTo(i * step, y);
            if (i === values.length - 1) {
                ctx.lineTo(370, y);
                ctx.lineTo(370, 45);
            }
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
    }

    // Column titles (with the chosen unit) and the totals row of the overview
    fillSummary(stored, report) {
        const S = this.S;
        const unit = this.unitTemplate().replace("<shapes>", "").trim();
        const head = this.headCells;
        head[0].textContent = S.colStored;
        head[1].textContent = S.colIn + " " + unit;
        head[2].textContent = S.colOut + " " + unit;
        head[3].textContent = S.colNet + " " + unit;
        const net = report.totalIn - report.totalOut;
        const total = this.totalCells;
        total[0].textContent = shapez.formatBigNumber(stored);
        total[1].textContent = this.rateNumber(report.totalIn);
        total[2].textContent = this.rateNumber(report.totalOut);
        total[3].textContent = this.netText(net);
        total[3].style.color = netColor(Math.abs(net) < 1e-9 ? 0 : net);
    }

    // Rebuilds the list (about once a second while the window is open). The rows are only
    // taken out and put back when their order changed, so scrolling and hovering stay put.
    rerender(force) {
        if (!this.visible && !force) return;
        const S = this.S;
        this.lastRender = performance.now();
        const store = activeStore;
        const source = this.dataSource;

        const overview = source === SOURCE_ALL;
        this.sourceExplanation.textContent =
            source === SOURCE_ALL ? S.descAll : source === SOURCE_STORED ? S.descStored : source === SOURCE_IN ? S.descIn : S.descOut;
        this.summary.style.display = overview ? "" : "none";
        this.contentDiv.style.display = overview ? "block" : ""; // one full-width row per shape
        this.detailedButton.style.display = this.iconsButton.style.display = overview ? "none" : "";
        // The game's list styling follows this attribute; the overview has none of its own
        this.dialogInner.setAttribute("data-displaymode", overview ? "overview" : this.displayMode);
        let bad = null;
        if (store) {
            const report = store.report();
            const v = verdict(S, report);
            const span = makeEl(this.sourceExplanation, { color: v.color, fontWeight: "bold", marginInlineStart: "10px" }, "span");
            span.textContent = v.text;
            bad = new Set(report.bad.map(r => r.key));
            if (overview) this.fillSummary(store.total, report);
        }

        // [key, value, arrived, took] of every shape with something to show
        const items = [];
        const perSec = store ? 1 / store.windowSeconds() : 0;
        if (store) {
            for (const [key, e] of store.entries) {
                if (overview) {
                    const arrived = store.arrivedOf(e);
                    const took = store.tookOf(e);
                    if (e.n > 0 || arrived > 0 || took > 0 || bad.has(key)) items.push([key, (arrived + took) * perSec, arrived, took]);
                    continue;
                }
                const value =
                    source === SOURCE_STORED ? e.n : (source === SOURCE_IN ? store.arrivedOf(e) : store.tookOf(e)) * perSec;
                if (value > 0 || (source === SOURCE_OUT && bad && bad.has(key))) items.push([key, value]);
            }
        }
        const pinned = this.root.hud.parts.pinnedShapes;
        const isPinned = key => !!pinned && pinned.isShapePinned(key);
        items.sort((a, b) => {
            const pa = isPinned(a[0]);
            if (pa !== isPinned(b[0])) return pa ? -1 : 1;
            if ((source === SOURCE_OUT || overview) && bad) {
                const ba = bad.has(a[0]);
                if (ba !== bad.has(b[0])) return ba ? -1 : 1;
            }
            return this.sorted && a[1] !== b[1] ? b[1] - a[1] : a[0].localeCompare(b[0]);
        });
        if (items.length > STATS_ROWS) items.length = STATS_ROWS;

        const order = items.map(item => item[0]).join();
        const reorder = order !== this.order || force;
        if (reorder) {
            for (const h of this.handles.values()) {
                this.observer.unobserve(h.element);
                h.element.remove();
            }
            this.contentDiv.textContent = "";
        }
        const wanted = new Set();
        for (const [key, value, arrived, took] of items) {
            wanted.add(key);
            let h = this.handles.get(key);
            if (!h) {
                h = this.makeHandle(key);
                this.handles.set(key, h);
            }
            if (reorder) {
                this.contentDiv.appendChild(h.element);
                this.observer.observe(h.element);
            }
            h.element.classList.toggle("pinned", isPinned(key));
            this.setOverview(h, overview);
            if (overview) {
                this.fillCells(h, store.count(key), arrived, took, perSec, bad.has(key));
                continue;
            }
            h.counter.textContent = this.counterText(value);
            h.counter.style.color = source === SOURCE_OUT && bad && bad.has(key) ? COLORS.bad : "";
            if (h.visible) this.drawGraph(h, store.entries.get(key), store);
        }
        for (const [key, h] of this.handles) {
            if (wanted.has(key)) continue;
            this.destroyHandle(h);
            this.handles.delete(key);
        }
        if (reorder) {
            this.order = order;
            if (items.length === 0) {
                const empty = document.createElement("strong"); // like the game's own empty message
                empty.classList.add("noEntries");
                empty.textContent = S.noShapes;
                this.contentDiv.appendChild(empty);
            }
            this.contentDiv.classList.toggle("hasEntries", items.length > 0);
        }
    }
}

////////////////////////////////////////////////////////////////////////
// Mod entry point

class Mod extends shapez.Mod {
    init() {
        shapez.enumItemProcessorTypes[VAULT_PROCESSOR_TYPE] = VAULT_PROCESSOR_TYPE;
        // Never used (the Vault takes items itself), but other code may look the type up
        shapez.MOD_ITEM_PROCESSOR_SPEEDS[VAULT_PROCESSOR_TYPE] = () => 1e6;
        shapez.MOD_ITEM_PROCESSOR_HANDLERS[VAULT_PROCESSOR_TYPE] = () => {};

        // Paying with Vault shapes: the Building Costs mod (and mods that pay through it, like
        // Buy Chunks) reads this after the Hub and the unlimited Custom Storages
        window.shapeVaultWallet = {
            count: (root, key) => (activeStore ? activeStore.count(key) : 0),
            take: (root, key, amount) => {
                const moved = activeStore ? Math.min(amount, activeStore.count(key)) : 0;
                if (moved > 0) activeStore.take(key, moved);
                return moved;
            },
        };

        this.modInterface.registerComponent(VaultInletComponent);
        this.modInterface.registerComponent(VaultExtractionComponent);
        this.modInterface.registerComponent(VaultSensorComponent);

        this.modInterface.registerNewBuilding({ metaClass: MetaVaultBuilding, buildingIconBase64: RESOURCES.vault.icon });
        this.modInterface.registerNewBuilding({ metaClass: MetaVaultExtractorBuilding, buildingIconBase64: RESOURCES.extractor.icon });
        this.modInterface.registerNewBuilding({ metaClass: MetaVaultSensorBuilding, buildingIconBase64: RESOURCES.sensor.icon });
        this.modInterface.addNewBuildingToToolbar({ toolbar: "regular", location: "secondary", metaClass: MetaVaultBuilding });
        this.modInterface.addNewBuildingToToolbar({ toolbar: "regular", location: "secondary", metaClass: MetaVaultExtractorBuilding });
        this.modInterface.addNewBuildingToToolbar({ toolbar: "wires", location: "secondary", metaClass: MetaVaultSensorBuilding });

        this.modInterface.registerGameSystem({ id: "vaultClock", systemClass: VaultClockSystem, before: "itemAcceptor" });
        this.modInterface.registerGameSystem({
            id: "vaultInlet",
            systemClass: VaultInletSystem,
            before: "itemAcceptor",
            drawHooks: ["staticAfter"],
        });
        this.modInterface.registerGameSystem({
            id: "vaultExtractor",
            systemClass: VaultExtractorSystem,
            before: "itemEjector",
            drawHooks: ["staticAfter"],
        });
        this.modInterface.registerGameSystem({ id: "vaultSensor", systemClass: VaultSensorSystem, before: "constantSignal" });

        this.modInterface.registerHudElement("vaultAmountEdit", HUDVaultAmountEdit);
        this.modInterface.registerHudElement("vaultStats", HUDVaultStats);
        this.modInterface.registerHudElement("vaultStatsDialog", HUDVaultStatistics);
        this.modInterface.registerIngameKeybinding({
            id: "shape_vault_toggle",
            keyCode: 117, // F6
            translation: STRINGS.en.keyF6,
            handler: root => {
                const hud = root.hud.parts.vaultStats;
                if (hud) hud.togglePanel();
                return shapez.STOP_PROPAGATION;
            },
        });

        // The Vault lives next to the game: created with it, written into the save's
        // extra data (stock and needed shapes only) and read back from there
        this.signals.gameInitialized.add(root => {
            activeStore = new VaultStore();
            root.shapeVault = activeStore;
        });
        this.signals.gameSerialized.add((root, data) => {
            if (!activeStore) return;
            if (!data.modExtraData) data.modExtraData = {};
            const saved = activeStore.serialize();
            const system = root.systemMgr.systems.vaultExtractor;
            if (system) {
                for (const entity of system.allEntities) {
                    const comp = entity.components.VaultExtraction;
                    if (comp.fixed && comp.shapeKey) {
                        if (!saved.fixed) saved.fixed = {};
                        saved.fixed[entity.uid] = comp.shapeKey;
                    }
                }
            }
            data.modExtraData[SAVE_KEY] = saved;
        });
        this.signals.gameDeserialized.add((root, data) => {
            if (!activeStore) activeStore = new VaultStore();
            const saved = data && data.modExtraData ? data.modExtraData[SAVE_KEY] : null;
            activeStore.deserialize(saved);
            pendingFixedShapes = saved && saved.fixed ? saved.fixed : null;
        });
        this.signals.gameStarted.add(root => {
            // Give the Shape Extractors of a loaded game their variant and typed shape back
            const system = root.systemMgr.systems.vaultExtractor;
            if (system) {
                for (const entity of system.allEntities) {
                    const comp = entity.components.VaultExtraction;
                    try {
                        const code = entity.components.StaticMapEntity.code;
                        const variant = shapez.getBuildingDataFromCode(code).variant;
                        if (variant === VARIANT_FIXED) comp.fixed = true;
                        else if (variant === VARIANT_UNDERFLOW) comp.below = true;
                    } catch (_) {}
                    if (comp.fixed && pendingFixedShapes && pendingFixedShapes[entity.uid]) comp.setKey(pendingFixedShapes[entity.uid]);
                }
            }
            pendingFixedShapes = null;
            if (activeStore) {
                activeStore.tick(root.time.now());
                activeStore.startedAt = root.time.now();
            }
        });
    }
}

////////////////////////////////////////////////////////////////////////
// Resources

const IMG = {
    vault: "data:image/png;base64,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",
    vaultBlueprint: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAYAAAAGACAYAAACkx7W/AAAQAElEQVR4AeydB5wcxZX/X0/Y2Ry1u1rlnEABECgQRI5nGyfM32ALGYF9x53D+Wxj39l3Dmefz5GzOQcBAmxsbGyfMTZBJJEkARJBEsp5FTfnMPFfv5ZGrFazO1Udprtn3ny2dzq8evXqWzXvdVd1V/uIP0yACTABJpCTBDgA5GS1c6GZABNgAkQcALgVMIFcJcDlznkCHAByvgkwACbABHKVAAeAXK15LjcTYAI5T4ADQM42AS44E2ACuU6AA0CutwAuPxNgAjlLgANAzlY9F5wJMIFcJZAsNweAJAn+ZgJMgAnkGAEOADlW4VxcJsAEmECSAAeAJAn+ZgK5QoDLyQROEOAAcAIEfzEBJsAEco0AB4Bcq3EuLxNgAkzgBAEOACdA5M4Xl5QJMAEmcJwAB4DjHPg/E2ACTCDnCHAAyLkq5wIzASaQqwQGlzurAsCC2x+4YPFtK29cvPz+Ty9evvI/xfeKxbfd/+ii21auW7T8/j1i6RLbCV7uZwa3MQP+HZzeBuAjxLJH+I61gs+j4nuFWL4llk8vXP7AR+BjBjtRL297OgCcc/tvRiy8beUti5av/KOorE5/IvESkfZb0ugu0rSvkEbLiei9GmkLNI0miqVIbPMfE2ACTCAlAfgIsUwkjRYKgfeK7+Vi+Vex3OXTEg/Dx8DXwOcsvPWBpRf8/UMVQs6zf54LAItu/dUUAf9OEZHX5CX6j/lIW6lp2gdEDRSLhf+YABMYigDvt4pAMXyOz5e4Px6JNIoehtXCH30evsmqDDKlx5epjMzks+CmX5cuvPX+zwnQOzRfbKeA/x0RkReJM3tP2G+m7JyWCTABFxPQyC/80BLhj74P37Totvu3wlfBZ5EHPq52oItvfWi8APpDX2G03uejHwrQUz3AlE10EYFxdZV099duMrQgrYuKwqZ4gIBGNAO+Cj5LjEf+AD7MzWa7MgCcc/svCgW8/yJfZJcA+jmxlLoZojdsYyuZABPIFIHjPkv754QvvHPR8ge+M+djD7py/NF1AWDxrfdfF4rnbSPSvkREAbHwHxNgAkzAkwQ00oKalrizKBR7Z8HylVe4rRA+txh08S0r80Uf/8/JR38lTRvrFrvYDibABJiAWQJi3HK8X9NWLVp+/8/g68zqU00/lLwrAsDC2+87OxzU1oto+cmhDOX9TIAJMAGvE9A0+hR83YJl981yQ1kcDgAJbdHylV/QEto6AeMMsfAfE2ACTCDbCZzhC/jWL7xt5aecLqijAWDRbQ/8j6Zp/y3O/INOg+D8mUDWEuCCuY6ARlTgI+1nokvoR04a53Mqc1HwBwSEf3Qqf86XCTABJuA0AU2jzwpfKIJAQrjDzFvjSAAQBX5AFPzjmS8u58gEmAATcBcB4Qs/u+i2++8hynwQyHgAWHTbyh+LArPzz1gb5IyYABNwOwGNtE+IICCuBDJraUYDgBjwvVMU9DOZLSLnxgSYABNwPwH4RvjITFqasQCw6PYHPqlp2ncyWTjOiwkwASbgJQLwkQtvu/8mq2xOpycjAWDRbQ8uoUT8J+mMseO43x+g4ooRVFE7hkaMHk+14yZT3aTpNHrKGTRu+lyaMOssXrKYQd3E6Yab1SjRTrh9ZPfvAz4AvgA+Ab4BPgK+Aj4DvsNw4zGRUKPEyvM/8eB8Eyqkk/qkJQ0KLv7UgzWUiP1OXN5k7FZPVFxxRTXVjp9KY6adSSPqxlJZVTUVl1VSQXEphfILKZiXRz6/7cU3SI2TMQEmkAkC8AHBvDzdJ8A3wEfAV8BnwHfUCh9SLE4g4VMyYQ/ygK+M++OPnHP778uwbediswdMaIlo/HfisqbWzkIkdRcJBz9SVNjY6bOF0x9DBUXFJPJOHuZvJpBbBLi0pgjAd8CHIBjAp8C3FJVWmNIpm1gjmhCKdz8gK29UztYAsHj5/f+uaXQx2fwpKCmjUZNmUrXo4skXTt/m7Fg9E2ACOUgAvqV6zATha2aIngTbT85JnL2+TwwKf5Zs/Pjs0n3+J341nUj7N7LxEyoopLoJ06h27CTKy8+3MSdW7RYCAZ9GY6sLpZeRlcbbRU15gXQ+sMktjNgOewnk5RdQ7bhJNHLCVAoV2DvLs0ba9xcuf3CmXSXy2aU47oveRRr5yY6PRlQ5cgxhgC9UaG8F2GF+ZnRmZy7ReIIWz6ymG5dMkFquPHuUYRBXnVMnlQdsgU2GM+KEniSQX1gsfNA03ReRcHZkx0cjv0Yx254PsCUALLp15fWapl1FNnwCwTyqmzCdSiurbdDOKr1A4MkNhykmAoFbbIUtsMkt9rAdmSUAX1Q3cSoF8kK2ZAxfKnzq1XYotyUAkKZ9zw5jC9HXP3mGuOwqtEM96/QIgfbuCL26vdk11r66vYlgk2sMYkMyTgBdQaMmTqfCknJb8tZ82l0qimVlLQ8AIlKJs3+aImuAjJym+fTLrBrR1+/z2dOrJGMHy7iHwLqtjdTWFXbcINiwbmuT43awAc4T8Pn9VDN2ou6rSPgsiy2aBt9qsU6yPACQpn3NSiP1Lp+J07jLx0qoWaDLLd0u6PqBLVmAlItgEQF0CY0SPsvqLiFN0/7VIhNPqrE0ACBCaRqddVK7BSsVtaMIo+4WqGIVWUagvrGHth/scKxUyBs2OGbAUBnzfscJwGdVVNdZa4dG84WPtXQswNIAIK4n7rSyxKVVtZSpBy+stJt1ZY7AM28eoXAklrkMT+SEPJH3iU3+YgKnESgqqyD4sNMOmNnhI0t9rGUB4PxP3FtCCc2ys//8ohKqqLE4gpoBz2ldSaCnP0Yvb2nMuG0vvdNIyDvjGXOGniIAH1YgfJllRie0RQtu+nWpVfosCwAJv+86TaM8KwzLCxVQzZiJpGmaFepyTEfuFfeNnS3U2N6XsYIjrzd3tWQsP87IuwQ0TaNq4cvQJWRFKYS6PH9h5FordEGHD/8sWRJ0PVn0wYx8Pj/f7WMRzqxXkxAlfGL9YUoksCY2bPxDHnpeNubBqrOLgM/vp8raMdYVykJfa0kAOOf2XwQTmnaNFSVEn79V0dIKe1iHNwgca+2jt/e22W7sW3vaCHnZnhFnkFUE8ouKqcCiZwQSGg05EKwKzZIAEIznnS86ayzplyrnfn/VOmT5EwRe3HRM9MtHT2xZ/9XTH6WXNh+zXjFrzAkCFdUjLSmnRlrZguUrF1qhzJIA4LMoIhWXV1HQpseprYDFOtxNoD8Sp+c3Nthm5GqhG3nYlgErzmoC6NmAj7OikH6NLOlytyQAkAV9UpqmUdmIjLw2gPiTvQS27G+jQ009lhcQOt8Rui1XbKVC1uV6AvBxmqaZt9MCnwsjTAeARbevnEGaNh3KzCzFFdV89m8GIKc9SQCDtFY+nQtd0HkyA15hAgYJoIcDvs5g8neTCZ+r+9539xhaMx0AtATNIws+eGjCAjWsgglQa1eYXt9h3WRxr29v1nUyWiZgBQGrfJ0Vvtd0AEgkyPTIhj8QoFB+gRVsc1gHF30ggTVbGqmjJzJwl6F16FizNfMPmhkylhN5ggB8HXyeWWOt8L2mA4DozjIdAAqKy0UvkgX9YmaJcvqsIYBum1UbDpsuD3RAl2lFrIAJnCCgaRrB553YNPwl1Jj2vaYDgBVRqKi03DAETsgEhiKw91g37ThkfLI4pIWOofTzfiZglIAVPi9BdNJxksGP6QAg8jUVhTSfj/KLioQa/mMC1hN4+o0jFInFlRUjDdIqJ+QETECCwHGfZ67XQ4wBmPK9MNN8ANDIVBQqLC4T3T/mzSD+MIEUBHowWdxm9T78lzY3ENKmUMm7mIBpApqGE98SU3oSmvnxV/Oe1+QgMB6OMEWBEzOBNAQ27GxWmiwOk71hgrk0at1zmC3xJIH8QpM9HyZ9L6CZDgBmByI0P0/6horgxT4Coq+UVO7jhyzS2GcRa2YCRL5AwBQGs74XmZsOAERaiEx8Av6gidSclAnIEcAEbhv3tqYVfntPK0/2lpYSC1hBwLzvM+d7UQYLAgDUGF98QQ4AxukhJS+yBFZvPCb69YeeLK6nP0ovbOLJ3mR5spw5Am7wfY4HgIDf3GWQuSrg1LlEABO5vbBx6MniXtjUQJDJJSZcVucIuMH3OR4A3BAFnWsCnHOmCWzen3qyOEz2tnmf/e8TyHR5OT/3ErDC95ktnfMBQIxkmC0Ep2cCKgQwyBtPvDvMiyd9sU9FB8syAbMEfC7wfY4HALMQOT0TUCVwfLK4d9/pu35nM0/2pgqR5bOCAAeArKhGLoQqgTXvNOiTxemTvb2j/qCYan62yLNSJmCSAAcAkwA5uTcJROMJeubNo/T0m0cI694sBVvNBMwR4ABgjh+n9jCB3Uc6ac+RLg+XgE1nAuYIcAAwx8/B1Jw1E2ACTMAcAQ4A5vhxaibABJiAZwlwAPBs1bHhTIAJ5CoBq8rNAcAqkqyHCTABJuAxAhwAPFZhbC4TYAJMwCoCHACsIsl6mECmCHA+TMAiAhwALALJapgAE2ACXiPAAcBrNcb2MgEmwAQsIsABwCKQmVPDOTEBJsAErCHAAcAajqyFCTABJuA5AhwAPFdlbDATYAK5SsDqcnMAsJoo62MCTIAJeIQABwCPVBSbyQSYABOwmgAHAKuJsj4mYBcB1ssELCbAAcBioKyOCTABJuAVAhwAvFJTbCcTYAJMwGICHAAsBmqfOtbMBJgAE7CWAAcAa3myNibABJiAZwhwAPBMVbGhTIAJ5CoBu8rNAcAusqyXCTABJuByAhwAXF5BbB4TYAJMwC4CHADsIst6mYBVBFgPE7CJAAcAm8CyWibABJiA2wlwAHB7DbF9TIAJMAGbCHAAsAmsdWpZExNgAkzAHgIcAOzhylqZABNgAq4nwAHA9VXEBjIBJpCrBOwuNwcAuwmzfibABJiASwlwAHBpxbBZTIAJMAG7CXAAsJsw62cCRglwOiZgMwEOADYDZvVMgAkwAbcS4ADg1pphuwwR6Ovpoo7mo9RYv5uO7N1CB3e8RQe2rKe9m9bS7jdfoh3rn6dt61bROy8/ThtX/5++YB37cAwykEUapIUO6IJO6DZkFCdiAi4lwAHApRVDxIYNRSDS30ftTUeo4cAu3cHvefsV2rr2Kd2Z73jtadonnP2R3Rupcf92ajm8l9oa6qlTBIXu9ibq62qjcF83xaL9J9VjHftwDDKQRRqkhQ7ogk7oRtBAXsgTAaKhfqduS7iv96Q+XmECXiHAAcArNZXDdsLhtxw9QPXb3qCtr64Szv4J2r95HR3ds0l38F2tDRTp78kYIeSFPBEgju7erNuybd2T4sriaarf/ia1HqsXQYYDQsYqhDMyTIADgGF0nNAuAqkc/sFtG6j16H6K9Hbbla1pveG+Lmo9so/qt64XwYADgmmgOawgU0XnAJAp0pzPsAQi4X69337n+tX6Gb4XHP6wBRIHBwcElK3p4G5CWcVh/mMCjhPgAOB4FeSuAfFYjNqOHaS9qILfowAAEABJREFUG9fS1jVPEvrae7tasxYIynZ410a9rChzW8NBAoOsLTAXzPUEOAC4voqyy8BEgqirtZHqRX/+ljVP0IGtr1Nny1FRyLhYcuUvrpf5wJbXCQzAoqutkcBGJ8D/mECGCHAAyBDoXM8mEY9T85H9tOO1p2nP2y/r/fnxWCTXsYgrgIjOYs9bLws2z1CLYARWOQ+GAWSEAAeAjGDO3Uzi0Zjo299F215dRYe2v0H9vV25CyNNyft7O+mgYARWePYA7NIk4cNMwBQBDgCm8NmRODt0RsNhOrZ3K2199UnRt7+JIv18W6RszYIVxkPA7ti+bQSWsmlZjgmoEOAAoEKLZdMSwANRh3Ztom3rnqRj+7dRLBJOm4YFUhMAu2P7tuosDwumkfC7D6+lTsF7mYAaAQ4AarxYeggCcdHHf3TvFkL3RfPBXRSPx4aQ5N2qBMCySTDduvZJOiquqsBaVQfLe4NApq3kAJBp4lmYX0fzEX0As2H/dqKE03fzaOTzB8mfV0DBghIKFZZTfnEVFZRWU0FZLRWW11FR5WgqrhpLpTUT9AXr2IdjkIEs0iAtdEAXdJLTH8G2QVxV7XjtGf1OKqfN4fy9T4ADgPfr0LEShPt6CBOn7du0jsJ9mX5CV9OdfB4cfEm17tjhyEtrxgvnPpqKymupoKSKQsXllFdYQsH8IgqGCiiQFyJ/ICiChJ+SH5/fr+/DMchAFmmQFjqKhK7iqtHHg8WIsVRYMZLyRUDJKyonf14BEWmUyQ9Y406q/VteE9x5bCWT7LMtL1+2FYjLYz8BdEEc27+DtoszUUycZn+O4sJCZOILhIQzL6OCspFUMmIcFQnHnA8HX1CkO3af/12nTjZ9fD4/BYL5lJdfRPlF5VQkbCgRtsCmvMIy8gXyKEEGP4rJ2hsOiTp4mhoO7BBdbk5feSkaz+KuIMABwBXV4B0j8BAXuiCO7X1H9PbY28+v+YOELpiC0hrd4RdX1onunAoKhvJJ82mugQZbYFN+cQUVV47Sbc0XNgcLSgllsNPQhBhrObrnHdq5/jnuFrITdJbq5gCQpRVrdbHwlOrRfdtoz8ZXRLeDjd09mo8C+cVUKPrri4UzRRdMML+QfD7vNFXYmidsLiip1AMCyhIUZSLNvjL093TqdYPbRlFXxB8mIEHAvhYpkTmLDCTg3vVIuI/2CsffsG+r6IuxoYNDOMak0y9BH3vpCAqECkjT3HOWb7R2NE3Ty1IgylSCsonAFswvIhJlJqs/wvPjtlHUFerMavWsL/sIcADIvjq1tESdLcdo5+voXmiwVC+Uab6A6NKpopIqMbAqHGS2OH0a4qNpyWBQrZc5JK4QwGAIccO7u1ob9Drrbm82rIMT5gYBDgC5Uc/KpYyLs8nDuzaLboU1FI1Y+wCS5g9Sfkk1FVeNEYO6JaS5qD9fGZTBBChzSIwRgEF+aTX5AkGDmlInQ53tfuslQpcQ6jK1FO91CwGn7OAA4BR5F+eL2zv3vPUiNR3cSZqFdvoCISooEwO6VaMpr6CINCuVS9h599duIplFQpVlImCQJ7qEiitH6+MevmC+ZbpJBHF0CaEuuUvIOqzZpIkDQDbVpgVl6e1qp50bnqee9hYLtB1Xofn8hLPc4so6CoYKj+/k/6cRCIQKqPjEMwaaYHaagMEdqMtdG1YT6tagCk6WpQQ4AGRpxRopVk9HC6HbIGbR/D0J0kQXTxkV4YxfnOUasSkn0gwqJK4IdGYFZWLQ3ZrLJEwwh7pFHQ/KjjdzmIAvh8vORR9AANM57H7rZYpHrZmj3y+6MkoqRxHujfdp3MwGoJZaBbP8kgoRPOsILKUSpRFC3aKOUddpRPlwjhDgX2aOVPRwxcSrCfdtfpXwUNFwcjLHNN/x7p4i0ZVh9cCmTP7ZJuMP5BFYogsNbM2WD3WMukadm9XF6b1PgAOA43XorAGN9TvpwJbXRVdDwpQhCe7uMcUvXWJLu4XE4DDqvPnwvnTZ8vEsJ8ABIMsreLjiHd69iY7s3jyciNQxTXTxFJXVcHePFC3jQsluocLyGiLBnEx+Du14kxr2bTephZN7mQAHAC/Xngnb8baupvpdJjQcT+oPhkQ/9WjCHSzH9/B/uwmAdbEYXwF7s3kd3bdFf3ObWT2c3hgBp1P5nDaA8888gebDewlv6zKTc0IkxnTIheV15BP9/mKT/zJIwOcPENhjBlLUhZms0RaaDu0xo4LTepQABwCPVpxRs3EHyKEdbxlNrqfTu3zKRxKmQ9Y0fRf/c4AA2OMuqyJRF6gTMyYc3vk2tTcdMaOC03qQAAcAD1aaUZO72hpp/zuvGU2up/P5g1Qkuh8CeRY+sUo5+rGo2KgL1AnqxozKA1te4ymlzQD0YFoOAB6sNCMm93S0Et7clYgbf3EI+pyLKkSXj+h+MGIDp7GPgE/UiV43gTzDmaBt7Nu8jvq6Owzr4ITeIsABwFv1Zcja/t5u2rtxDcVjUUPpkQivPixEV4OPmwx4uHHRRN0UVYykgP6aSmMWoo3sefsV6u/tMqaAU3mKAP+aHauuzGSMKQD2vv0yxaJhwxkG84upsKyGNI07/A1DzFBCTfMRJtxDnRnNMor3P7xt/SywRu3hdPYR4ABgH1vHNScSCarfuoEwu6dRY/IKSgkvM9E0dv5GGWY6naZpep2h7ozmHe7r1h8QRBsyqoPTuZ8ABwD315FhCxv2bSMM/BpVECqupPySSqPJHUtXUVZE0ybU0qJ5U+g9F8+lZR+4gD639AppeyCLNEgLHVPH11Kl0CmtwCWCqLtQcYVha7paGwltyLACTjgkAbcc8LnFELbDWgI9HS2m7vXPKyijUGGptUbZoC2UF6CZk+rouovn0Kc/dhn98M6P0Lc+cz195uOX083vXUBXX3QmzT9zPE0ZXyOdO2SRBmmh47NLL6dvCp0/ELr/6ebL6Lolc2j6pJGEvKWVOiQYKiwj1KXR7PGMANqS0fSczt0EOAC4u34MWYf+/v2Y38dQaqJAqEic+cudOU4eV0Oix8FgTsaSFRWG6IrFs+iLt16jO/x/vPlSuvai2TR9or1OOV8EmxnC8V+7ZDZ9WgQCBBvYAFtgk7HSGEsF5mAvkxqzigZFncrIppJBW4paNEV4Kv28zzkCPuey5pztIlC/7Q2K9PUYUo87SNDnL5P4vDmT9K6Vj75nge1BAA7vzKmj6bYbLqJvf+4DdP3lZ9H40c53T8EG2AKbln/4Qpo1eVR6FjJwh5EBCzBHVxXqYBjRk4fyS0cQ6vbkDoUVtKVDO809PKiQHYtmkAAHgAzCzkRWzYf2UofBJzox7zzuING09AO+S86dRh9/3yLd2S0Wfe1wSBLJlBHkh4J0xfln0Lc++376+/93Mc2bMZYCfvc1W9h01sxxdMdNl4juovfrNsN2svgDxmAN5lhHHZwnAnG6bDRNI9StL5CXTjTl8faGQ9RyZH/KY7zTuwTc90vyLkvHLccDPJjh04ghPn9Q+lZPOP8brjlXd/504gOHBMck/MyJPea+yooL6ANXnE3/KRz/9ZfNo/KSQnMKM5i6orSQYPO3PvN+wtVBqSiLFdmDLRiDdVIf9qkEgcLyWkJdJ9OrfB/a+TY/JKYCzAOyHAAyXkn2ZIjb9eq3bTD2UhfNR3AMeJAonXVJ559KDo4JDirVMdl9I6vL6OPXL6JviEHXyxbNJDvOomVtMStXkC+uXsRYxTc/fT3d/J6FVFtValglHD3YgvFgJTiGIIC6GXxs8LbP59frmkSdDz6Wbhsvk0EbSyfHx71DgAOAd+pqWEtbDu+j3s62YWWGOog+f58/MNThk/vhYHDmf3JHihU4qA9eeU6KI8PvwgDrR//uPPq3T/0dLRBdGuhSGT6Fd44GAj5adNZk+uo/vIc+LK6c8oLpWQ8u3VDOPymnaUSoG9RRct9Q36hr1PlQx4fbjzbGXUHDEfLWMQ4A3qqvlNZGI/2Eed1THkyzE7cIBkPpu1fgWOBg0qjTD1+6cAapBAHcWfO1O95L55899ZRuJV1ZFv2Dk75YjJ187Y73EMosWzSwRGCVkUcdoa7SyaLOgwXGrkiO7NlMaHPp8uDjpxNw2x4OAG6rEQP2HN27hWIGbtPzB/MpVFyeNsfRtRX62WVawQECCAIfumr+gD2nrwbEmTHO+nFvfVlJwekCWboHYwQo80euPZfAYLhigiFYDicz+BiCAOps8P7B25hKGm1g8P5022hraHPp5Pi4+wlwAHB/HQ1rYU9nK6H7Z1ihFAc10QdcUFZNmqalOHrqrkPHWukPT204dafE1iULpg95JYD+8C8tv0Y/65dQpSyy/3Azrd+8n55du1W3fcUjL9EP719F3/7F4/TvP3mUvvT9P9Ad33hIX7COfd/55RP0o5Wr6J4/vER/XLVBTwsdB440K+cvk+Ci+dPoS7deQ9WVJSnFceYPhikPDrMTdYU6G0ZEP6RpuDMIbUDdDaDN9XS06nr4n3cJqNe8d8uadZZj4Nfoy130WwLFgKAslOdf3aY7Uln5pBzOXuHIktv4XjR3Mn3p9mtoVE36qw/IyywdXX207u09dN8fX6Ev/Pcj9N/3PEkr//Qy/enpNwi2v7X1AO0+0EhwjE2tXdTV039SLdax7+DRFtpV30hvbjlAz63bpqeFju+ueFLXCd3IA3mdTKyykkJ2VG05feWT19LZs8adchTMwO6UnRIbcP4or4SoLoJBYZwI6BuK/w7xswGKxNwnzgHAfXUibRHOwjAoJ53ghGCouIICefkntuS/4Fj+/Kz6A0FwZHBowYCfPvHBC+jm9y2kUFB9IHSwpd29/fTyhp3izP5p+vIP/0i/enQtbXhnH/X0GZ/5dHAeyW3ohG7kgbx+9MDT9MobO6mn13xeGBS+9UMX6ncKBf1+/aoJzJJ5y36jblBHsvJJuUBeAYUK1YMx2h4PCCcpevObA4A3600fhDMy8Is7QPIMDv4B1dOvvEOPv7AJq0oLHBrm0znnjPFK6VIJb95xiH7x8Av0xe/9gX77t9fEmX1DKjFb9+3a30C/+etr9IXvPUK/+N2LtGX3EdP54U4h3P4KVqrKUCeoG9V0Sfm8ojLy+YPJTelvHhCWRuVKQQ4AGasWazNqrN9paOA3VFwl1e8/nLV/e2GjoSBQUqR+1THQjs07D9F3VzxBP3t4NW3ccXDgIUfXN26vp7sfek637Z1dh03ZUlqszgjOH3ViJmNN0yhUXKmsAgPCaIvKCTmBKwj4XGEFG6FEAJO9NR/ep5QGwoG8QgqGrLnbBg4Hjgd67V62irNrDND+7Ler6cCRFruzM6wftv3vb54n2Lptz1HDelQSog5QFypphpJF20AbGer4UPvRFcmTxQ1Fx937OQC4u35SWtdUv5vi0UjKY0PuFGd4mB9+yOMGDsDx/G31RgMp5ZI0NHcQnP5Pxdk1BmjlUjkvBVt/8utnCd1UjS2d6Q1KpBdJJQH2qN0NsvUAABAASURBVINUx4zuM9JGYqItNh/cbTTLnEjn1kJyAHBrzQxhVzwWo8ZD6j+2UFG56OM1P/A62KzHX9yk3B0Ef4dlsK7kdk9fhP646g361s/+Suj2Se732je6qb7xs8f0u4l6RZmGsj+hEQ3HI1U6nPmDfapjZvb5/AFDA8JNok2ibZrJm9NmngAHgMwzN5Vj8+G9ymf/+FGbGfhNZzDOQuGQ0snheNLRCZ+HzdOWetHF8y3hNJ9bt5Vi8aT0aWKe2RGPJfTnCb4pyoSypTI8yUK2tGAN5ql0WbHPyICwfhUg2qYV+bOOzBHgAJA51qZzwhlWY/0OZT2hogrTA7/pMoVDgmMaTi7p4JIOb7Dsi+t30vfue4raO3sHH/L2trAeZULZcNuq2DztL8kkyeg0gRM7wBisT2za8qVpGoXEFaOq8sb6nYQ2qpqO5Z0j4HMua85ZlUDr0QMUDb/7AJNMepz9ByTm+pHRlU7mCdEd1NLePaxY0tENFApHovpDW797/DWKxeIDD2XVOsqG21ZX/ullikRjp5UtyWaoIICH1ezo9jnNELEDbUZTeFBQJBFts4/QRrHOizcIcADwRj1RIhGnxoM7la0NFpbZfvafNOpDV8+nyrKi5OZp30kHN/BAT19Yf5ALUy4M3J/N6yjrjx94mnr7Tx/ITzJKFQRGVBTr70jIBBtN0yhPtB3VvBoP7tLbqmo6lneGgM+ZbHMpV2vK2t3eTOHe4c+uB+eEM7i8/KEd8mB5M9tnTh1NMrNQDsyjs7uPfiC6fIbqGx8om23r+w410w9XrjplSopkGZNBILk98BsPic2eNmbgLtvW8wqKiTQ1FxHu7SK0VeKPJwio1a4nipSdRrYcOaBcsLzCUnH2b38Vj6gooWUfvEDJvrbOHvr+favoaFOHUrpsEj7c0CYYPEVgMbhcwwWBpdcvpqpy4ZwHJ7J4WxPOP2TgqXEjbdVi01mdJAH7vYOkISw2NIFYLEodTYeGFkh5RKO8fPudBF7c8vc3LiG80CWlGSl2YvK1ux54hppaJe6RT5E+m3bhOYG7HnxGaf6igvwg3X7DReTzDRcmrKGUV4iZStXy6Wg6TIl49o7lqJB1u6zP7QayfUSdTUeV764IFpSIq3e/7fhuuPZcwmscZTPCgO///OoZapB5QEpWqcflGpo76ae/fo76w1HpkowZWUEfvvpcaXmjguhGRFtSSR8XJyztzZl5ElrFLpY9nQAHgNOZuG5PW8NBZZtCovtHOZFigmkTaun8s6ZIp4rGYoSpEg4da5NOkyuCeH/Bzx9eTTGFM+eL5k+lKeNqbEdkpC21HVXvsrS9IJzBaQQ4AJyGxF07cNtnR4va2ZQ/WEC4/dPOkqD74ab3LFDK4nePr6ed+xuU0nhaWNH4HfuO0SNPrFdKdeN155GmqXXRKGUghNGW/MF8sSb/hzYbCffJJ2BJRwhwAHAEu3ymrcfqiRKpbgocWkcwA3f+XL5oJmHwd2grTj3y2sa9tObNXafu5K3TCLy0YSdteGf/afuH2lFXXUZG3ho2lL6h9gdVx5NEm+1oND9F9lD28H5rCHAAsIajbVraGlW7fzQK5hfaZg8UY8riay6ajVWp5WhjOz302DopWRYi/cU2RwQzWRbXLZlDxYUhWXFDckE8TKh4pWGk69KQcZzIMAEOAIbRpUto/ngsGqbejlYlRQFx9q9p9lbrNRfNoTzJN3r1hyP6/P3RGN8VIluReEoY4wEYMJdJkx8K0tUKAVlG52AZzecj1amiu9ubKBoJE3/cS8BeT+HecnvCss7WJmU7gyF7H/zC2f/isyZJ2/V/z7xJmMJAOgEL6gTA7NFn5V+/eeE5UzJwFaDetrra1NuwDoD/ZYQAB4CMYDaWSbfijwdn/gED7/pVse7yRbMo4PdLJcHdPi+tV5++Qkp5Dgi98PoOOnRM7goQdXKZqBs7sQRCBaQpXl2qtmE77c+kbq/kxQHAxTXV1XJMybqAGKjTNPvuCCkQXQ0Xzp8qZVNCDAL++i9rpWRZKDUBnaHC2AluCy3Iz0utzIK9mqZRQPEKk68ALABvowoOADbCNaO6v6+b+nu7lFQEMVCnlEJN+LLFs6T7/l95Y5erX9+oVnLnpA8cbqG1b8q9AAhjARefN91WYwN5BUr6+7vbeRxAiVhmhTkAZJa3dG7dyv3/GvmD9t0JomkaLZE8+8cDX3957m3K2Y/FBX/s+belHxDDVYDF2Z+izp+n3sb4KuAUhK7a4ADgqup41xjVHw2cv6bZ1/0za3IdFRbI/fjXvrGHunvV3lvwbsl5bTCB9q5eWvfWnsG7U26XFhfQjEkjUx6zYqfP5ydfQK2bqatVrSvTCjtZhxwBn5xY5qSCfteZlLnCD8hJdfAsoPik5oCspFbPmzNRSi4u+v5XrXlHSpaF5Ak8+dJmAluZFOfOlqsrGV2pZPyKba2zmZ/+Bkc3+jbXedvKkjxaevkkqilXe/QcgN2xmLcC/f+R/h4lRX4b7/7BPf9zZ4yVsmfD5n2U7q1gUopY6BQCYPrmFrn5deaJugoG/Kekt3JD9WQDbRlt2kobvKQLvgw+rapU7copE2V0XQBAoQHs45dNosvPqqNQ0JUmkp2f3s52RfUa+W3s/583cxzJOpQX+bZPsuvz4vodUqoxGDxnulzAllI4SMjIOIB6mx6UqQc34bvgw+DL4NPcWATXeld0Z581uYI+ceUUmjG2zI3sbLOpv0ft7h84f02zr/9/zvTRUmVt7eihPfWNUrIspE5g1/4Gak3zzuWkVtk6S8qrfPt8fuVxgEif2hWtij1ukk3aAp8F3wUfZuNPM5md4W+f4ZQZSlhcEKD3LBhNNy4ZT6WFwQzl6mw2/T1qL0oJKPbJqpZu+sSRUklelRyolFJmsVAg4KPZ08cQ3qZ1523X0Dc/cz396Ms30g+//BF9/Uu3Xa0fmz1tNPn89gVTs8V6fbPcRHHTJtSazWrY9KrjAP29am162MxdfLCsKKj7Kvgs+C4Xm6qb5voAoFsp/o2tLqJbr5pCi2dVky8Db0ISWTr2p3q2pPkDttk6qrqcCvPl+i7XvCV3v7ptxqZQDNvff8XZ9N1/+TB96iNLCIPZY+sqqbKsiPKCftHFGNDXx9VV6cc+dePF9N3Pf5iQBmnJZZ/1m/ZJWYS7gWqrSqVkjQj5Fe8E6u9Wu6o1YpOTaeCTzhe+CWf98FVO2qKSt2cCAAoVEGdmgHzrlZNpzAh7Z7xEfk4tqlcAmK/dLlunTqiRUo1XGza3uedH7vf7CC9Q//o/vY8wdbXKKysL84N6GqSFDuiSgpABoUMNrdTWKdedIlt3RsxWbXPhLO4Cgi+CT8LJKXyUEZ5OpfFUAEhCKi/Oo/938QS67rzRVBCy726HZH6Z/I5GwxSNqN1D7/MHbTNxqmRXwo797rnXG4Ogd3z0EvrgledQYYHc1UsqgEgLHcs/eCFBZyoZJ/Zt2yP3gqCp4+W67oyUQbXN4U6gWDRiJCvXpoHv+TvRPQ1fBJ/kWkOHMcyTASBZnlnjymi56BaaN6kiucvz36rdP6T5yOf321Zu2f5/DFDaZoSCYnR7fPHWq0nWbhnVc2aMoS/cehXVjnDHzQiyrGdOtjMAiDanqbmPcF+3DG5PyMDnLL9qKs30+A0qajXowqrJz/PTFWfX0ccvm0jVZXJPqtpTDGu0qvaVqp6JqViJfnLZfvCtu51/+1NRYYg+deMSqh1hfd/3SOH8P/mRi2yfclmmfnZKXm0VFYSorERt7h5S+PgUx55U27aCKRkThY+Br4HPyc/zvPsk75fgRNXXVhTQxy+fTJfMHUnBgHeLpdz/H7Cv+6eyXG7+d8xd39nt7PtffWJ86FMfuZhqbBz4xNXF7TcsIeR1otk58gXesuMAVeXFttnoU+x6VG3bthluQDF8yqXCt8DHwNcYUOHKJN71lClw4uag+VMr6darJtO0MdafBabI0vJdkYiaI/X7ApbbkFRYXV6SXB32+6DknPXDKjF58LKFs2jS2BEmtaRPPnlcNSGv9JL2SmCWUJkcRlTYFwD8igFAtW3LlC8TMvAluAPxHOFb4GNS5enVfZYHgKnja0llGVtdSAOXkZX5plmWFATpfQvH0IcvHO+5ZweUB8ps7P+vrJC7Amhudfbun+LCEF19wRmm242sgqvOP4NKisy3U9n8Usm1tMn1p1dXyAXxVHmk3afY9pTbdloD7BUoK8rTfQh8SUlBwHRmNeUFp/g6+D0VXwlZ00YMUmB5APjs0stJZblxyQQauFx59qhBJhrfnFBbRJ8Qg8QLZ4wgr0TuhOK7c32a5VV4Erjs2WOzw7d//t0l8zJ6l05BfpCuu3juSU5OrDS2yT1YVSUZxI2UQbXtqbZtIzZZkQa+Aj5j2ZWTCT7ECp3QcdU5daf4Ovg9FV8JWeixcrHPe1hppQldQb9GF55ZQ6jMUVX2DYiZMPGUpPFE7JTttBs2BoDSIjlemKgsrZ02CeQLZ7xo7iSbtA+tdqHIE3nrEg78a5a8ApCtQ0NFUGx7ym3bkFHmEsFHwFfAZ8B3mNPm/tRZHwCSVVBZEqKbLplI18wfRQV5/uRu132rXiZrvuGr8O6v3URGF9l55Tu61MYtrIQ+bfxIwjQPVuqU0YVBQeQtI2uHTGdXr5TamZPrDNc/2s1wmaRre4PTqrbtwent3IZPuObcUbqPgK+wMy836R7ee7jJUotsOXNCOd169RSaPbHCIo3WqolH1B6W0Uiz1gAD2vrCUQOprEkya8ooaxQZ0OJk3v0RxStFA+VLl0RTbHuqbTtd/lYdnyN8AXzCmePLrVLpGT05FwBQM4j2V4v+uJsvnUhVJcafFIUuImv/K58laZq1BhjQ1t+vFrQMZDFkkjEjnQvkTubd5yDzk5Wh2Pbi8fjJpG5YwW8fPgB98/AJbrAp0zbkZABIQq6rLKClV0yhJbNryS1zeKj+SDTFfthk2a387o84dwVQWuTc3ThO5h128Kor2XZU214i7vxVC2zHb/3iObX6bx8+APtydcnpAIBK9wsC502vottEt5CVI/7QbWSJK/5IVPthjdiULk1fXzidiG3HS4vlBqrtMMDJvF0RANKMPw1mHnXBXEBT6kr0OwPPnVZF+O0PtlF12+vywv15vQjW2e9TvKS1Lmdva9L8zndDeZuguvUxcld3inoJnEkRTySIm+u77HM+AOC2+9e2N9OKJ3fRnqPOPtCEagkoTu2QcEG/aigYhOmOLB2Sd8PYYZyTeec7yDzJUrXtqbbtZD5WfuM3jt/66zuaCb99K3V7UVdOB4AjLb30wNO76IVNxygaS7ii/jSf2i2qCXFG47TheUHzT0kaLUNHt3O3oHY4mHcozznmybpSbXuqbTuZj9Xf+K2v3nhM/+3DB1it30v6cjIA9IZj9OSGI/Tr5/ZSc6dz/depGopPsV+VyPnA5aQzOni0NRXGjOxzMu+8POfl9KILAAAQAElEQVSuut6Fq9b21Nv2uznZsYbfPnzAU8IXwCfYkYfbdeZcANi8r43uFd09m/Y65ziGaxQ+xUv7RCI+nLqMHHPyCmDLrsMZKWOqTDZuq0+1OyP7QkG1K0U7jFJte6pt2w6bU+ncKHwBfMLm/W2pDmf1vpwJAC2d/fTQ83vpifWHyZpob0+78AfUzuzS9cPe8Y2HyOiy60CjVCFLi527FXPH/qMUiWY+CEZFntv3yb2ZSwqiopDsPP879h0zXP9oN8OZla7tDU6r2rYHp7dzGz7hidcP6z4CvsLOvNykO+sDQET07b+0uYFWrtpNh5vlHp93soJ8muKZnY1jAB2S756tqbRxxsk0ldHXF6F1b+9JI2X94bUiz5iDo4jVksxtHahWvPp0cwBIthD4CPgK+Az4juT+bP22PAD8+IFnSGV5+IV9NHBZ9YZ1l/QY8b/vqV20blsTxdW6Kx2rb82vWiX2FayhRW7GSTtfwiJTEY+/sJEiGZwaAXn9bfXbMqbZJlNTJfd6Stk6NGJoQvHkQ1M9uTFilAVp4CvgMxAI4ENSqTSyD2MNA30d1lV8JWSN5DtcGlVvM5wu/RheV6ey1Df20MDlaIv5uzo6eyP06LqD9MeXD1BHj3PTFOhAFP+pniXF4/Y9hdsoOc+/k1cAwIuz3Jff2IXVjCzPv7adnH4DWk1lsVRZG5vlgriUskFCCcWZa33KJzeDMszwZnt3WPchfxG+pLPX/O+soa33FF8Hv6fiKyFrNQLLA4DVBqroQ+Rev7OF7n1qN+042KGS1DWywaBaf7ry3EEKJT3W3C4lPbauUkrOTqG/ijPyTLyZbM/BJsIVh51lkdE9YXSVjBgda7bvd6Da9lTbtlQBMyC0XfiSe0VPwhu7WjzTkyCLJWsCwLHWXnrwmd30/NvODArKAk8nFypU60+P2/h4vezZI97IVWPju3jTMcNxTI72s9+sptaOHmzasqA75ecPr6ZI1Nk5bUZWl1EoT+5mgSONckHcCDDVtqfato3YZFca3Gjw7FtHdR8DX2NXPpnW6/kA0BeO0dNvHKEHn91Lje39meZneX6homIlnfGYfV1cXT391CbpUCePrVay2w7hNjFojSDQKwaGrdbfKVjc/dDz1C2+rdatqk+WdXNbN4VtnKhPte2ptm1VLpmQh4+Br3nmzSPUF8783WdWl9HTAWDLgXa656ld9NYed97Tb6SygvmFaskScYrbOB3E7nq5W0FlnZJa4dSlDzW00r//5FHaI2m3TA7b9hylb979GDW12tefLmNHUmbyOLlgu7u+IZnE8u94TFwFibanojivQO3kRkV3pmXf3N0qfM9O2ip8UKbztjI/TwaAtq4w/Xb1Pvrba4eot180RCuJpNVlr0AgkEeBYEgpE9UzMRXluw/IORFZp6SSt1HZ7t5++uH9q+jXf3mVzLytDAO9v/nrq/TTh54l6DRqj9XpJo+tkVK5W/I5Dillg4RU21wwVEh+f2CQFm9vwvf89bVD9LsX9hEGjL1YGk8FgGgsQa9saaR7V+2mg0329fU6XZGqfaWqfbEq5dtd3yQljjGAqnL3nOHhDsW1b+2ir//0UVr1yhZxuS5/F0eP6EJCmv8QVxKvvLGLoEsKQgaEasVYy4gKOc57bAwAMcWuxzzVK9sMsLQqiwONPbpPWiN8E3yUVXozocczAaC+sZswEg/Icdzukwk6DuWh2g1kZwA4dLRFXGXJjTMsnjfZIWJDZ9sXjtKjz75JX/r+I4QB3Nc27qUDR5qppb2b8CKbcCSmr9cfaSEc+/nvXqAv/eARPQ3SDq3ZmSMLJRljUPxwo31TG6i2uWzo/0eND7XETpyc3rdqF8FXDSXntv2uDwBdvVF67NVD9PAL+z13T7/Ryla9AohG7HvCGY+Z7TvYJFWUBfMmSck5IRSNxmnTjkP0wJ/X0HdXPElfvevP9M/f+R197jsP6+v/teIJ/dim7QcpLn7MTtgok+d5cybIiNGu/XJdd1LKUgjFImrP64QK1O5uS5GlJ3a1d0d0X4Xu6e4++atOpwrn2gCAy24MtCCibqu371Y2p8APl2+oUO4SP6kjHg1TQvFNYsm0Mt+bdhyUEaOK0kKaMl6uf1pKIQudQmDaxJFUXiJ3k8CmnYdOSWvlRiIeJ7Q5FZ2qV7Uqut0oixtU0GMBHwZf5kYbYZMrA0BDWx89+Owewq1W/RHv32oF0CpLQYncY/4DdUbD9t0C+9qmfdJ3Gi2ZP22gWdm17nBplpwrxzYWi9OGzftsszYaVjv7hyFG2jTSeXmB74IPgy+DT3NjWVwXAFo6w/TAM3vIrcAyUYmh/CLCXRMqeUUVL8lVdPf2hemdXUekksybNY5qJCcqk1LIQjoBTP42d/oYfT3dv83i7L+3X27cJp2uVMdV2xraMtp0Kl25sA++DD4N7x9wW3ldFwAi4uzFbZCcsKeofIRStqp9skrKhfBrm/aK/+n/8F7ly8+flV6QJZQIXH3BmaRpmlQaDGZLCRoUUm1rRYpt2aBZrk+Gp4ndZqTrAoDbAL1rT2bXihV/NOiTtXMcAC8/6Q/LnVUunDuJyooLMgssi3MrLc6ncyUHf3vE1dpGyTEbI8iM9P+rtmUjdnEaYwQ4ABjjZnuqogq1KwAYFLVxHCAqrsxe3rAL2aRd/D4fvefSuWnlWECOwPuvOJv8PrmfKuoobuNt0lED/f9G2rIcGZYyS0CuVZnNhdMrE0CfKfpOVRJGw/bdDgo7nl27laKYAgAbaZZF8ybTuFGVaaT4cDoCE8eMoPNmT0wnph9H3TyzZou+btc/1TaGNoy2bJc9mdKbrflwAHBxzar2nUb7u0n1JR0qxW/v6qU1b+6RTnLzexZK91tLK80hQZ9Po4+9d5F0iV8SV2h2TlmBtoU2Jm2QECyp4tuCBQbX/nEAcG3VEBUrjgMkEnGK9tt7FfD0K+9QLC53a+7o2gpacp7crYsurgbHTLt80UyqHVEqlT/qZNXLm6VkjQqhbaGNqaQvrqhVEWfZDBPgAJBh4CrZGek7jYirAJU8VGUxhcLrG+XvMX/fpfNIdu4aVVsyJu9ARnD81y6ZI53zurf2mJr4TiajSF+XjNgpMiUGxrJOUcAbthLgAGArXnPK0XcaKipTUhIN9xDu1FBKpCj82Oq3peeZzwsG6FM3XkzBgF8xl9wVB6u/V2AWjkTpseffthUY2hTalkomaLv+QJ5KEpbNMAEOABkGrppd5chxakkSCYr02ztTKl4S88SLm6Ttqqsuo4+9T74vW1pxlgouvX4x4cEv2eI99vxG299RbKRNKbdd2QKznGUEOACkRemsQEXtWBIjqaTyMXKprqIfss+s3UrHmjqwKrWcc8Z4WnzWFCnZXBa64JypdNYs+aB/uKGNnn91m+3IlNuUppHedm23jDMwQ8BnJjGntZ9AIC9ExRXVShnhSc24jZPDwRjca/6rv6zFqvTykWvn07QJPCg4FLCp42vohmvmD3U45f4HH11LCXHVl/KgRTvjsQihTamoK60cSWi7KmlYNvMEOABknrlyjuXVcnPADFTc323/DKp7DzbROjH4ODDf4dYDfr8+HjBmZMVwYjl5bHRtOf3DRy+RfuALkF55cxfhPQZYt3Pp7+lUVl9eo95mlTPJQIJsz4IDgAdquKxmNPn8aoOokd5OSth8FQB0f3hqPTW3yd8dEsoL0D/dfBnfGQR4JxZMnvfpj11OGDA/sSvtF+7G+sOTG9LKmRVIxOOEtqSiR/P5qXTESJUkLOsQAQ4ADoFXydbvD4gf1GiVJEI2QWEDZ24iodIfZp385e9fUkpTXBiizy69gvB6Q6WEWShcO6KMPrP0cgITleL97Lerpe/EUtE7WDbcg3EevBZo8JGht8uqccISGFqAj7iGAAcA11TF8IYYuaTu7+2gRELuoa3hcx/+6MGjLYSXpw8vderRitJC+udlV9IYN3cHnWqy5Vvj6irp88uuINmXvCQNWPmnlwmDv8ltu75x9o82pKq/sk5+EFtVN8tbS4ADgLU8bdNWIgaC/cE8Nf3C+Yd75btn1JSfKv3KG7tIdRpinPX+8y1X0tTxtacqy4Gt6RNH6gGwqCB0WmmHO98G5/Wb95+Wxo4d4T7R9y/akIputNGiMvWJDFXyYFnrCHAAsI6lrZo0n49GTlCfZz/c0y6uAoZzKdaZ/eu/rCM8IzCUxlRWhMSYwD/efCnJvu1qKN1e2n/pwpl0x0cvJTzwNdjuVIySMuj3/93jryc3bf3GlePx7h+1bNBGNU1TS8TSjhHgADAkevcdqBg5jgJ5+UqGYSA40tetlMao8NUXnknlomtnuPSpHFzA76MbrjmXPvmRJWIg1D9cck8fQ7BDGT945dnk95/uJJNsTj9yvNiVZUUExse37P0fFm0GbUclF9z2WSHaqEoalnWWAAcAZ/kr5e7z+6lq9GSlNBDu724l9Odi3a7luiVz6Nols4dVn3RsSUc3WHjO9DH05duvpdoRpYMPeX4bZfrKJ68jlDFVYZJMkoxSyWAfGF8nWGPdrgVtJdzdpqy+euw05bvVlDPhBJYS4ABgKU77lVWNmkD+QFApI5zJ2flcABzStWmcf9LgpINLOrzk/uR3TVUp3XnbtXTF+WcIZ5KUTh713rffpxHO2r8syjTUpHhJFrKlBevrbAwCaCtoMyq0faJNVo2aqJLE1bK5YhwHAI/VdCCYRyMMXAWEe9spFg1bXtprL5qd9sx/cKZwdFgG709u5wX9dP1l8whOc+JY7w4oThlbTV/51HX0nkvmUlCUKVm+wd9ggWXw/uG2rxUBF+yHkzFyLBaNENqKatpq0SZ9/uztvlPl4RV5DgBeqakBdlaNmUwYFB6wS2q1r7NVSk5W6DpxFnrdxfJTFsvqTcqNqimnz99yFd143QLKz1e76knqcOK7ID+PbnrvAvrsLVfSyBFltpkA9qgDKzPo62xRVoe2OGLsZOV0nMB5AhwAnK8DZQsC4iqgsm6icrpYpJciFr0wBo7nWnEWqmyEYgJNnBpfeM4U+uY/XU8fuOJsqhADoYoq1MUNpoBtH7pqPn3z09fT4nlTVOfwM5Qr6uA6EYgNJR6UKNLXQ2gjg3an3URb9PO0z2k5uVGAA4Aba0XCptoJ00UfeUBC8lSR/q4WSpicPAwO51oDzr+p1fgzCYUFeXTZopn0rc9cT8s/fCHNmTbm1II5uDV3xlj65A1LdNsuWTCdCkxcrRhhhLq4zmQQQJvo62pWpujzB6hWtEXlhJzAFQQ4ALiiGtSNCARD4oc3UzkhZnYM9+LxfuWkegIMzl5rwPk/t24bff2nf6FVr2wRAUhXZfjfWTPH0SdvXEL//YUP6d1D6Gs3rMxgQjy89tG/O4++94UP0+03XERzZpgLSIjJT760mf7jp48SWKmahTpB3aimS8qHu9tJdeAXaWsnzCS0Razz4j0CHABOqzPv7BgxZjIVjVu12gAAEABJREFUlJQrG9zf1Sou9fuV012yYAZhcJYUP3Bof1y1geLCyz367Jv0v795jnr7zA9I4yladA99btmV9O3PfYA+9t5FdM4ZE6hQ9MErmphWHDrnnzmBPn79Ivqvz3+QPrv0cjr/7KmEK5O0idMIdPf2009+/az+Vi+BiMAKzNIkO+0w6gZ1dNqBNDui4V7q71G/7RNtD20wjXo+7GICHABcXDnpTNM0jUZPnZdOLOXxnvZGccYnP08QHMuHrjonpa7hdsKRwaENlNmy+wh9+xeP0/7D6l0OA/UMXC8rKaCF8ybRJz54Pn3vix+mLy6/mpZ94AJ93AC2zxNXDZPHVdPo2gp9JlJMQ5FMj3XcojlmZCXhagIvZLl04Qw9LXR86bardZ3LPnA+LZgziUqK8smqDxh8++eP0/a9R09RCWZgd8pOiQ3UEcorIaqLxOMx6hVtQd9Q/Dd62jwxzqEppmJxNxHgAOCm2jBgS2FpBZXXqk++lYhHqbejSSpHOE04FinhAULPv7pdP5sdsOvkakt7N/1g5Sp64fUdJ/dZuTJ+VBXNP3M8YdwAtt8mxg0w79BXPnktff2f3kff/ZcP0d1fu0lfsI59X779GsLVxPIPXUgfvPIcPS10jKurstK0k7pWCz4/uO8pauvsOblv4MofxVUTGA7cJ7OO8qLOZGTh/BOK8/1AL9pcYUkFVrNqybXCcADIghofNeVMwiRcqkWJhnvEpX/68YBDx1rp90+ozUGDs1e8K2A4m2KxuK73Rw88TUeb7H+BzXC2ZPIYyvqDlU/RI0+tp1g8+RhYagvAECxTH029F3WFOkt99N29/T0doiuw790dkmtoa2hzkuIs5mICHABcXDmypmEQbqSBieKgv7+rRTiB9OMBOFOHY0GadAscFs5e08klj+/a30D/+bO/6Q6xpy+S3J113z29YXrkyfV6WffUN0mXDyzXvLVLSh51hLpKJxyL9BPqPp1cquNoa2hzqY7xPm8R4ADgrfoa0trKURMMDQhDoex4ABwLHAzSDLWoOv+kHgwQo0vka//zZ3r8xU0EZ5k8lrFvmzJCWR5/YRN99Sd/ptWvbdcHw1Wz+s1jr9KaNEEAdYM6Sqc7EY8T6jydXKrjGPhFW0t1jPd5jwAHAO/VWUqLNU2jsTPOIc3nT3l8uJ0YD+hpb6AEbkEZTlAcg4OBoxGrp/0Zdf4DFeHuoL+t3khfvev/6LHn3ibcITPwuJfWO3v66S/PvaWX5W8vbKQ+E1c3qJqhggCOoU5QN+n4oI71uhZjQOlkBx9H29LbmMYDv4PZeHWbA4BXay6F3flFpTR66twUR9LvikX6qFcxCMDxJDXj7BRdFclts9994Sg9+fJm+rcf/5n+/Myb1Nmt3ldt1gaj6Tu6+uhPT79BX/3x/9FTL79DKItRXQPTgffgIIB9Dz66VmowHc4fdYy6HqhXdh1tC21MVp7l3E+AA8DJOsqOlcq68YQ7NIyUJhru1e8MgqNIlx5nm3A8cEBw/nBM6dIYOR6OROnpNVvoKz/+E/3vb56nV97cRTizNqLLzjQIUK+8sYvuFjb+611/omfXbqVINGZ5luAN1mCOddTBaxv3pM0HdYq7vlDHaYVTCKBNoW2lOMS7PEyAA4CHK28o08dMm0uhwpKhDg+7P9rfTX1drcPKJA/C8eAOHjgkOKPkfju+47EEvbPrMCGvO7//B/qfB58RTnYbNTSnv4vJDnug85jI+9m12+guYcudP/gj/eavr9IWYSNsxXG7FrAGB7BHHcjkg0neULcysoNl0JbQpgbv523vE+AA4P06PK0EmJ9l/BnnGX5IJ9LbQf09crdl7j7QIMYOTjPB9h3b9x0T3Swb6Ot3P0b/+qP/o9/+7VV6e1s99fXbdxdRr+jDRx7IC3l+Q+T9p6c30A5hi+0FHpQBggDYD9qdcrOvs5UieL9vyqPD70S/P9oS2tTwkt4+mqvWcwDI0ppHX+3ISWcaLl2/uAoI93YaTp/JhHiQ6uUNu+iXv3+RPv/d39O/3fVn+vEDz9Cv//Kq3ge/fvN+wq2msjZBFmnQfw8d0PVVofNf/vv3eh7IC3nK6nNSDoE83CsXzFPZyf3+qahkzz4OANlTl6eVpHrsFCodUXfaftkdfZ3N1GdgfnhZ/XbJtbZ30879x2jtW7v0u3BW/ullQneJbH6QRRrcwQMd0IUnl2XTu0EOff6oOwRyo/aU1Ywm7vc3Ss8b6TgAeKOeDFuJ2/ZCRcbGA5BpWHQHYfAQDgXbWblkWaFQV70djYS6M1o0tJkx084ympzTeYQABwCPVJRRM/2BIE2acz7l5RcZVSH6j7tO3CIaN6yDE2aGQCIRJ9znH+3vMZwh2graDNqOYSWc0BMEOAB4oprMGRkMFdDEuYvJzFubcPtgd+tRwlOk5qzh1HYRiMdjhDqKhXsNZ4E2graCNmNYCSf0DAEOAOSZujJlaKigmCbOWUSaz3iVx6Nh4WCOUDwWNWULJ7aeAOqku1XUjagjo9rRNtBG0FaM6uB03iJg3Bt4q5xsrSBQWFpJ42adR6QZf5QfbxSDo4mG+4g/7iAQ7e+l7pbDlDATmEWbQNtAG3FHqdiKTBDgAJAJyi7Ko2xEHY2dcbYpixLoamg7qj8whvvRTSnjxIYJgH1fdxt1tx0j9P0bViQSok2gbYjVnPrL9cJyAMjBFlBRO45qx88wVXJcQ4R72qmnTXQ7xKyf8sCUcTmQGF0+YB8WAUCcvJsqMdoC2oQpJZzYkwQ4AHiy2swbXTtxJtVOmGlaUSzST92thylq4q4T00bkmIKo6PLpEl0+YG+26DWiDaAtmNXD6b1JwOdNs9lqKwjUTphBoy241/t4l1CD97qErICYQR0J0eeDh7vQ5UMJ87fkjpl+Fo0UbSCDReCsXEaAA4DLKiTT5lSNmiAGhs8V48LmmgK6IdAl1NVcT+G+7kwXI+vzA9Ou5kP6w11gbabAmuajCbMXUWXdBDNqOG0WEDD3q88CAFwEovKaMTRxzmLyBYKmceBqoK+jUXQLHaWYiVsSTRuSJQpi0YhgeYTANGHgJS6DMWBSt4lzz6fSqpGDD/F2DhLI4QCQg7U9TJGLK6pp8rwLyR/MG0ZK/lAs0kfdzcJxdbZS3ILuCvmcs0MyHo9Tb2eLYHiYYmKcxYpSBUP5NOXsJVRcPsIKdawjCwhwAMiCSrSqCAXFZbqDyCsoskallhBdFu3CiR3ibiEFouju6W45RJHeDiLBkCz4YHqHyWdfTJgl1gJ1rCJLCHAAyJKKtKoYeAp0inAUJZW1VqkU45UxvQsDVwRwbhjMtEx5ligCk0hfjwiW4qpJdKEl4tbdWltcUUNTzrmY8kIFWULLfDFYw3ECHACOc+D/AwgERDfQhNmLqW7yHCIxYEgWfWKx/hOB4LB+RZBIWKRYUs0d33iIZBZJdZaIwfGHezuF4z9MvR0NBEaWKBZKNE0TdThbjO+cT6hTsYv/mMApBDgAnIKDN5IEhO+g6rGTacpZF1LQ4jPHeDyiB4Ku5oPUL7o5EvEMR4JkIR38RplR9q7mQ4T3LoCJleagziaL/n68EwJ1aaVu1pU9BDgAZE9d2lISzA0zdf6lZGWXUNLQRDxK/WKgE7eO4p0DkXAfZeSqIGlAhr9RNpSxt6OZUGaUHQysNgNdPqizwpIKq1WzviwjwAEgyyrUjuKg+wBdQrUTZxHZcDqZSMSPv3Og7ajuGHs7WymaRbeQoix9Xa3HyybKGOnrFIHO/INcNOijadzlMwgJb6YhwAEgDSA+fJyA8C1UO346TZp7geVdQsdzOP4/IQY/I73t1NNyWDjMw4R32sbFvuNHvfMfc/XA9q7mw3pZ8JAcymZXCbjLxy6y2a03BwNAdleo3aXDPeTTF1xJtRPPIM3ntzW7eCxM/eLMubOxnjpFX3lPRxOFxYApHo5Cd4qtmSsohy2wKdzbRT2iewe2djaJ8Q1hO8qgoEpZFHUwcsIsQp1wl48yvpxPwAEg55uAOgCfzyeuBqbR9POuoLLqMeoKFFNoGlEiFqFoX5c+YIp75DubDujTIGM65Eh/D8EBK6o1LI68kCfy7m5rIN2WFgzmNgkbRfeOsBU2G85AMiHYow5qJkwn1IlkMhZjAicJcAA4iYJXVAnk5RfQ+DPO1buFQoUlqsnNyYtxA7z6MNzdpr+vGEGho2Ef4ewb78Tt62oTVwvdhEHXaKSfYpGwHiRi0SihSwnjDkkDsI59OAbnDtmoSIO0OKtH/z104o4d5IG8etsbCHnHwj0iOlnfn5+0LdU3WKMrDuxRB6lkeF9qArz3VAIcAE7lwVsGCGAaCdx1koluoXTm6VcK4oog3NMmrhYaqVcMuva0HiFMWQ3H3d1ykLqaRJdS4wGCM8fSKdaxD8e6xZk8ZJEGafs6RbdTTztFhc64OLNPl7+dx5PdPWAN5nbmxbpzgwAHgNyoZ9tLiS6I2vHTaMbCq6hmnOiS8AdtzzNXMvAJltXjTrDl7p5cqfaMlJMDQEYw504mwbwQjZw063ggmDCTrJpczhKCHlMSCILlGTrLuklnENh6rAhsrssJcABweQV51bxAMKi/bGTmgqtp1JQ5hNsUvVqWTNsNVpiG4/jV1DQCy0zbwPnlBgEOALlRz46V0hfw04gxk2nGgitp1LR5hFkpHTPG5RmHCkpozPSzdVaYhsPn97vcYjbP6wRyKAB4vaq8bb/m89GIURMJ96tPmncRVdZNJL8FL6DxNhXSGYDFpHkX0rTzLhdcxhNYeb1cbL83CHAA8EY9ZY2VmkZUXF4lznTn0czF19K4M86j0hGjiLQcaoqirKVVdTRu1nk6gzHT5wkmI+yYZYP4wwSGI5BDv7rhMPAxJwjgzqHy6tE04cwFdIYIBqOnnUVFZSMoG+cGRZlQttHT5ullnTB7IZXXjCYwcIJ9ruXJ5U1NgANAai68N8ME/GLQuGrUBJp81oU0SwQDXBlUjppE6BfPsCmWZQfbK0W319iZ5+plQtmqxDbKalkmrIgJmCDAAcAEPE5qDwHc7ogrgzHT5ooxg8tp5qJraJxwohUjJ1BefrE9mVqgFbbBxrEz5+s2T19wOY0RZ/wVtWMIZbIgC1bBBCwlwAHAUpyszA4CwVA+lQsnOnbGWTRj4RViuZrGn7mQ6iafSZXiqqGovJqCoUIa8mPxAeSFOfcrxdn8yEmzdVtmLLxa2HUFwcaK2rHCnnyLc2V1TMB6AhwArGfKGm0mgPlvykbUUfXYqeIM+yyaPO8CccZ9Fc25+P007bwraMLsRSI4zKHq8dNFgJhI5TVjqaRqpD6+kF9cTrgV1R8InbQS69iHY+inhyzSwMFDB+7Jh85pQjfymLnoKpo093yR9zyqGTeFYAtsOqmQV5iARwhwAPBIRbGZcgTyC4upVDh73EdfN3GW7qTHzZpPE0VQQB/8tPmXiDP1K+mMC67VAwYcOtZnLLyScAwykPTRzLEAAA6MSURBVEWaMaL7BjqgCzqhW84KlmIC3iCQAwHAGxXBVjIBJsAEMk2AA0CmiXN+TIAJMAGXEOAA4JKKYDOYABOwngBrHJ4AB4Dh+fBRJsAEmEDWEuAAkLVVywVjAkyACQxPgAPA8Hz4qJcJsO1MgAkMS4ADwLB4+CATYAJMIHsJcADI3rrlkjEBJsAEhiWQxQFg2HLzQSbABJhAzhPgAJDzTYABMAEmkKsEOADkas1zuZlAFhPgoskR4AAgx4mlmAATYAJZR4ADQNZVKReICTABJiBHgAOAHCeW8hIBtpUJMAEpAhwApDCxEBNgAkwg+whwAMi+OuUSMQEmwASkCGRhAJAqNwsxASbABHKeAAeAnG8CDIAJMIFcJcABIFdrnsvNBLKQABdJjQAHADVeLM0EmAATyBoCHACypiq5IEyACTABNQIcANR4sbSbCbBtTIAJKBHgAKCEi4WZABNgAtlDgANA9tQll4QJMAEmoEQgiwKAUrlZmAkwASaQ8wQ4AOR8E2AATIAJ5CoBDgC5WvNcbiaQRQS4KMYIcAAwxo1TMQEmwAQ8T4ADgOerkAvABJgAEzBGgAOAMW6cyk0E2BYmwAQMEeAAYAgbJ2ICTIAJeJ8ABwDv1yGXwCCByaNKCIvB5JyMCXieQBYEAM/XARfAAQIBn0aXzxupL1h3wATOkgk4ToADgONVwAY4QWDxGTVUWhjUl8VnVDthAufJBBwn4HPcAjaACWSYQEVxHs2fWnky1/lTqwj7Tu7gFc8QYEPNEXA8AMRiMXMl4NRMQJHANfNHkV90ASWTYR37ktv8zQQyQcANvs/xABCPRjPBmvNgAjqBM8eX0+gRhfr6wH/Yd+aE8oG7eJ0J2ErADb7P8QAQjUZshczKs5iAYtFCQR8tmVMzZKols2sIMkMK8AEmYCEBN/g+xwNAjAOAhU2KVQ1H4OI5tVQYCgwpgmNLZtcOeZwPMAErCbjB95kOAAlKtJuBEuMuIDP4OK0kgdqKfJozsSKt9NxJFQTZtIIswARMEjDr+8z6XphvOgBoCToKRUYX41HQaI6cLtcIaKLAKoO8kEUakYz/mIBtBKKRsCndZn0vMjcdABKauQAQ7uuFHbwwAdsInDO1iqrL8qX1Q/bsAbeJSidkQSagQCDS36cgfbqoWd8LjaYDgNko1NfTSXG+FRR1wYsNBApDfrrgzGplzReeWSPGC/zK6ThBZgh4PRf4vL7uTlPFMOt7kbnpAGA6CiUS1NfdBVt4YQKWE7ji7DoK+tWbOdJcflad5fawQiYAAj1dHeIrIRbjf6Z9r8ha/ZchEp3yZ3IMALqOw8AaL0zAOgITa4to2uhSwwqnjykl6DCsgBMygSEImD3719Va4HtNBwArolBvVzslxJWAXij+xwTSEZA47vdpdOU5oyQkhxeBDugaXoqPMgF5AvB18HnyKVJLWuF7TQcALW5uEBhFw51A/TwYDBS8WERg8axqfaI3s+owYdyimepjCGbz5fTZSwC+zuwtoDqdBO0jkx/zAcBnPgCgDH16nxjWeGEC5ghgYrdzp1WZUzIg9XnTq3iyuAE8eNUcgZ6ONnMKTqTWLPC9pgNAvxZ+RwxldJywyfBXe9NRioT7JdKzCBMYngDu47ey2wa6oHP4XPkoE0hPICp8XGdLQ3rBdBKJRGeYwrvTiaU7bjoAbPjlJyNaIvFEuozSHUe/WHvTsXRifJwJDEtg1vjylJO9DZtI4iAmi5s1rkxCkkWYwNAE2oSPg68bWkL6yOPwvdLSQwiaDgC6Xo3+TBZ8utqaiR8MswBkjqrARG6XDDPZm1ksl8ytpWDAmp+MWVtyNb2Xyw3fBh9nSRks8rmWtGYtFv9bIkHmnms+QaXl2OETa/zFBNQIXDS7lgqHmexNTdvp0tB9scjj9CO8hwmkJ2CZbxPdP23Bor+mzzG9hCUB4JX7bu0kSjyfPrv0En3dHdTLD4alB8USpxDABG5zJ9o/n//cSeWEvE7JnDeYQBoC8GnwbWnEZA8/vuV/b7Dk6VlLAgCsTmj0ML6tWFqOHODpIawAmW06higPJm7DIK2mYW0IIYt2a5pGyMsidawmBwhg2odm4dMsK6pF3T+wx7IA4I/F/5iwqBsIdwM1HtrHD4ehhnhJSwATt2ECt7SCFgkgr7OmVFqkjdVkMwEM+DYc3Eu4+8eKcsLHWtX9A3ssCwBWdgPBsN6uDmptOIJVXpjAkAT0yd5mVQ953K4DF51RLcYbeLI4u/hmi174sD6Tk76dyiLxvFXdP9BrWQCAMkrQz/Vvi/51NB+jrvaWE9r4iwmcTgATtuUFM++Ikeel80aebhDvYQInCHR3tBJ82IlNa74S9GOy8GNpAFh77zLcDrrDQvuo+fAB6u/tsVIl68oSAmOrCwkTtjlVnJljywg2OJU/5+teAuG+Hmo6tN9SAxOUeEP42CetVGppAIBhcUp8B99WLehDO7pvB/V0WvP4tFV2sR5nCeDp3KstmOzNbClgA2wxq4fTD0/AS0d7OtvpyN4dlo9hakTfs5qD5QFgXVvRr4SRll4FIAgcq9+rjwmIQRChnv9yncDCmdVUXpznOAbYsGDGCMftYAOcJwDfhD7/Y/V7LHf+4ux/55q2okesLqXlAYAeuSFGlPh3qw0V0Y/am45Sg4Abj8etVs/6PESgrChIC6ZbN9mb2aLDFthkVg+n9y4B+KSG+t26j4Kvsrwkcfricd9qrWbrA4Cwb82KZQ8nEvSsWLX8D/Noo0vIqtuqLDeQFVpPYJBGt3W7BPw+gk2DzOTNHCEQDYdFl892wp2LdhRZ9IA8Jfr+Mb5quXpbAgCs9MX9dxAlbJneM9zXS4d2b6OWo4coGokgO15yhEDAp9GarY308Av7pJZVbxifWuSpDUek8oAtsClHqoCLeYJANBolTO9waPdWivT3ndhr9VeiP6b5Pm211qQ+2wLAK/d9bLu4CrgzmZHV34lEnDpaGujQri3UfKSeIiIKW50H63MfgWg8QfWNPdLL0RbjP8yGtl7pfGCT+2ixRXYQwIOqTUcO0KGd7+i3ecIX2ZEPdMKHvrZiqaVjqtCbXGwLAMhg7T3LfpwgegbrxpfhUwJ+Z2uTCATvUNOhA9TTZfrVBMNnyEeZABPIOQIJMe4I3wIfg5POrtZmMdBr81hkIvEofKidsG0NADA8nsi7WUSxo1i3e+lqb6aGA7tp/9a3CSPxCAzcRWQ3ddbPBLKTAHwHfEjDgT20f/sm3bfAx2SitIlE4li/r2ip3XnZHgBeveejxyhBNydI9NnYXZoT+hMiq97Odr1r6ODOzYQ+uoaD+whjBh0tjdTd0U76ezljsRMp+IsJMAE3ErDbppjwAfAFuHcfvgE+AnP3wGfAd6B7uaerXQxn2ny2P6Cg8JWi5+TGDb+8QWQ84IANq7YHANi89t5bnhVB4PNYd2LBAE0PHssWYwYtRw9S48E9dGTPNqrfvpH2bXmTlyxmcGTvdsNN7vCe7dw2srht4LcPHwBfgNvL4Rs6hI/o6WizcVBXojlqvn9Yd8+y1RKSpkUyEgBg5fG+rMR3sc4LE2ACTIAJpCCQSHx97S+X/iLFEVt2ZSwAwPo1K5bdKcYD7sY6L0wgLQEWYAI5RED4xp+vuWfZf2SyyBkNACjY2ntu+UfRv/V9rPPCBJgAE2ACYoghQT8WvvHvM80i4wEABVy74pYviDGBf8E6L0yACTCBXCUgzvrFn/ZZ4fw/5wQDRwIACrrmnlt+EI9rt4n1qFhS/PEuJsAEmEAWE0hQTCPthrUrlt7lVCkdCwAo8Lp7l94Tj9PFlEjUE3+YABNgArlCQPi8eIKWrLln6R+cLLKjAQAFX3fvLa/0RGmOWF8lFv5jAkyACVA2I0gQ/Rk+D77P6XI6HgAA4K37l7WtWbH06jgllokOsWbs44UJMAEmkE0E4NsSlLhVdPl8AD7PDWXzucGI4zZoiXUrlt0fC2vTBah7xSIC5fEj/J8JMAEm4FUC8GXC8d8H37Z2xbL7iDTX+DYXBQDSP689uLRZjIgv1+La+QLaFn0n/8stAlxaJpAlBODD4MuE478Vvs1txXJdAEgCWnPf0rWhnRPmiui5PJFI7E/u528mwASYgAcIHCBK3A4fBl/mVntdGwAAbPXqS6LiauDetfcsmyDGBz5NiYTxiV2gkJecI3DgSAvd8Y2HDC1Im3PAuMCmCIi+nW3ipPWTa1bcMn7NimUr4MNMKbQ5sQsDQOoSi/GBn6y5Z9mMRNw/FQ+RiUurF8Q3T+eZGhfvZQJMIBMEEhQTDv9F4Yv+Bb5p7YpbZq6955ZfZiJrK/LwTABIFnbtvR/bteaeW36wdsWyi33BYHU8rt0iuoj+JI53iYX/mAATYAK2EhAnn+3iTP/3caKb4YOEw1+i+yThm2zN2AblngsAAxm8/LObWtfdu/SBtfcs++Ca0fvK+jX/KC3mO5cS2vWi/+0O0WX0bRGdHxTLs6LCtontzoHpeZ0JMAF3EXDcmkSiE75C9xkJelCsf0es/yN8CnwLfMza0fsr16645SPrVtzyEHyQ4zabMMDTAeCUcv/Hf8Q3/PJjR1657+Pr19yz9FHR//a/a+5Z9q9r77llqVguFxU2U2yXrllxi8YLM+A2wG0gZRu4Z1kpfIXuM+A7VtzyFbF+N3wKfAt8DAlfc4rv8fBG9gQAD1cCm84EmAATcIIABwAnqHOeqQnwXibABDJKgANARnFzZkyACTAB9xDgAOCeumBLmAATYAIZJeCiAJDRcnNmTIAJMIGcJ8ABIOebAANgAkwgVwlwAMjVmudyMwEXEWBTnCHAAcAZ7pwrE2ACTMBxAhwAHK8CNoAJMAEm4AwBDgDOcOdcBxLgdSbABBwhwAHAEeycKRNgAkzAeQIcAJyvA7aACTABJuAIARcEAEfKzZkyASbABHKeAAeAnG8CDIAJMIFcJcABIFdrnsvNBFxAgE1wlsD/BwAA///N6DGrAAAABklEQVQDAJjzkx1AftqsAAAAAElFTkSuQmCC",
    vault1: "data:image/png;base64,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",
    vault1Blueprint: "data:image/png;base64,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",
    extractor: "data:image/png;base64,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",
    extractorBlueprint: "data:image/png;base64,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",
    sensor: "data:image/png;base64,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",
    sensorBlueprint: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAQAElEQVR4AexdCXQUx5n+ei7d94UkBDoQh4Q4jUGI2NixEx+Jk0CSl2TtGGzwsZv3Em+yefHb++Ul+7y7trNZZ58D2JA462vjhDi2sbHjAxuEDBgEQggEQkhCErrP0dyzVaOD0TF9zNRM98xUP7W6u+r///rrq/+rrq4+Rge+cASiGAFOgChufF51gBOAR0FUI8AJENXNzyvPCcBjIKoRiGICRHW788pPIMAJMAEE30QnApwA0dnuvNYTCHACTADBN9GJACdAdLY7r/UEAkEnwOrtz2dt2Lnvmxt27PvPyp37/rhx576TlTv3DpCtm6/71MFgp/bKnYgJEhv7/kBjhcZM5YN70ifiNGgbXTAsr33ohVwS7D8nlTodZ9B1kUJe0Qn4oQB8FcAqAUIK+MIR8EJgIiZIbOBrNFZozAg6Qy+JoROEDD+lMeUlzmyXlMPMFqiTlTv2PW1yOy8JwOMChAp21rmlaESAxNAaEqT/QGOKdKpP0RhjiQOxHbg56tRU4Av4gQDEgS8cAYYI0Jgi62PXifBiJgvzARNg7UO/Nppczn8SeOCzaA9uQwIBQoI4sj5mctnIsOjXRglxyeyACEAvUkxu04ck+B+RLIkLcAQYIkBjjsYejUElZmfK+k2AzZs/MAiC4Q0BwsaZRvkxRyAUCNDYIxfKf6Kx6G95fhPAWtr8DARU+lsw1+MIMEJgkycW/TTmFwE27Nz7CGHfw0rLjIlPQlpOHnIKFyN/URkWLFmJwrLVfI1iDGgM0FigMZGWnY/Y+ESlYUX6YeFhGpOKFYmCYgKs3/Fijs4tPE10Zf4JSEzNxPzScuQWLkJKRg7i4hNgNMVAp1dcvMwyuVi4IEBjgMYCjYmUzGzMKyz1xEoiiRmQ0IbMhXTIT63btneeTPEpMcURqBOs/0r8ip2yILKTkJyGvJKlyMwrgMFoEpHkWRyB6wjQWKExQ2MnPjkV7utZPvcEIM5gxE98CvjIUESAG3f8tkhwCzt82JqWTB3PyFsAU4wsrkzTDc4BtxpuCNDYycxbiPhEuQ8OCA8pPQsoIoAezn8mvb9eCsj4pBRk5RdCp1NkXsosz49CBGgMZRcUgXaoUtWfOAv8i5Scd76iCCUFbPBWnmvfSHr8TBL8gkCk5xLgaRwBhQgIgkCG0Qthio2T1BTc2AwFi2wCVD60dykEYYmU7az5vOeXwojnK0eAngnocEhSk8SoJ1YlBccFZBMALtAnOSG2JJIrd1OMNEvFbPA8joAvBOgZgMaYr/ypdBmxOikrmwBkQCM6/BHIeD8tW/Es1KQffBtMBCLINo0xGmtiVSKxukos3ztPNgHcAkSjm0556sk8lLdxvs8RYI0AjTEaa2J2pWLVW1c2AchkrCgBYuKU38HzdoTvcwTkImCKixcVJRfCorHqrSybAORCXNSowWTytsv3OQJBQ8BoEr+3FJwzAIQYsRoZ+Z1eMXh4HkMEDBJDbUHBK7eyzwBS/uuMRikRns8RYIKAzmCQbUdKkB0ByBhJqjCezxFggYBeL/kwguximBFAdolckCOgIQQ4ATTUGNyV0CPACRB6zHmJGkKAE0BDjcFdCT0CEUyA0IPJSww/BDgBwq/NuMcMEeAEYAgmNxV+CHAChF+bcY8ZIsAJwBBMbir8EOAECL82k/aYS8hGgBNANlRcMBIR4ASIxFbldZKNACeAbKi4YCQiwAkQia3K6yQbAU4A2VBxwXBAQKmPnABKEePyEYUAJ0BENSevjFIEOAGUIsblIwoBTgDGzWnSOZEWY0dBsgNl2W5UFplw58okbF2fgW9vysZ3N+dh5xcW4m/uLsHffb3Ms+64fQG+U5WNe9ak4PZlsagqErA614nSVAtShQE4hrthHuyD3WYFX9giwAkQIJ4JBidK0p24dWkcHr6jCN/fUoEdX16Jb31hBe6+qRyb1i7C8tICFBfkYP68TORkpiI1OQHxcTFTJaelJCI/NxNLivOxqrwYG9cuw21VFfjqbWuwc+tGPL79ZvzoWzcQgqRhVZYFeaYBGC19sFnM4EtgCEQQAQIDQon2vAQ7qkqMeOC2Avz1Vyuw5dYKrF1ehOTEOCVmFMkmJMRi+dJC3H7zGvzVPRvxg3s34dEvLcENuQ6kurswNtityB4XHkdAN77h/6UQSDE5sG6hAQ+R4ct9d67ExtWlyEhNklILan46Kf+WqhXY+Y3N+Ml9VbhjeTyKUywwwRLUciPJOCeASGvqBJdnHP/dzbl46J4V2LxuMVLI8EVERbUsk8mACnKG2Hr7Gnz/62vIcCkF6bohOB0O1XwKh4I5AeZoJaPgxOr5OjxyV6lnHJ+TmYZwW+j1xINbNuAblVlI0/XzC2gfDcgJ4AVMPLmg3VRqwg+2VuC2DUuR4HWh6iUWVrslC3OxY0sV7r05HxlCH6xj/MLZuwE5AQgaApxYt8CAh79cjsqVi0hKmP3JcHdBfjYe2LrJM1t17XI9nE4+NKKwRT0B5ic58ODthdh842IY9JEPx8Z15fj+d25C38VPMdDdjmhfIr/FfbRwnN6OL69Owbe/uAJpKerO5vhwMWjJBeRs8KOHt6K1vgZNtYej+n5CVBKgONWFnV8qx9KS/KAFmdYNZ5ML+8+tX4mR/i6c//Q99F9r1brLQfEvqgggwIXPL4vD1tuWI8ZoCAqg4WR0y903QU+GfW6XE63njqP1/Em4XK5wqkLAvkYNARIMdtx7Uz7WlBcFDFqkGMhIS0bxwryp6vR3NOPiiQ9gNY9MpWl9J1D/dIEaCAf94lQnHrirDPOyw28+P9j4ZqanTivCMjqEC8ffj5ohUcQToLLISIY8FYg1Gac1ND8YRyArI2V8x+u/e2JI1EGmS72SI3I3cgngdnvG+5vWlkZkw7Gq1KjZ93ND3VfOk2uDE3C7I/e6ICIJoCM3tr60JoWP92Ww5PxF8dmf/mstuHy6Gi6nU4a18BOJOAIYyUzPlvXzsKxkfvi1Rog9Hhoxo62jS7JUOlV6qfZjOBw2SdlwEwhjAsyGmj7S8JX1OSgqyJqdqUJK4+UOnKi7jEPHL+DAJ/V47S91+N2B09jz51r8av9pPPl/dXjilTN46tWT+MWrx/Hfr9Tgf149gt+8XoP3j57DeaI/ZrUHzfP6882ybY8N9aO5tjriHqGIGALQceqdq9JUDf7RUQuqT10kQV6Lp35/FvtP9OP9hjHUNDtQ1wk09evQMWpAv9UIs8MAl6CDTq+HUxcDuy4eFn0SRnWp6LIl4USbG68T/Wf+3Ihdb1zAHz+sx9mLV2UHrJQg9fXl/X+REpuWbx7uw5WzNRF1TaCbVsMwPXCTC95blsahfNH8kNegraMH79c04Lk3TuFXb17CJxdtJMiN5CpEYObLoMWBiz3AW6cG8fRr5/Dye+dwqkF87C5V+DN7/4De/iEpsVn5I31daKk/RkjgnpUXjgkRQYCqEhPWVZSEFP+mlk7PUOalw1040epCn8UEQccu6H1VxkHI3jrgxrt1w/jl6w2ov9IDq82OqXCc2vFlAXjtzUOoa7jsW0AiZ7C7He2NtRJS4ZEd9gRYlO5E1ZrQTXW2dfbghQO1eO3TPs9QRs1m3rwiB2ULMxFD7nFMUW9qZ7Zn9Reu4IlnXsT+Ax/PzlSY0tt+GXRVqKY5cZ3mPFLgEH1P92u3VijQ8F/0Ws8AXnrnNF78uAudoyrfVCPVKFuYihWFc9/ZHh4dw8dHT+NMfRMOfngMe18+gMd/thv/9svfBdTzk2Kn/V0lZ4GxkcFpaeF2ELYEMAhObP1cYdDx7h8cxh/eP4PfftCGtmEDBJEeNujOTBRAR1qbK7InjmZvkhLicObKMJ7asx8v/P4g3v/kM1nTnbMtSaSQ4Vhz3VE4HcGbqZLwIODssCXAHWTGhz7MFTACIgbqG1ux991mXOrTA4J2oFpZnIaEWAPEltScfCy58fNISs8REws4z24xgz5JGrAhlQxop1UVAFCW4w7qjS7SseFgdQPeODVMZnNI8CvwLdiitPevXCZ+n8Nmd6K9xwy9wYjCio3IWrgkqG4N9Xaiu7UxqGUEy3jYEYA+1nxn1bJg4QEbmVH53dunUHvVpYnhzsyKripJl+z9z7YMTc0KCWTIlltUhgVlN0LQBY/MHU1nYTEPz3RX88dhR4AvrsmBThcct3v6hvDcW/XkItekyYbTk+5/47JMUd+cLjeO1M9+vCE1Ox+lazfDGBMnqu93JjlttjV85re6XEXWcsGJJNZeTtgrSnWiZMG8iSO2m8bmDrzwwRWMONSf4fFVszWL0hEXIz72P9XUD7N17gfXYhOSUXrDLUhIyfBVREDp5qE+9HW2BGQj1MphQwC9zokvbFgUFHxqai9h//F+ONzBGyIE6jjt/dcvEQ9ch9OFo+e6RYsyGGNQsvompGYXiMr5m9l5qY7MCjn8VQ+5XtgQYENRbFA+PnvhcjsOXfD9THzIW8RHgTcszpDs/U9e8t37zzRbsGwt4pPTZyYHfOywW9HRVBewnVAZCAsCxOvtqFzFvvfv6RvEGyd6ocmrXVxfjHoBUr2/zUF6/4ae60oSe4IgoLCiEsbYeAlJ5dl95C6xNUwuiMOCAOtKEkmMkukM5W3hU2PMYsUrHzVrbppzLodp7x9jFB+efXaxDxbb3GP/uWzSNIPRhOIVG6HTi19XUFmla1dLeEyLap4AsXoH1nq+5KC0CXzLu1wuvPReA8xO7V7wTnpvMuiwjgx/Jo/n2tLev0ZB7+9tIyY+CYXLN3gnMdmnb5LZLKNMbAXTiOYJsGZhvOfbNSxBeP2js+i1aD/4aZ1p8Ev1/scu9IKSgMr7syamZSG3ZIU/qr51yLRoOJwFNE0Ak+DA+hVsv+NztPYiGnvFhxO+WzW0ObT3p8MfsVKt5K7vsfPyx/6+bGUVlCA1p8BXtl/p9DtDduuYX7qhUtI0AZbOM8JgYBes9KL3kzCY8Zls/PVLMkFJMHk817bmfC/sThkvAcylPCNt/pLV5EZZ7IxU/w/pi0q9HVf8NxACTU0TYM3SPKYQvHe8BW5B01Weqm+sSY81peLTlGNWBz5rJLNYU1qB7eh0euQUlQdmZIb2QCcnwAxI5B2mx9ow10eb5GnPlrra2YvWIXZnk9klsE2Z1vv7MH20gV3vP1lEGhkG0TvGk8eBbm0WM0YH+wI1EzR9zXaHS3ITmVb64PHA3qFl6oyEMU/vvyhNVGrU4sDJS+wDSxAEckHM9iUjOiMkWhkVMzVJAMHtwuqy+cxgqWtsQ49Fmw+4zVXJyqVZMOjFm6aaTHvSB9/m0g80LSk9G4mpWYGamdIf7GqDm0w9TyVoaEccZZUczUtyISEulknpLpcbn9SzGyczcUrESHyMHqtKUkUkANr71wah9/cuNHcRu7MAfWNssLfT27xm9jVJgJLcBGYAHTvThGF7eMz500pvWCbd+x+u7wLhNRUP2hqXmAKWD8wNcwLIb6uifPFn3uVbGnXz9AAADSZJREFUAmqvaP9u5GR9PL1/cdrk4ZzbIbMdp5sG5sxjnZgxv4SZydEB/87CzBzwYUhzZwCTzoHszBQf7ipLHhgawaCN/XMuyryQL11Vlg29TvyZp8Nnu8Fm1l/ar4TkNOiNJmlBGRI2ywi0eFNMcwSYx3Dy5/SFdhlNow2RpDgDKopSRZ0ZGLHh7JXQ9P6TjqRk5U3uBrwd0eBZQHMEmJ/J7pW9pq6xgBstVAY2lmVJ9/71oev9J+udnMGOAKOD2hsGaY4AxfPF33qabBip7ZjFiu7R8Bj+0N5/eaF47987ZEV9S+g/QkUflGP1Mr15MPBnlqTaXWm+pgggwIXc7HSldZhTvq7xKkBu6iAMlk3l2dBJ+HqY9P5qVEWn0yE5Yx6Tounvj7nJPR4mxhgZ0RQBEowur2oFtnuxfSQwAyHSTkkwonyh+EU/7f3Ptw2FyKPZxSRn5s5O9DPFOmb2UzM4apoiQFIMm0o6HE60D2uqap6K0U6+JDcRVaTH31q1AI/evRjbby8hJypBdGbn0JnZnznxGAzRP1ZnAOqu3cIJQHGYc02OZRO0nT39ZDDFxtacjvqRmJpowrdvLsIWEvj02z7FhAiJZObHaBj309fkZ9eABRc71P3glN5gRExckh+1nq1iHdPWmXkc/dl+qpJCg4RFwUPD2vrKQ0VRGu6/rRj5mcpnuA7Vqdv7T7aHwcTm9Gwb09aNSU0RIC1JeYBMNpD3dths9T5UdZ9+yPaOtbmSL7bM5eSg2YbLndroMQ2MvihHH4+eq65qpWmKAInxsUxwGB6zM7ETqJHUBBNuWZGj3MyERkKMEdTGxKGqGyOjM4DDpp3OiQKqKQLEmNi4M2pR/8tkdEx/17p8TI7xKdhKV4NewF3r8kBtKdVlLW8wsTk7u1zKPt3Cuh4z7bGJuJlW/Tw2GdncuDJb2U2n+lkV5KbH+TXmn1lefma8x9bM9FAfG2PYXAO4nOp3Tt7YaYwARm/f/N4fs4XqcTHfLuZmsOkxaQksbVF7/qwGE5vhqZufAXzDbzIZfGcqyBlzqD9oWJCZoMBjcVF6NhGXCH6ukREBnE4+BPLZWrExJp95SjLMTvVPbCx77bx09t/vVIInlTXEsBkCSZ0BaFmhXNWPFK/aDgwFPkc8bkNT1fKqoX+79GLYP012WgaDCXpj4MMgnZ7NMJdVzTQVKW3X+gOuV1sn+y8l+ONU1yC7m3EsbflTl0kd+prk5L6/2/ikVH9Vg6KnKQJ09gR+06e9N/CzCAukuwYYEoChrUDqFpck/tCeHNuxiZwAPnFq6LDCbvd/mow+BHehUxs3Wrr62fnB0pZP8GVkZOQWQgjgy3qCICAjb4GMkkInoqkzwJjLiPdqzvtd+3eONGBMI588v9QxjG4Gw6AeYuNih3qPQns3hikuATkLl8LfJaeoDKZYdrNj/vrhrachAoy7VdfpxtVO5a/OUZ36a+M2tPDf7nThzZp2OAP4cC3Vfb3mKhwB2GCNRdbCUsQkJCk2S3+HIKugVLFesBU0RwBAhz8dvYq2Dvmvz7US2f3V2nsDrHvIgo/q/Gcl1aUvwwQ7CJTYp0OgheUbCAmSZavFJqSA/giHIAiydUIlqEECAKMOA14+3Im/1DTAJfIFKPppwPeONuAVImt2srmJxhr4E419OPhZu6IfsKA/dfTmsXZQXdb+sLAXG5+IxWtvQdYC2qOLBDUJ+KyCxShduxkxRIdF2axtaJIAtJJucib4rNWFXa+fwZuHzqK2oQXDI2b0Dw6T/SueNJp3ss0FKkt1tLrWNg1g77uX0NIt/TYUlXn+4CXUh/jzJ0qxE3Q65BYvR+kNt2JecTmSMnLJfQIT6CMTyZl5nrTStbcit6QcVFap/VDJa5YAkwAMk7NBfZeAg3UjePbtZux5t5Xsj4KmjZC8STmtb4dG7Z4f5dvz9kW8faID9Ps+gyRt0Gz37L9D0p5755JHRgtPs8rFMy4xGdkLFqOoYgPKq+5G2cY7Ubh8vSeN5sm1o5ac5gmgFjDBKrd/xIYzl/vxFhni7DrQiF1vNeItsn+apPUNs5s6DZb/kWaXEyDSWpTXRxECnACK4OLCkYYAJ0CktSivjyIEOAEUwcWFIw0BToBIa9Ewq4/a7nICqN0CvHxVEeAEUBV+XrjaCHACqN0CvHxVEeAEUBV+XrjaCHACqN0CvHxVEVCRAKrWmxfOEfAgwAnggYH/i1YEOAGiteV5vT0IcAJ4YOD/ohUBToBobXlebw8CnAAeGEL8jxenGQQ4ATTTFNwRNRDgBFADdV6mZhDgBNBMU3BH1EAgqgjQf60VzXU1qD/yNk5/+Ee+emFAMaHYUIzUCES1yowKAtBfJmyqPYzWc8cx1NMOh21MLbw1Wy7FhGJDMaJYUcyC4azWbEYFAVrqj2Gkv0tr2GvWH4pVy7ljmvWPpWMRT4DejiswD2njNwNYNlywbZkH+0CxC3Y5atuPeAIMdrfNwnjV8lL842P349l//yFeeObvVV2pD9QX6tMsR1VOmAs7lV1iXnzEE8AyPDgNtLUrluCHj3wTi0vmIyE+dlqeGgfUB+oL9Yn6poYPvsqciZ0vuXBOj3gCOOzTv7Z29+2Vmm0vrfk2EzvNAheAYyEkQABeMlTNy8lkaI2tKS37xram2rEWdQRIiI/RDvozPNGybzNcjZjDqCNAxLQcrwgTBKKOAKPm6dcETFBkZETLvjGqoubMRB0B2q/J/+mlULeWln0LNRahKi/iCWAwTh/zv/ludaiwvV6OzD2t+TYTO5nVCCuxiCdAbFLKtAY5cfo8nnz2VVy41IZRs2VanhoH1AfqC/WJ+qaGD77KnImdL7lwTo94AqTnFs1qn1N1jfjp07/BIz9+Evd972eqrtQH6gv1aZajKifMhZ3KLjEvPuIJkJqVh8T0bObARbrB5IxcUOwivZ4RTwDagHmLVkAQoqKqtLoBrzq9HnmLVwZsJxwMREVUxMYnoeLmr6Bg2Q2gP+FpMMWFQ9uE1EeKCcWGYrT8c/fAFMMGo5BWwo/CmBHA5Xb7UXxoVdJyClC4fD3KNt6BFZu/xlcvDCgmFBuKUWhbRXlpTqdTuZIPDXYEsNt9FMGTOQJsEXA5HMwMyiaAG+7pzxXPcMHhZOfUDNP8kCMwDQGHQ7yzlYpVb2OyCSC40emtOHM/Wt4hnVlvfhx6BGwW8Xe6pWLV22PZBHAL4gQwD4meILzL5PscgYAQMA/2i+pLxaq3smwCSLHKMjoE65jZyzbf5QiwR4D2/lbLqKhhqVj1VpZNADLHc8pbca79gZ5rcyXzNI4AMwT6u0VH4p5y5MSqR5D8k00A6LAfEsvY8AA/C0hgxLP9R4D2/jTGJC3IiNVJG7IJUL1rewPc7vOTir62ve0tcLlcvrJ5OkfALwRoTHVfbZbWJTHqiVVpSY+EbAJQaXJx8Tbdiq026xh6rl4RE+F5HAFFCLjJTdYeEvx2q4yndwVIjlTgtSgjgB6/gBuSXpjJUOhaS1P0ngnAF1YI0J6/q7UJ5hmft5nTPonNMYf7yTnzfCQqIsDRZ7c3Q3D/lw9b05LHRgbRcfkCbHJYO02TH3AExhGgsUNjaGxkaDxB6j+JzZN7H+iWEvPOV0QAqug0G38u906bnQyH2i81oKe9FQ67jarzlSMgiQCNFRozNHZoDEkqEAEy8zMkOF0/I7uK/hQToOZ/7x2CW3hUfilujAz0oK3xLDqbGzHY04Ux8yjsNitcTn6xLB/HyJSkMUBjwTI6QmLjGjpIjNBYoTEDkLCWWW0iufPw8w8OyxSfElNMAKpZvWfbS8S5J+i+ktViHkF/11Vca76Aqxfr0XK+Fs31J/kaxRjQGKCx0HmlkcRGO6wkRpTE1Lis+4mju7e9Or6v7L9fBKBFHNm97XFycX6I7vOVIzCJQKi3pOc/QGPR33L9JgDI1bDF6fo6gBay8j+OQOgRcLtbXWbDt0BiEX4uARAAoFfcVsG6iJwJnvWzfK7GEfAPATf2WHW2Es81qX8WPFoBEYBaOLHrYTu5JnjULQiPkGsWdq/qUON85QjMRMANJ+lwdxzZs20njb2Z2UqPAybAZIHVu+7/teDSlxMS7CEO8jnPSWD4lgkCZOrdTtbnaYyRDvc5JkaJEWYEILZw+Pn7zlNmumAoIST4FSGD5F1jqsdXjoAvBEgcjZIL3addbmNx9e7tD9IY8yXrTzpDAlwvvmbPvW2Epd8jZIiDU9hIKvELwt4jZHuOrJ2cGNex4nsTCLhhobFBgr1hPFbc/+F2CetJHCVW7972tzSmJiSZboJCAG8Pjzx/fzWpxGPVu7dXkW0ZWXMpMcjUlcDXbRyD3RMY7NkWR2Ojeve2ZdWeWNn+4+rn7v/UO5aCsR90AgTDaW6TI8AKAU4AVkhyO2GJACdAWDYbd5oVApwALJDkNsIWAU6AsG067jgLBDgBWKDIbYQtApwAYdt03HEWCHACsECR2whbBDgBwrbptOF4uHvx/wAAAP//wrhOjAAAAAZJREFUAwBB/7k1SOaxCQAAAABJRU5ErkJggg==",
};

// The tutorial picture and the toolbar icon are the building's own picture
const RESOURCES = {
    vault: { base: IMG.vault, blueprint: IMG.vaultBlueprint, tutorial: IMG.vault, icon: IMG.vault },
    vault1: { base: IMG.vault1, blueprint: IMG.vault1Blueprint, tutorial: IMG.vault1, icon: IMG.vault1 },
    extractor: { base: IMG.extractor, blueprint: IMG.extractorBlueprint, tutorial: IMG.extractor, icon: IMG.extractor },
    sensor: { base: IMG.sensor, blueprint: IMG.sensorBlueprint, tutorial: IMG.sensor, icon: IMG.sensor },
};
