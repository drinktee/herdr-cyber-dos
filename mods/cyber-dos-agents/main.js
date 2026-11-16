// Blue DOS: agents in grouped or priority views. Grouped spaces are a tree:
// the space name heads the group, and each agent hangs off it by an elbow.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props } from "herdr";

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

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const UPPER = (s) => String(s ?? "").toUpperCase();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return tab.name === prog && telling ? live : tab.name;
}

// The conversation, not the status or the program (those are the dot and the icon).
// Drops a trailing " | <space>", and skips a path, a bare tab number, or the program's own name.
// A tab someone named is the fallback.
function conversation(a) {
  const noise = new Set([a.program?.name, a.program?.key, a.app, a.status, a.space_name]
    .map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean));
  const usable = (s) => {
    const v = clean(s);
    if (!v || noise.has(v.toLowerCase())) return null;
    if (/^[~/]|^[A-Za-z]:\\/.test(v) || /^\d+$/.test(v) || v.includes("@")) return null;
    return v;
  };
  let raw = clean(a.title);
  const space = String(a.space_name ?? "").trim().toLowerCase();
  const pipe = raw.lastIndexOf(" | ");
  if (pipe > 0) {
    const right = raw.slice(pipe + 3).trim().toLowerCase();
    if (right && right === space) raw = raw.slice(0, pipe).trim();
  }
  return usable(raw) || usable(a.tab_name);
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "NEEDS YOU", 3: "DONE", 2: "WORKING", 1: "IDLE" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    cx.timer.every(30000, (cx) => cx.notify());
  }

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  setPins(pins) {
    this.pins = pins;
    localStorage.setItem("pins", JSON.stringify(pins));
  }

  prunePins(all) {
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
    const kept = this.pins.filter((p) => !heard.has(machine(p)) || live.has(p));
    if (kept.length !== this.pins.length) this.setPins(kept);
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex().w_full().border_1().border_color(t.border).bg(t.popover).text_size(12)
      .child(div().px(10).pt(6).pb(5).text_size(11.5).text_color(t.dim).child("SORT AGENTS"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`).h(28).px(10).gap(8).items_center().text_color(t.foreground)
        .hover((el) => el.bg(t.hover).text_color(t.accent))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/cyber-dos-workspace-chrome/${s.icon}.svg`).size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().child(UPPER(s.label)))
        .when(s.id === on, (el) => el.child(svg("mods/cyber-dos-workspace-chrome/check.svg").size(12).flex_none().text_color(t.accent)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact, prefix = []) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 12, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`).pl(prefix.length ? 12 : 38).pr(10).h(28).flex_none().gap(0).items_center().text_size(12)
      .when(on, (el) => el.bg(t.accent + "20"))
      .when(!on, (el) => el.hover((s) => s.bg(t.accent + "10")))
      .on_click(() => this.peek(k.address))
      .children([
        ...prefix.map((l) => div().self_start().w(8).h(28).mr(3).flex_none()
          .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.dim))),
        ...s.lines.map((l) => div().self_start().mt(-3).w(8).h(14).mr(3).flex_none()
          .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.dim))
          .when(l === "└" || l === "├", (el) => el.border_b(1.5).border_color(t.dim))),
      ])
      .when(Boolean(pic), el => el.child(div().mr(6).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.accent : t.dim).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // A mark per state: working is a braille spinner, blocked is a filled alert, idle is a hollow ring.
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return div().w(compact ? 12 : 14).flex_none().text_size(compact ? 13 : 15).text_center().text_color(t.ansi10).frames(SPIN, 110);
    if (a.status === "blocked" && compact) return div().size(5).mx(3).flex_none().rounded_full().bg(t.blocked);
    if (a.status === "blocked") return div().flex_none().px(5).h(14).bg(t.blocked + "26").text_size(10).font_bold().text_color(t.blocked)
      .flex().items_center().child("NEEDS YOU");
    if (a.status === "idle") return div().size(5).mx(3).flex_none().rounded_full().border(1).border_color(t.idle ?? t.dim);
    return div().size(5).mx(3).flex_none().rounded_full().bg(color);
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = shared("sidebar.collapsed") === true;
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    this.prunePins(all);
    const pinned = this.pins.map((p) => list.find((a) => a.address === p)).filter(Boolean);
    const rest = list.filter((a) => !this.pins.includes(a.address));
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i, branch = null) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs, branch);
      if (this.folded.has(a.address)) return [r];
      const prefix = branch ? [branch.last ? "" : "│"] : [];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority, prefix))];
    };

    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div().id(`fold-${a.address}`).h(16).px(2).gap(2).flex().items_center().text_size(11.5)
        .text_color(open ? t.dim : (t[top] ?? t.dim)).cursor_pointer()
        .hover((s) => s.text_color(t.accent))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/cyber-dos-workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(9).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";
    };
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = [], branch = null) => {
      const pic = icon(a.program, 13, t.foreground);
      const more = detail.get(a.address);
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex().id(`ag-${a.address}`).h(26).px(6).flex_none().items_center().gap(3)
          .when(!a.focused, (el) => el.hover((s) => s.bg(t.accent + "14")))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_size(11.5).text_color(t.dim).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = this.pins.includes(a.address);
      const pin = div().id(`pin-${a.address}`).flex_none().p(2).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.accent))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.setPins(isPinned ? this.pins.filter((p) => p !== a.address) : [...this.pins, a.address]);
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/cyber-dos-workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(11));
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const session = conversation(a);
      // Grouped rows hang off the space header: one line, the conversation, with a tree elbow.
      const branched = Boolean(branch);
      const primary = branched ? (session || more || a.program?.name || label(a)) : (a.space_name || name);
      const hot = !a.focused && this.hovered === a.address;
      const text = hot ? lift(t.foreground, 0.7) : idle ? lift(t.muted, 0.5) : lift(t.foreground, 0.5);
      let el = h_flex()
        .id(`ag-${a.address}`).relative().px(branched ? 12 : 10).h(branched ? 30 : 44).flex_none().items_center().gap(6)
        .when(a.focused, (el) => el.bg(t.accent + "28"))
        .when(a.focused && !branched, (el) => el.border_l(2).border_color(t.accent))
        .when(!branched, (el) => el.mx(6).my(1))
        .rounded(2)
        .cursor_pointer()
        .when(!a.focused, (el) => el.hover((s) => s.bg(t.accent + "14")))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }));
      if (branched) el = el.child(v_flex().w(8).h(30).mr(3).flex_none()
        .child(div().w(8).h(15).border_l(1.5).border_b(1.5).border_color(t.dim))
        .child(div().w(8).h(15).when(!branch.last, (n) => n.border_l(1.5).border_color(t.dim))));
      return el
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(branched
          ? div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(text).child(primary)
          : v_flex().flex_1().min_w(0).justify_center()
            .child(div().truncate().text_size(13).font_medium().text_color(text).child(primary))
            .when(Boolean(session), el => el.child(div().truncate().text_size(11.5)
              .text_color(lift(t.muted, 0.45)).child(session))))
        .when(!branched && Boolean(machine), el => el.child(div().text_size(9.5).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, branched || (byPriority && !isPinned)));
    };

    const groups = pinned.length ? [{ id: "pinned", label: "PINNED", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({
        id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a],
        machine: !byPriority && a.address.includes("/") ? a.address.split("/")[0] : null,
      });
    }

    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex().id(g.id).px(10).pt(8).h(26).flex_none().gap(5).items_center().text_size(11.5).font_bold()
        .cursor_pointer().hover((s) => s.text_color(t.accent))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(UPPER(g.label || "space")))
        .when(Boolean(g.machine), (el) => el.child(div().text_size(9.5).font_medium().text_color(t.dim).child(g.machine)))
        .when(byPriority || (!open && !String(g.id).startsWith("sp-")), (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/cyber-dos-workspace-chrome/chevron-right.svg").size(9).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : byPriority
        ? groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))])
        : groups.flatMap((g) => {
            const body = this.folded.has(g.id) ? []
              : g.id === "pinned"
                ? g.members.flatMap(withKids)
                : g.members.flatMap((a, i) => withKids(a, i, { last: i === g.members.length - 1 }));
            return [header(g), ...body];
          });

    return v_flex().size_full().min_h(0).bg(t.surface).text_size(12)
      .when(!collapsed, (el) =>
        el.child(
          h_flex().px(10).h(30).flex_none().items_center().justify_between()
            .border_b(1).border_color(t.border)
            .child(h_flex().gap(5).items_center()
              .child(div().size(4).rounded_full().bg(t.solid))
              .child(div().text_size(13).font_family("FiraCode Nerd Font").font_bold().text_color(t.muted).child("AGENTS"))
              .child(div().text_size(11.5).text_color(t.border).child("/"))
              .child(div().text_size(11.5).text_color(t.dim).child(UPPER(sort.id === "grouped" ? "GROUPED" : sort.label))))
            .child(div().id("ag-sort").text_size(12).text_color(t.dim)
              .hover((s) => s.text_color(t.accent))
              .on_click(() => openOverlay({ mod: "cyber-dos-agents", kind: "popup", frame: "none", width: 190, height: 120, props: { sortMenu: true } }))
              .tooltip(`Sort agents: ${sort.label}`)
              .child(svg(`mods/cyber-dos-workspace-chrome/${sort.icon}.svg`).size(12))),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(10).py(4).text_size(11.5).text_color(t.dim).child("NO AGENTS YET — START ONE FROM + IN THE TABS")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).overflow_y_scrollbar().mode("scrolling").py(2).children(rows))
      .child(
        h_flex().h(26).px(10).items_center().justify_end()
          .when(collapsed, (el) => el.justify_center().px(0))
          .child(div().id("collapse").text_size(12).text_color(t.dim)
            .hover((s) => s.text_color(t.accent))
            .on_click(() => {
              const next = !collapsed;
              setShared("sidebar.collapsed", next);
              run("layout.resize", { id: "sidebar", px: next ? 44 : (shared("sidebar.width") ?? 268) });
            })
            .child(collapsed ? "»" : "«")),
      );
  }
}
