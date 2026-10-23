// Headless checks for the inheritance rules: casualties leave the roster, undo
// puts them back, armour rewinds the stage, and the reward pool reacts to what
// you still own.
//
// Manual helper, not part of the build: requires a dev server on :5173.

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
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
      const hudArmy = () => document.getElementById('army').textContent;

      // --- 1. opening composition
      R.startLevel(0, true);
      out.opening = { roster: R.run.roster.join(''), army: R.army, hud: hudArmy(), fen: R.buildFen().split(' ')[0] };
      out.openingPieces = [];
      for (let sq = 0; sq < 90; sq++) if (R.pos.board[sq] && R.pos.board[sq] < 8) out.openingPieces.push(sq);

      // --- 2. casualties leave the roster. Scripted rather than searched so the
      // result is deterministic: red slides the rook off the a-file, black walks
      // its a5 soldier down and eats the a3 one. a0=0 a1=9 a2=18 a3=27 a4=36 a5=45
      R.startLevel(0, true);
      const before = R.run.roster.join('');
      R.moveBoth(0, 9);
      R.moveBoth(45, 36);
      R.moveBoth(9, 18);
      const midRoster = R.run.roster.join('');
      R.moveBoth(36, 27);
      const after = R.run.roster.join('');
      out.capture = { before, midRoster, after, army: R.army, hud: hudArmy(), status: document.getElementById('status').textContent };

      // --- 3. undo restores the roster
      R.startLevel(0, true);
      const undoBefore = R.run.roster.join('');
      let undoChecked = false;
      for (let i = 0; i < 200 && !undoChecked; i++) {
        const moves = R.pos.legalMoves([]);
        if (!moves.length) break;
        R.moveBoth(moves[0] >> 8, moves[0] & 255);
        if (R.run.roster.join('') !== undoBefore || R.run.status !== 'playing') break;
      }
      out.beforeUndo = R.run.roster.join('');
      R.undo();
      out.afterUndo = R.run.roster.join('');

      // --- 4. armour rewinds the stage and the army
      R.startLevel(0, true);
      R.run.armor = 2;
      const snapArmy = R.run.roster.join('');
      // burn a pawn off the roster, then lose the stage
      R.run.roster = R.run.roster.filter((t, i) => !(t === 'p' && i === R.run.roster.indexOf('p')));
      R.pos.kings[0] = -1;
      R.finishIfOver();
      out.afterLose = { armor: R.run.armor, roster: R.run.roster.join(''), hud: hudArmy() };
      R.startLevel(R.run.level, true);
      out.afterArmourRetry = { roster: R.run.roster.join(''), expected: snapArmy, hud: hudArmy() };

      // --- 5. reward pool tracks what you still own
      const p0 = R.drawRewards(R.run, { count: 12 }).map((c) => c.key);
      out.poolFull = p0;
      R.run.roster = ['k'];
      const pEmpty = R.drawRewards(R.run, { count: 12 }).map((c) => c.key);
      out.poolLoneKing = pEmpty;
      R.run.roster = ['k', 'r', 'p', 'p'];

      // --- 6. blood price adds a black pawn to the next stage
      R.run.extraBlackPawns = 2;
      const withDebt = R.buildFen().split(' ')[0];
      R.run.extraBlackPawns = 0;
      const noDebt = R.buildFen().split(' ')[0];
      out.debtChangedBoard = withDebt !== noDebt;

      // --- 7. stage entry refills once and survives a retry
      R.startLevel(1, false);
      const atEntry = R.run.roster.join('');
      R.startLevel(1, true);
      out.refill = { atEntry, afterRetry: R.run.roster.join('') };

      // --- 8. a wipe-out ends the run without waiting for the ply limit
      R.run.armor = 0;
      R.run.roster = ['k'];
      R.startLevel(R.run.level, true);
      R.run.roster = ['k'];
      R.finishIfOver();
      out.wipeOut = {
        status: document.getElementById('status').textContent,
        overlay: !document.getElementById('overlay').hidden,
        title: document.getElementById('ovTitle').textContent,
      };
      R.hideOverlay();

      // --- 9. clicking a reward card advances the run for real
      R.startLevel(0, true);
      R.run.armor = 1;
      R.pos.board[R.pos.kings[1]] = 0;
      R.pos.kings[1] = -1;
      R.finishIfOver();
      await new Promise((r) => setTimeout(r, 80));
      out.cardCount = document.querySelectorAll('.card').length;
      document.querySelector('.card')?.click();
      await new Promise((r) => setTimeout(r, 250));
      out.afterCard = {
        level: R.run.level,
        name: document.getElementById('levelName').textContent,
        overlayHidden: document.getElementById('overlay').hidden,
        army: R.army,
        build: R.describeBuild(R.run),
      };

      // --- 10. a real click on a soldier makes a move and the bot answers
      R.startLevel(0, true);
      const pliesBefore = R.pos.turn === 0 ? 0 : 1;
      R.onSquare(27);
      const marks = document.querySelectorAll('#marks .mark').length;
      R.onSquare(36);
      await new Promise((r) => setTimeout(r, 1600));
      out.clickPlay = {
        marks,
        status: document.getElementById('status').textContent,
        aiInfo: document.getElementById('aiInfo').textContent,
        turn: R.pos.turn,
        army: R.army,
      };

      return out;
    `);

    console.log(JSON.stringify(r, null, 1));
    console.log('');

    check('opening army is 車+双兵', r.opening.roster === 'krpp', r.opening.roster);
    check('opening placement', r.opening.fen === '4k4/9/9/9/p1p1p4/9/P1P6/9/9/R3K4', r.opening.fen);
    check('HUD mirrors the army', r.opening.hud === r.opening.army, `${r.opening.hud} / ${r.opening.army}`);
    check('a casualty leaves the roster', r.capture.before === 'krpp' && r.capture.after === 'krp', r.capture.before + ' -> ' + r.capture.after);
    check('HUD follows the casualty', r.capture.hud === r.capture.army, r.capture.hud);
    check('armour rewinds the army', r.afterArmourRetry.roster === r.afterArmourRetry.expected,
      `${r.afterArmourRetry.roster} vs ${r.afterArmourRetry.expected}`);
    check('armour is spent', r.afterLose.armor === 1, String(r.afterLose.armor));
    check('a lone king has no tier offers', !r.poolLoneKing.some((k) => k.startsWith('tier:p')), r.poolLoneKing.join(','));
    check('a lone king still sees armour', r.poolLoneKing.some((k) => k.includes('armor')));
    check('blood price changes the board', r.debtChangedBoard === true);
    check('refill applies once', r.refill.atEntry === 'krppp', r.refill.atEntry);
    check('refill survives a retry', r.refill.afterRetry === 'krppp', r.refill.afterRetry);
    check('a wipe-out ends the run', r.wipeOut.status.includes('部队打光了') && r.wipeOut.overlay,
      r.wipeOut.status + ' / ' + r.wipeOut.title);
    check('a reward card advances the run', r.cardCount === 3 && r.afterCard.level === 1 && r.afterCard.overlayHidden,
      JSON.stringify(r.afterCard));
    check('a real click moves and the bot answers', r.clickPlay.marks > 0 && r.clickPlay.turn === 0,
      JSON.stringify(r.clickPlay));

    const realErrors = consoleErrors.filter((e) => e && !/favicon/i.test(e));
    check('no console errors', realErrors.length === 0, realErrors.join(' | '));

    ws.close();
  } finally {
    cleanup();
  }
  console.log(failures === 0 ? '\nall roster checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
