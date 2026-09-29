# Status Display

**A live dashboard for your factory: see the wire values you care about on screen, from anywhere on the map.**

## Why you want it

In shapez, a wire signal - is the storage full, which shape is the Hub asking for, is a machine running - can only be seen by flying over to it and switching to the wires layer. In a big factory you keep flying back and forth just to check.

Status Display adds a **Status Block**: connect any wire to it, give it a name, and its value appears in a small panel in the **bottom-right corner of the screen**, all the time, wherever you are:

```
Main storage full : 1
Current goal      : [shape]
Paint line        : red
```

- Watch **storage-full signals** to know when a line is backing up.
- Show the **current Hub goal** (with a Hub goal signal) or the shape a production line is making.
- Monitor **colors, shapes and 0/1** values - shapes are drawn as small images, not just codes.
- Add as many blocks as you want; each gets its own labeled row, and rows disappear when the block is removed.

## How to use

1. On the **wires layer**, place a **Status Block** (wires toolbar).
2. Type a label when asked (you can change it later by clicking the block).
3. Connect a wire to the block's **bottom pin**.
4. The label and live value show up in the bottom-right panel.

## Installation

Download the `.js` file, put it in your shapez.io `mods` folder (on Windows: `%APPDATA%\shapez.io\mods`) and restart the game.

## Author

Made by **Star** ([Star69995](https://github.com/Star69995)). MIT License - see [LICENSE](../LICENSE).
