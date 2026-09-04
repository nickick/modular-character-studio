/** Broad visual families used by the compact bundled demo catalogue. */
export const equipmentLines = [
  { id: "leather", name: "Leather", blurb: "Light armor and field gear", prefixes: [] },
  { id: "mage", name: "Mage", blurb: "Robes and arcane equipment", prefixes: [] },
  { id: "metal", name: "Metal", blurb: "Plate and heavy protection", prefixes: [] },
  { id: "utility", name: "Held items", blurb: "Weapons, shields, and accessories", prefixes: [] },
];

export const UNALIGNED = { id: "unaligned", name: "Other", blurb: "Items without a visual family" };
export const UNRATED = { id: "unrated", name: "Unrated", level: null };
export const equipmentTiers = [
  { id: "common", name: "Demo", level: 1, rarities: ["common"] },
];

export function lineFor(item) {
  if (item && typeof item === "object" && item.line) {
    return item.line === UNALIGNED.id ? null : item.line;
  }
  return null;
}

export function tierFor({ rarity, level } = {}) {
  if (rarity === "common" || typeof level === "number") return "common";
  return null;
}
