// Blue DOS: the spaces list — uppercase header, a node readout per machine, and
// rows that read as neon chips when selected.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window } from "herdr";

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

function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const FALLBACK = 60000;
const UPPER = (s) => String(s ?? "").toUpperCase();
// A space at home reads "HOME" rather than "~", as the reference's first row does.
const label = (s) => (s.name === "~" ? "HOME" : s.name);

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {};
    this.checked = {};
    this.unsure = new Set();
    this.pending = new Set();
    this.busy = {};
    this.ready = {};
    this.at = {};
    this.watching = new Set();
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  due(now, sp, ps) {
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      const r = await exec("git", ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    openOverlay({ mod: "cyber-dos-menu", kind: "popup", frame: "none", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set();
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // "THIS COMPUTER" style header per machine, with a node count on the right.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r, last) => (collapsed ? this.compact(r, t) : this.row(r, t, last));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(12).items_center()
      .text_size(12).text_color(t.dim).child(collapsed ? "…" : "LOADING…");
    const names = [null, ...remote];
    return names.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 12).gap(6).items_center()
        .text_size(11.5).text_color(lift(t.foreground, 0.5)).cursor_pointer().hover(s => s.text_color(t.accent))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(collapsed, el => el.justify_center().child(div().size(5).rounded_full().bg(connected ? t.working : t.dim)))
        .when(!collapsed, el => el
          .child(svg(`mods/cyber-dos-workspace-chrome/${m ? "server" : "monitor"}.svg`).size(10).flex_none())
          .child(div().flex_1().truncate().child(UPPER(m ?? "This computer")))
          .child(div().text_size(10.5).text_color(connected ? t.working : t.dim).child(connected ? "●" : "○"))
          .child(div().id(`machine-add-${m ?? "local"}`).px(3).hover(s => s.text_color(t.accent))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", m ? { machine: m } : {}); }).child("+")));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(14).gap(6).items_center()
        .text_size(12).text_color(t.dim).hover(s => s.text_color(t.accent))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg("mods/cyber-dos-workspace-chrome/plus.svg").size(10)).when(!collapsed, el => el.child("NEW SPACE"));
      return [head, ...(folded ? [] : mine.length ? mine.map((r, i) => draw(r, i === mine.length - 1)) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" · ");
    return h_flex().flex_1().min_w(0).gap(4).justify_end().items_center().text_size(11.5).text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.working).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`↓${g.behind}`)));
  }

  // A space row: the selected one gets a pink edge and a tinted fill, as the
  // reference marks its active node.
  row({ w, i, g, tree }, t, last = false) {
    const on = w.active;
    return v_flex()
      .relative().id(`space-${w.id}`).px(10).h(24).flex_none().justify_center()
      .when(on, (el) => el.bg(t.accent + "28").rounded(2).mx(6).border_l(2).border_color(t.accent))
      .when(!on, (el) => el.rounded(2).mx(6).hover((s) => s.bg(t.accent + "14")))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.border_t(1).border_color(t.accent))
      .on_hover((hot, cx) => {
        if (hot) this.hot = w.id;
        else if (this.hot === w.id) this.hot = null;
        else return;
        cx.notify();
      })
      .on_mouse_down("left", () => { this.pressed = i; this.over = i; })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex().gap(6).items_center()
          // A space hangs off its machine exactly as an agent hangs off its
          // space: every row turns in from the stem with a corner, and the stem
          // carries on below all but the last.
          .child(v_flex().w(8).h(24).mr(3).flex_none()
            .child(div().w(8).h(12).border_l(1.5).border_b(1.5).border_color(t.dim))
            .child(div().w(8).h(12).when(!last, el => el.border_l(1.5).border_color(t.dim))))
          .when(Boolean(tree), el => el.pl(16).child(div().text_size(10.5).text_color(t.dim).child(tree)))
          .child(div().flex_shrink(0).max_w(140).truncate().text_size(13)
            .text_color(on ? t.accent : this.hot === w.id ? lift(t.foreground, 0.45) : lift(t.muted, 0.25)).child(label(w)))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t) {
    const status = w.status ?? "idle";
    return h_flex().id(`space-${w.id}`).h(28).flex_none().justify_center().gap(3)
      .when(w.active, (el) => el.bg(t.accent + "28"))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.accent + "14")))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_size(10.5).text_color(w.active ? t.accent : t.dim).child(String(i + 1)))
      .child(div().size(4).rounded_full().bg(t[status] ?? t.dim));
  }

  render() {
    const t = theme();
    const collapsed = shared("sidebar.collapsed") === true;
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // The panel's foot: how many nodes answer, and where they are.
    const online = this.machines.filter(m => m.state === "connected").length;
    const nodes = sp.length;
    return v_flex().size_full().min_h(0).bg(t.surface).text_size(12.5)
      .child(h_flex().h(30).pl(12).pr(8).items_center().justify_between()
        .border_b(1).border_color(t.border)
        .when(!collapsed, el => el.child(h_flex().gap(6).items_center()
          .child(div().size(4).rounded_full().bg(t.accent))
          .child(div().text_size(13).font_family("FiraCode Nerd Font").font_bold().text_color(t.muted).child("SPACES"))))
        .child(div().id("space-new").px(5).py(2).text_size(14).text_color(t.dim)
          .hover(s => s.bg(t.hover).text_color(t.accent)).on_click(() => run("space.new")).child("+")))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().mode("scrolling").py(3)
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)))
      .when(!collapsed, el => el.child(h_flex().h(24).px(10).gap(10).flex_none().items_center()
        .border_t(1).border_color(t.border).text_size(10).text_color(t.dim)
        .children([
          ["working", t.working], ["blocked", t.blocked], ["idle", t.idle], ["done", t.done],
        ].map(([st, col]) => h_flex().gap(4).items_center()
          .child(div().size(4).rounded_full().bg(col))
          .child(div().text_color(col).child(String(agents().filter(a => a.status === st).length)))))));
  }
}
