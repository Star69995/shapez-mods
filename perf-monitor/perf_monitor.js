// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/perf-monitor",
    author: "Star",
    name: "Performance Monitor",
    version: "1.1.0",
    id: "perf-monitor",
    description:
        "A small, plain-language readout of how heavy your factory is for the game (load, how many buildings you can carry) plus a one-key 15 second test that shows what slows the game down the most. English and Hebrew.",
    minimumGameVersion: ">=1.5.0",
    doesNotAffectSavegame: true,
};

////////////////////////////////////////////////////////////////////////
// Settings

const MEASURE_SECONDS = 15; // length of the profiler run
const REFRESH_MS = 1000; // how often the live readout is recomputed
const MIN_BUILDINGS = 300; // below this the estimate is just noise
const REPORT_ROWS = 7; // rows shown in the profiler table
const REPORT_ROWS_SHORT = 5; // ... when the belt / factory / area sections follow (F9 shows all)
const LOAD_WARN = 0.7; // load above this turns yellow
const BELT_SAMPLE_SECONDS = 2; // the belts are timed one by one only for the last seconds of the test
const COST_WAIT_SECONDS = 10; // how long to wait for the compressor's own timing after the test
const WORST_ROWS = 2; // compressed factories listed as "least worth it"
const BOX_SLICE_MS = 6; // time per frame spent judging the compressed factories
const COLORS = { ok: "#7ee08a", warn: "#ffd84a", bad: "#ff7070", idle: "#9aa8bc" };

////////////////////////////////////////////////////////////////////////
// Texts (English / Hebrew)

const STRINGS = {
    en: {
        ok: "Running smoothly",
        warn: "The factory is getting heavy",
        bad: "Too heavy - the game is slowing down",
        paused: "Game paused",
        load: n => "Load on the game: " + n + "%",
        buildings: n => n + " buildings",
        limit: (a, b) => "Comfortable limit: about " + a + " to " + b + " buildings (estimate)",
        room: n => "Room for about " + n + " more buildings",
        near: "You are close to the limit",
        over: n => "About " + n + " buildings over the limit - expect lag",
        speed: (tps, rate, fps) => "Game speed " + tps + "/" + rate + " - " + fps + " frames per second",
        details: (simMs, drawMs, us) =>
            "Per tick: simulation " + simMs + ", drawing " + drawMs + ", " + us + " per building",
        hint: "F8 find what slows the game (select an area first to test only it)  -  F9 details  -  F7 hide",
        hintAgain: "F8 test again  -  F10 hide result  -  F9 details  -  F7 hide",
        measuring: s => "Testing... " + s + " seconds left (the game runs a bit slower meanwhile)",
        noTicks: "The test could not run - is the game paused?",
        reportTitle: "What slows your factory the most",
        biggest: (name, pct) => "Biggest cost: " + name + " (" + pct + "% of the load)",
        colWhat: "What",
        colShare: "Share of the load",
        colCount: "Buildings",
        colWeight: "Weight each",
        rest: "Everything else",
        weightHelp: "Weight each: x2 means twice as heavy as an average building",
        beltsTitle: "Belts",
        beltsMoving: (n, p) => n + " moving - " + p + "% of belt time",
        beltsStuck: (n, p) => n + " stuck (full, waiting) - " + p + "% of belt time",
        beltsEmpty: (n, p) => n + " empty - " + p + "% of belt time",
        beltsAtBox: n => n + " of the stuck ones wait at a compressed factory",
        beltsHelp: "A stuck belt costs time and moves nothing - look at what it is waiting for",
        boxesTitle: "Compressed factories",
        boxesKinds: (live, calc) => live + " live, " + calc + " calculated",
        boxesLive: (ms, p) => "Live: " + ms + " per tick (" + p + "% of the load)",
        boxesCalc: (ms, p) => "Calculated: " + ms + " per tick (" + p + "% of the load)",
        boxesVerdict: (good, small, bad) => "Worth it: " + good + "  -  small gain: " + small + "  -  not worth it: " + bad,
        boxesWorst: "Not worth it, biggest first (position):",
        boxesWorstRow: (x, y, live, ratio) => "(" + x + ", " + y + ") " + (live ? "live" : "calculated") + " - " + (ratio >= 1.2 ? "about " + (ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)) + "x cheaper" : "costs the same as the real buildings"),
        boxesNote: "Not worth it = costs about as much as the real buildings inside",
        boxesPending: "Checking which factories are worth it ...",
        areaTitle: "Selected area",
        areaSummary: (n, pb, ms, pl) => n + " buildings (" + pb + "% of all) - about " + ms + " per tick (" + pl + "% of the load)",
        areaTop: list => "Heaviest here: " + list,
        areaNote: "Factories are measured exactly, the rest is estimated by number of buildings",
        areaTip: "Tip: select an area (Ctrl + drag) before F8 to measure only that area",
    },
    he: {
        ok: "המשחק רץ חלק",
        warn: "המפעל מתחיל להיות כבד",
        bad: "המפעל כבד מדי - המשחק מאט",
        paused: "המשחק מושהה",
        load: n => "עומס על המשחק: " + n + "%",
        buildings: n => n + " מבנים",
        limit: (a, b) => "גבול נוח: בערך " + a + " עד " + b + " מבנים (הערכה)",
        room: n => "יש מקום לעוד בערך " + n + " מבנים",
        near: "אתה קרוב לגבול",
        over: n => "בערך " + n + " מבנים מעל הגבול - צפויים עיכובים",
        speed: (tps, rate, fps) => "מהירות המשחק " + tps + "/" + rate + " - " + fps + " פריימים בשנייה",
        details: (simMs, drawMs, us) =>
            "לכל טיק: חישוב " + simMs + ", ציור " + drawMs + ", " + us + " למבנה",
        hint: "F8 מצא מה מאט את המשחק (אפשר לבחור אזור קודם)  -  F9 פרטים  -  F7 הסתר",
        hintAgain: "F8 בדוק שוב  -  F10 הסתר תוצאה  -  F9 פרטים  -  F7 הסתר הכל",
        measuring: s => "בודק... נשארו " + s + " שניות (בינתיים המשחק רץ קצת יותר לאט)",
        noTicks: "הבדיקה לא הצליחה לרוץ - אולי המשחק מושהה?",
        reportTitle: "מה מאט הכי הרבה את המפעל",
        biggest: (name, pct) => "הכי כבד: " + name + " (" + pct + "% מהעומס)",
        colWhat: "מה",
        colShare: "חלק מהעומס",
        colCount: "מבנים",
        colWeight: "כובד למבנה",
        rest: "כל השאר",
        weightHelp: "כובד למבנה: x2 אומר פי שניים כבד ממבנה ממוצע",
        beltsTitle: "מסועים",
        beltsMoving: (n, p) => n + " נעים - " + p + "% מזמן המסועים",
        beltsStuck: (n, p) => n + " תקועים (מלאים, מחכים) - " + p + "% מזמן המסועים",
        beltsEmpty: (n, p) => n + " ריקים - " + p + "% מזמן המסועים",
        beltsAtBox: n => n + " מהתקועים מחכים למפעל דחוס",
        beltsHelp: "מסוע תקוע עולה זמן ולא מזיז כלום - כדאי לבדוק למה הוא מחכה",
        boxesTitle: "מפעלים דחוסים",
        boxesKinds: (live, calc) => live + " חיים, " + calc + " מחושבים",
        boxesLive: (ms, p) => "חיים: " + ms + " לטיק (" + p + "% מהעומס)",
        boxesCalc: (ms, p) => "מחושבים: " + ms + " לטיק (" + p + "% מהעומס)",
        boxesVerdict: (good, small, bad) => "משתלמים: " + good + "  -  רווח קטן: " + small + "  -  לא משתלמים: " + bad,
        boxesWorst: "לא משתלמים, הכי כבדים קודם (מיקום):",
        boxesWorstRow: (x, y, live, ratio) => "(" + x + ", " + y + ") " + (live ? "חי" : "מחושב") + " - " + (ratio >= 1.2 ? "זול בערך פי " + (ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)) : "עולה כמו המבנים האמיתיים"),
        boxesNote: "לא משתלם = עולה בערך כמו המבנים האמיתיים שבפנים",
        boxesPending: "בודק אילו מפעלים משתלמים ...",
        areaTitle: "האזור שנבחר",
        areaSummary: (n, pb, ms, pl) => n + " מבנים (" + pb + "% מכולם) - בערך " + ms + " לטיק (" + pl + "% מהעומס)",
        areaTop: list => "הכי כבד כאן: " + list,
        areaNote: "מפעלים נמדדים במדויק, השאר מוערך לפי מספר המבנים",
        areaTip: "טיפ: בחר אזור (Ctrl + גרירה) לפני F8 כדי למדוד רק אותו",
    },
};

// Readable names for the game's system ids (unknown ids, e.g. from other mods, are shown as they are)
const SYSTEM_NAMES = {
    belt: { en: "Belts", he: "מסועים" },
    undergroundBelt: { en: "Tunnels", he: "מנהרות" },
    miner: { en: "Extractors", he: "חולצים" },
    itemProcessor: { en: "Machines (cutters, painters...)", he: "מכונות (חותכים, צובעים...)" },
    itemProcessorOverlays: { en: "Machine overlays", he: "שכבות מכונות" },
    itemEjector: { en: "Item output", he: "פליטת פריטים" },
    itemAcceptor: { en: "Item input", he: "קליטת פריטים" },
    storage: { en: "Storage", he: "אחסון" },
    filter: { en: "Filters", he: "פילטרים" },
    itemProducer: { en: "Item producers", he: "מפיקי פריטים" },
    constantProducer: { en: "Constant producers", he: "מפיקים קבועים" },
    mapResources: { en: "Map resources", he: "משאבי מפה" },
    beltReader: { en: "Belt readers", he: "קוראי מסוע" },
    beltUnderlays: { en: "Belt underlays", he: "שכבות מסוע" },
    display: { en: "Displays", he: "מסכים" },
    lever: { en: "Levers", he: "מנופים" },
    constantSignal: { en: "Constant signals", he: "אותות קבועים" },
    wire: { en: "Wires", he: "חוטים" },
    wiredPins: { en: "Wire pins", he: "פינים של חוטים" },
    logicGate: { en: "Logic gates", he: "שערים לוגיים" },
    goalAcceptor: { en: "Goal acceptors", he: "קולטי מטרה" },
    hub: { en: "Hub", he: "המרכז" },
    vaultClock: { en: "Shape Vault", he: "כספת צורות" },
    vaultInlet: { en: "Shape Vault", he: "כספת צורות" },
    vaultExtractor: { en: "Vault extractors", he: "מוציאי כספת" },
    vaultSensor: { en: "Vault sensors", he: "חיישני כספת" },
    zone: { en: "Zones", he: "אזורים" },
    factoryBox: { en: "Compressed factories", he: "מפעלים דחוסים" },
    TeleporterSystem: { en: "Teleporters", he: "טלפורטים" },
    staticMapEntities: { en: "Static map entities", he: "אלמנטים סטטיים" },
};

////////////////////////////////////////////////////////////////////////
// Counters. The only always-on cost is two performance.now() calls
// around each tick and each frame, which is a few hundred nanoseconds.

const perf = {
    ticks: 0,
    simMs: 0,
    frames: 0,
    drawMs: 0,
    tickStart: 0,
    drawStart: 0,
    reset() {
        this.ticks = 0;
        this.simMs = 0;
        this.frames = 0;
        this.drawMs = 0;
    },
};

////////////////////////////////////////////////////////////////////////
// Formatting helpers

function fmtInt(n) {
    return Math.round(n).toLocaleString("en-US");
}

function fmtMs(ms) {
    return (ms < 10 ? ms.toFixed(2) : ms.toFixed(1)) + "ms";
}

function fmtCount(n) {
    if (n >= 10000) return Math.round(n / 1000) + "k";
    return fmtInt(n);
}

// A budget estimate is only roughly right, so it is rounded to 2 significant digits
function roundEstimate(n) {
    if (n < 100) return Math.round(n);
    const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
}

// Only touches the DOM when the value really changed
function setText(el, text) {
    if (el._text !== text) {
        el._text = text;
        el.textContent = text;
    }
}

function setColor(el, color) {
    if (el._color !== color) {
        el._color = color;
        el.style.color = color;
    }
}

function setShown(el, shown, display = "block") {
    const d = shown ? display : "none";
    if (el.style.display !== d) el.style.display = d;
}

function makeDiv(parent, style = {}) {
    const el = document.createElement("div");
    Object.assign(el.style, style);
    parent.appendChild(el);
    return el;
}

// What one pair of performance.now() calls costs, to take it off each timed belt
function timerOverheadMs() {
    const n = 20000;
    const start = performance.now();
    for (let i = 0; i < n; i++) {
        const a = performance.now();
        performance.now() - a;
    }
    return (performance.now() - start) / n;
}

// The buildings the player has selected (Ctrl + drag): Multi Layer Copy keeps
// them in `selectedEntities`, the base game in `selectedUids`
function selectedEntities(root) {
    const selector = root.hud && root.hud.parts && root.hud.parts.massSelector;
    if (!selector) return [];
    if (Array.isArray(selector.selectedEntities)) {
        return selector.selectedEntities.filter(e => e && !e.destroyed && !e.queuedForDestroy);
    }
    const found = [];
    if (selector.selectedUids instanceof Set) {
        for (const uid of selector.selectedUids) {
            const entity = root.entityMgr.findByUid(uid, false);
            if (entity) found.push(entity);
        }
    }
    return found;
}

// The compressed factories system of the Factory Compressor mod, if it can be timed
function boxSystemOf(root) {
    const sys = root.systemMgr.systems.factoryBox;
    return sys && typeof sys.startCostMeasure === "function" && typeof sys.getCostReport === "function" ? sys : null;
}

////////////////////////////////////////////////////////////////////////
// HUD part - the readout in the bottom-right corner

class HUDPerfMonitor extends shapez.BaseHUDPart {
    createElements(parent) {
        this.element = document.createElement("div");
        this.element.id = "ingame_HUD_PerfMonitor";
        Object.assign(this.element.style, {
            position: "absolute",
            bottom: "8px",
            right: "8px",
            display: "none",
            flexDirection: "column",
            gap: "3px",
            width: "310px",
            padding: "8px 11px",
            background: "rgba(8, 20, 35, 0.86)",
            color: "#eef4ff",
            borderRadius: "6px",
            fontFamily: "'Segoe UI', Arial, sans-serif",
            fontSize: "13px",
            lineHeight: "1.35",
            maxHeight: "calc(100vh - 16px)",
            overflow: "hidden",
            pointerEvents: "none", // never steals clicks from the game
            zIndex: "200", // above the game canvas (100)
        });

        // Live part
        this.statusEl = makeDiv(this.element, { fontWeight: "bold", fontSize: "14px" });
        const barBg = makeDiv(this.element, {
            height: "6px",
            borderRadius: "3px",
            background: "rgba(255,255,255,0.15)",
            overflow: "hidden",
        });
        this.barEl = makeDiv(barBg, { height: "100%", width: "0%", borderRadius: "3px" });
        this.loadEl = makeDiv(this.element, { color: "#c9d6ea" });
        this.buildingsEl = makeDiv(this.element, { marginTop: "4px" });
        this.verdictEl = makeDiv(this.element, { fontWeight: "bold" });
        this.limitEl = makeDiv(this.element, { color: "#c9d6ea", fontSize: "12px" });
        this.speedEl = makeDiv(this.element, { color: "#8d9bb3", fontSize: "12px" });
        this.detailsEl = makeDiv(this.element, { color: "#8d9bb3", fontSize: "11px" });

        // Profiler result
        this.reportEl = makeDiv(this.element, {
            marginTop: "6px",
            paddingTop: "6px",
            borderTop: "1px solid rgba(255,255,255,0.2)",
            display: "none",
        });

        this.hintEl = makeDiv(this.element, { marginTop: "4px", color: "#8d9bb3", fontSize: "11px" });
        parent.appendChild(this.element);
    }

    initialize() {
        this.visible = true;
        this.details = false;
        try {
            this.visible = localStorage.getItem("perfMonitorVisible") !== "0";
            this.details = localStorage.getItem("perfMonitorDetails") === "1";
        } catch (_) {}
        let lang = "en";
        try {
            lang = String(this.root.app.settings.getLanguage() || "en");
        } catch (_) {}
        this.lang = lang.toLowerCase().startsWith("he") ? "he" : "en";
        this.S = STRINGS[this.lang];
        this.element.dir = this.lang === "he" ? "rtl" : "ltr";

        this.measure = null;
        this.report = null;
        this.reportShownFor = null;
        this.lastRefresh = 0;
        this.live = null;
        this.windowStart = performance.now();
        perf.reset();
        this.applyVisibility();
    }

    applyVisibility() {
        this.element.style.display = this.visible ? "flex" : "none";
    }

    saveFlag(key, value) {
        try {
            localStorage.setItem(key, value ? "1" : "0");
        } catch (_) {}
    }

    toggleVisible() {
        this.visible = !this.visible;
        this.saveFlag("perfMonitorVisible", this.visible);
        this.applyVisibility();
        this.lastRefresh = 0;
    }

    toggleDetails() {
        this.details = !this.details;
        this.saveFlag("perfMonitorDetails", this.details);
        this.reportShownFor = null;
        this.lastRefresh = 0;
    }

    // Dismiss only the profiler result, keeping the live readout
    hideReport() {
        if (this.measure || !this.report) return;
        this.report = null;
        this.reportShownFor = null;
        this.lastRefresh = 0;
    }

    ////////////////////////////////////////////////////////////
    // The profiler: temporarily wraps every system's update()

    startMeasure() {
        if (this.measure) return;
        if (!this.visible) this.toggleVisible();
        const mgr = this.root.systemMgr;
        const acc = {};
        const restore = [];
        for (const id of mgr.systemUpdateOrder) {
            const sys = mgr.systems[id];
            if (!sys || typeof sys.update !== "function") continue;
            const orig = sys.update;
            const hadOwn = Object.prototype.hasOwnProperty.call(sys, "update");
            acc[id] = 0;
            sys.update = function () {
                const t = performance.now();
                orig.call(this);
                acc[id] += performance.now() - t;
            };
            restore.push(() => {
                if (hadOwn) sys.update = orig;
                else delete sys.update;
            });
        }
        // The Factory Compressor times its own boxes for the same 15 seconds
        const boxSys = boxSystemOf(this.root);
        if (boxSys) boxSys.startCostMeasure();
        const area = selectedEntities(this.root);
        perf.reset();
        this.report = null;
        this.reportShownFor = null;
        this.measure = {
            startedAt: performance.now(),
            acc,
            restore,
            boxSys,
            beltSample: null,
            area: area.length > 0 ? new Set(area.map(e => e.uid)) : null,
        };
        this.lastRefresh = 0;
    }

    // Times every belt path one by one (stuck / moving / empty) for a couple of
    // seconds. Only the last seconds of the test, so the main figures stay clean.
    startBeltSample() {
        const m = this.measure;
        const proto = shapez.BeltPath && shapez.BeltPath.prototype;
        if (!proto || typeof proto.update !== "function") {
            m.beltSample = { skipped: true };
            return;
        }
        const orig = proto.update;
        const sample = {
            overhead: timerOverheadMs(),
            ticks0: perf.ticks,
            empty: { n: 0, ms: 0 },
            stuck: { n: 0, ms: 0 },
            moving: { n: 0, ms: 0 },
            atBox: 0,
        };
        proto.update = function () {
            const length = this.items.length;
            const spacing = this.spacingToFirstItem;
            const t = performance.now();
            orig.call(this);
            const dt = performance.now() - t;
            let kind;
            if (length === 0) kind = sample.empty;
            else if (this.spacingToFirstItem === spacing && this.items.length === length) {
                kind = sample.stuck;
                if (this.boundAcceptor && this.boundAcceptor.fcBox) sample.atBox++;
            } else kind = sample.moving;
            kind.n++;
            kind.ms += dt;
        };
        m.restore.push(() => {
            proto.update = orig;
        });
        m.beltSample = sample;
    }

    finishMeasure() {
        const m = this.measure;
        this.measure = null;
        for (const undo of m.restore) undo();

        const ticks = perf.ticks;
        const seconds = (performance.now() - m.startedAt) / 1000;
        this.reportShownFor = null;
        if (ticks < 10) {
            this.report = { error: true };
            perf.reset();
            return;
        }
        const mgr = this.root.systemMgr;
        const totalMs = perf.simMs / ticks;
        const buildings = this.root.entityMgr.entities.length;
        const avgPerBuilding = totalMs / Math.max(1, buildings);
        const rows = [];
        for (const id in m.acc) {
            const ms = m.acc[id] / ticks;
            const sys = mgr.systems[id];
            const count = sys && sys.allEntities ? sys.allEntities.length : null;
            const usPerBuilding = count ? (ms * 1000) / count : null;
            rows.push({
                id,
                name: SYSTEM_NAMES[id] ? SYSTEM_NAMES[id][this.lang] : id,
                ms,
                count,
                usPerBuilding,
                weight: count ? ms / count / avgPerBuilding : null,
            });
        }
        rows.sort((a, b) => b.ms - a.ms);
        this.report = { ticks, seconds, totalMs, drawMs: perf.frames ? perf.drawMs / perf.frames : 0, buildings, rows };
        this.report.belts = this.summarizeBelts(m.beltSample);
        this.report.boxes = this.summarizeBoxes(m.boxSys, ticks, seconds, totalMs);
        this.report.area = this.summarizeArea(m.area, rows, this.report.boxes, totalMs, buildings);
        try {
            console.table(
                rows.map(r => ({
                    system: r.id,
                    buildings: r.count,
                    "ms/tick": +r.ms.toFixed(3),
                    "% of tick": +((r.ms / totalMs) * 100).toFixed(1),
                    "us/building": r.usPerBuilding === null ? null : +r.usPerBuilding.toFixed(2),
                }))
            );
        } catch (_) {}
        perf.reset();
        this.windowStart = performance.now();
    }

    // Belt paths: how many were moving / stuck / empty per tick and what each kind cost
    summarizeBelts(sample) {
        if (!sample || sample.skipped) return null;
        const ticks = perf.ticks - sample.ticks0;
        if (ticks < 5) return null;
        const kinds = {};
        let total = 0;
        for (const name of ["moving", "stuck", "empty"]) {
            const k = sample[name];
            const ms = Math.max(0, k.ms - k.n * sample.overhead) / ticks;
            kinds[name] = { perTick: k.n / ticks, ms };
            total += ms;
        }
        for (const name in kinds) kinds[name].share = total > 0 ? kinds[name].ms / total : 0;
        return { kinds, atBox: sample.atBox / ticks };
    }

    // Compressed factories: live / calculated, what each kind costs, and (judged a few
    // per frame afterwards, it reads every factory's contents) which are not worth it
    summarizeBoxes(sys, ticks, seconds, totalMs) {
        if (!sys || sys.costRun || !sys.costResult) return null;
        const boxes = { live: { n: 0, ms: 0 }, calc: { n: 0, ms: 0 }, byUid: new Map(), verdicts: null, queue: [], worst: [] };
        for (const entity of sys.allEntities) {
            const comp = entity.components.FactoryBox;
            const kind = comp.sim ? boxes.live : boxes.calc;
            const ms = ((comp.costRate || 0) * seconds) / ticks;
            kind.n++;
            kind.ms += ms;
            boxes.byUid.set(entity.uid, ms);
            boxes.queue.push(entity);
        }
        boxes.sys = sys;
        boxes.total = totalMs;
        boxes.verdicts = { good: 0, small: 0, bad: 0 };
        boxes.pending = boxes.queue.length > 0;
        return boxes;
    }

    // The area the player had selected: factories exactly, the rest by number of buildings
    summarizeArea(selected, rows, boxes, totalMs, buildings) {
        if (!selected || selected.size === 0) return null;
        const mgr = this.root.systemMgr;
        const parts = [];
        let areaMs = 0;
        let inArea = 0;
        for (const row of rows) {
            const sys = mgr.systems[row.id];
            if (!sys || !sys.allEntities || sys.allEntities.length === 0) continue;
            let ms = 0;
            if (row.id === "factoryBox" && boxes) {
                for (const entity of sys.allEntities) if (selected.has(entity.uid)) ms += boxes.byUid.get(entity.uid) || 0;
            } else {
                let count = 0;
                for (const entity of sys.allEntities) if (selected.has(entity.uid)) count++;
                ms = (row.ms * count) / sys.allEntities.length;
            }
            if (ms > 0) parts.push({ name: row.name, ms });
            areaMs += ms;
        }
        for (const uid of selected) if (this.root.entityMgr.findByUid(uid, false)) inArea++;
        parts.sort((a, b) => b.ms - a.ms);
        return { buildings: inArea, share: inArea / Math.max(1, buildings), ms: areaMs, load: totalMs > 0 ? areaMs / totalMs : 0, parts };
    }

    // Judges a few compressed factories each frame until all are done
    judgeBoxes() {
        const boxes = this.report && this.report.boxes;
        if (!boxes || !boxes.pending) return;
        const start = performance.now();
        while (boxes.queue.length > 0 && performance.now() - start < BOX_SLICE_MS) {
            const entity = boxes.queue.pop();
            if (entity.destroyed) continue;
            const cost = boxes.sys.getCostReport(entity);
            if (!cost.ready) continue;
            boxes.verdicts[cost.verdict]++;
            if (cost.verdict === "bad") {
                const origin = entity.components.StaticMapEntity.origin;
                boxes.worst.push({ x: origin.x, y: origin.y, live: !!entity.components.FactoryBox.sim, ratio: cost.ratio, ms: cost.boxMs });
            }
        }
        if (boxes.queue.length === 0) {
            boxes.pending = false;
            boxes.worst.sort((a, b) => b.ms - a.ms);
        }
        this.reportShownFor = null; // redraw with what is known
    }

    ////////////////////////////////////////////////////////////
    // Per-frame hook (throttled to once a second)

    update() {
        if (!this.element || !this.root || !this.root.entityMgr) return;
        const now = performance.now();

        if (this.measure) {
            const elapsed = now - this.measure.startedAt;
            if (!this.measure.beltSample && elapsed >= (MEASURE_SECONDS - BELT_SAMPLE_SECONDS) * 1000) this.startBeltSample();
            // The Factory Compressor finishes its timing inside a game tick: wait for it
            const boxSys = this.measure.boxSys;
            const waiting = boxSys && boxSys.costRun && elapsed < (MEASURE_SECONDS + COST_WAIT_SECONDS) * 1000;
            if (elapsed >= MEASURE_SECONDS * 1000 && !waiting) this.finishMeasure();
        }
        this.judgeBoxes();
        if (!this.visible) return;
        if (now - this.lastRefresh < REFRESH_MS) return;
        this.lastRefresh = now;

        // Per-second figures from the counters, then restart the window
        const elapsed = (now - this.windowStart) / 1000;
        if (!this.measure && elapsed > 0.5) {
            const buildings = this.root.entityMgr.entities.length;
            this.live = {
                tps: perf.ticks / elapsed,
                paused: this.root.time.getIsPaused(),
                fps: this.root.dynamicTickrate.averageFps,
                simMs: perf.ticks ? perf.simMs / perf.ticks : this.live ? this.live.simMs : 0,
                drawMs: perf.frames ? perf.drawMs / perf.frames : this.live ? this.live.drawMs : 0,
                buildings,
            };
            perf.reset();
            this.windowStart = now;
        }

        this.renderLive();
        this.renderReport();
    }

    renderLive() {
        const S = this.S;
        const l = this.live;
        const rate = this.root.dynamicTickrate.currentTickRate || 60;
        const budgetMs = 1000 / rate;

        if (this.measure) {
            const left = Math.max(
                0,
                Math.ceil(MEASURE_SECONDS - (performance.now() - this.measure.startedAt) / 1000)
            );
            setText(this.statusEl, S.measuring(left));
            setColor(this.statusEl, COLORS.warn);
            this.statusEl.style.fontSize = "13px";
            for (const el of [this.loadEl, this.buildingsEl, this.verdictEl, this.limitEl, this.speedEl, this.detailsEl])
                setShown(el, false);
            this.barEl.style.width = "0%";
            setText(this.hintEl, "");
            return;
        }
        this.statusEl.style.fontSize = "14px";
        if (!l) return;

        // Overall state
        const load = l.simMs / budgetMs;
        const state = l.paused ? "idle" : load > 1 ? "bad" : load > LOAD_WARN ? "warn" : "ok";
        setText(this.statusEl, l.paused ? S.paused : S[state]);
        setColor(this.statusEl, COLORS[state]);
        this.barEl.style.width = Math.min(100, Math.round(load * 100)) + "%";
        this.barEl.style.background = COLORS[state];
        setShown(this.loadEl, true);
        setText(this.loadEl, S.load(Math.round(load * 100)));

        // Building budget: what fits in a tick at the cost per building measured right now
        setShown(this.buildingsEl, true);
        setText(this.buildingsEl, S.buildings(fmtInt(l.buildings)));
        const enough = l.buildings >= MIN_BUILDINGS && l.simMs > 0;
        setShown(this.verdictEl, enough);
        setShown(this.limitEl, enough);
        let perBuilding = 0;
        if (enough) {
            perBuilding = l.simMs / l.buildings;
            const high = roundEstimate(budgetMs / perBuilding);
            const low = roundEstimate(Math.max(0, budgetMs - (l.drawMs * l.fps) / rate) / perBuilding);
            setText(this.limitEl, S.limit(fmtCount(low), fmtCount(high)));
            if (l.buildings <= low * 0.9) {
                setText(this.verdictEl, S.room(fmtCount(roundEstimate(low - l.buildings))));
                setColor(this.verdictEl, COLORS.ok);
            } else if (l.buildings <= high * 1.05) {
                setText(this.verdictEl, S.near);
                setColor(this.verdictEl, COLORS.warn);
            } else {
                setText(this.verdictEl, S.over(fmtCount(roundEstimate(l.buildings - high))));
                setColor(this.verdictEl, COLORS.bad);
            }
        }

        setShown(this.speedEl, true);
        setText(this.speedEl, S.speed(l.tps.toFixed(0), rate, l.fps.toFixed(0)));
        setShown(this.detailsEl, this.details);
        if (this.details) {
            setText(this.detailsEl, S.details(fmtMs(l.simMs), fmtMs(l.drawMs), (perBuilding * 1000).toFixed(2) + "us"));
        }
        setText(this.hintEl, this.report ? S.hintAgain : S.hint);
    }

    renderReport() {
        const r = this.report;
        if (this.reportShownFor === r && r !== null) return;
        this.reportShownFor = r;
        const S = this.S;
        this.reportEl.textContent = "";
        setShown(this.reportEl, !!r);
        if (!r) return;
        if (r.error) {
            makeDiv(this.reportEl, { color: COLORS.warn }).textContent = S.noTicks;
            return;
        }

        makeDiv(this.reportEl, { fontWeight: "bold", marginBottom: "2px" }).textContent = S.reportTitle;
        const top = r.rows[0];
        if (top) {
            makeDiv(this.reportEl, { color: COLORS.warn, marginBottom: "4px" }).textContent = S.biggest(
                top.name,
                Math.round((top.ms / r.totalMs) * 100)
            );
        }

        const grid = makeDiv(this.reportEl, {
            display: "grid",
            gridTemplateColumns: "1fr 82px 52px 52px",
            columnGap: "6px",
            rowGap: "2px",
            alignItems: "center",
            fontSize: "12px",
        });
        const cell = (text, style = {}) => {
            const el = makeDiv(grid, style);
            el.textContent = text;
            return el;
        };
        const head = { color: "#8d9bb3", fontSize: "11px" };
        cell(S.colWhat, head);
        cell(S.colShare, head);
        cell(S.colCount, { ...head, textAlign: "end" });
        cell(S.colWeight, { ...head, textAlign: "end" });

        let shownMs = 0;
        const hasSections = !!(r.belts || r.boxes || r.area);
        for (const row of r.rows.slice(0, hasSections && !this.details ? REPORT_ROWS_SHORT : REPORT_ROWS)) {
            shownMs += row.ms;
            const pct = Math.round((row.ms / r.totalMs) * 100);
            cell(row.name, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
            const share = makeDiv(grid, { display: "flex", alignItems: "center", gap: "4px" });
            const bg = makeDiv(share, {
                flex: "1",
                height: "6px",
                background: "rgba(255,255,255,0.15)",
                borderRadius: "3px",
                overflow: "hidden",
            });
            makeDiv(bg, {
                height: "100%",
                width: Math.min(100, pct) + "%",
                background: pct >= 30 ? COLORS.bad : pct >= 12 ? COLORS.warn : COLORS.ok,
            });
            const pctEl = makeDiv(share, { minWidth: "28px", textAlign: "end" });
            pctEl.textContent = pct + "%";
            cell(row.count === null ? "-" : fmtCount(row.count), { textAlign: "end" });
            cell(row.weight === null ? "-" : "x" + (row.weight >= 10 ? row.weight.toFixed(0) : row.weight.toFixed(1)), {
                textAlign: "end",
            });
        }

        const restPct = Math.max(0, Math.round(((r.totalMs - shownMs) / r.totalMs) * 100));
        cell(S.rest, { color: "#8d9bb3" });
        cell(restPct + "%", { color: "#8d9bb3" });
        cell("");
        cell("");

        if (this.details) {
            makeDiv(this.reportEl, { color: "#8d9bb3", fontSize: "11px", marginTop: "4px" }).textContent = S.weightHelp;
            makeDiv(this.reportEl, { color: "#8d9bb3", fontSize: "11px" }).textContent =
                r.ticks + " ticks / " + r.seconds.toFixed(0) + "s - tick " + fmtMs(r.totalMs) + ", draw " + fmtMs(r.drawMs);
        }
        this.renderSections(r);
    }

    // Belts, compressed factories and the selected area, under the main table
    renderSections(r) {
        const S = this.S;
        const pct = x => (x < 0.005 ? (this.lang === "he" ? "פחות מ-1" : "<1") : Math.round(x * 100));
        const title = text => {
            makeDiv(this.reportEl, { fontWeight: "bold", marginTop: "8px", marginBottom: "2px" }).textContent = text;
        };
        const line = (text, color = "#c9d6ea", size = "12px") => {
            makeDiv(this.reportEl, { color, fontSize: size }).textContent = text;
        };

        if (r.belts) {
            const k = r.belts.kinds;
            title(S.beltsTitle);
            line(S.beltsMoving(fmtInt(k.moving.perTick), pct(k.moving.share)));
            line(S.beltsStuck(fmtInt(k.stuck.perTick), pct(k.stuck.share)), k.stuck.share >= 0.25 ? COLORS.warn : "#c9d6ea");
            if (r.belts.atBox >= 1) line(S.beltsAtBox(fmtInt(r.belts.atBox)), "#8d9bb3", "11px");
            line(S.beltsEmpty(fmtInt(k.empty.perTick), pct(k.empty.share)));
            if (this.details) line(S.beltsHelp, "#8d9bb3", "11px");
        }

        const b = r.boxes;
        if (b) {
            title(S.boxesTitle);
            line(S.boxesKinds(fmtInt(b.live.n), fmtInt(b.calc.n)));
            if (b.live.n > 0) line(S.boxesLive(fmtMs(b.live.ms), pct(b.live.ms / r.totalMs)));
            if (b.calc.n > 0) line(S.boxesCalc(fmtMs(b.calc.ms), pct(b.calc.ms / r.totalMs)));
            if (b.pending) {
                line(S.boxesPending, "#8d9bb3", "11px");
            } else {
                const v = b.verdicts;
                line(S.boxesVerdict(fmtInt(v.good), fmtInt(v.small), fmtInt(v.bad)), v.bad > 0 ? COLORS.warn : COLORS.ok);
                if (v.bad > 0) {
                    line(S.boxesWorst, "#8d9bb3", "11px");
                    for (const w of b.worst.slice(0, this.details ? 8 : WORST_ROWS)) {
                        line(S.boxesWorstRow(w.x, w.y, w.live, w.ratio), "#c9d6ea", "11px");
                    }
                    if (this.details) line(S.boxesNote, "#8d9bb3", "11px");
                }
            }
        }

        const a = r.area;
        if (a) {
            title(S.areaTitle);
            line(S.areaSummary(fmtInt(a.buildings), pct(a.share), fmtMs(a.ms), pct(a.load)));
            const top = a.parts
                .slice(0, 3)
                .map(part => part.name + " " + pct(part.ms / Math.max(1e-9, a.ms)) + "%")
                .join(", ");
            if (top) line(S.areaTop(top), "#c9d6ea", "11px");
            if (this.details) line(S.areaNote, "#8d9bb3", "11px");
        } else if (this.details) {
            makeDiv(this.reportEl, { color: "#8d9bb3", fontSize: "11px", marginTop: "6px" }).textContent = S.areaTip;
        }
    }
}

////////////////////////////////////////////////////////////////////////
// Mod entry point

class Mod extends shapez.Mod {
    init() {
        this.modInterface.registerHudElement("perfMonitor", HUDPerfMonitor);

        // Time every logic tick and every frame (two timer reads each)
        this.modInterface.runBeforeMethod(shapez.GameCore, "updateLogic", function () {
            perf.tickStart = performance.now();
        });
        this.modInterface.runAfterMethod(shapez.GameCore, "updateLogic", function () {
            perf.simMs += performance.now() - perf.tickStart;
            ++perf.ticks;
        });
        this.modInterface.runBeforeMethod(shapez.GameCore, "draw", function () {
            perf.drawStart = performance.now();
        });
        this.modInterface.runAfterMethod(shapez.GameCore, "draw", function () {
            perf.drawMs += performance.now() - perf.drawStart;
            ++perf.frames;
        });

        const bind = (id, keyCode, translation, action) =>
            this.modInterface.registerIngameKeybinding({
                id,
                keyCode,
                translation,
                handler: root => {
                    const hud = root.hud.parts.perfMonitor;
                    if (hud) action(hud);
                    return shapez.STOP_PROPAGATION;
                },
            });
        bind("perf_monitor_toggle", 118, "Show / hide the performance monitor", hud => hud.toggleVisible()); // F7
        bind("perf_monitor_profile", 119, "Find what slows the game down (15s test)", hud => hud.startMeasure()); // F8
        bind("perf_monitor_details", 120, "Performance monitor: technical details", hud => hud.toggleDetails()); // F9
        bind("perf_monitor_hide_report", 121, "Performance monitor: hide the test result", hud => hud.hideReport()); // F10
    }
}
