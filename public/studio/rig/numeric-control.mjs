const pairs = new WeakMap();

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function labelFor(input) {
  return input.getAttribute("aria-label")
    ?? input.closest("label")?.textContent.trim().replace(/\s+/g, " ")
    ?? input.id;
}

function dispatch(input, name) {
  input.dispatchEvent(new CustomEvent(name));
}

/**
 * Upgrade one existing numeric input into the editor's slider + exact-value box.
 * The original input remains canonical, preserving all feature listeners.
 */
export function enhanceNumericControl(input) {
  if (!input || pairs.has(input)) return pairs.get(input) ?? null;
  if (!["number", "range"].includes(input.type)) return null;

  const originalType = input.type;
  const companion = document.createElement("input");
  const slider = originalType === "range" ? input : companion;
  const box = originalType === "number" ? input : companion;
  slider.type = "range";
  box.type = "number";

  const baseMin = finite(input.dataset.rangeMin, finite(input.min, -100));
  const baseMax = finite(input.dataset.rangeMax, finite(input.max, 100));
  const step = finite(input.step, 1);
  slider.min = String(baseMin);
  slider.max = String(baseMax);
  slider.step = String(step);
  box.step = String(step);
  if (originalType === "range") {
    box.min = input.min;
    box.max = input.max;
    box.id = `${input.id}Number`;
  } else {
    slider.id = `${input.id}Slider`;
  }

  const label = labelFor(input);
  slider.classList.add("numeric-control-slider");
  box.classList.add("numeric-control-number");
  slider.setAttribute("aria-label", `${label} slider`);
  box.setAttribute("aria-label", `${label} exact value`);

  const wrapper = document.createElement("span");
  wrapper.className = "numeric-control-fields";
  input.before(wrapper);
  wrapper.append(slider, box);
  input.closest("label")?.classList.add("numeric-control");

  const record = { canonical: input, slider, box, baseMin, baseMax };
  pairs.set(input, record);
  pairs.set(companion, record);

  const relay = (source, type) => {
    input.value = source.value;
    input.dispatchEvent(new Event(type, { bubbles: true }));
  };
  companion.addEventListener("pointerdown", () => dispatch(input, "numeric-control-begin"));
  companion.addEventListener("focus", () => dispatch(input, "numeric-control-begin"));
  companion.addEventListener("input", () => relay(companion, "input"));
  companion.addEventListener("change", () => relay(companion, "change"));
  companion.addEventListener("blur", () => dispatch(input, "numeric-control-end"));
  input.addEventListener("input", () => syncNumericControl(input));

  syncNumericControl(input);
  return record;
}

export function enhanceNumericControls(root = document) {
  return [...root.querySelectorAll("input[data-numeric-control]")]
    .map(enhanceNumericControl)
    .filter(Boolean);
}

/** Keep generated companions synchronized after feature code updates a value. */
export function syncNumericControl(input) {
  const record = pairs.get(input);
  if (!record) return;
  const { canonical, slider, box, baseMin, baseMax } = record;
  const value = finite(canonical.value, 0);
  const reach = Math.max(Math.abs(baseMin), Math.abs(baseMax), Math.abs(value));
  slider.min = String(baseMin < 0 ? -reach : Math.min(baseMin, value));
  slider.max = String(Math.max(baseMax, reach));
  if (document.activeElement !== slider) slider.value = String(value);
  if (document.activeElement !== box) box.value = String(value);
  slider.disabled = canonical.disabled;
  box.disabled = canonical.disabled;
}

export function syncNumericControls(root = document) {
  for (const input of root.querySelectorAll("input[data-numeric-control]")) {
    syncNumericControl(input);
  }
}
