/**
 * Provides configurable bag or true-random polyomino generation for sessions.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { bagGenerator } from "../config/gameplayConstants.js";
import { bagGeneratorForPreset, roomBagGenerator } from "../config/bags.js";

const DEFAULT_QUEUE_SIZE = 5;
const MAX_QUEUE_SIZE = 6;
const colorNumber = (color) =>
  Number.isFinite(color)
    ? color
    : Number.parseInt(String(color).replace("#", ""), 16) || 0xffffff;

const shuffle = (items, random) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
export class PieceQueue {
  constructor(random = Math.random, preset = null, roomRules = null) {
    this.random = random;
    this.preset = preset;
    this.roomRules = roomRules;
    this.targetSize = Math.max(
      0,
      Math.min(
        MAX_QUEUE_SIZE,
        Math.floor(Number(roomRules?.mutators?.queueSize ?? DEFAULT_QUEUE_SIZE)),
      ),
    );
    this.bag = [];
    this.items = [];
    // Priority entries are gameplay-real next pieces, but deliberately stay
    // outside `items`: the renderer, replay queue snapshots, and opponents'
    // visible previews must never reveal a God Essence item block early.
    this.hiddenItems = [];
    // Only queue-disabled games need deferred PM Order mutations: there is no
    // visible future PM to mutate until the next spawn is drawn.
    this.pendingAttachments = 0;
    this.pendingGems = 0;
    // Material effects operate on whole upcoming PMs. Existing previews are
    // changed immediately; this FIFO owns the remainder when an effect
    // reaches beyond the configured preview length (including queue size 0).
    // God Essence rewards intentionally never enter this queue: they are
    // separate, hidden priority entries and must remain their special O PM.
    this.materialQueue = [];
  }
  addAttachments(count = 0) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    // Every visible queue mutation happens immediately, with replacement, so
    // a large attack can grow the same PM several times. The sole deferred
    // case is a disabled queue: the entire attack belongs to the next PM.
    if (!total) return 0;
    if (!this.items.length) {
      if (this.targetSize === 0) this.pendingAttachments += total;
      return this.targetSize === 0 ? total : 0;
    }
    // Item blocks are complete authored rewards/attacks, not ordinary PMs.
    // PM Order must never fuse an attachment onto one. If only item blocks
    // are visible, this attack has no legal target and simply fizzles.
    const candidates = this.items.filter((item) =>
      item && !this.isGodEssenceItem(item),
    );
    if (!candidates.length) return 0;
    let applied = 0;
    for (let index = 0; index < total; index += 1) {
      const item = candidates[Math.floor(this.random() * candidates.length)];
      if (this.attachTo(item)) applied += 1;
    }
    return applied;
  }
  attachTo(item, material = "attachment") {
    if (!item || this.isGodEssenceItem(item)) return false;
    const minos = (item.minos || item.matrix?.flatMap((row, y) =>
      row.flatMap((filled, x) => (filled ? [{ x, y }] : [])),
    ) || []).map((mino) => ({ ...mino }));
    if (!minos.length) return false;
    const occupied = new Set(minos.map((mino) => `${mino.x},${mino.y}`));
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const candidates = new Map();
    for (const anchor of minos) {
      for (const [dx, dy] of neighbors) {
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        const key = `${x},${y}`;
        if (!occupied.has(key)) candidates.set(key, { x, y, anchor });
      }
    }
    const attachment = [...candidates.values()][
      Math.floor(this.random() * candidates.size)
    ];
    if (!attachment) return false;
    const expanded = [...minos, {
      x: attachment.x,
      y: attachment.y,
      colorIndex: attachment.anchor.colorIndex ?? item.colorIndex ?? -1,
      material,
      ...(material === "attachment" ? { attachment: true } : {}),
      ...(material === "gem" ? { gem: true } : {}),
    }];
    // Rebase the complete PM around its true occupied bounds. This makes the
    // added mino part of matrix geometry, rather than an extra renderer-only
    // cell, so rotations, collision and adjacency all agree.
    const minX = Math.min(...expanded.map((mino) => mino.x));
    const minY = Math.min(...expanded.map((mino) => mino.y));
    const normalized = expanded.map((mino) => ({
      ...mino,
      x: mino.x - minX,
      y: mino.y - minY,
    }));
    const width = Math.max(...normalized.map((mino) => mino.x)) + 1;
    const height = Math.max(...normalized.map((mino) => mino.y)) + 1;
    const matrix = Array.from({ length: height }, () => Array(width).fill(false));
    normalized.forEach((mino) => {
      matrix[mino.y][mino.x] = true;
    });
    item.matrix = matrix;
    item.minos = normalized;
    item.order = (Number(item.order) || minos.length) + 1;
    return true;
  }
  addGems(count = 0) {
    this.pendingGems += Math.max(0, Math.floor(Number(count) || 0));
  }
  isGodEssenceItem(item) {
    return Boolean(
      item?.godEssenceReward ||
      Number.isInteger(item?.godEssenceItemIndex),
    );
  }
  materializeMinos(item) {
    if (!item) return [];
    if (Array.isArray(item.minos) && item.minos.length)
      return item.minos.map((mino) => ({ ...mino }));
    return (item.matrix || []).flatMap((row, y) =>
      row.flatMap((filled, x) => (filled ? [{ x, y, material: "default" }] : [])),
    );
  }
  applyMaterial(item, material) {
    if (!item || this.isGodEssenceItem(item)) return false;
    const minos = this.materializeMinos(item);
    if (!minos.length) return false;
    // PM Order attachments and God Essence crystals are deliberately
    // excluded. They retain their own gameplay material while only ordinary
    // PM minos receive the elemental queue effect.
    const isDefaultMino = (mino) =>
      !mino.attachment && mino.material !== "attachment" &&
      !mino.gem && mino.material !== "gem" &&
      (!mino.material || mino.material === "default");
    // A PM already converted by Filler/Metal/etc. is not a new target for a
    // later queue-material effect. Leave it alone and carry that assignment
    // forward to the next ordinary PM instead.
    if (!minos.some(isDefaultMino)) return false;
    item.minos = minos.map((mino) =>
      isDefaultMino(mino)
        ? {
            ...mino,
            material,
            ...(material === "metal" ? { metalLives: mino.metalLives ?? 3 } : {}),
          }
        : mino,
    );
    return true;
  }
  setUpcomingMaterial(material, count = 0) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    if (!total || !material) return 0;
    let remaining = total;
    // Mutate all normal previews in first-to-spawn order. Foreign God Essence
    // items may be visibly queued, but are authored attacks and are never
    // converted into a material PM.
    for (const item of this.items) {
      if (!remaining) break;
      if (!this.applyMaterial(item, material)) continue;
      remaining -= 1;
    }
    // Preview slots cannot represent the rest. Preserve it for the next
    // generated normal PMs; draw() consumes this FIFO one PM at a time.
    while (remaining-- > 0) this.materialQueue.push(material);
    return total;
  }
  enqueueHidden(item) {
    if (!item) return false;
    this.hiddenItems.push(item);
    return true;
  }
  enqueueVisible(item) {
    if (!item) return false;
    // Fill the normal preview first, then append after it. This makes an
    // incoming foreign item visible and preserves every already-authored
    // queue entry ahead of it.
    if (this.targetSize) this.fill();
    this.items.push(item);
    return true;
  }
  hasHiddenItems() {
    return this.hiddenItems.length > 0;
  }
  applyPendingGems(item) {
    if (!this.pendingGems) return 0;
    // Each new queue entry takes a proportional share of the balance. A
    // disabled queue has one effective slot: all pending gems belong to the
    // next entering PM.
    const gems = Math.ceil(this.pendingGems / Math.max(1, this.targetSize));
    this.pendingGems -= gems;
    const minos = item.minos.map((mino) => ({ ...mino }));
    const order = shuffle([...minos.keys()], this.random);
    const replacements = Math.min(gems, minos.length);
    for (let index = 0; index < replacements; index += 1) {
      const minoIndex = order[index];
      minos[minoIndex] = { ...minos[minoIndex], material: "gem", gem: true };
    }
    item.minos = minos;
    // Once every original mino is a gem, keep adding fused gem cells. This
    // intentionally raises the PM order: e.g. 25 pending gems with QS 5
    // makes the next trimino an all-gem pentomino.
    for (let index = replacements; index < gems; index += 1)
      this.attachTo(item, "gem");
    return gems;
  }
  next() {
    if (this.hiddenItems.length) return this.hiddenItems.shift();
    if (!this.targetSize) return this.items.shift() || this.draw();
    this.fill();
    const next = this.items.shift();
    this.fill();
    return next;
  }
  // Inspect the next queued type without consuming it. Physics release uses
  // this to wait for a safe spawn position while the pile keeps simulating.
  peek() {
    if (this.hiddenItems.length) return this.hiddenItems[0];
    if (!this.targetSize) {
      if (!this.items.length) this.items.push(this.draw());
      return this.items[0];
    }
    this.fill();
    return this.items[0];
  }
  fill() {
    let steps = 0;
    while (this.items.length < this.targetSize) {
      if (++steps > this.targetSize + 1) {
        console.error("[PieceQueue] Refill safety limit reached.", {
          items: this.items.length,
          steps,
        });
        break;
      }
      this.items.push(this.draw());
    }
  }
  draw() {
    if (!this.bag.length) {
      const source = this.roomRules?.bag
        ? roomBagGenerator(this.roomRules.bag, this.roomRules.physics?.materials, this.random)
        : this.preset
        ? bagGeneratorForPreset(this.preset, this.random, bagGenerator)
        : typeof bagGenerator === "function"
          ? bagGenerator(this.random)
          : bagGenerator;
      this.bag = shuffle(source, this.random);
    }
    const definition = this.bag.pop();
    const chain = this.roomRules?.chain;
    const palette = (chain?.colors || [])
      .slice(0, Math.max(1, Number(chain?.colorCount) || 1))
      .map(colorNumber);
    // Palette assignments remain authored data in every mode, but Lines Out
    // must never render them. Keep indices for a later mode change while
    // withholding the render palette from its queue/active-piece cells.
    const usesColorChain = Boolean(chain && palette.length);
    const rendersColorChain = ["color-lines", "color-clusters"].includes(chain?.mode);
    const pickIndex = () => Math.floor(this.random() * palette.length);
    const colorIndex = usesColorChain ? pickIndex() : undefined;
    const item = usesColorChain
      ? {
          ...definition,
          colorIndex,
          palette: rendersColorChain ? palette : null,
          minos: Array.isArray(definition.minos)
            ? definition.minos.map((mino) => ({
                ...mino,
                colorIndex: chain.colorPerMino ? pickIndex() : colorIndex,
                material: mino.material || "default",
              }))
            : definition.matrix.flatMap((row, y) =>
                row.flatMap((filled, x) =>
                  filled
                    ? [{ x, y, colorIndex: chain.colorPerMino ? pickIndex() : colorIndex, material: "default" }]
                    : [],
                ),
              ),
        }
      : {
          ...definition,
          minos: (definition.minos || definition.matrix.flatMap((row, y) =>
            row.flatMap((filled, x) => (filled ? [{ x, y }] : [])),
          )).map((mino) => ({ ...mino })),
        };
    if (this.pendingAttachments || this.pendingGems) {
      this.applyPendingGems(item);
      // Queue-disabled PM Order attacks all land on this one newly generated
      // PM. `attachTo` rebuilds its matrix every time, so every attachment is
      // fused and rotates with the resulting polyomino.
      while (this.pendingAttachments > 0) {
        this.attachTo(item);
        this.pendingAttachments -= 1;
      }
    }
    // A material assignment is consumed only for a newly generated ordinary
    // PM. Hidden God Essence entries are returned by next()/peek() before
    // draw() and therefore never consume or inherit queue materials.
    const material = this.materialQueue.shift();
    if (material) this.applyMaterial(item, material);
    // Always return the authored item form. In non-colour modes it preserves
    // mino material metadata for queue previews, physics fixtures and board
    // locks instead of falling back to the bare bag definition.
    return item;
  }
}
