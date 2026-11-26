// Blue DOS: the tab strip — numbered chips, FILES/CHANGES as bracketed toggles.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout } from "herdr";

const UPPER = (s) => String(s ?? "").toUpperCase();
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The conversation on a pane, same rules as the agents list: drop a trailing
// " | <space>", and skip a path, a bare number, or the program's own name.
function talk(pane, spaceName) {
  if (!pane) return null;
  const noise = new Set([pane.program?.name, pane.program?.key, pane.app, pane.status, spaceName]
    .map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean));
  const usable = (s) => {
    const v = clean(s);
    if (!v || noise.has(v.toLowerCase())) return null;
    if (/^[~/]|^[A-Za-z]:\\/.test(v) || /^\d+$/.test(v) || v.includes("@")) return null;
    return v;
  };
  let raw = clean(pane.title);
  const space = String(spaceName ?? "").trim().toLowerCase();
  const pipe = raw.lastIndexOf(" | ");
  if (pipe > 0 && raw.slice(pipe + 3).trim().toLowerCase() === space) raw = raw.slice(0, pipe).trim();
  return usable(raw);
}

// Tab text a little brighter than the theme's own, so names read on chrome.
const lift = (hex, k = 0.35) => {
  const h = String(hex ?? "").replace("#", "");
  if (h.length !== 6 && h.length !== 8) return hex;
  const up = (i) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * k).toString(16).padStart(2, "0");
  };
  return `#${up(0)}${up(2)}${up(4)}${h.length === 8 ? h.slice(6) : ""}`;
};


function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).w(22).h_full().flex_none().flex().items_center().justify_center()
      .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.accent))
      .on_mouse_down("left", stop).on_click(action).child(label);

    // A tab chip: icon, its number, the name, and a close. A name someone gave
    // stays. A bare number, an internal id, the program's own name, or a wrapper
    // name (codex-f, codex-z, claude-grok) shows the conversation, then the program's name.
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
      const nick = same(c.name, "codex-f") || same(c.name, "codex-z") || same(c.name, "claude-grok");
      const auto = /^tb\d+$/.test(c.name) || c.name === String(c.index) || same(c.name, program?.name) || nick;
      const name = auto ? (talk(lead, space?.name) || program?.name || "") : c.name;
      const on = c.active;
      return h_flex().id(`tab-${c.id}`).relative().h_full().px(8).gap(5).items_center().flex_none().text_size(11)
        .when(on, el => el.bg(t.accent + "14").border(1).border_color(t.accent + "88").rounded(2).mx(2).my(2))
        .when(!on, el => el.mx(1).my(2).rounded(2).hover(s => s.bg(t.hover)))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", () => openOverlay({ mod: "cyber-dos-menu", kind: "popup", frame: "none", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }))
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(12).text_color(on ? t.accent : lift(t.dim, 0.4)) : image(program.icon).size(12)))
        .child(div().text_size(10).text_color(on ? t.accent : lift(t.dim, 0.4)).child(String(c.index)))
        .when(Boolean(name), el => el.child(div().max_w(140).truncate().text_color(on ? t.accent : lift(t.muted, 0.5)).child(name)))
        .when(c.zoomed, el => el.child(div().text_size(8).text_color(t.solid).child("Z")))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(4).rounded_full().bg(t[c.status])))
        .child(div().id(`close-${c.id}`).text_size(11).text_color(on ? lift(t.muted, 0.2) : lift(t.dim, 0.4)).hover(s => s.text_color(t.blocked))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
          .child("×"));
    };

    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h_full().px(8).gap(4).flex_none().items_center().text_size(9)
        .when(on, el => el.bg(t.accent + "14").text_color(t.accent))
        .when(!on, el => el.text_color(t.dim))
        .hover(s => s.text_color(t.accent))
        .on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(9)).child(UPPER(label));
    };

    return h_flex().size_full().min_w(0).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().overflow_x_scrollbar()
        .children(shown.map(item))
        .child(button("tab-new", "+", () => openOverlay({ mod: "cyber-dos-new-menu", kind: "popup", frame: "none", width: 250, height: 512 }))))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(window()?.buttons, el => el.child(button("minimize", "−", () => run("window.minimize")))
        .child(button("maximize", "□", () => run("window.maximize")))
        .child(button("close-window", "×", () => run("window.close"))));
  }
}
