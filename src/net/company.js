// Playing with a friend: a room on a p3p2 server.
//
// The room's log is the battle. Every page reads the same ops in the same order into a `Table` (`table.js`), and
// `play.js` shows what the table holds. Both load with the first room: on an ordinary visit nothing here asks any
// server anything or loads anything more, and `start()` resolves at once.
import { P3P2 } from '@p3p2/client';

/** The format of the ops and the snapshot (`table.js`). A page with another one is kept out of the room. */
export const TABLE_VERSION = '2';

export function openCompany(ctx) {
  const p3p2 = new P3P2({
    game: { id: 'battleship', version: TABLE_VERSION },
    // p3p2's own button and panel, top right: top left are pause and sound, the status runs along the top, the
    // buttons along the bottom, and the version is bottom left. "Play with a friend" in the menus opens the same
    // panel. Enter fires at the aimed cell, so chat opens with T.
    ui: { corner: 'top-right', chatKey: 't' },
  });
  /** `play.js` and `table.js`, loaded with the first room. */
  let net = null;
  const loadNet = () => (net ??= Promise.all([import('./play.js'), import('./table.js')])
    .then(([{ RoomPlay }, { Table }]) => ({ play: new RoomPlay(ctx), Table })));

  let play = null;
  let room = null;
  let table = null;
  let claim = null;
  let mayRetry = true;
  let fromSnapshot = false;

  const handle = {
    get table() { return table; },
    get me() { return room ? room.self.pid : null; },
    /** Sends an op. While the connection is coming back, the client keeps it until it is. */
    submit(op) { return !!room && room.log.submit(op); },
    presence(pid) {
      const m = room?.members.find((x) => x.pid === pid);
      return m ? m.state : null;
    },
    sit(c) {
      if (!room || c < 0 || table.seats[c]) return;
      claim = { c };
      room.log.submit({ t: 'sit', c, name: room.self.name });
    },
    /** To the end of the line of those who want to play (or to a free seat), and out of it again. */
    line() { return !!room && room.log.submit({ t: 'line', name: room.self.name }); },
    unline() { return !!room && room.log.submit({ t: 'unline' }); },
    /** This room, for what this tab remembers about it. */
    get key() { return room ? `${room.server}|${room.name}` : ''; },
  };

  /** Pids already reported gone from the line, so that each is reported once. */
  const reported = new Set();
  /**
   * Takes out of the line whoever has left the room: their own page cannot. The admirals' pages do it, or, with
   * neither admiral in the room, the page of the first in line who is.
   */
  function tidy() {
    if (!room || !table?.line.length) return;
    const here = new Set(room.members.map((m) => m.pid));
    const me = handle.me;
    const present = table.line.filter((x) => here.has(x.pid));
    const mine = table.seatOf(me) !== -1 || (!table.seats.some((pid) => pid && here.has(pid)) && present[0]?.pid === me);
    if (!mine) return;
    for (const x of table.line) {
      if (here.has(x.pid) || reported.has(x.pid)) continue;
      if (room.log.submit({ t: 'gone', pid: x.pid })) reported.add(x.pid);
    }
  }

  function sitIfFree() {
    if (!room || claim || table.seatOf(handle.me) !== -1) return;
    const free = table.seats.indexOf(null);
    if (free !== -1) handle.sit(free);
  }

  async function adopt(r) {
    room = r;
    table = null;
    claim = null;
    mayRetry = true;
    const { play: p, Table } = await loadNet();
    if (room !== r) return;
    table = new Table();
    let open = false;
    await r.log.open({
      load(state) { table.load(state); fromSnapshot = state !== undefined; },
      apply(op, entry) {
        const what = table.apply(op, entry.pid);
        if (claim && op?.t === 'sit' && op.c === claim.c) {
          const lost = entry.pid !== handle.me;
          claim = null;
          if (lost && mayRetry) { mayRetry = false; queueMicrotask(sitIfFree); }
        }
        if (open && what) changed(what, entry);
      },
      save() { return table.save(); },
    });
    if (room !== r) return;
    open = true;
    play = p;
    await play.enter(handle);
    sitIfFree();
    for (const ev of ['member-join', 'member-leave', 'member-state']) r.on(ev, () => play?.status());
    r.on('member-join', (m) => reported.delete(m.pid));
    r.on('member-leave', () => tidy());
    tidy();
  }

  function changed(what, entry) {
    const me = handle.me;
    const mine = entry.pid === me;
    const name = (c) => table.names[c] || 'An admiral';
    const who = entry.from?.name || 'An admiral';
    const toast = (text) => ctx.hud.toast(text[0].toUpperCase() + text.slice(1));
    if (what.t === 'sit' && !mine) toast(`${name(what.c)} takes a seat`);
    if (what.t === 'stand' && !mine) {
      const next = what.next ? (table.seats[what.c] === me ? '; you take the seat' : `; ${what.next} takes the seat`) : '';
      toast(`${who} ${what.lost ? 'left the battle, and lost it' : 'left the table'}${next}`);
    }
    if (what.t === 'line' && !mine && table.seatOf(me) !== -1) toast(`${who} wants to play next`);
    if (what.t === 'new') {
      const c = what.change;
      const first = table.seats[0] === me ? 'you fire first' : `${table.names[0]} fires first`;
      if (c?.left === me) toast(`Battle ${what.n}: ${c.in} takes your seat`);
      else if (c?.took === me) toast(`Battle ${what.n}: your turn at the table, and ${first}`);
      else if (c) toast(`Battle ${what.n}: ${c.in} takes ${c.out}'s seat, and ${first}`);
      else toast(`Battle ${what.n}: ${first}`);
    }
    play.changed(what);
  }

  p3p2.on('room', adopt);
  p3p2.on('leave', () => {
    room = null;
    table = null;
    claim = null;
    play?.leave();
    play = null;
  });
  p3p2.start().catch(() => { /* no room, then; the AI is still there */ });

  if (window.__bs) {
    window.__bs.room = {
      table: () => (table ? { ...table.save(), phase: table.phase, fingerprint: table.fingerprint(), fromSnapshot } : null),
      seat: () => (table ? table.seatOf(handle.me) : null),
      canFire: () => play?.canFire() ?? false,
      showing: () => play?.showing ?? false,
      mine: () => play?.mine?.fleet ?? null,
      /** The question to a watcher, or where they are in the line: { ask, text }, or null. */
      asking: () => play?.asking ?? null,
    };
  }
  return { open: () => p3p2.open() };
}
