// @ts-check
/**
 * Card-shuffle demo — a self-contained animated illustration of dealing
 * outcomes into shuffled groups, for use in activity demo popups.
 *
 * Renders two groups of outcome cards (success colored, failure plain),
 * then animates gather → jitter → deal on each play(), reassigning the
 * SAME fixed pool of outcomes to random group labels. The point being
 * illustrated: under the null hypothesis the outcomes are fixed; only
 * the group labels move.
 *
 * Loaded on demand by activity-panel.js (see DEMOS registry there).
 */

import { animateCardShuffle } from '../card-shuffle-anim.js';

export const meta = {
  title: 'How one shuffle works',
};

/**
 * @typedef {object} CardShuffleOptions
 * @property {string} [group1] - First group label (default "Group 1")
 * @property {string} [group2] - Second group label (default "Group 2")
 * @property {number} [n1] - Size of group 1 (default 24)
 * @property {number} [n2] - Size of group 2 (default 24)
 * @property {number} [success1] - Observed successes in group 1 (default 21)
 * @property {number} [success2] - Observed successes in group 2 (default 14)
 * @property {string} [successLabel] - Legend label for colored cards (default "Success")
 * @property {string} [failureLabel] - Legend label for plain cards (default "Failure")
 */

/**
 * Mount the demo into a container.
 * @param {HTMLElement} container
 * @param {CardShuffleOptions} [options]
 * @returns {{ play: () => Promise<void>, destroy: () => void }}
 */
export function mount(container, options = {}) {
  const group1 = options.group1 || 'Group 1';
  const group2 = options.group2 || 'Group 2';
  const n1 = options.n1 ?? 24;
  const n2 = options.n2 ?? 24;
  const success1 = options.success1 ?? 21;
  const success2 = options.success2 ?? 14;
  const successLabel = options.successLabel || 'Success';
  const failureLabel = options.failureLabel || 'Failure';
  const totalSuccess = success1 + success2;
  const total = n1 + n2;

  // The fixed pool of outcomes: true = success. Order gets shuffled on play.
  /** @type {boolean[]} */
  let outcomes = [
    ...Array(success1).fill(true), ...Array(n1 - success1).fill(false),
    ...Array(success2).fill(true), ...Array(n2 - success2).fill(false),
  ];

  container.innerHTML = `
    <div class="demo-cards card-display"></div>
    <div class="card-legend">
      <span><span class="swatch success"></span> ${successLabel}</span>
      <span><span class="swatch failure"></span> ${failureLabel}</span>
    </div>
    <p class="demo-caption" role="status" aria-live="polite"></p>
  `;
  const display = /** @type {HTMLElement} */ (container.querySelector('.demo-cards'));
  const caption = /** @type {HTMLElement} */ (container.querySelector('.demo-caption'));

  /** Render the two card groups from the current outcomes order. */
  function render() {
    display.innerHTML = '';
    const groups = [
      { label: group1, slice: outcomes.slice(0, n1) },
      { label: group2, slice: outcomes.slice(n1) },
    ];
    for (const g of groups) {
      const grp = document.createElement('div');
      grp.className = 'card-group';
      const h = document.createElement('h3');
      const succ = g.slice.filter(Boolean).length;
      h.textContent = `${g.label} — ${succ} of ${g.slice.length}`;
      grp.appendChild(h);
      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'cards';
      for (const isSuccess of g.slice) {
        const card = document.createElement('div');
        card.className = 'card ' + (isSuccess ? 'demo-success' : 'demo-failure');
        card.setAttribute('aria-label', isSuccess ? successLabel : failureLabel);
        cardsDiv.appendChild(card);
      }
      grp.appendChild(cardsDiv);
      display.appendChild(grp);
    }
  }

  function updateCaption(shuffled) {
    const s1 = outcomes.slice(0, n1).filter(Boolean).length;
    const s2 = outcomes.slice(n1).filter(Boolean).length;
    const d = ((s1 / n1 - s2 / n2) * 100).toFixed(1);
    caption.innerHTML = shuffled
      ? `After this shuffle: <strong>${s1}</strong> vs <strong>${s2}</strong> — a difference of `
        + `<strong>${d} pp</strong>. The total (${totalSuccess} of ${total}) never changes; `
        + `only the labels moved.`
      : `The observed data: <strong>${success1}</strong> vs <strong>${success2}</strong> successes. `
        + `Shuffling deals the same ${totalSuccess} successes into random groups.`;
  }

  render();
  updateCaption(false);

  let playing = false;
  return {
    async play() {
      if (playing) return;
      playing = true;
      // Fisher–Yates on the fixed outcome pool
      for (let i = outcomes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
      }
      await animateCardShuffle(display, render);
      updateCaption(true);
      playing = false;
    },
    destroy() {
      container.innerHTML = '';
    },
  };
}
