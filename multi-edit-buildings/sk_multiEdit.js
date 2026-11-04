// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/multi-edit-buildings",
    author: "Star",
    name: "Multi-Edit Buildings",
    version: "1.3.0",
    id: "sk-multi-edit",
    description:
        "Select buildings with the normal mass-selector (Ctrl+drag), then edit their values by building type all at once. Also edits Hub Extractors and Vault Extractors (Count / Shape / Overflow variants). Seq Fill for Signal Generators only uses shapes/colors registered in the game and lets you pick shapes, colors, quadrant pattern, order, start, repeat or a custom list.",
    minimumGameVersion: ">=1.5.0",
};

// ─── Signal-code helpers (used by the Constant Signal entry) ─────────────────

function _signalToCode(signal) {
    if (!signal) return "";
    const type = signal.getItemType ? signal.getItemType() : "";
    if (type === "color")   return signal.color || "";
    if (type === "boolean") return signal.value ? "1" : "0";
    if (type === "shape" && signal.definition) {
        return signal.definition.getHash
            ? signal.definition.getHash()
            : (signal.definition.getShortKey ? signal.definition.getShortKey() : "");
    }
    return "";
}

function _parseSignalCode(root, code) {
    if (!code) return null;
    if (code === "1" || code === "true")  return shapez.BOOL_TRUE_SINGLETON;
    if (code === "0" || code === "false") return shapez.BOOL_FALSE_SINGLETON;
    const colorItem = shapez.COLOR_ITEM_SINGLETONS[code];
    if (colorItem) return colorItem;
    try {
        const def = shapez.ShapeDefinition.fromShortKey(code);
        if (def) return root.shapeDefinitionMgr.getShapeItemFromDefinition(def);
    } catch (e) {}
    return null;
}

// ─── Signal sequence helpers ──────────────────────────────────────────────────
// Shape/color codes are read from the game at runtime, so only shapes and
// colors that are actually registered (vanilla + loaded mods) are offered.

// Preferred display order; anything extra a mod registers is appended.
const SEQ_SHAPE_ORDER = "RCSW";
const SEQ_COLOR_ORDER = "urgbypcw";

function _orderedCodes(preferred, available) {
    const avail = Array.from(new Set(available));
    return [
        ...preferred.split("").filter(c => avail.includes(c)),
        ...avail.filter(c => !preferred.includes(c)),
    ];
}
function availableShapeCodes() {
    return _orderedCodes(SEQ_SHAPE_ORDER, Object.values(shapez.enumSubShapeToShortcode || {}));
}
function availableColorCodes() {
    return _orderedCodes(SEQ_COLOR_ORDER, Object.values(shapez.enumColorToShortcode || {}));
}

/** "R C,S" → ["R","C","S"]; returns null if any code is unknown. */
function _parseCodeList(raw, available) {
    const codes = raw.replace(/[\s,]+/g, "").split("");
    if (codes.length === 0 || codes.some(c => !available.includes(c))) return null;
    return codes;
}

/** Pattern: 4 chars, '#' = quadrant filled by the sequence, '-' = empty. */
function _isValidPattern(p) {
    return /^[#-]{4}$/.test(p) && p.includes("#");
}
function fillToPattern(fill) {
    return "#".repeat(fill) + "-".repeat(4 - fill);
}

/**
 * @param {{shapes:string[], colors:string[], pattern:string, colorsFirst:boolean}} opts
 * e.g. shapes R,C · colors u,r · pattern "#---" → [Ru------, Cu------, Rr------, Cr------]
 */
function buildSignalSequence({ shapes, colors, pattern, colorsFirst }) {
    const items = [];
    if (colorsFirst) {
        for (const shp of shapes) for (const col of colors) items.push(shp + col);
    } else {
        for (const col of colors) for (const shp of shapes) items.push(shp + col);
    }
    return items.map(q => pattern.split("").map(c => (c === "#" ? q : "--")).join(""));
}

// ─── Registry of editable building component types ───────────────────────────
//
// To support another modded building, append an entry here.
//
// Fields:
//   componentId   – key in entity.components  (e.g. "CustomStorage")
//   key           – (optional) unique id of the entry; defaults to componentId. Needed when
//                   one component has several variants that are edited differently.
//   match         – (optional) function(component) => boolean, picks the variant of the component
//   buildingLabel – human-readable name in the panel
//   dialogTitle   – function(count) => string
//   dialogDesc    – string below the dialog title
//   formElements  – function() => FormElementInput[]   (created fresh each time)
//   applyValues   – function(entity, formElements[])   (writes the new values)
//
const MULTI_EDIT_TYPES = [

    // ── Custom Storage (sk_bldCustomStorage+.js) ─────────────────────────────
    {
        componentId:  "CustomStorage",
        buildingLabel: "Custom Storage",
        dialogTitle: count =>
            `Edit Storage Limit  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Leave the field empty to set infinity (∞), or enter a number from 1 to 99999.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_storage",
                placeholder:  "Empty = ∞  |  1 – 99999",
                defaultValue: "",
                validator:    val =>
                    val.trim() === "" ||
                    (parseInt(val) > 0 && parseInt(val) <= 99999),
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.CustomStorage;
            if (!comp) return;
            const raw = formEls[0].getValue().trim();
            if (raw === "") {
                comp.CustomStorageText = "∞";
                comp._cachedValue      = Number.MAX_SAFE_INTEGER;
            } else {
                comp.CustomStorageText = raw;
                comp._cachedValue      = parseInt(raw);
            }
            if (entity.components.Storage) {
                entity.components.Storage.maximumStorage = comp._cachedValue;
            }
        },
    },

    // ── Transceiver (pnmod-transceiver) ──────────────────────────────────────
    {
        componentId:  "TransceiverComponent",
        buildingLabel: "Transceiver",
        dialogTitle: count =>
            `Edit Transceiver Channels  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Find & Replace: type text in 'Find' and it will be swapped for 'Replace with' in every selected channel. " +
            "Leave 'Find' blank to set all channels to the same value.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_tc_find",
                placeholder:  "Find  (blank = replace whole channel)",
                defaultValue: "",
                validator:    () => true,
            }),
            new shapez.FormElementInput({
                id:           "sk_me_tc_replace",
                placeholder:  "Replace with",
                defaultValue: "",
                validator:    () => true,
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.TransceiverComponent;
            if (!comp) return;
            const find    = formEls[0].getValue();
            const replace = formEls[1].getValue();
            if (find === "") {
                comp.channel = replace;
            } else {
                comp.channel = comp.channel.split(find).join(replace);
            }
        },
    },

    // ── Teleporter – Input (teleporter.js) ───────────────────────────────────
    {
        componentId:  "InputTeleporterComponent",
        buildingLabel: "Teleporter (Input)",
        dialogTitle: count =>
            `Edit Teleporter Input Channels  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Find & Replace: text in 'Find' is swapped for 'Replace with' in every selected channel. " +
            "Leave 'Find' blank to overwrite all channels with the same value.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_tpin_find",
                placeholder:  "Find  (blank = replace whole channel)",
                defaultValue: "",
                validator:    () => true,
            }),
            new shapez.FormElementInput({
                id:           "sk_me_tpin_replace",
                placeholder:  "Replace with",
                defaultValue: "",
                validator:    () => true,
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.InputTeleporterComponent;
            if (!comp) return;
            const find    = formEls[0].getValue();
            const replace = formEls[1].getValue();
            comp.channel  = find === "" ? replace : comp.channel.split(find).join(replace);
        },
    },

    // ── Teleporter – Output (teleporter.js) ──────────────────────────────────
    {
        componentId:  "OutputTeleporterComponent",
        buildingLabel: "Teleporter (Output)",
        dialogTitle: count =>
            `Edit Teleporter Output Channels  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Find & Replace: text in 'Find' is swapped for 'Replace with' in every selected channel. " +
            "Leave 'Find' blank to overwrite all channels with the same value.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_tpout_find",
                placeholder:  "Find  (blank = replace whole channel)",
                defaultValue: "",
                validator:    () => true,
            }),
            new shapez.FormElementInput({
                id:           "sk_me_tpout_replace",
                placeholder:  "Replace with",
                defaultValue: "",
                validator:    () => true,
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.OutputTeleporterComponent;
            if (!comp) return;
            const find    = formEls[0].getValue();
            const replace = formEls[1].getValue();
            comp.channel  = find === "" ? replace : comp.channel.split(find).join(replace);
        },
    },

    // ── Note Building (sk_bldNote.js) ────────────────────────────────────────
    {
        componentId:  "SkNote",
        buildingLabel: "Note Building",
        dialogTitle: count =>
            `Edit Note Text  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Leave a field blank to keep each building's current value. " +
            "Use // for line breaks.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_note_text",
                placeholder:  "Note text  (blank = keep current)",
                defaultValue: "",
                validator:    () => true,
            }),
            new shapez.FormElementInput({
                id:           "sk_me_note_size",
                placeholder:  "Font size 4–35  (blank = keep current)",
                defaultValue: "",
                validator:    val =>
                    val.trim() === "" ||
                    (parseInt(val) >= 4 && parseInt(val) <= 35),
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.SkNote;
            if (!comp) return;
            const text    = formEls[0].getValue();
            const sizeRaw = formEls[1].getValue().trim();
            if (text    !== "") comp.NoteText     = text;
            if (sizeRaw !== "") comp.NoteFontSize = parseInt(sizeRaw);
        },
    },

    // ── Constant Signal / Signal Generator (vanilla) ─────────────────────────
    {
        componentId:  "ConstantSignal",
        buildingLabel: "Signal Generator",
        dialogTitle: count =>
            `Edit Signal Values  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Find & Replace works on the signal's text code. " +
            "Leave 'Find' blank to overwrite all signals with the Replace value. " +
            "With 'Find' set, only the matched substring is swapped (e.g. Find: u  Replace: R  turns CuCuCuCu → CRCRCRCR). " +
            "Colors: red, green, blue, yellow, purple, cyan, white, uncolored.  Boolean: 1 / 0.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_sig_find",
                placeholder:  "Find  (blank = overwrite all)",
                defaultValue: "",
                validator:    () => true,
            }),
            new shapez.FormElementInput({
                id:           "sk_me_sig_replace",
                placeholder:  "Replace with",
                defaultValue: "",
                validator:    val => val.length > 0,
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.ConstantSignal;
            if (!comp) return;
            const find    = formEls[0].getValue();
            const replace = formEls[1].getValue();
            if (!replace) return;

            const currentCode = _signalToCode(comp.signal);
            let newCode;
            if (find === "") {
                newCode = replace;
            } else {
                if (!currentCode.includes(find)) return;
                newCode = currentCode.split(find).join(replace);
            }

            const newSignal = _parseSignalCode(entity.root, newCode);
            if (!newSignal) return;
            comp.signal = newSignal;
        },
    },

    // ── Hub Extractor – Count (HubExtractor mod) ─────────────────────────────
    {
        componentId:  "HubExtraction",
        key:          "HubExtraction_count",
        match:        comp => comp.singles,
        buildingLabel: "Hub Extractor (Count)",
        dialogTitle: count =>
            `Edit Hub Extractors (Count)  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Leave a field blank to keep each extractor's current value.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_hubc_amount",
                label:        "Amount (N)",
                placeholder:  "1, 2, 3 ...  (blank = keep current)",
                defaultValue: "",
                validator:    val => val.trim() === "" || (/^\d+$/.test(val.trim()) && parseInt(val) >= 1),
            }),
            new shapez.FormElementInput({
                id:           "sk_me_hubc_fewer",
                label:        "Also shapes with fewer than N",
                placeholder:  "yes / no  (blank = keep current)",
                defaultValue: "",
                validator:    val => /^(|y|yes|n|no)$/i.test(val.trim()),
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.HubExtraction;
            if (!comp) return;
            const amount = formEls[0].getValue().trim();
            const fewer  = formEls[1].getValue().trim().toLowerCase();
            if (amount !== "") comp.targetCount = parseInt(amount);
            if (fewer  !== "") comp.orFewer     = fewer[0] === "y";
            comp.resetScan();
        },
    },

    // ── Hub Extractor – Shape (HubExtractor mod) ─────────────────────────────
    {
        componentId:  "HubExtraction",
        key:          "HubExtraction_fixed",
        match:        comp => comp.fixed,
        buildingLabel: "Hub Extractor (Shape)",
        dialogTitle: count =>
            `Edit Hub Extractors (Shape)  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Sets the shape every selected extractor ejects.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_hubs_shape",
                label:        "Shape code:",
                placeholder:  "CuCuCuCu",
                defaultValue: "",
                validator:    val => shapez.ShapeDefinition.isValidShortKey(val.trim()),
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.HubExtraction;
            if (!comp) return;
            comp.setKey(formEls[0].getValue().trim());
        },
    },

    // ── Vault Extractor – Overflow (shape_vault.js) ──────────────────────────
    {
        componentId:  "VaultExtraction",
        key:          "VaultExtraction_overflow",
        match:        comp => comp.overflow,
        buildingLabel: "Vault Overflow Extractor",
        dialogTitle: count =>
            `Edit Vault Overflow Extractors  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Sets how much of each shape stays in the Vault; everything above it is ejected.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_vaulto_keep",
                label:        "Amount to keep",
                placeholder:  "100, 1000 ...",
                defaultValue: "",
                validator:    val => /^\d+$/.test(val.trim()) && parseInt(val, 10) <= 2000000000,
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.VaultExtraction;
            if (!comp) return;
            comp.keep = parseInt(formEls[0].getValue().trim(), 10);
            comp.resetScan();
        },
    },

    // ── Vault Extractor – Shape (shape_vault.js) ─────────────────────────────
    {
        componentId:  "VaultExtraction",
        key:          "VaultExtraction_fixed",
        match:        comp => comp.fixed,
        buildingLabel: "Vault Shape Extractor",
        dialogTitle: count =>
            `Edit Vault Shape Extractors  (${count} building${count !== 1 ? "s" : ""})`,
        dialogDesc:
            "Sets the shape (or color code) every selected extractor ejects from the Vault.",
        formElements: () => [
            new shapez.FormElementInput({
                id:           "sk_me_vaults_shape",
                label:        "Shape code:",
                placeholder:  "CuCuCuCu",
                defaultValue: "",
                validator:    val => !!_vaultKey(val),
            }),
        ],
        applyValues(entity, formEls) {
            const comp = entity.components.VaultExtraction;
            if (!comp) return;
            comp.setKey(_vaultKey(formEls[0].getValue()));
            comp.resetScan();
        },
    },
];

/**
 * Same key rules as the Vault mod: a shape code, or a color (full name or its one-letter code,
 * which is stored as the full name). Returns "" if the text is not valid.
 */
function _vaultKey(text) {
    const key = text.trim();
    const color = (key.length === 1 && shapez.enumShortcodeToColor[key]) || key;
    if (shapez.COLOR_ITEM_SINGLETONS.hasOwnProperty(color)) return color;
    return shapez.ShapeDefinition.isValidShortKey(key) ? key : "";
}

const _typeKey = typeDef => typeDef.key || typeDef.componentId;

// ─── Helper: read selected UIDs from whatever mass-selector is active ─────────
// Supports both the vanilla HUDMassSelector (selectedUids Set)
// and the multilayercopy mod (selectedEntities Array).
function getMassSelectorUids(massSelector) {
    if (!massSelector) return [];

    // multilayercopy mod
    if (Array.isArray(massSelector.selectedEntities)) {
        return massSelector.selectedEntities
            .filter(e => e && !e.destroyed)
            .map(e => e.uid);
    }
    // vanilla
    if (massSelector.selectedUids instanceof Set) {
        return Array.from(massSelector.selectedUids);
    }
    return [];
}

// ─── HUD Part ─────────────────────────────────────────────────────────────────
class HUDSkMultiEdit extends shapez.BaseHUDPart {

    // ── Lifecycle ────────────────────────────────────────────────────────────

    createElements(parent) {
        this.panel = document.createElement("div");
        this.panel.id = "sk-multi-edit-panel";
        Object.assign(this.panel.style, {
            position:      "fixed",
            bottom:        "74px",
            left:          "50%",
            transform:     "translateX(-50%)",
            background:    "rgba(18, 18, 28, 0.94)",
            border:        "1px solid rgba(255,255,255,0.15)",
            borderRadius:  "10px",
            padding:       "10px 14px 8px",
            color:         "#e8e8e8",
            fontFamily:    "'GameFont', 'Roboto Condensed', sans-serif",
            fontSize:      "13px",
            zIndex:        "2000",
            display:       "none",
            minWidth:      "280px",
            maxWidth:      "540px",
            userSelect:    "none",
            boxShadow:     "0 4px 22px rgba(0,0,0,0.55)",
            pointerEvents: "auto",
            lineHeight:    "1.5",
        });
        document.body.appendChild(this.panel);
    }

    initialize() {
        this._lastKnownSize = -1;
        this._seqDir  = 'R';
        // Last-used Seq Fill settings (remembered between dialogs).
        // shapes/colors of null = "all available" (resolved when the dialog opens).
        this._seq = {
            shapes:      null,
            colors:      null,
            pattern:     fillToPattern(4),
            colorsFirst: false,
            start:       1,
            repeat:      1,
            custom:      "",
        };
    }

    // ── Per-frame update ─────────────────────────────────────────────────────

    update() {
        const massSelector = this.root.hud.parts.massSelector;
        const uids         = getMassSelectorUids(massSelector);
        const size         = uids.length;

        // Only rebuild the panel when the selection size changes.
        // (Rebuilding on every pixel-drag would be wasteful.)
        if (size === this._lastKnownSize) return;
        this._lastKnownSize = size;

        this._refreshPanel(uids);
    }

    // ── Panel ────────────────────────────────────────────────────────────────

    /** @param {number[]} uids */
    _refreshPanel(uids) {
        if (uids.length === 0) {
            this.panel.style.display = "none";
            return;
        }

        // Group uids by the first matching editable component type
        const typeGroups = new Map(); // type key → uid[]

        for (const uid of uids) {
            const entity = this.root.entityMgr.findByUid(uid, false);
            if (!entity || entity.destroyed) continue;

            for (const typeDef of MULTI_EDIT_TYPES) {
                const comp = entity.components[typeDef.componentId];
                if (comp && (!typeDef.match || typeDef.match(comp))) {
                    const key = _typeKey(typeDef);
                    if (!typeGroups.has(key)) {
                        typeGroups.set(key, []);
                    }
                    typeGroups.get(key).push(uid);
                    break;
                }
            }
        }

        // If none of the selected buildings have editable values, hide the panel
        if (typeGroups.size === 0) {
            this.panel.style.display = "none";
            return;
        }

        // ── Build HTML ────────────────────────────────────────────────────
        const BTN =
            "background:#2d6ecf;border:none;border-radius:5px;color:#fff;" +
            "padding:2px 12px;cursor:pointer;font-size:12px;font-family:inherit;";
        const BTN_SEQ =
            "background:#1a6b44;border:none;border-radius:5px;color:#fff;" +
            "padding:2px 8px;cursor:pointer;font-size:12px;font-family:inherit;margin-right:4px;";

        let html =
            `<div style="font-weight:bold;margin-bottom:7px;">` +
            `Multi-Edit` +
            `<span style="font-size:11px;font-weight:normal;opacity:0.55;margin-left:8px;">` +
            `edit selected buildings by type</span></div>`;

        const DIR_BTN =
            "border:none;border-radius:4px;color:#fff;padding:1px 7px;" +
            "cursor:pointer;font-size:11px;font-family:inherit;margin:0 2px;";

        html += `<table style="width:100%;border-collapse:collapse;">`;
        for (const [componentId, groupUids] of typeGroups) {
            const typeDef = MULTI_EDIT_TYPES.find(t => _typeKey(t) === componentId);
            const seqBtn  = componentId === "ConstantSignal"
                ? `<button data-seq="${componentId}" style="${BTN_SEQ}">Seq Fill</button>`
                : "";
            html +=
                `<tr>` +
                `<td style="padding:3px 6px;">${typeDef.buildingLabel}</td>` +
                `<td style="padding:3px 6px;opacity:0.55;">${groupUids.length}×</td>` +
                `<td style="padding:3px 6px;text-align:right;">` +
                seqBtn +
                `<button data-type="${componentId}" style="${BTN}">Edit all</button>` +
                `</td></tr>`;
            if (componentId === "ConstantSignal") {
                const dirBtns = [
                    {d:'L', label:'← L'},
                    {d:'R', label:'R →'},
                    {d:'U', label:'↑ U'},
                    {d:'D', label:'↓ D'},
                ].map(({d, label}) =>
                    `<button data-dir="${d}" style="${DIR_BTN}background:${this._seqDir === d ? '#2d6ecf' : '#3a3a4a'};">${label}</button>`
                ).join('');
                const fillBtns = [1, 2, 3, 4].map(f =>
                    `<button data-fill="${f}" style="${DIR_BTN}background:${this._seq.pattern === fillToPattern(f) ? '#8b4aad' : '#3a3a4a'};">${f}q</button>`
                ).join('');
                html += `<tr><td colspan="3" style="padding:0 6px 5px;font-size:11px;">` +
                        `<span style="opacity:0.55;">Dir:</span> ${dirBtns}` +
                        `<span style="opacity:0.55;margin-left:8px;">Fill:</span> ${fillBtns}` +
                        `</td></tr>`;
            }
        }
        html += `</table>`;

        this.panel.innerHTML = html;
        this.panel.style.display = "block";

        // Wire up each "Edit all" button
        this.panel.querySelectorAll("button[data-type]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id   = btn.getAttribute("data-type");
                const grp  = typeGroups.get(id) || [];
                this._showEditDialog(id, grp);
            });
        });

        // Wire up each "Seq Fill" button
        this.panel.querySelectorAll("button[data-seq]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id  = btn.getAttribute("data-seq");
                const grp = typeGroups.get(id) || [];
                this._showSequenceDialog(id, grp);
            });
        });

        // Wire up direction buttons (update style in-place, no panel rebuild)
        this.panel.querySelectorAll("button[data-dir]").forEach(btn => {
            btn.addEventListener("click", () => {
                this._seqDir = btn.getAttribute("data-dir");
                this.panel.querySelectorAll("button[data-dir]").forEach(b => {
                    b.style.background = b === btn ? "#2d6ecf" : "#3a3a4a";
                });
            });
        });

        // Wire up fill buttons
        this.panel.querySelectorAll("button[data-fill]").forEach(btn => {
            btn.addEventListener("click", () => {
                this._seq.pattern = fillToPattern(parseInt(btn.getAttribute("data-fill")));
                this.panel.querySelectorAll("button[data-fill]").forEach(b => {
                    b.style.background = b === btn ? "#8b4aad" : "#3a3a4a";
                });
            });
        });
    }

    // ── Edit dialog ──────────────────────────────────────────────────────────

    /**
     * @param {string}   componentId
     * @param {number[]} uids
     */
    _showEditDialog(componentId, uids) {
        const typeDef = MULTI_EDIT_TYPES.find(t => _typeKey(t) === componentId);
        if (!typeDef) return;

        // Re-resolve (entities might be destroyed since the panel was built)
        const entities = uids
            .map(uid => this.root.entityMgr.findByUid(uid, false))
            .filter(e => e && !e.destroyed && e.components[typeDef.componentId]);

        if (entities.length === 0) return;

        const formElements = typeDef.formElements();

        const dialog = new shapez.DialogWithForm({
            app:          this.root.app,
            title:        typeDef.dialogTitle(entities.length),
            desc:         typeDef.dialogDesc,
            formElements: formElements,
            buttons:      ["cancel:bad:escape", "ok:good:enter"],
            closeButton:  false,
        });
        this.root.hud.parts.dialogs.internalShowDialog(dialog);

        dialog.buttonSignals.ok.add(() => {
            for (const entity of entities) {
                if (!entity.destroyed) {
                    typeDef.applyValues(entity, formElements);
                }
            }
        });
    }

    // ── Sequence fill dialog ─────────────────────────────────────────────────

    /**
     * Assigns each selected signal generator the next value of the configured sequence,
     * sorted according to this._seqDir (L/R/U/D).
     * @param {string}   componentId
     * @param {number[]} uids
     */
    _showSequenceDialog(componentId, uids) {
        const entities = uids
            .map(uid => this.root.entityMgr.findByUid(uid, false))
            .filter(e => e && !e.destroyed && e.components[componentId]);

        if (entities.length === 0) return;

        const dir = this._seqDir || 'R';
        const dirLabel = {L: 'Left ←', R: 'Right →', U: 'Up ↑', D: 'Down ↓'}[dir];

        entities.sort((a, b) => {
            const pa = a.components.StaticMapEntity.origin;
            const pb = b.components.StaticMapEntity.origin;
            switch (dir) {
                case 'L': return pa.x !== pb.x ? pb.x - pa.x : pa.y - pb.y;
                case 'U': return pa.y !== pb.y ? pb.y - pa.y : pa.x - pb.x;
                case 'D': return pa.y !== pb.y ? pa.y - pb.y : pa.x - pb.x;
                default:  return pa.x !== pb.x ? pa.x - pb.x : pa.y - pb.y; // R
            }
        });

        const allShapes = availableShapeCodes();
        const allColors = availableColorCodes();
        const s         = this._seq;
        const isPosInt  = val => /^\s*\d+\s*$/.test(val) && parseInt(val) >= 1;

        const fShapes = new shapez.FormElementInput({
            id:           "sk_me_seq_shapes",
            label:        `Shapes (available: ${allShapes.join(" ")})`,
            placeholder:  allShapes.join(""),
            defaultValue: (s.shapes || allShapes).join(""),
            validator:    val => !!_parseCodeList(val, allShapes),
        });
        const fColors = new shapez.FormElementInput({
            id:           "sk_me_seq_colors",
            label:        `Colors (available: ${allColors.join(" ")})`,
            placeholder:  allColors.join(""),
            defaultValue: (s.colors || allColors).join(""),
            validator:    val => !!_parseCodeList(val, allColors),
        });
        const fPattern = new shapez.FormElementInput({
            id:           "sk_me_seq_pattern",
            label:        "Quadrants: # = filled, - = empty (e.g. ####, #---, #-#-)",
            placeholder:  "####",
            defaultValue: s.pattern,
            validator:    val => _isValidPattern(val.trim()),
        });
        const fColorsFirst = new shapez.FormElementCheckbox({
            id:           "sk_me_seq_colorsfirst",
            label:        "Colors change first (Ru, Rr, Rg … instead of Ru, Cu, Su …)",
            placeholder:  "",
            defaultValue: s.colorsFirst,
        });
        const fStart = new shapez.FormElementInput({
            id:           "sk_me_seq_start",
            label:        "Start at item # (1 = first)",
            placeholder:  "1",
            defaultValue: String(s.start),
            validator:    isPosInt,
        });
        const fRepeat = new shapez.FormElementInput({
            id:           "sk_me_seq_repeat",
            label:        "Repeat each value on N buildings in a row",
            placeholder:  "1",
            defaultValue: String(s.repeat),
            validator:    isPosInt,
        });
        const fCustom = new shapez.FormElementInput({
            id:           "sk_me_seq_custom",
            label:        "Custom list (overrides everything above; space-separated codes)",
            placeholder:  "e.g. CuCuCuCu RrRr---- g 1",
            defaultValue: s.custom,
            validator:    val => val.trim() === "" ||
                val.trim().split(/[\s,]+/).every(code => !!_parseSignalCode(this.root, code)),
        });
        const formElements = [fShapes, fColors, fPattern, fColorsFirst, fStart, fRepeat, fCustom];

        const dialog = new shapez.DialogWithForm({
            app:   this.root.app,
            title: `Sequence Fill  (${entities.length} signal generator${entities.length !== 1 ? "s" : ""})`,
            desc:
                `Direction: ${dirLabel}. The sequence wraps around when it runs out. ` +
                `Settings are remembered for the next time.`,
            formElements,
            buttons:      ["cancel:bad:escape", "ok:good:enter"],
            closeButton:  false,
        });
        this.root.hud.parts.dialogs.internalShowDialog(dialog);

        dialog.buttonSignals.ok.add(() => {
            s.shapes      = _parseCodeList(fShapes.getValue(), allShapes);
            s.colors      = _parseCodeList(fColors.getValue(), allColors);
            s.pattern     = fPattern.getValue().trim();
            s.colorsFirst = !!fColorsFirst.getValue();
            s.start       = parseInt(fStart.getValue());
            s.repeat      = parseInt(fRepeat.getValue());
            s.custom      = fCustom.getValue().trim();
            // Keep "all available" as the default if the user didn't narrow it down
            if (s.shapes.join("") === allShapes.join("")) s.shapes = null;
            if (s.colors.join("") === allColors.join("")) s.colors = null;

            const sequence = s.custom
                ? s.custom.split(/[\s,]+/)
                : buildSignalSequence({
                      shapes:      s.shapes || allShapes,
                      colors:      s.colors || allColors,
                      pattern:     s.pattern,
                      colorsFirst: s.colorsFirst,
                  });
            const N = sequence.length;

            for (let i = 0; i < entities.length; i++) {
                const entity = entities[i];
                if (entity.destroyed) continue;
                const comp = entity.components.ConstantSignal;
                if (!comp) continue;
                const code   = sequence[(Math.floor(i / s.repeat) + s.start - 1) % N];
                const signal = _parseSignalCode(entity.root, code);
                if (signal) comp.signal = signal;
            }

            // Refresh the panel so the Fill buttons reflect the new pattern
            this._lastKnownSize = -1;
        });
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    cleanup() {
        if (this.panel && this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
        }
    }
}

// ─── Mod Entry Point ──────────────────────────────────────────────────────────
class Mod extends shapez.Mod {
    init() {
        this.modInterface.registerHudElement("SkMultiEdit", HUDSkMultiEdit);
    }
}
