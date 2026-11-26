<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# Sprite kit

This kit renders the people, places and props of the town map at build time. Its WebGL2 ray marcher uses signed distance fields, toon shading and ink outlines. It needs no external libraries or model files. The client draws the baked frames using the atlas manifest.

```
node tools/sprite-kit/bake.mjs [--jobs 4] [--only char.li_da,place.bridge] [--scales 1,2] [--px 56] [--out out] [--kmax N]
```

Use Node 22 and Chromium from the Playwright installation in `web/`. The script looks in `../../web` unless `KIT_PLAYWRIGHT_FROM` points to another directory. Software WebGL works. A GPU can speed up the bake. `--jobs` sets the number of parallel browsers, `--scales` selects atlas resolutions (`1,2`), and `--px` sets pixels per world unit at 1x. Use `--only` to choose sprite IDs or prefixes, or `--kmax N` for the first N frames of each animation. Either leaves the manifest incomplete, so use a full bake for release. The script starts with the largest frames, which take several GB per job at 2x.

## What it writes

Under `out/`, find the lossless 1x atlas (`atlas-1x.webp`), the lossless 2x atlas, `manifest.json`, `contact-sheet.png` with anchors and footprints for all sprites, and `walk4.gif`. The 2x atlas splits into `atlas-2x-1.webp` and `atlas-2x-2.webp` above 4,096 px. Run timings go into `bake-report.json` next to `bake.mjs`. Git ignores both the output directory and the report.

The web client reads the atlas files, camera and units from the manifest (`schema: lantern-eve/sprite-kit@1`). A grid cell projects to 32 px wide and 25.22 px deep, and one world unit of height raises the sprite by 34.48 px. Each sprite entry gives frame size, anchor, atlas offsets and placement data.

- A character has the animations `idle`, `walk` and `talk`, and `carry` for the ones that carry something. Each has the four directions `down`, `up`, `left` and `right`, which are separate renders. `walk` has the length of its stride in pixels. The anchor is the ground point between the feet. The kit has a figure for each of the twenty people of the cast and one for the manager, and three more of the town (a man, a woman and a child). `web/src/page/map/sprites.ts` says who is drawn with which.
- A place has its footprint in cells and the anchor at the south-west corner of the footprint on the ground. A house has the mounts of its two door lanterns, a building with windows names the sprite of its lit windows (`lights`, see below), and the bridge has the lift of a walker on its deck.
- A prop or an effect has a footprint or a blend mode, and the lantern says where its glow goes. A tree, a heap of mossy stones and a pile of junk are props with a footprint of one cell.

Frame sizes, anchors and offsets are in pixels at scale 1. The 2x atlas holds the same frames at twice the size. The page draws both at the logical size of scale 1.

## The windows at night

For a building with windows, render `fx.windows.<name>` from the same model using ray marcher mode `uMode 1`. In that mode, lit panes and lantern paper are a flat warm colour. The other surfaces remain transparent while still blocking surfaces behind them. This leaves the window lattice dark. The client draws the effect over the building at night using the building’s anchor and its `lights` reference. The effect’s `spots` field gives halo rectangles as `[x, y, w, h]` in 1x pixels from the anchor, with y down. Instances of each house model share one window sprite. Stalls and the bridge have none.

## Objects for the corner of the page

The manager’s tools in the page corner come from four sprites. `prop.elder_seal` has a stone face engraved with 族 and a red cord. `prop.notebook` is a thread-bound book with a 见闻簿 label and the spine on the right. `prop.incense_unlit` and `prop.incense_lit` are the same bronze incense burner with an unlit stick or a glowing tip and smoke. All four use the map’s camera and light, measure 57 to 71 px high at 1x and have a single anchor with no footprint. The burner sprites share their anchor and the space below it, so only the smoke rises when the client switches to the lit sprite.

A page draws one like any other sprite of the manifest: `frames` gives `[page, x, y]` in the atlas, `frame` the size in pixels at 1x and `anchor` the ground point in the frame.

The objects have a shader program of their own. `src/shaders/objects.glsl` holds their three models, their materials and the choice between them, and `engine.js` compiles it as the program `objects`: the same marcher and figures with these models in place of the places. The program that bakes every other sprite does not contain these models, and neither does its decal canvas, so adding an object to the kit never changes a sprite that is already in the atlas. The characters on the seal and the label are outlines of Ma Shan Zheng (`src/page/glyphs.js`, made by `tools/fonts/glyph_paths.py`), drawn into a decal canvas of their own by `makeObjectsDecal` in `places.js`.

## Comparing two bakes

```
node tools/sprite-kit/compare.mjs web/public/sprites tools/sprite-kit/out [--partial]
```

The comparison decodes both atlases in Chromium, checks each sprite frame byte for byte and compares the manifest entries. Atlas positions are excepted because frame packing can move pixels without changing them. The tool lists new sprite IDs without failing. `--partial` allows missing IDs in the new bake for runs using `--only`. The process exits with 0 if all compared entries match.

## Where the art goes

`web/public/sprites/` holds the files that the page loads: the atlases (`atlas-1x.webp`, and `atlas-2x-1.webp` and `atlas-2x-2.webp` when the 2x atlas does not fit one page of 4096 pixels) and `manifest.json`. After a bake, take the old atlases out of there and copy the new files from `out/`.

```
rm web/public/sprites/atlas-*.webp
cp tools/sprite-kit/out/atlas-*.webp tools/sprite-kit/out/manifest.json web/public/sprites/
```

The page reads the manifest and takes no frame from a fixed place. A sprite that is new in the manifest needs no change of code once `web/src/page/map/sprites.ts` says whom or what it draws.

## The bake is deterministic

The same source and options yield byte-identical files. The packer sorts frames before writing, regardless of the order in which Chromium jobs finish. It also strips Chromium’s colour profile. Timings live outside `out/`. Changes to the atlases or `manifest.json` in `web/public/sprites/` therefore reflect a change in the source or options.

## The sources

- `bake.mjs` starts the browsers, deals the frames out to them, packs the atlases and writes the files.
- `src/shaders/` is the GLSL: `march.glsl` is the ray marcher, `figures.glsl` the people, `places.glsl` the teahouse, the family houses, the pier, the bridge, the bamboo, the lantern and the willow, `town.glsl` the other buildings (one shared body for a plain house, and a function for each building with what makes it its own), `trees.glsl` the trees, the heap of stones and the pile of junk, `dispatch.glsl` which model a place is and the albedo of the place materials (and the night light), `common.glsl` the helpers they share, and `post.glsl` the ink lines and the last pass.
- `src/shaders/objects.glsl` is the program of the objects for the corner of the page, and `compare.mjs` compares two bakes.
- `src/page/` runs in the browser page. `config.js` has the units, the camera, the light and the palette, `engine.js` the WebGL2 engine, `catalog.js` the people and their animations, `places.js` the places and the props with their footprints (taken from `content/maps/bridge_town.yaml`) and the lit windows made from them, `bake.js` bakes one frame, `compose.js` trims and packs the frames (and finds the windows of a night light), `gif.js` makes the preview, and `glyphs.js` holds the outlines of the characters on the seal and the label.
