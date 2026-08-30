// Shared skeleton-loading markup, used instead of plain "Loading…" text
// while a page's first data fetch is in flight.

export function skeletonCards(count = 3) {
  return Array.from({ length: count }, () => '<div class="skeleton skeleton-card"></div>').join('');
}

export function skeletonCatalogue(shelves = 3, itemsPerShelf = 6) {
  return Array.from({ length: shelves }, () => `
    <div class="skeleton-shelf">
      <div class="skeleton skeleton-shelf-head"></div>
      <div class="skeleton-rail">${Array.from({ length: itemsPerShelf }, () => '<div class="skeleton skeleton-product"></div>').join('')}</div>
    </div>`).join('');
}

export function skeletonLines(count = 3) {
  return Array.from({ length: count }, () => '<div class="skeleton skeleton-line" style="margin:8px 0"></div>').join('');
}
