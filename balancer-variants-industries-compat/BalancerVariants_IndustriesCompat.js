// @ts-nocheck
const METADATA = {
    website: "https://github.com/Star69995/shapez-mods/tree/main/balancer-variants-industries-compat",
    author: "Star",
    name: "BalancerVariants - Industries Compat",
    version: "1.0.3",
    id: "balancer-variants-industries-compat",
    description: "Makes BalancerVariants buildings visible when Shapez Industries is active",
    minimumGameVersion: ">=1.5.0",
};

class Mod extends shapez.Mod {
    init() {
        const MetaBalancerBuilding = shapez.MetaBalancerBuilding;

        // Capture BV's patched updateVariants NOW, before industries overwrites it.
        // BalancerVariants.js sorts before this file ('.' < '_'), so it has already run init().
        const bvUpdateVariants = MetaBalancerBuilding.prototype.updateVariants;

        let patched = false;
        this.modLoader.signals.hudElementInitialized.add(element => {
            if (patched || element.constructor.name !== "HUDBuildingsToolbar") return;
            patched = true;

            // At this point all mod init()s are done; these are industries' versions.
            const industriesGetAvailableVariants = MetaBalancerBuilding.prototype.getAvailableVariants;
            const industriesUpdateVariants = MetaBalancerBuilding.prototype.updateVariants;

            const bvVariants = [];
            for (const key in shapez.enumBalancerVariants) {
                if (key.startsWith("B_Variants_")) {
                    bvVariants.push(shapez.enumBalancerVariants[key]);
                }
            }

            // Include BV variants in the available list
            MetaBalancerBuilding.prototype.getAvailableVariants = function (root) {
                const result = industriesGetAvailableVariants.call(this, root);
                for (const variant of bvVariants) {
                    if (!result.includes(variant)) {
                        result.push(variant);
                    }
                }
                return result;
            };

            // Delegate to BV's updateVariants for BV variants so industries'
            // assertAlways(false) default case never fires for them.
            MetaBalancerBuilding.prototype.updateVariants = function (entity, rotationVariant, variant) {
                if (bvVariants.includes(variant)) {
                    return bvUpdateVariants.call(this, entity, rotationVariant, variant);
                }
                return industriesUpdateVariants.call(this, entity, rotationVariant, variant);
            };

        });
    }
}
