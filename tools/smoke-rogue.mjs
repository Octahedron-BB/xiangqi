// Headless smoke test: plays the whole run through the debug handle and reports
// roster transitions, stage composition errors and console errors.
//
// Manual helper, not part of the build: requires a dev server on :5173.

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'C:/Program Files/Google/Chrome/Application/chrome.exe'
);
const PORT = 9339;
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

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rogue-cdp-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
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
    const errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(msg.params.args.map((a) => a.description ?? a.value).join(' '));
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
    await send('Page.enable');
    await wait(1500);

    const report = await evaluate(`
      const R = window.__rogue;
      const out = { stages: [], rewards: [], errors: [] };
      if (!R) { out.fatal = 'no debug handle'; return out; }
      let guard = 0;
      while (R.run.status === 'playing' && R.run.level < 20 && guard++ < 80) {
        const rosterBefore = R.run.roster.join('');
        R.pos.board[R.pos.kings[1]] = 0;
        R.pos.kings[1] = -1;
        R.finishIfOver();
        await new Promise(r => setTimeout(r, 120));
        out.stages.push({ cleared: R.run.level + 1, rosterAtClear: rosterBefore, army: R.run.army });
        let picks = 0;
        while (R.run.pending > 0 && picks++ < 4) {
          const menu = R.drawRewards(R.run, { count: 3 });
          if (!menu.length) { R.run.pending = 0; break; }
          R.applyReward(R.run, menu[0]);
          R.run.pending -= 1;
          out.rewards.push(menu[0].key);
        }
        R.run.pending = 0;
        R.hideOverlay();
        if (R.run.level >= 19) { out.finalArmy = R.run.army; break; }
        R.startLevel(R.run.level + 1);
        await new Promise(r => setTimeout(r, 60));
        out.stages.push({
          entered: R.run.level + 1,
          name: document.getElementById('levelName').textContent,
          fen: R.buildFen().split(' ')[0],
          army: R.run.army,
          kings: R.pos.kings.slice(),
          legal: R.pos.legalMoves([]).length,
        });
      }
      out.finalArmy = R.run.army;
      out.build = R.describeBuild(R.run);
      out.status = R.run.status;
      return out;
    `);

    console.log(JSON.stringify(report, null, 1));
    const realErrors = errors.filter((e) => e && !/favicon/i.test(e));
    console.log('console errors:', realErrors.length);
    for (const e of realErrors) console.log('  !', e);
    ws.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
