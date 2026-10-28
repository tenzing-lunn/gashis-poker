// Keeping the table in view: the band from the table header through the play controls (DESIGN.md §5).

/** Fully inside the viewport. */
export function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}

/** Bottom edge where the element sits in the flow (a stuck sticky dock reports where it is stuck). */
function flowBottom(el: HTMLElement): number {
  const prev = el.previousElementSibling;
  if (getComputedStyle(el).position !== "sticky" || !prev) return el.getBoundingClientRect().bottom;
  return prev.getBoundingClientRect().bottom + parseFloat(getComputedStyle(prev).marginBottom) + el.offsetHeight;
}

/**
 * Scroll the least distance that shows the table band (the `.screen` around `inside`) from its first line,
 * the table header, through the controls. When that is taller than the viewport, the controls' bottom goes
 * to the viewport's bottom, which keeps the status line, the controls and the hero's seat in view.
 * Does nothing when the band is already in view.
 */
export function revealTable(inside: Element): void {
  const band = inside.closest(".screen") ?? inside;
  const head = band.querySelector(".l");
  const dock = band.querySelector<HTMLElement>(".controls-dock");
  if (!head || !dock) return;
  const vh = window.innerHeight;
  const top = head.getBoundingClientRect().top;
  const bottom = flowBottom(dock);
  if (top >= 0 && bottom <= vh) return;
  const dy = bottom - top <= vh && top < 0 ? top : bottom - vh;
  window.scrollBy({ top: dy, behavior: "instant" });
}

/**
 * After the docked controls grew in place (a hand's result can take a second line on mobile): when the sticky
 * dock now covers the band by at most `lines` of its lines, scroll that much, so it sits in the flow under the
 * hero's seat again. Nothing on desktop (the dock is not sticky) and nothing when the user has scrolled away
 * (the dock is in the flow already, or covers more than it could have grown by).
 */
export function keepDockInFlow(inside: Element, lines = 2): void {
  const dock = inside.closest<HTMLElement>(".controls-dock") ?? (inside.closest(".screen") ?? inside).querySelector<HTMLElement>(".controls-dock");
  if (!dock || getComputedStyle(dock).position !== "sticky") return;
  const over = flowBottom(dock) - window.innerHeight;
  const line = parseFloat(getComputedStyle(dock).lineHeight) || 27;
  if (over > 0 && over <= lines * line) window.scrollBy({ top: over, behavior: "instant" });
}

/**
 * Bring the table into view and put focus on the controls (no second scroll), so the default action
 * takes it when the hero's turn comes: for DEAL and NEXT HAND.
 */
export function enterTable(inside: Element): void {
  revealTable(inside);
  const band = inside.closest(".screen") ?? inside;
  band.querySelector<HTMLElement>(".controls-dock form")?.focus({ preventScroll: true });
}
