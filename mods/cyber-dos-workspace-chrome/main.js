// Blue DOS: the window's top strip in three pieces —
//   brand   (no props):  the pixel HERDR mark and the breadcrumb
//   readout ({readout:true}): NODE://05 over ONLINE 05/05
//   footer  ({footer:true}):  SETTINGS / ADD MACHINE, the sidebar's bottom block

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, openOverlay, nextCommand, spaces, machines } from "herdr";

const UPPER = (s) => String(s ?? "").toUpperCase();

export default class TopBar extends View {
  init(_props, cx) {
    cx.spawn(async cx => {
      for (;;) {
        await nextCommand();
        cx.notify();
        if (!this.footer && !this.readout) this.openPicker();
      }
    });
  }

  openPicker() {
    openOverlay({ mod: "cyber-dos-picker", kind: "popup", frame: "none", at: "top", offset: 40, width: 640, height: 0.8 });
  }

  render() {
    const p = props() ?? {};
    this.footer = p.footer === true;
    this.readout = p.readout === true;
    const t = theme();
    const collapsed = shared("sidebar.collapsed") === true;
    const mac = window()?.platform === "macos";

    // The sidebar's bottom block: a SETTINGS header, then Add machine with the
    // version at its right end, so the block stays two rows tall.
    if (this.footer) {
      const version = `v${updates().app.version ?? ""}`;
      return v_flex().size_full().bg(t.surface).text_size(12)
        .child(h_flex().id("settings").h(30).px(10).items_center().justify_between()
          .border_b(1).border_color(t.border).cursor_pointer()
          .hover(s => s.bg(t.hover))
          .on_click(() => run("app.settings"))
          .when(collapsed, el => el.justify_center().px(0)
            .child(svg("mods/cyber-dos-workspace-chrome/settings.svg").size(11).flex_none().text_color(t.dim)))
          .when(!collapsed, el => el
            .child(h_flex().gap(6).items_center()
              .child(svg("mods/cyber-dos-workspace-chrome/settings.svg").size(10).flex_none().text_color(t.dim))
              .child(div().text_size(13).font_bold().text_color(t.muted).child("SETTINGS")))
            .child(h_flex().gap(4).items_center()
              .when(Boolean(updates().app.ready), el => el.child(div().size(4).rounded_full().bg(t.accent)))
              .child(div().text_size(10).text_color(t.accent).child("LOCAL")))))
        .child(h_flex().id("machine").h(30).px(10).gap(7).items_center().text_color(t.muted)
          .hover(s => s.bg(t.hover).text_color(t.accent)).cursor_pointer()
          .on_click(() => openOverlay({ mod: "cyber-dos-machine-add", kind: "dialog", frame: "none", width: 560 }))
          .child(svg("mods/cyber-dos-workspace-chrome/plus.svg").size(11).flex_none())
          .when(collapsed, el => el.flex_1())
          .when(!collapsed, el => el
            .child(div().flex_1().truncate().child("ADD MACHINE"))
            .child(div().text_size(9.5).flex_none().text_color(t.dim).child(version))));
    }


    // The corner readout: nothing for now.
    if (this.readout) return div();

    // The brand end: the mark and where you are.
    const space = spaces().find(s => s.active);
    return h_flex().size_full().bg(t.chrome).items_center().text_size(12.5).gap(8)
      .pl(10)
      .pr(10)
      .child(h_flex().flex_none().gap(0).items_center()
        .child(div().text_size(13.5).font_bold().text_color(t.accent).child("HERDR")))
      .child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().text_size(10.5).text_color(t.border).child("/"))
        .child(div().text_size(10.5).text_color(t.dim).child(space?.machine ?? "local"))
        .child(div().text_size(10.5).text_color(t.border).child("/"))
        .child(div().text_size(11).text_color(t.muted).truncate().child(space?.name ?? "—")))
      .child(div().id("search").px(6).py(3).text_size(12.5).text_color(t.dim)
        .hover(s => s.text_color(t.accent)).on_click(() => this.openPicker())
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .tooltip("Find a space, tab or agent")
        .child(svg("mods/cyber-dos-workspace-chrome/search.svg").size(12)));
  }
}
