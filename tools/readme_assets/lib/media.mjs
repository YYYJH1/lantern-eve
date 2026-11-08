// ffmpeg, for the two things the pictures need: a GIF made from a folder of frames, and a PNG
// cut down to a palette so that it stays small. ffmpeg is taken from PATH, or from the variable FFMPEG.

import { spawn } from 'node:child_process';
import { copyFile, link, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', (error) => reject(new Error(`cannot run ffmpeg: ${error.message}`)));
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

/** The ffmpeg filter that draws a one-pixel outline, so that a picture of a page stands out on a page of nearly its own colour. */
export const outline = (color) => `drawbox=x=0:y=0:w=iw:h=ih:color=0x${color}:t=1`;

/**
 * Number the frames for ffmpeg. `frames` is a list of {file, hold}: the picture and how many
 * frames it stays for. The numbered files are hard links, so a long hold costs nothing.
 */
export async function numberFrames(frames, dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  let n = 0;
  for (const { file, hold } of frames) {
    for (let i = 0; i < hold; i++) {
      n += 1;
      const target = path.join(dir, `${String(n).padStart(5, '0')}.png`);
      await link(file, target).catch(() => copyFile(file, target));
    }
  }
  return n;
}

/**
 * Make a GIF from numbered frames (see numberFrames). The picture is scaled to `width`, gets a
 * palette made from all of its frames and is written with as many colours as fit under `maxBytes`.
 * Returns the size and the number of colours.
 */
export async function makeGif({ dir, out, fps, width, edge, maxBytes, palette }) {
  const filters = `scale=${width}:-1:flags=lanczos,${outline(edge)}`;
  for (const colors of [256, 192, 128, 96, 64, 48, 32]) {
    await ffmpeg([
      '-framerate', String(fps), '-i', path.join(dir, '%05d.png'),
      '-vf', `${filters},palettegen=max_colors=${colors}:stats_mode=full`, palette,
    ]);
    await ffmpeg([
      '-framerate', String(fps), '-i', path.join(dir, '%05d.png'), '-i', palette,
      '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=none:diff_mode=rectangle`,
      '-loop', '0', out,
    ]);
    const { size } = await stat(out);
    if (size <= maxBytes) return { size, colors };
  }
  const { size } = await stat(out);
  return { size, colors: 32, tooLarge: true };
}

/** Write a PNG with a palette of at most `colors` colours, which is a fraction of the size of the true-colour one. */
export async function quantizePng({ input, out, colors, palette, crop }) {
  const cut = crop === undefined ? '' : `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},`;
  await ffmpeg(['-i', input, '-vf', `${cut}palettegen=max_colors=${colors}:stats_mode=full`, '-frames:v', '1', '-update', '1', palette]);
  await ffmpeg([
    '-i', input, '-i', palette,
    '-lavfi', `${cut.slice(0, -1) || 'null'} [x]; [x][1:v] paletteuse=dither=none`,
    '-frames:v', '1', '-update', '1', '-compression_level', '9', out,
  ]);
  const { size } = await stat(out);
  return size;
}
