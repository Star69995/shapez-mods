# BalancerVariants - Industries Compat

![BalancerVariants - Industries Compat](images/logo.png)

**Lets you use the big balancers from Balancer Variants while playing Shapez Industries.**

> **Dependencies - this mod needs BOTH of these mods installed:**
> 1. [Balancer Variants](https://mod.io/g/shapez/m/balancervariants) by Fyshi1 (or [my modified version](https://github.com/Star69995/shapez-balancer-variants) with 9x1 / 10x1)
> 2. [Shapez Industries](https://mod.io/g/shapez/m/shapez-industries) by Sense_101 (tested with 1.1.6)
>
> It is a fix for one specific conflict between those two mods and does nothing on its own.

## Why you need it

[Balancer Variants](https://mod.io/g/shapez/m/balancervariants) adds large balancers (3x1 up to 8x1, or 10x1 with [my modified version](https://github.com/Star69995/shapez-balancer-variants)) that merge, split and balance many belts with a single building - much smaller and cleaner than chaining 2x1 balancers.

But when [Shapez Industries](https://shapez.mod.io/shapez-industries) is also installed, Industries takes over the balancer building, and the extra balancers simply **disappear from the toolbar** (or break when placed). This tiny mod fixes that: with both mods installed, the big balancers are back and work normally, alongside Industries' own balancers.

No settings, nothing to click - just install it next to the other two mods.

## How to use

1. Install **Balancer Variants**, **Shapez Industries** and this mod (all three `.js` files in your `mods` folder).
2. Start or load a Shapez Industries game.
3. Select the **Balancer** in the toolbar and press **T** (cycle variants) to reach the 3x1 ... 10x1 balancers - they appear next to Industries' own balancer variants.
4. Place them like any balancer: belts go in on one side and come out balanced on the other.

## What exactly it fixes

Both mods change the same building, the balancer (`MetaBalancerBuilding`):

- Balancer Variants adds its 3x1 ... 10x1 variants to the balancer.
- Shapez Industries loads later and replaces the balancer's `getAvailableVariants` and `updateVariants` with its own versions, which only know Industries' variants. Result: the big balancers are missing from the toolbar, and Industries' `updateVariants` hits its "unknown variant" assert for them.

This mod waits until every mod has loaded, then:

1. adds the Balancer Variants variants back to the balancer's available list, and
2. sends those variants to Balancer Variants' own setup code, while every Industries variant still goes to Industries.

It does not change anything else in either mod.

## Compatibility

- **Game version:** shapez 1.5.0 or newer (the modding update).
- **Required:** Balancer Variants and Shapez Industries (see Dependencies above).

Keep the file name as is: the game loads mods alphabetically and this file must load after `BalancerVariants.js`.

## Installation

Get it on **[mod.io](https://mod.io/g/shapez/m/balancer-variants-industries-compat)**, or download the `.js` file from this folder.

Download the `.js` file, put it in your shapez.io `mods` folder (on Windows: `%APPDATA%\shapez.io\mods`) and restart the game.

## Author

Made by **Star** ([Star69995](https://github.com/Star69995)). MIT License - see [LICENSE](../LICENSE).
