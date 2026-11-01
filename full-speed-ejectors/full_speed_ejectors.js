// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/full-speed-ejectors",
    author: "Star",
    name: "Full-Speed Ejectors",
    version: "1.0.1",
    id: "full-speed-ejectors",
    description:
        "Fixes a rounding problem that caps every building's output at half the tick rate (15 items/s at 30 ticks/s) even when the belt can carry more. Output onto a belt is limited only by the belt again. Filters also hold more items inside, so they no longer slow a fast belt.",
    minimumGameVersion: ">=1.5.0",
    doesNotAffectSavegame: true,
};

// A building hands an item to its target (a belt, or another building such as a belt
// reader, a machine or a hub) only once the item's ejector "progress" reaches 1. Progress
// grows by a fixed amount per tick and every new item starts at 0 (the leftover is thrown
// away), so at low tick rates each item needs one tick more than it should: at 30 ticks/s
// that is 2 ticks per item = 15 items/s, while a belt could take 20.8.
//
// The target already limits what it accepts (belt spacing, a machine's free input slot...),
// so the extra delay is only a cap. Starting items just below 1 offers them to the target
// on the very tick they are ejected. Slots with no target keep the original behaviour.
const ALMOST_DONE = 0.999999;
const FILTER_QUEUE = 4; // the original filter holds 2

class Mod extends shapez.Mod {
    init() {
        const proto = shapez.ItemEjectorComponent.prototype;
        const original = proto.tryEject;
        proto.tryEject = function (slotIndex, item) {
            if (!original.call(this, slotIndex, item)) return false;
            const slot = this.slots[slotIndex];
            if (slot.cachedTargetEntity) slot.progress = ALMOST_DONE;
            return true;
        };

        // The filter holds at most 2 items inside and every one needs a few ticks to
        // get through, so at a fast belt it refuses items now and then and the belt
        // behind it runs below its speed. Same rule as the original, a longer queue.
        const filter = shapez.FilterSystem && shapez.FilterSystem.prototype;
        if (filter) {
            filter.tryAcceptItem = function (entity, slot, item) {
                const network = entity.components.WiredPins.slots[0].linkedNetwork;
                if (!network || !network.hasValue()) return false;
                const value = network.currentValue;
                const filterComp = entity.components.Filter;
                const queue =
                    value.equals(shapez.BOOL_TRUE_SINGLETON) || value.equals(item)
                        ? filterComp.pendingItemsToLeaveThrough
                        : filterComp.pendingItemsToReject;
                if (queue.length >= FILTER_QUEUE) return false;
                queue.push({ item, progress: 0 });
                return true;
            };
        }
    }
}
