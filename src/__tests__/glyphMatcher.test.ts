/**
 * End-to-end check on the beginner keyboard's component matcher.
 *
 * The real risk this guards is DRIFT between the two halves of the recognizer:
 * the offline generator (server/scripts/backfill/chinese/generate-handwriting-templates.js)
 * bakes hanzi-writer medians through inkGeometry, and the runtime pushes captured
 * ink through the same functions. If either side changes independently, every
 * stored template silently becomes wrong — scores stay plausible, rankings go bad,
 * and nothing throws. So this test reads the COMMITTED asset and feeds it ink
 * derived from the ORIGINAL hanzi-writer-data, closing the loop.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6s.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseGlyphTemplates, KIND_COMPONENT, KIND_CHARACTER } from '../components/handwriting/glyphTemplates';
import { explainGlyphMatch, matchGlyphs } from '../components/handwriting/glyphMatcher';
import { POINTS_PER_STROKE } from '../components/handwriting/inkGeometry';
import type { Ink } from '../components/handwriting/types';
import { hasMedians, inkFromMedians } from './support/inkFromMedians';
import realInk from './support/realInk.json';

const ASSET = path.resolve(__dirname, '../assets/handwriting/glyph-templates.bin');

function loadTemplates() {
  const buffer = fs.readFileSync(ASSET);
  // Node's Buffer may be a view onto a larger pool, so slice to this file's bytes.
  return parseGlyphTemplates(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
}

/**
 * Synthetic ink comes from `./support/inkFromMedians`, which converts hanzi-writer's
 * y-up medians into the y-down space a canvas produces (§ 6y).
 *
 * It is deliberately NOT the fingerprint path: medians are raw and unresampled,
 * exactly as a learner's raw pointer samples are raw. Both must survive the same
 * normalization to be comparable.
 */
describe('glyph template asset', () => {
  it('parses with the header the client expects', () => {
    const templates = loadTemplates();
    expect(templates.pointsPerStroke).toBe(POINTS_PER_STROKE);
    expect(templates.chars.length).toBeGreaterThan(7000);
    expect(templates.strokeCounts.length).toBe(templates.chars.length);
    // Every template must have at least one stroke, or it can never be matched.
    expect(Math.min(...templates.strokeCounts)).toBeGreaterThan(0);
    // Every template must claim at least one role, or nothing can be done with
    // a tap on it.
    expect(Math.min(...templates.kinds)).toBeGreaterThan(0);
  });

  it('carries both halves of the union, with overlap', () => {
    const { kinds } = loadTemplates();
    let components = 0;
    let characters = 0;
    let both = 0;
    for (const kind of kinds) {
      if (kind & KIND_COMPONENT) components++;
      if (kind & KIND_CHARACTER) characters++;
      if ((kind & KIND_COMPONENT) && (kind & KIND_CHARACTER)) both++;
    }
    expect(components).toBeGreaterThan(800);
    expect(characters).toBeGreaterThan(7000);
    // The overlap is the whole reason kind is a bitfield rather than an enum:
    // most components are also standalone headwords, and duplicating their
    // strokes into two templates would double-score them in every match.
    expect(both).toBeGreaterThan(700);
  });

  it('derives one centroid per stroke, inside the normalized box', () => {
    const { centroids, centroidOffsets, strokeCounts, coords, offsets, pointsPerStroke } = loadTemplates();
    const last = strokeCounts.length - 1;
    expect(centroids.length).toBe(centroidOffsets[last] + strokeCounts[last] * 2);
    // Spot-check that a centroid really is the mean of its stroke — this is the
    // prefilter's whole basis, and a wrong offset would silently degrade recall
    // rather than throw.
    for (const i of [0, 100, last]) {
      let sumX = 0;
      for (let k = 0; k < pointsPerStroke; k++) sumX += coords[offsets[i] + k * 2];
      expect(centroids[centroidOffsets[i]]).toBeCloseTo(sumX / pointsPerStroke, 5);
    }
  });

  it('has coordinates inside the normalized box', () => {
    const { coords } = loadTemplates();
    // normalizeStrokes divides by the larger box dimension, so no coordinate can
    // exceed ±0.5 by more than quantization rounding.
    let max = 0;
    for (let i = 0; i < coords.length; i++) max = Math.max(max, Math.abs(coords[i]));
    expect(max).toBeLessThanOrEqual(0.51);
  });
});

describe('matchGlyphs', () => {
  it('ranks a component first when given its own strokes', () => {
    const templates = loadTemplates();
    // A spread of shapes: simple/complex, bound radical forms, one-stroke.
    for (const char of ['木', '氵', '心', '目', '一', '口', '女', '言']) {
      const [top] = matchGlyphs(inkFromMedians(char), templates, { limit: 1 });
      expect(top.char, `expected ${char} to match itself`).toBe(char);
    }
  });

  it('is insensitive to stroke order', () => {
    const templates = loadTemplates();
    const ink = inkFromMedians('木');
    const shuffled = [ink[3], ink[0], ink[2], ink[1]];
    expect(matchGlyphs(shuffled, templates, { limit: 1 })[0].char).toBe('木');
  });

  it('is insensitive to stroke direction', () => {
    const templates = loadTemplates();
    const reversed = inkFromMedians('木').map((stroke) => ({
      xs: [...stroke.xs].reverse(),
      ys: [...stroke.ys].reverse(),
      ts: stroke.ts,
    }));
    expect(matchGlyphs(reversed, templates, { limit: 1 })[0].char).toBe('木');
  });

  it('is insensitive to size and position', () => {
    const templates = loadTemplates();
    const shifted = inkFromMedians('心').map((stroke) => ({
      xs: stroke.xs.map((x) => x * 0.25 + 700),
      ys: stroke.ys.map((y) => y * 0.25 - 300),
      ts: stroke.ts,
    }));
    expect(matchGlyphs(shifted, templates, { limit: 1 })[0].char).toBe('心');
  });

  it('still finds the component when a stroke is missing', () => {
    // The no-stroke-count-gate rule (§ 6s): dropping a stroke must degrade the
    // ranking, never exclude the answer. A hard gate would score 0% here.
    const templates = loadTemplates();
    const partial = inkFromMedians('目').slice(0, -1);
    const top5 = matchGlyphs(partial, templates, { limit: 5 }).map((c) => c.char);
    expect(top5).toContain('目');
  });

  it('never returns an empty list for non-empty ink', () => {
    // With no clear button, an empty candidate row strands the learner with ink
    // they cannot remove (§ 6r). Even nonsense must produce candidates.
    const templates = loadTemplates();
    const scribble: Ink = [{ xs: [0, 10, 3, 40], ys: [0, 90, 20, 5], ts: [0, 16, 32, 48] }];
    expect(matchGlyphs(scribble, templates).length).toBeGreaterThan(0);
  });

  it('returns nothing for empty ink', () => {
    expect(matchGlyphs([], loadTemplates())).toEqual([]);
  });

  it('recognizes a whole character, not just its parts', () => {
    // The reason the asset is the union (§ 6s): against a components-only set,
    // 想 returned 耤 替 赖 越 彗 — confident nonsense. The learner is not told to
    // draw parts, so drawing a whole character has to work.
    const templates = loadTemplates();
    for (const char of ['想', '你', '我', '爱', '谢', '学']) {
      const top5 = matchGlyphs(inkFromMedians(char), templates, { limit: 5 }).map((c) => c.char);
      expect(top5, `expected ${char} in its own top 5`).toContain(char);
    }
  });

  it('is simplified-only, by scope', () => {
    // DECIDED 2026-09-07: this version does not accept traditional input. 請 is
    // absent not because hanzi-writer-data lacks it — the file is right there —
    // but because the inventory is drawn from dictionaryentries_zh, which is
    // simplified. Pinned so that the boundary is explicit rather than incidental:
    // if traditional is ever admitted, this test is the thing that says where
    // the decision was made.
    const templates = loadTemplates();
    expect(hasMedians('請')).toBe(true);
    expect(templates.chars).not.toContain('請');
    const top5 = matchGlyphs(inkFromMedians('請'), templates, { limit: 5 }).map((c) => c.char);
    expect(top5).not.toContain('請');
    // And it still answers — never an empty row (§ 6r).
    expect(top5.length).toBe(5);
  });

  it('labels each candidate with what a tap should do', () => {
    // The candidate row is one mixed ranked list, so the role bits are the only
    // thing distinguishing "append to the buffer" from "commit as text".
    const templates = loadTemplates();
    const candidates = matchGlyphs(inkFromMedians('木'), templates, { limit: 10 });
    for (const candidate of candidates) {
      expect(candidate.kind & (KIND_COMPONENT | KIND_CHARACTER)).toBeGreaterThan(0);
    }
    // 木 is both — it heads the row and is tappable either way.
    expect(candidates[0].char).toBe('木');
    expect(candidates[0].kind & KIND_COMPONENT).toBeTruthy();
    expect(candidates[0].kind & KIND_CHARACTER).toBeTruthy();
  });

  it('honours a kind mask', () => {
    const templates = loadTemplates();
    const componentsOnly = matchGlyphs(inkFromMedians('想'), templates, {
      limit: 20,
      kindMask: KIND_COMPONENT,
    });
    expect(componentsOnly.length).toBe(20);
    for (const candidate of componentsOnly) {
      expect(candidate.kind & KIND_COMPONENT).toBeTruthy();
    }
  });

  it('does not let the coarse prefilter drop the right answer', () => {
    // The cascade is only safe if stage 1 keeps what stage 2 would have chosen.
    // Compare a pooled match against an exhaustive one over the same set.
    const templates = loadTemplates();
    for (const char of ['木', '心', '想', '目']) {
      const pooled = matchGlyphs(inkFromMedians(char), templates, { limit: 1 });
      const exhaustive = matchGlyphs(inkFromMedians(char), templates, {
        limit: 1,
        pool: templates.chars.length,
      });
      expect(pooled[0].char, `prefilter changed the winner for ${char}`).toBe(exhaustive[0].char);
    }
  });
});

describe('real hand-drawn ink (§ 6y)', () => {
  /**
   * ⚠️ THE REGRESSION TEST FOR THE MIRRORED-TEMPLATE BUG, AND THE ONLY TEST HERE
   * THAT IS NOT SYNTHETIC.
   *
   * Every other case in this file builds ink from the same medians the templates
   * come from. That symmetry is exactly what hid a y-axis inversion for the whole
   * of the feature's development: both sides were mirrored, the error cancelled,
   * and the suite reported 85–100% top-1 for a matcher that ranked two real
   * drawings of 尔 at 1409 and 1670 out of 7,258.
   *
   * These samples came off a device through the § 6w debug dump. They are the
   * only evidence in the repo about how the matcher behaves on a human hand, so
   * they are checked in verbatim — never regenerate them from medians.
   */
  it('ranks 尔 first for both captured samples', () => {
    const templates = loadTemplates();
    for (const sample of realInk.samples) {
      const ink: Ink = sample.strokes.map((stroke) => ({
        xs: stroke.x,
        ys: stroke.y,
        ts: stroke.x.map((_, i) => i * 16),
      }));
      const candidates = matchGlyphs(ink, templates, { limit: 5 });
      expect(candidates[0].char, `${sample.note}: top-5 was ${candidates.map((c) => c.char).join('')}`).toBe(
        sample.glyph,
      );
    }
  });

  it('pairs each drawn stroke with the template stroke of the same index', () => {
    // The signature of a genuine match, and the thing that localized the bug: a
    // mirrored corpus produced a scrambled permutation instead.
    const templates = loadTemplates();
    const sample = realInk.samples[0];
    const ink: Ink = sample.strokes.map((stroke) => ({
      xs: stroke.x,
      ys: stroke.y,
      ts: stroke.x.map((_, i) => i * 16),
    }));
    const explained = explainGlyphMatch(ink, templates, '尔');
    expect(explained.rank).toBe(0);
    for (const pairing of explained.pairings) expect(pairing.template).toBe(pairing.drawn);
  });
});
