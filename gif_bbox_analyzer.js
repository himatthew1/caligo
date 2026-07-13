const fs = require('fs');
const { GifReader } = require('omggif');

function analyzeGif(filePath, label) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const reader = new GifReader(data);
  const width = reader.width;
  const height = reader.height;
  const numFrames = reader.numFrames();

  console.log(`\n=== ${label} ===`);
  console.log(`File: ${filePath}`);
  console.log(`Canvas size: ${width}x${height}`);
  console.log(`Number of frames: ${numFrames}`);

  // Print frame info for debugging
  for (let i = 0; i < numFrames; i++) {
    const info = reader.frameInfo(i);
    console.log(`  Frame ${i}: ${info.width}x${info.height} at (${info.x},${info.y}), disposal=${info.disposal}, transparent_index=${info.transparent_index}`);
  }

  return { reader, width, height, numFrames };
}

function compositeAllFrames(reader, width, height, numFrames) {
  // The "current canvas" that accumulates composited pixels
  // RGBA format, 4 bytes per pixel
  const canvas = new Uint8Array(width * height * 4); // starts all zeros (transparent black)

  // We also need a "previous canvas" for disposal method 3 (restore to previous)
  let previousCanvas = null;

  for (let i = 0; i < numFrames; i++) {
    const info = reader.frameInfo(i);

    // Before applying the new frame, save state if next disposal might need it
    // Disposal method 3 = restore to previous state (before this frame was drawn)
    // We save BEFORE drawing the current frame
    if (info.disposal === 3) {
      previousCanvas = new Uint8Array(canvas);
    }

    // Decode the frame's raw pixel data (just the frame's sub-rectangle)
    const framePixels = new Uint8Array(width * height * 4);
    reader.decodeAndBlitFrameRGBA(i, framePixels);

    // Composite the frame onto the canvas
    // The frame occupies the region (info.x, info.y) to (info.x+info.width, info.y+info.height)
    for (let y = info.y; y < info.y + info.height; y++) {
      for (let x = info.x; x < info.x + info.width; x++) {
        const idx = (y * width + x) * 4;
        const alpha = framePixels[idx + 3];
        if (alpha > 0) {
          // This pixel is not transparent in the frame, so it overwrites canvas
          canvas[idx] = framePixels[idx];
          canvas[idx + 1] = framePixels[idx + 1];
          canvas[idx + 2] = framePixels[idx + 2];
          canvas[idx + 3] = framePixels[idx + 3];
        }
        // If alpha == 0 and the frame has a transparent index, leave canvas as-is
        // (transparent pixels in the frame don't erase the canvas)
      }
    }

    // After drawing the frame, apply disposal for the NEXT frame's starting state
    // But we only apply disposal AFTER the frame is displayed (i.e., before next frame)
    // We'll apply disposal at the START of next iteration, or rather, we handle it
    // at the end here so the canvas is correct after the last frame too.
    //
    // Actually, disposal tells us what to do with the frame's area AFTER it's been displayed
    // and BEFORE the next frame is drawn. For the LAST frame, disposal doesn't matter
    // because we want the composited result.
    //
    // But since we want the final composited state after the last frame, we should NOT
    // apply disposal after the last frame. We only apply disposal between frames.
    if (i < numFrames - 1) {
      applyDisposal(canvas, info, width, height, previousCanvas);
    }
  }

  return canvas;
}

function applyDisposal(canvas, info, width, height, previousCanvas) {
  switch (info.disposal) {
    case 0: // No disposal - leave as is (do nothing)
    case 1: // Do not dispose - leave as is
      break;
    case 2: // Restore to background - clear the frame's area to transparent
      for (let y = info.y; y < info.y + info.height; y++) {
        for (let x = info.x; x < info.x + info.width; x++) {
          const idx = (y * width + x) * 4;
          canvas[idx] = 0;
          canvas[idx + 1] = 0;
          canvas[idx + 2] = 0;
          canvas[idx + 3] = 0;
        }
      }
      break;
    case 3: // Restore to previous
      if (previousCanvas) {
        // Restore the entire canvas to the saved state
        canvas.set(previousCanvas);
      }
      break;
  }
}

function findBoundingBox(pixels, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  let nonTransparentCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = pixels[idx + 3];
      if (alpha > 0) {
        nonTransparentCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1) {
    console.log('  WARNING: No non-transparent pixels found!');
    return null;
  }

  // Bounding box in pixels (maxX+1 and maxY+1 because we want the right/bottom edge)
  const bboxPx = { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
  // Bounding box as percentages of canvas
  const bboxPct = {
    x0: (minX / width * 100),
    y0: (minY / height * 100),
    x1: ((maxX + 1) / width * 100),
    y1: ((maxY + 1) / height * 100),
  };
  // Center point as percentage
  const centerPct = {
    x: ((minX + maxX + 1) / 2 / width * 100),
    y: ((minY + maxY + 1) / 2 / height * 100),
  };
  // Dimensions
  const bboxWidth = maxX + 1 - minX;
  const bboxHeight = maxY + 1 - minY;

  return { bboxPx, bboxPct, centerPct, bboxWidth, bboxHeight, nonTransparentCount };
}

function printResults(label, bbox, width, height) {
  if (!bbox) return;
  console.log(`\n--- ${label} Bounding Box ---`);
  console.log(`  Pixels: x0=${bbox.bboxPx.x0}, y0=${bbox.bboxPx.y0}, x1=${bbox.bboxPx.x1}, y1=${bbox.bboxPx.y1}`);
  console.log(`  Size: ${bbox.bboxWidth}x${bbox.bboxHeight} pixels`);
  console.log(`  Percentages: x0=${bbox.bboxPct.x0.toFixed(2)}%, y0=${bbox.bboxPct.y0.toFixed(2)}%, x1=${bbox.bboxPct.x1.toFixed(2)}%, y1=${bbox.bboxPct.y1.toFixed(2)}%`);
  console.log(`  Center: x=${bbox.centerPct.x.toFixed(2)}%, y=${bbox.centerPct.y.toFixed(2)}%`);
  console.log(`  Non-transparent pixels: ${bbox.nonTransparentCount} / ${width * height} (${(bbox.nonTransparentCount / (width * height) * 100).toFixed(1)}%)`);
}

// ============ SPAWN GIF (last frame) ============
const spawnPath = 'C:\\Users\\user\\Desktop\\board-game\\public\\art\\rat_black_spawn.gif';
const { reader: spawnReader, width: sw, height: sh, numFrames: snf } = analyzeGif(spawnPath, 'SPAWN GIF (rat_black_spawn.gif)');

// Composite all frames to get the final (last) frame's visual state
const spawnComposited = compositeAllFrames(spawnReader, sw, sh, snf);
const spawnBbox = findBoundingBox(spawnComposited, sw, sh);
printResults('Spawn Last Frame (composited)', spawnBbox, sw, sh);

// Also decode JUST the last frame raw (without compositing) for comparison
const spawnLastRaw = new Uint8Array(sw * sh * 4);
spawnReader.decodeAndBlitFrameRGBA(snf - 1, spawnLastRaw);
const spawnLastRawBbox = findBoundingBox(spawnLastRaw, sw, sh);
printResults('Spawn Last Frame (raw, no compositing)', spawnLastRawBbox, sw, sh);

// ============ IDLE GIF (first frame) ============
const idlePath = 'C:\\Users\\user\\Desktop\\board-game\\public\\art\\rat_black_idle.gif';
const { reader: idleReader, width: iw, height: ih, numFrames: inf_ } = analyzeGif(idlePath, 'IDLE GIF (rat_black_idle.gif)');

// First frame - just decode it directly (no prior frames to composite)
const idleFirst = new Uint8Array(iw * ih * 4);
idleReader.decodeAndBlitFrameRGBA(0, idleFirst);
const idleBbox = findBoundingBox(idleFirst, iw, ih);
printResults('Idle First Frame', idleBbox, iw, ih);

// ============ SUMMARY ============
console.log('\n========== SUMMARY ==========');
if (spawnBbox) {
  console.log(`Spawn last frame bbox (% of ${sw}x${sh}): x0=${spawnBbox.bboxPct.x0.toFixed(2)}%, y0=${spawnBbox.bboxPct.y0.toFixed(2)}%, x1=${spawnBbox.bboxPct.x1.toFixed(2)}%, y1=${spawnBbox.bboxPct.y1.toFixed(2)}%`);
  console.log(`Spawn last frame center: (${spawnBbox.centerPct.x.toFixed(2)}%, ${spawnBbox.centerPct.y.toFixed(2)}%)`);
}
if (idleBbox) {
  console.log(`Idle first frame bbox (% of ${iw}x${ih}): x0=${idleBbox.bboxPct.x0.toFixed(2)}%, y0=${idleBbox.bboxPct.y0.toFixed(2)}%, x1=${idleBbox.bboxPct.x1.toFixed(2)}%, y1=${idleBbox.bboxPct.y1.toFixed(2)}%`);
  console.log(`Idle first frame center: (${idleBbox.centerPct.x.toFixed(2)}%, ${idleBbox.centerPct.y.toFixed(2)}%)`);
}
