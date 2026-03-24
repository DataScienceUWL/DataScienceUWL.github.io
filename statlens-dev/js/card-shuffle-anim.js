// @ts-check
/**
 * Card-shuffle animation for the conceptual randomization-test page.
 *
 * Uses the FLIP technique (First-Last-Invert-Play) to animate cards
 * gathering to a central deck, then dealing out to new group positions.
 *
 * Respects prefers-reduced-motion — falls back to instant re-render.
 */

import { prefersReducedMotion } from './chart-utils.js';

/**
 * Animate a card shuffle: gather cards to center, jitter, deal to new positions.
 *
 * @param {HTMLElement} container - The `.card-display` container holding card groups
 * @param {() => void} updateDOM - Callback that updates the DOM with shuffled card assignments
 * @param {object} [opts]
 * @param {number} [opts.gatherMs=300] - Duration of gather phase
 * @param {number} [opts.jitterMs=350] - Duration of jitter/shuffle phase
 * @param {number} [opts.dealMs=400] - Duration of deal phase
 * @returns {Promise<void>} Resolves when animation completes (or immediately if skipped)
 */
export async function animateCardShuffle(container, updateDOM, opts = {}) {
  const gatherMs = opts.gatherMs ?? 300;
  const jitterMs = opts.jitterMs ?? 350;
  const dealMs = opts.dealMs ?? 400;

  // Skip animation entirely for reduced motion
  if (prefersReducedMotion()) {
    updateDOM();
    return;
  }

  const cards = /** @type {HTMLElement[]} */ ([...container.querySelectorAll('.card')]);
  if (cards.length === 0) {
    updateDOM();
    return;
  }

  // ── Phase 0: Record initial positions (FLIP: "First") ──
  const containerRect = container.getBoundingClientRect();
  const firstRects = cards.map(c => c.getBoundingClientRect());

  // Center point of the container (gather target)
  const centerX = containerRect.left + containerRect.width / 2;
  const centerY = containerRect.top + containerRect.height / 2;

  // Fix container height to prevent layout shift during animation
  container.style.minHeight = containerRect.height + 'px';

  // ── Phase 1: Gather to center ──
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const r = firstRects[i];
    const cardCX = r.left + r.width / 2;
    const cardCY = r.top + r.height / 2;

    // Spread cards slightly around center for a "deck" look
    const spreadX = (Math.random() - 0.5) * 20;
    const spreadY = (Math.random() - 0.5) * 12;
    const dx = centerX - cardCX + spreadX;
    const dy = centerY - cardCY + spreadY;

    card.style.transition = `transform ${gatherMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.9)`;
    card.style.zIndex = '10';
  }

  // Fade group labels
  const labels = /** @type {HTMLElement[]} */ ([...container.querySelectorAll('.card-group h3')]);
  for (const label of labels) {
    label.style.transition = `opacity ${gatherMs}ms ease`;
    label.style.opacity = '0.3';
  }

  await wait(gatherMs);

  // ── Phase 2: Jitter in the center (shuffle feel) ──
  const jitterFrames = 4;
  const jitterInterval = jitterMs / jitterFrames;

  for (let frame = 0; frame < jitterFrames; frame++) {
    for (const card of cards) {
      const current = card.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      if (!current) continue;
      const baseX = parseFloat(current[1]);
      const baseY = parseFloat(current[2]);
      const jx = baseX + (Math.random() - 0.5) * 8;
      const jy = baseY + (Math.random() - 0.5) * 6;
      card.style.transition = `transform ${jitterInterval * 0.8}ms ease`;
      card.style.transform = `translate(${jx}px, ${jy}px) scale(0.9)`;
    }
    await wait(jitterInterval);
  }

  // ── Phase 3: Update DOM, then deal (FLIP: "Last-Invert-Play") ──

  // Snapshot current gathered positions for smooth transition
  // Remove transitions before DOM update
  for (const card of cards) {
    card.style.transition = 'none';
  }

  // Update the DOM — cards now exist in their new group positions
  updateDOM();

  // Get the new cards and their final positions ("Last")
  const newCards = /** @type {HTMLElement[]} */ ([...container.querySelectorAll('.card')]);

  // Record final positions
  const lastRects = newCards.map(c => c.getBoundingClientRect());

  // Invert: position each new card where the deck was (center), then animate to final
  for (let i = 0; i < newCards.length; i++) {
    const card = newCards[i];
    const lastR = lastRects[i];
    const cardCX = lastR.left + lastR.width / 2;
    const cardCY = lastR.top + lastR.height / 2;

    // Start from center (where the deck was)
    const dx = centerX - cardCX + (Math.random() - 0.5) * 16;
    const dy = centerY - cardCY + (Math.random() - 0.5) * 10;

    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.9)`;
    card.style.zIndex = '10';
  }

  // Force reflow so the "inverted" position is applied before animating
  void container.offsetHeight;

  // Play: animate from center to final positions
  for (let i = 0; i < newCards.length; i++) {
    const card = newCards[i];
    // Stagger slightly for a "dealing" feel
    const delay = (i / newCards.length) * 100;
    card.style.transition = `transform ${dealMs}ms cubic-bezier(0.2, 0, 0.2, 1) ${delay}ms`;
    card.style.transform = 'translate(0, 0) scale(1)';
  }

  // Restore labels
  for (const label of labels) {
    label.style.transition = `opacity ${dealMs}ms ease`;
    label.style.opacity = '1';
  }

  // Also restore labels on the new DOM (labels were re-created by updateDOM)
  const newLabels = /** @type {HTMLElement[]} */ ([...container.querySelectorAll('.card-group h3')]);
  for (const label of newLabels) {
    label.style.opacity = '1';
  }

  await wait(dealMs + 120); // wait for stagger to finish

  // Clean up inline styles
  for (const card of newCards) {
    card.style.transition = '';
    card.style.transform = '';
    card.style.zIndex = '';
  }
  container.style.minHeight = '';
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
