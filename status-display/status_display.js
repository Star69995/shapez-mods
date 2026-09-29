// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/status-display",
    author: "Star",
    name: "Status Display",
    version: "1.0.6",
    id: "status-display",
    description:
        "Adds a Status Block to the wires layer. Connect a wire to its bottom pin; set a custom label by clicking the block. All active status blocks appear as a live panel in the bottom-right corner of the screen.",
    minimumGameVersion: ">=1.5.0",
};

////////////////////////////////////////////////////////////////////////
// Helper – turn a wire value into a readable string

// Returns { text: string|null, shape: ShapeDefinition|null }
function getDisplayValue(value) {
    if (!value) return { text: "---", shape: null };
    try {
        const t = typeof value.getItemType === "function" ? value.getItemType() : null;
        if (t === "shape" || (value.definition && typeof value.definition.getHash === "function")) {
            return { text: null, shape: value.definition };
        }
        if (t === "boolean" || typeof value.value === "boolean") {
            return { text: value.value ? "1" : "0", shape: null };
        }
        if (t === "color" || typeof value.color === "string") {
            return { text: value.color, shape: null };
        }
        if (typeof value.value === "number") {
            return { text: String(value.value), shape: null };
        }
    } catch (_) {}
    return { text: "?", shape: null };
}

////////////////////////////////////////////////////////////////////////
// Component – stores the label text

class StatusBlockComponent extends shapez.Component {
    static getId() {
        return "StatusBlock";
    }

    static getSchema() {
        return { labelText: shapez.types.string };
    }

    constructor() {
        super();
        this.labelText = "Status";
        this.isCopied = false;
    }

    copyAdditionalStateTo(other) {
        other.labelText = this.labelText;
        other.isCopied = true;
    }
}

////////////////////////////////////////////////////////////////////////
// System – triggers the label dialog when a block is placed

class StatusBlocksSystem extends shapez.GameSystemWithFilter {
    constructor(root) {
        super(root, [StatusBlockComponent]);

        this.root.signals.entityManuallyPlaced.add(entity => {
            const comp = entity.components.StatusBlock;
            if (!comp) return;
            if (comp.isCopied) {
                comp.isCopied = false;
                return;
            }
            const hud = this.root.hud.parts.statusBlockEdit;
            if (hud) hud.editLabel(entity, { deleteOnCancel: true });
        });
    }

    update() {}
}

////////////////////////////////////////////////////////////////////////
// Building – 1×1 wires-layer block with a single acceptor pin

class MetaStatusBlockBuilding extends shapez.ModMetaBuilding {
    constructor() {
        super("status_block");
    }

    static getAllVariantCombinations() {
        return [
            {
                variant: shapez.defaultBuildingVariant,
                name: "Status Block",
                description:
                    "Shows a labeled wire value in the bottom-right corner of the screen. Click to rename the label.",
                regularImageBase64: RESOURCES["status_block.png"],
                blueprintImageBase64: RESOURCES["status_block.png"],
                tutorialImageBase64: RESOURCES["status_block.png"],
            },
        ];
    }

    getSilhouetteColor() {
        return "#48b2e8";
    }

    getIsUnlocked(root) {
        return root.hubGoals.isRewardUnlocked(
            shapez.enumHubGoalRewards.reward_wires_painter_and_levers
        );
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
                ],
            })
        );
        entity.addComponent(new StatusBlockComponent());
    }
}

////////////////////////////////////////////////////////////////////////
// HUD part – click a block (on the wires layer) to edit its label

class HUDStatusBlockEdit extends shapez.BaseHUDPart {
    initialize() {
        this.root.camera.downPreHandler.add(this.downPreHandler, this);
    }

    downPreHandler(pos, button) {
        if (this.root.currentLayer !== "wires") return;

        const tile = this.root.camera.screenToWorld(pos).toTileSpace();
        const contents = this.root.map.getLayerContentXY(tile.x, tile.y, "wires");
        if (contents) {
            const comp = contents.components.StatusBlock;
            if (comp && button === shapez.enumMouseButton.left) {
                this.editLabel(contents, { deleteOnCancel: false });
                return shapez.STOP_PROPAGATION;
            }
        }
    }

    editLabel(entity, { deleteOnCancel = true } = {}) {
        const comp = entity.components.StatusBlock;
        if (!comp) return;
        const uid = entity.uid;

        const input = new shapez.FormElementInput({
            id: "statusLabelText",
            placeholder: "Label",
            defaultValue: comp.labelText,
            validator: val => val.length > 0,
        });

        const dialog = new shapez.DialogWithForm({
            app: this.root.app,
            title: "Status Block",
            desc: "Enter the label to show next to the wire value:",
            formElements: [input],
            buttons: ["cancel:bad:escape", "ok:good:enter"],
            closeButton: false,
        });
        this.root.hud.parts.dialogs.internalShowDialog(dialog);

        dialog.buttonSignals.ok.add(() => {
            if (!this.root || !this.root.entityMgr) return;
            const ref = this.root.entityMgr.findByUid(uid, false);
            if (!ref || !ref.components.StatusBlock) return;
            ref.components.StatusBlock.labelText = input.getValue();
        });

        if (deleteOnCancel) {
            dialog.buttonSignals.cancel.add(() => {
                if (!this.root || !this.root.entityMgr) return;
                const ref = this.root.entityMgr.findByUid(uid, false);
                if (!ref) return;
                this.root.logic.tryDeleteBuilding(ref);
            });
        }
    }
}

////////////////////////////////////////////////////////////////////////
// HUD part – bottom-right corner live status panel

class HUDStatusDisplay extends shapez.BaseHUDPart {
    createElements(parent) {
        this.element = document.createElement("div");
        this.element.id = "ingame_HUD_StatusDisplay";
        Object.assign(this.element.style, {
            position: "absolute",
            bottom: "70px",
            left: "16px",
            display: "none",
            flexDirection: "column",
            gap: "5px",
            pointerEvents: "none",
            zIndex: "100",
        });
        parent.appendChild(this.element);
        this.rows = new Map(); // uid -> { row, labelEl, valEl }
    }

    initialize() {}

    update() {
        if (!this.rows) return;
        const system = this.root.systemMgr.systems.statusBlocks;
        if (!system) return;

        const active = new Set();

        for (const entity of system.allEntities) {
            const uid = entity.uid;
            active.add(uid);

            const comp = entity.components.StatusBlock;
            const pinsComp = entity.components.WiredPins;
            const slot = pinsComp && pinsComp.slots && pinsComp.slots[0];
            const network = slot && slot.linkedNetwork;
            const rawValue = network && network.hasValue() ? network.currentValue : null;
            const { text: newText, shape: newShape } = getDisplayValue(rawValue);
            const newShapeHash = newShape ? newShape.getHash() : null;

            if (!this.rows.has(uid)) {
                const row = document.createElement("div");
                Object.assign(row.style, {
                    background: "rgba(8, 20, 35, 0.88)",
                    color: "#ddeeff",
                    padding: "5px 14px",
                    borderRadius: "5px",
                    fontFamily: "'Courier New', monospace",
                    fontSize: "13px",
                    borderLeft: "3px solid #48b2e8",
                    whiteSpace: "nowrap",
                    lineHeight: "1.5",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                });
                const labelEl = document.createElement("span");
                Object.assign(labelEl.style, { color: "#7dd4f0", fontWeight: "bold" });
                const sep = document.createElement("span");
                sep.textContent = ": ";
                Object.assign(sep.style, { color: "#446688" });
                const valEl = document.createElement("span");
                row.appendChild(labelEl);
                row.appendChild(sep);
                row.appendChild(valEl);
                this.element.appendChild(row);
                this.rows.set(uid, { row, labelEl, valEl, _shapeHash: null, _textVal: null });
            }

            const rowData = this.rows.get(uid);
            if (rowData.labelEl.textContent !== comp.labelText) {
                rowData.labelEl.textContent = comp.labelText;
            }

            // Only update the value cell when the value actually changes
            if (rowData._shapeHash !== newShapeHash || rowData._textVal !== newText) {
                rowData._shapeHash = newShapeHash;
                rowData._textVal = newText;

                if (newShape) {
                    // Render shape as a small canvas image
                    const shapeCanvas = newShape.generateAsCanvas(32);
                    const img = document.createElement("img");
                    img.src = shapeCanvas.toDataURL();
                    Object.assign(img.style, {
                        width: "20px",
                        height: "20px",
                        verticalAlign: "middle",
                        imageRendering: "pixelated",
                    });
                    rowData.valEl.innerHTML = "";
                    rowData.valEl.appendChild(img);
                } else {
                    rowData.valEl.textContent = newText;
                }
            }
        }

        // Remove rows for blocks that no longer exist
        for (const [uid, { row }] of this.rows) {
            if (!active.has(uid)) {
                row.remove();
                this.rows.delete(uid);
            }
        }

        this.element.style.display = this.rows.size > 0 ? "flex" : "none";
    }
}

////////////////////////////////////////////////////////////////////////
// Mod entry point

class Mod extends shapez.Mod {
    init() {
        this.modInterface.registerComponent(StatusBlockComponent);

        this.modInterface.registerNewBuilding({
            metaClass: MetaStatusBlockBuilding,
            buildingIconBase64: RESOURCES["status_block.png"],
        });

        this.modInterface.addNewBuildingToToolbar({
            toolbar: "wires",
            location: "secondary",
            metaClass: MetaStatusBlockBuilding,
        });

        this.modInterface.registerGameSystem({
            id: "statusBlocks",
            systemClass: StatusBlocksSystem,
            before: "constantSignal",
        });

        this.modInterface.registerHudElement("statusBlockEdit", HUDStatusBlockEdit);
        this.modInterface.registerHudElement("statusDisplay", HUDStatusDisplay);
    }
}

////////////////////////////////////////////////////////////////////////
// Resources – pre-rendered PNG icon (192×192, generated via System.Drawing)

const RESOURCES = {
    "status_block.png": "data:image/png;base64,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",
};
