// Playing with a friend: a room on a p3p2 server.
//
// The room's log is the battle. Every page reads the same ops in the same order into a `Table` (`table.js`), and
// `play.js` shows what the table holds. Both load with the first room: on an ordinary visit nothing here asks any
// server anything or loads anything more, and `start()` resolves at once.
import { P3P2 } from '@p3p2/client';

/** The format of the ops and the snapshot (`table.js`). A page with another one is kept out of the room. */
export const TABLE_VERSION = '1';

export function openCompany(ctx) {
  const p3p2 = new P3P2({
    game: { id: 'battleship', version: TABLE_VERSION },
    // The game's own 👥 button, top right, opens the panel there: top left are pause and sound, the status runs along
    // the top, the buttons along the bottom, and the version is bottom left. Enter fires at the aimed cell, so chat
    // opens with T.
    ui: { corner: 'top-right', button: false, chatKey: 't' },
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
  };

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
  }

  function changed(what, entry) {
    const mine = entry.pid === handle.me;
    const name = (c) => table.names[c] || 'An admiral';
    if (what.t === 'sit' && !mine) ctx.hud.toast(`${name(what.c)} takes a seat`);
    if (what.t === 'stand' && !mine) ctx.hud.toast(what.lost ? `${entry.from?.name || 'An admiral'} left the battle, and lost it` : `${entry.from?.name || 'An admiral'} left the table`);
    if (what.t === 'new') ctx.hud.toast(`Battle ${what.n}: ${name(0)} fires first`);
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
    };
  }
  return { open: () => p3p2.open() };
}
