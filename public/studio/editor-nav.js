(() => {
  "use strict";

  const editors = [
    ["/", "Modular Character Studio", "Project home"],
    ["/rig", "Rig Studio", "Pose the skeleton, layers, animation, and deformation"],
    ["/equipment", "Equipment Studio", "Fit armor and held items against the shared rig"],
  ];

  const style = document.createElement("style");
  style.textContent = `
    .editor-nav { position: fixed; z-index: 10000; top: 12px; right: 14px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .editor-nav__button { width: 42px; height: 42px; padding: 0; display: grid; place-items: center; border: 1px solid #465568; border-radius: 10px; color: #eef3f8; background: #1b2530; box-shadow: 0 8px 24px rgba(0,0,0,.34); cursor: pointer; }
    .editor-nav__button:hover, .editor-nav__button[aria-expanded="true"] { background: #293746; }
    .editor-nav__icon, .editor-nav__icon::before, .editor-nav__icon::after { display: block; width: 20px; height: 2px; border-radius: 2px; background: currentColor; content: ""; }
    .editor-nav__icon { position: relative; }
    .editor-nav__icon::before { position: absolute; top: -6px; }
    .editor-nav__icon::after { position: absolute; top: 6px; }
    .editor-nav__menu { position: absolute; top: 48px; right: 0; width: 310px; padding: 8px; border: 1px solid #3c4959; border-radius: 11px; background: #151d26; box-shadow: 0 18px 52px rgba(0,0,0,.5); }
    .editor-nav__menu[hidden] { display: none; }
    .editor-nav__link { display: grid; gap: 2px; padding: 9px 10px; border: 1px solid transparent; border-radius: 8px; color: #e8f0f8; text-decoration: none; }
    .editor-nav__link:hover { border-color: #3b4c5e; background: #222e3a; }
    .editor-nav__link strong { font-size: 13px; }
    .editor-nav__link small { color: #91a5b8; font-size: 10px; line-height: 1.35; }
  `;
  document.head.append(style);

  const nav = document.createElement("nav");
  nav.className = "editor-nav";
  nav.setAttribute("aria-label", "Modular Character Studio navigation");
  const button = document.createElement("button");
  button.className = "editor-nav__button";
  button.type = "button";
  button.setAttribute("aria-label", "Open editor menu");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = '<span class="editor-nav__icon" aria-hidden="true"></span>';
  const menu = document.createElement("div");
  menu.className = "editor-nav__menu";
  menu.hidden = true;

  for (const [href, label, description] of editors) {
    const link = document.createElement("a");
    link.className = "editor-nav__link";
    link.href = href;
    link.target = "_top";
    link.innerHTML = `<strong>${label}</strong><small>${description}</small>`;
    menu.append(link);
  }
  nav.append(button, menu);
  document.body.append(nav);

  function close() { menu.hidden = true; button.setAttribute("aria-expanded", "false"); }
  button.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("pointerdown", (event) => { if (!nav.contains(event.target)) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
})();
