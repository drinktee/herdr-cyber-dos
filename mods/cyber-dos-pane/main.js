// Blue DOS: a pane's header, two rows as the reference has it —
//   PANE / SESSION 01 ......... FILES  CHANGES
//   ~/herdr-app · branch
// The buttons split, zoom and close this pane; they show on hover.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";

const UPPER = (s) => String(s ?? "").toUpperCase();
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Sidebar text a little brighter than the theme's own, so names read on chrome.
const lift = (hex, k = 0.35) => {
  const h = String(hex ?? "").replace("#", "");
  if (h.length !== 6 && h.length !== 8) return hex;
  const up = (i) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * k).toString(16).padStart(2, "0");
  };
  return `#${up(0)}${up(2)}${up(4)}${h.length === 8 ? h.slice(6) : ""}`;
};


function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div().id(id).w(18).h(14).flex().items_center().justify_center().text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.accent))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/cyber-dos-pane/${icon}.svg`).size(10));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const st = p.status;
    const pane = p.pane;
    const where = folder(p.cwd);
    // This pane's place among its tab's panes: the model has no index, so count
    // the panes that share this tab.
    const siblings = panes().filter(x => x.tab === p.tab);
    const num = String(siblings.findIndex(x => x.pane === p.pane) + 1).padStart(2, "0");
    return v_flex()
      .id(`pane-head-${pane}`).size_full().bg(t.chrome).justify_center().gap(1).px(10)
      .border_b(1).border_color(t.border).text_size(9)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      // Row 1: PANE / SESSION NN on the left, the pane's buttons at the right.
      .child(h_flex().w_full().items_center().gap(5)
        .child(div().text_size(10.5).font_bold().text_color(lift(t.foreground, 0.45)).child(`PANE-${num}`))
        .child(div().text_size(10.5).text_color(lift(t.muted, 0.25)).child("/"))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).font_bold().text_color(p.focused ? lift(t.accent, 0.25) : lift(t.muted, 0.35)).child(UPPER(p.title || name)))
        .when(st === "blocked", el => el.child(div().flex_none().px(5).h(12).flex().items_center()
          .bg(t.blocked + "26").text_size(7.5).font_bold().text_color(t.blocked).child("NEEDS YOU")))
        .when(st === "working", el => el.child(div().w(14).flex_none().text_size(14).text_center().text_color(t.ansi10).frames(SPIN, 110)))
        .when(st === "done", el => el.child(div().size(4).flex_none().rounded_full().bg(t.done)))
        .when(this.hovered, el => el.child(h_flex().h(14).flex_none()
          .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
          .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
          .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
          .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })))))
      // Row 2: where this pane is, and the branch it's on.
      .child(h_flex().w_full().items_center().gap(5)
        .child(div().flex_1().min_w(0).truncate().text_size(9)
          .text_color(p.focused ? t.foreground : t.muted).child(where || UPPER(name)))
        .when(Boolean(p.branch), el => el
          .child(div().text_size(8).text_color(t.border).child("·"))
          .child(div().text_size(8.5).text_color(t.solid).child(p.branch))));
  }
}
