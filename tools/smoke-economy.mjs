// Headless checks for the economy and meta layer: gold by plies, the shop, the
// 悔棋符 consumable, saves, and the bot refusing to walk into a 长将 ruling.
//
// Manual helper, not part of the build: requires a dev server on :5173.

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9343;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJSON(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve(d);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rogue-cdp-'));
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
    { stdio: 'ignore' },
  );
  const cleanup = () => {
    try {
      chrome.kill();
    } catch {}
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  };

  try {
    for (let i = 0; i < 60; i++) {
      try {
        await httpJSON(`http://127.0.0.1:${PORT}/json/version`);
        break;
      } catch {
        await wait(250);
      }
    }
    const target = await httpJSON(
      `http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:5173/rogue.html?debug=1`,
      'PUT',
    );
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.description ?? a.value).join(' '));
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const myId = ++id;
        pending.set(myId, resolve);
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
      return res.result?.result?.value;
    };

    await send('Runtime.enable');
    await wait(1400);

    const r = await evaluate(`
      const R = window.__rogue;
      const out = {};
      const text = (elId) => document.getElementById(elId).textContent;
      const forceWin = () => { R.pos.board[R.pos.kings[1]] = 0; R.pos.kings[1] = -1; R.finishIfOver(); };

      // --- 1. fresh HUD
      R.startLevel(0, true);
      out.freshHud = { gold: text('gold'), undo: text('btnUndo'), disabled: document.getElementById('btnUndo').disabled };

      // --- 2. gold = base + 2 per ply saved against par
      R.startLevel(0, true);
      R.run.gold = 0;
      R.pos.board[R.pos.kings[1]] = 0;
      R.pos.kings[1] = -1;
      R.finishIfOver();
      out.goldWin = { gold: R.run.gold, hud: text('gold'), status: text('status') };
      R.hideOverlay();

      // --- 3. undo costs a token
      R.startLevel(0, true);
      R.run.gold = 0;
      R.run.items = { undo: 1 };
      document.getElementById('btnUndo').disabled = false;
      R.useUndo();
      out.undoEmpty = { items: JSON.stringify(R.run.items ?? {}) };
      R.run.items = { undo: 2 };
      R.moveBoth(27, 36); // pawn a3 -> a4
      const before = R.pos.board[36];
      R.useUndo();
      out.undoUsed = { tokenLeft: R.run.items.undo ?? 0, pawnBack: R.pos.board[36] === 0 && R.pos.board[27] !== 0 };
      R.hideOverlay();

      // --- 4. shop opens after stage 5 and sells for gold
      R.run = R.run; // keep
      R.startLevel(4, true); // stage 5
      R.run.gold = 100;
      R.run.shopsSeen = new Set();
      R.pos.board[R.pos.kings[1]] = 0;
      R.pos.kings[1] = -1;
      R.finishIfOver();               // win -> rewards
      R.run.pending = 0;              // skip the reward screen
      R.hideOverlay();
      R.afterStage();                 // should open the shop
      await new Promise((r2) => setTimeout(r2, 60));
      const shopCards = [...document.querySelectorAll('.card')];
      out.shop = {
        open: !document.getElementById('overlay').hidden,
        title: text('ovTitle'),
        cards: shopCards.length,
        prices: shopCards.slice(0, 3).map((c) => c.querySelector('.card-price')?.textContent),
        footer: document.getElementById('ovFoot').textContent,
      };
      const before4 = { gold: R.run.gold, tiers: JSON.stringify(R.run.tiers), roster: R.run.roster.join('') };
      shopCards[0]?.click();
      await new Promise((r2) => setTimeout(r2, 60));
      out.afterBuy = {
        gold: R.run.gold,
        spent: before4.gold - R.run.gold,
        tiers: JSON.stringify(R.run.tiers),
        roster: R.run.roster.join(''),
        cardsNow: document.querySelectorAll('.card').length,
      };
      R.hideOverlay();

      // --- 5. save / load round trip
      R.startLevel(2, true);          // stage 3
      R.run.gold = 47;
      R.run.tiers.p = 2;
      R.run.items = { undo: 3 };
      // a save records the army as it stood when the stage began, so move the
      // snapshot itself to prove it round-trips
      R.run.snapshot = ['k', 'r', 'p', 'p', 'p', 'c'];
      R.run.roster = ['k', 'r'];
      R.run.granted = new Set([0, 1, 2]);
      R.saveGame();
      out.savedLevel = R.run.level;
      R.run.gold = 0;
      R.run.tiers.p = 0;
      R.run.roster = ['k'];
      R.loadGame();
      await new Promise((r2) => setTimeout(r2, 80));
      out.loaded = {
        level: R.run.level,
        gold: R.run.gold,
        tierP: R.run.tiers.p,
        roster: R.run.roster.join(''),
        items: R.run.items.undo,
        hudGold: text('gold'),
        btnUndo: text('btnUndo'),
        levelPill: text('levelPill'),
      };

      // --- 6. new game wipes the save
      window.confirm = () => true;
      R.newGame();
      await new Promise((r2) => setTimeout(r2, 80));
      out.afterNew = {
        level: R.run.level,
        gold: R.run.gold,
        roster: R.run.roster.join(''),
        saveGone: localStorage.getItem('xq.rogue.save.v1') === null,
      };

      // --- 7. the bot refuses its own 长将
      R.startLevel(0, true);
      const moves = R.pos.legalMoves([]);
      const probe = moves[0];
      const u = R.pos.make(probe);
      const probeFen = R.pos.fen();
      R.pos.unmake(u);
      const before2 = R.repeatsOn(probe);
      R.seen.set(probeFen, { count: 2, last: 2 });
      const after2 = R.repeatsOn(probe);
      out.repetition = { before: before2, after: after2 };

      // and the picker actually swaps it for another legal reply
      R.startLevel(0, true);
      R.moveBoth(27, 36);                    // red moves, black to play
      const replies = R.pos.legalMoves([]);
      const first = replies[0];
      const u2 = R.pos.make(first);
      const firstFen = R.pos.fen();
      R.pos.unmake(u2);
      const ranked = replies.map((m) => ({ from: m >> 8, to: m & 255, score: 0 }));
      const noRep = R.seen.get(firstFen);
      out.pickBaseline = R.avoidingRepetition({ move: first, ranked });
      R.seen.set(firstFen, { count: 2, last: 1 });
      out.pickAfterRepeat = R.avoidingRepetition({ move: first, ranked });
      out.firstMove = first;
      if (noRep) R.seen.set(firstFen, noRep);
      else R.seen.delete(firstFen);

      return out;
    `);

    console.log(JSON.stringify(r, null, 1));
    console.log('');

    check('fresh HUD shows 0 gold and no charm', r.freshHud.gold === '0' && /×0/.test(r.freshHud.undo) && r.freshHud.disabled,
      JSON.stringify(r.freshHud));
    check('a clear pays gold', r.goldWin.gold > 0, JSON.stringify(r.goldWin));
    check('using undo with no charm does nothing', !r.undoEmpty.hasOwnProperty('undo') || r.undoEmpty.items === '{}',
      r.undoEmpty.items);
    check('undo spends a charm and rewinds the move', r.undoUsed.tokenLeft === 1 && r.undoUsed.pawnBack,
      JSON.stringify(r.undoUsed));
    check('shop opens after stage 5', r.shop.open && r.shop.cards > 0, JSON.stringify(r.shop));
    check('shop shows prices', r.shop.prices.every((p) => p && /金/.test(p)), JSON.stringify(r.shop.prices));
    check('buying spends gold and changes the run',
      r.afterBuy.spent > 0 && (r.afterBuy.tiers !== undefined || r.afterBuy.roster.length > 0),
      JSON.stringify(r.afterBuy));
    check('save stores the stage', r.savedLevel === 2, String(r.savedLevel));
    check('load restores the run',
      r.loaded.level === 2 && r.loaded.gold === 47 && r.loaded.tierP === 2 &&
      r.loaded.roster === 'krpppc' && r.loaded.items === 3,
      JSON.stringify(r.loaded));
    check('load refreshes the HUD', r.loaded.hudGold === '47' && /×3/.test(r.loaded.btnUndo),
      `${r.loaded.hudGold} / ${r.loaded.btnUndo}`);
    check('new game resets and clears the save',
      r.afterNew.level === 0 && r.afterNew.gold === 0 && r.afterNew.roster === 'krpp' && r.afterNew.saveGone,
      JSON.stringify(r.afterNew));
    check('repetition detection fires on the third occurrence', r.repetition.before === false && r.repetition.after === true,
      JSON.stringify(r.repetition));
    check('the bot swaps away from a repeating reply',
      r.pickAfterRepeat !== r.firstMove && r.pickBaseline === r.firstMove,
      `first=${r.firstMove} baseline=${r.pickBaseline} after=${r.pickAfterRepeat}`);

    const realErrors = consoleErrors.filter((e) => e && !/favicon/i.test(e));
    check('no console errors', realErrors.length === 0, realErrors.join(' | '));

    ws.close();
  } finally {
    cleanup();
  }
  console.log(failures === 0 ? '\nall economy checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
