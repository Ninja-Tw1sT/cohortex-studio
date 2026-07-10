// Fixed color palette assigned to agents on creation so their runs, tool
// assignments, and contributions stay visually distinguishable at a glance.
const PALETTE = [
  "#00f5ff", // cyan
  "#ff00cc", // magenta
  "#8a5cff", // violet
  "#39ff14", // green
  "#ffb300", // amber
  "#ff5c5c", // coral
  "#5ce1ff", // sky
  "#c792ea", // lavender
  "#ff8a3d", // orange
  "#4dffb8", // mint
  "#ff5ca8", // pink
  "#7dff5c", // lime
];

// Deterministic per-owner assignment: the Nth agent an owner creates gets
// PALETTE[N % PALETTE.length], so colors stay stable and predictable rather
// than randomly reshuffling as agents are added/removed.
function nextColor(existingCount) {
  return PALETTE[existingCount % PALETTE.length];
}

module.exports = { PALETTE, nextColor };
