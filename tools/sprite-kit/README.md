<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# Sprite kit

The game page does not draw the people, the places and the props of the town map itself. This kit renders them once, at build time: a small WebGL2 ray marcher of our own (signed distance fields, toon shading and ink lines, no library and no model files) that bakes every frame of every sprite into two atlases and a manifest. The game page only draws the frames.

```
node tools/sprite-kit/bake.mjs [--jobs 4] [--only char.li_da,place.bridge] [--scales 1,2] [--px 56] [--out out] [--kmax N]
```

It needs Node 22 and the Playwright of `web/` with its Chromium. The script looks for Playwright in `../../web`, and `KIT_PLAYWRIGHT_FROM` names another `web/` folder. Software WebGL is enough, and a graphics card only makes the bake faster. `--jobs` is the number of browsers that bake at the same time, `--scales` the atlases to make (`1,2`), `--px` the pixels to a world unit at scale 1. `--only` bakes the sprites with these ids or id prefixes, and `--kmax N` only the first N frames of every animation. A bake with either writes a manifest that is not whole, so it is for looking and not for shipping. The heaviest frames are baked first, and each of them needs a few GB while it renders at 2x, so every further job needs that much more memory.

## What it writes

`out/` holds `atlas-1x.webp`, the 2x atlas (`atlas-2x.webp`, or `atlas-2x-1.webp` and `atlas-2x-2.webp` when it is taller than 4,096 px) (all lossless), `manifest.json`, and two pictures for the eye: `contact-sheet.png` with every sprite, its anchor and its footprint, and `walk4.gif`. The timings of the run go to `bake-report.json` next to `bake.mjs`. Git ignores both `out/` and the report.

The manifest (`schema: lantern-eve/sprite-kit@1`) is the whole contract with the page. It gives the camera and the units (one grid cell is 32 px wide and 25.22 px deep on the screen, and height adds -34.48 px per world unit), the atlas files, and for each sprite its frame size, its anchor, the position of each frame in each atlas, and what the sprite needs to be placed:

- A character has the animations `idle`, `walk` and `talk`, and `carry` for the ones that carry something. Each has the four directions `down`, `up`, `left` and `right`, which are separate renders. `walk` has the length of its stride in pixels. The anchor is the ground point between the feet. The kit has a figure for each of the twenty people of the cast and one for the manager, and three more of the town (a man, a woman and a child). `web/src/page/map/sprites.ts` says who is drawn with which.
- A place has its footprint in cells and the anchor at the south-west corner of the footprint on the ground. A house has the mounts of its two door lanterns, a building with windows names the sprite of its lit windows (`lights`, see below), and the bridge has the lift of a walker on its deck.
- A prop or an effect has a footprint or a blend mode, and the lantern says where its glow goes. A tree, a heap of mossy stones and a pile of junk are props with a footprint of one cell.

Frame sizes, anchors and offsets are in pixels at scale 1. The 2x atlas holds the same frames at twice the size. The page draws both at the logical size of scale 1.

## The windows at night

A building with windows has a second sprite, `fx.windows.<name>`, and it is not a second copy of the building. It is the lit panes of the windows, and the paper of the lanterns that hang on the building, rendered once from the same model in a mode of the ray marcher (`uMode 1`) where the panes are a flat warm colour and everything else is clear but still hides what lies behind it. The lattice bars in front of a pane stay dark, so the light shows through the lattice. The page adds this sprite to the picture over the building at night, anchored where the building is, and draws nothing of it by day. The building's entry names it (`lights`), and its own entry has the windows as `spots`: `[x, y, w, h]` from its anchor in 1x pixels (y down), which the page puts a soft halo on. Instances of one building share the one sprite: the two Li houses share one, and so do the two Zhou houses, and the stalls and the bridge have none.

## Objects for the corner of the page

Four sprites are not for the map. They are for the corner of the page, where the manager keeps the tools of the job: `prop.elder_seal` (a stone seal with the character 族 cut in its face and a red cord tied round its knob), `prop.notebook` (a thread-bound book lying flat, 见闻簿 on its label, the spine on the right as in the old books), and `prop.incense_unlit` and `prop.incense_lit` (a bronze burner with a stick of incense, and the same burner with the tip glowing and a thread of smoke going up). They are baked by the same line as the people and the props, with the same camera and light, and are 57 to 71 pixels tall at 1x. Each stands on one point and has no footprint. The two burners are one model, so a page that swaps them puts them on the same anchor and nothing moves: the lit one is taller above the anchor by the smoke, and the room under the anchor is the same.

A page draws one like any other sprite of the manifest: `frames` gives `[page, x, y]` in the atlas, `frame` the size in pixels at 1x and `anchor` the ground point in the frame.

The objects have a shader program of their own. `src/shaders/objects.glsl` holds their three models, their materials and the choice between them, and `engine.js` compiles it as the program `objects`: the same marcher and figures with these models in place of the places. The program that bakes every other sprite does not contain these models, and neither does its decal canvas, so adding an object to the kit never changes a sprite that is already in the atlas. The characters on the seal and the label are outlines of Ma Shan Zheng (`src/page/glyphs.js`, made by `tools/fonts/glyph_paths.py`), drawn into a decal canvas of their own by `makeObjectsDecal` in `places.js`.

## Comparing two bakes

```
node tools/sprite-kit/compare.mjs web/public/sprites tools/sprite-kit/out [--partial]
```

It decodes the atlases of the two folders in Chromium and compares every byte of the pixels, sprite by sprite and frame by frame, and the manifest entry of each sprite without the positions of its frames (a frame moves in the atlas when a sprite is added, and its pixels do not). A sprite that only the new manifest has is listed and is no error. `--partial` also lets the new manifest lack sprites, for a bake with `--only`. The exit code is 0 when everything compared is identical.

## Where the art goes

`web/public/sprites/` holds the files that the page loads: the atlases (`atlas-1x.webp`, and `atlas-2x-1.webp` and `atlas-2x-2.webp` when the 2x atlas does not fit one page of 4096 pixels) and `manifest.json`. After a bake, take the old atlases out of there and copy the new files from `out/`.

```
rm web/public/sprites/atlas-*.webp
cp tools/sprite-kit/out/atlas-*.webp tools/sprite-kit/out/manifest.json web/public/sprites/
```

The page reads the manifest and takes no frame from a fixed place. A sprite that is new in the manifest needs no change of code once `web/src/page/map/sprites.ts` says whom or what it draws.

## The bake is deterministic

The same sources and the same options give byte-identical files. The order in which the browsers finish does not matter, because the frames are sorted before they are packed, and the colour profile that Chromium adds is cut out of the images, so every loader shows the same colours. What differs from run to run, the timings, is kept out of `out/`. A change in the four files under `web/public/sprites/` (the atlases and `manifest.json`) therefore comes from a change in the sources or the options.

## The sources

- `bake.mjs` starts the browsers, deals the frames out to them, packs the atlases and writes the files.
- `src/shaders/` is the GLSL: `march.glsl` is the ray marcher, `figures.glsl` the people, `places.glsl` the teahouse, the family houses, the pier, the bridge, the bamboo, the lantern and the willow, `town.glsl` the other buildings (one shared body for a plain house, and a function for each building with what makes it its own), `trees.glsl` the trees, the heap of stones and the pile of junk, `dispatch.glsl` which model a place is and the albedo of the place materials (and the night light), `common.glsl` the helpers they share, and `post.glsl` the ink lines and the last pass.
- `src/shaders/objects.glsl` is the program of the objects for the corner of the page, and `compare.mjs` compares two bakes.
- `src/page/` runs in the browser page. `config.js` has the units, the camera, the light and the palette, `engine.js` the WebGL2 engine, `catalog.js` the people and their animations, `places.js` the places and the props with their footprints (taken from `content/maps/bridge_town.yaml`) and the lit windows made from them, `bake.js` bakes one frame, `compose.js` trims and packs the frames (and finds the windows of a night light), `gif.js` makes the preview, and `glyphs.js` holds the outlines of the characters on the seal and the label.
