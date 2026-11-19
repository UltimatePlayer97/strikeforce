# STRIKEFORCE 6v6

Vite + TypeScript project wrapper around the supplied STRIKEFORCE 6v6 game.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Development

```sh
npm install
npm run dev
```

## Production build

```sh
npm run typecheck
npm run build
npm run preview
```

## Project layout

```text
src/
  game/
    core.js       Original game runtime, preserved without gameplay edits
    index.ts      Typed runtime entry point
  main.ts         Application entry point
  style.css       Original page styles
  vite-env.d.ts   Vite client types
index.html        Original game DOM and embedded weapon assets
vite.config.ts
 tsconfig.json
```

## Migration note

The supplied `src.zip` was not used as the gameplay implementation because its
rewritten systems do not match the supplied original game. The original runtime
and its embedded asset payload are retained to keep the game visually and
functionally identical. Vite now resolves Three.js and JSZip through npm rather
than the original browser import map. The game runtime remains JavaScript during
this compatibility-first migration; the application entry point and build
configuration are strict TypeScript. Converting the runtime itself to idiomatic
TypeScript requires a staged type migration and runtime testing, rather than
pretending that adding `: any` or disabling type checking is a proper conversion.
