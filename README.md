# flappy-claude

Flappy Bird for Claude Code, played while Claude works. The bird is Claude's
spark, spinning through the spinner's glyphs; the pipes scroll past above the
prompt.

- **Shows up by itself** while a turn runs, and goes away when Claude is done.
  A run still in the air when the turn ends keeps going until the bird lands.
- **Click the game** to flap and give it the keyboard, then **Space** (or Up,
  W, K) flaps. **Esc** goes back to the prompt; a second Esc interrupts Claude
  as usual.
- **Best score** is kept across sessions.
- **`/flappy play`** brings the game up while Claude is idle.
  **`/flappy off`** hides it, **`/flappy on`** brings it back.

## Install

```
/plugin marketplace add Anerco/plugins
/plugin install flappy-claude@anerco
```

Clicks reach the game in Claude Code's fullscreen layout (`"tui": "fullscreen"`
in settings). The game needs 8 free rows above the prompt; it stays hidden in a
shorter terminal.

**Updates:** in `/plugin`, choose Marketplaces → anerco → Enable auto-update.

## Privacy

It reads and writes nothing outside its own store (the best score and the
on/off switch) and makes no network calls.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
