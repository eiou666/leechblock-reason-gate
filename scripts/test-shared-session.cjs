const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '..', 'leechblock-shared');
const background = fs.readFileSync(path.join(dir, 'background.js'), 'utf8').split('/*** STARTUP CODE BEGINS HERE ***/')[0];
const gateBase = 'http://127.0.0.1:8765/lb-custom/reason-gate.html';
const home = 'https://www.bilibili.com/?spm_id_from=333.1007.0.0';
const fav = 'https://space.bilibili.com/123456789/favlist?fid=987654321&ftype=create';
const search = 'https://search.bilibili.com/all';
const timestamp = (hour = 9, minute = 0, second = 0) => new Date(2026, 8, 5, hour, minute, second).getTime();

function memoryStorage(seed = {}) {
  const data = structuredClone(seed);
  return {
    data,
    async get(key) { return structuredClone(key == null ? data : { [key]: data[key] }); },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; },
  };
}

async function setup({ now = timestamp(), session = memoryStorage(), local = memoryStorage(), initialize = true, privateContext = false } = {}) {
  let clock = now;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const updates = [], tabs = [];
  const chrome = {
    runtime: { getURL: name => `chrome-extension://test/${name}`, async sendMessage() {} },
    extension: { inIncognitoContext: privateContext },
    storage: { session, local, sync: memoryStorage(), onChanged: { addListener() {} } },
    tabs: {
      async update(id, details) { updates.push({ id, ...details }); const tab = tabs.find(t => t.id === id); if (tab) Object.assign(tab, details); },
      async query() { return tabs; },
      async sendMessage() {},
      async remove() {},
    },
    action: { setIcon() {} },
    i18n: { getMessage: () => '' },
  };
  const context = vm.createContext({ chrome, URL, Date: Clock, console, setTimeout, clearTimeout });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(dir, name), 'utf8'), context, { filename: name }));
  vm.runInContext(background, context, { filename: 'background.js' });
  const run = code => vm.runInContext(code, context);
  const sessions = run('gReasonSessions');
  await sessions.ready;
  if (initialize) run('gOptions = reasonGateDefaults(); gNumSets = +gOptions.numSets; gGotOptions = true; createRegExps();');
  let nextId = 1;
  function tab(url, incognito = false) {
    const item = { id: nextId++, url, incognito };
    tabs.push(item);
    context.handleTabCreated(item);
    Object.assign(context.gTabs[item.id], { url, incog: incognito });
    return item.id;
  }
  async function grant(set = 1, url = search, incognito = false) {
    const source = `${gateBase}?${set}&${url}`;
    const id = tab(source, incognito);
    await context.allowBlockedPage(id, url, set, true, source);
    return id;
  }
  function check(url, incognito = false, repeat = false) {
    const id = tab(url, incognito);
    const blocked = context.checkTab(id, !repeat, repeat);
    return { id, blocked, state: context.gTabs[id] };
  }
  return { context, run, sessions, session, local, tabs, updates, tab, grant, check,
    setClock(value) { clock = value; }, policy: set => context.reasonSharedPolicy(set, context.gOptions) };
}

// DOM/event/timer harness for the served single-page UI plus real content script.
async function inlinePage(h, { elapsed = 0, infoOverride, failSend = false } = {}) {
  class Element {
    constructor(attributes = {}) { this.attributes = attributes; this.events = {}; this.value = ''; this.disabled = false; this.validity = ''; this.reports = 0; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, fn) { (this.events[type] ??= []).push(fn); }
    dispatch(type, event = {}) { for (const fn of this.events[type] ?? []) fn(event); }
    click() { if (!this.disabled) this.dispatch('click'); }
    setCustomValidity(message) { this.validity = message; }
    reportValidity() { this.reports++; }
    focus() {}
  }
  const app = new Element({ 'data-lb-reason-gate': 'inline-v1' });
  const reason = new Element(), submit = new Element(); submit.disabled = true;
  let clock = elapsed, rejectNextSend = failSend;
  const timers = [], messages = [];
  const source = `${gateBase}?1&${search}`;
  const id = h.tab(source);
  const elements = { app, reason, submit };
  const context = vm.createContext({
    document: { getElementById: name => elements[name] ?? null },
    location: new URL(source),
    performance: { now: () => clock },
    window: { setTimeout(fn, ms) { timers.push({ fn, at: clock + ms }); return timers.length; } },
    chrome: { runtime: { async sendMessage(message) {
      if (message.type === 'blocked') return infoOverride ?? h.context.createBlockInfo(id, source);
      messages.push(message);
      if (rejectNextSend) { rejectNextSend = false; throw new Error('test disconnected extension'); }
      // Exercise the actual background grant logic, not just message shape.
      await h.context.allowBlockedPage(id, message.blockedURL, message.blockedSet, true, source);
    } } },
  });
  vm.runInContext(fs.readFileSync(path.join(dir, 'blocked.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { app, reason, submit, messages, timers,
    advance(ms) {
      clock += ms;
      for (let next; (next = timers.findIndex(timer => timer.at <= clock)) !== -1;) timers.splice(next, 1)[0].fn();
    },
    pressSubmit() { reason.dispatch('keydown', { ctrlKey: true, key: 'Enter', preventDefault() {} }); },
  };
}

test('inline gate is inert before 5 seconds, enables at 5 seconds, and never submits automatically', async () => {
  const h = await setup(), page = await inlinePage(h);
  page.reason.value = '查找学习相关视频';
  assert.equal(page.submit.disabled, true);
  page.advance(4999);
  page.submit.click();
  page.submit.dispatch('click'); // Bypassing HTML disabled must still fail.
  page.pressSubmit();
  assert.equal(page.submit.disabled, true);
  assert.equal(page.messages.length, 0);
  assert.equal(page.reason.reports, 0, 'early clicks have no validation side effect');
  page.advance(1);
  assert.equal(page.submit.disabled, false);
  assert.equal(page.messages.length, 0);
  assert.equal(h.check(home).blocked, true, 'waiting alone grants nothing');
  page.submit.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.messages.length, 1);
  assert.equal(page.reason.value, '查找学习相关视频');
  assert.equal(h.check(fav).blocked, false);
  assert.equal(h.check(fav).state.secsLeft, 1800);
});

test('inline gate still requires five non-whitespace characters after waiting', async () => {
  const h = await setup(), page = await inlinePage(h);
  page.advance(5000);
  for (const text of ['', '  \t\n', '一 二 三 四']) {
    page.reason.value = text;
    page.submit.click();
    assert.equal(page.reason.validity, '至少输入5个非空白字符');
    assert.equal(page.submit.disabled, false);
  }
  assert.equal(page.messages.length, 0);
  page.reason.value = '一 二 三 四 五';
  page.reason.dispatch('input');
  assert.equal(page.reason.validity, '');
  page.pressSubmit();
  page.pressSubmit();
  page.submit.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.messages.length, 1, 'double click / keyboard repeats do not re-submit');
  assert.equal(h.check(home).blocked, false);
});

test('inline waiting is measured from page entry, including a slow extension response', async () => {
  const h = await setup(), page = await inlinePage(h, { elapsed: 6500 });
  assert.equal(page.submit.disabled, false);
  assert.equal(page.timers.length, 0);
  assert.equal(page.messages.length, 0);
});

test('refreshing the inline page restarts its wait and does not retain an armed bypass', async () => {
  const h = await setup(), first = await inlinePage(h);
  first.advance(5000);
  assert.equal(first.submit.disabled, false);
  const reloaded = await inlinePage(h);
  assert.equal(reloaded.submit.disabled, true);
  reloaded.reason.value = '查找学习相关视频';
  reloaded.pressSubmit();
  assert.equal(reloaded.messages.length, 0);
});

test('inline gate stays disabled with missing block info and allows retry after messaging failure', async () => {
  const h = await setup(), missing = await inlinePage(h, { infoOverride: {} });
  missing.advance(10000);
  assert.equal(missing.submit.disabled, true);
  const page = await inlinePage(h, { failSend: true });
  page.reason.value = '查找学习相关视频'; page.advance(5000); page.submit.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.submit.disabled, false);
  assert.equal(page.reason.value, '查找学习相关视频');
  assert.equal(h.check(home).blocked, true);
  page.submit.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.check(home).blocked, false);
});

test('served HTML keeps the input and button together with no countdown or reload code', () => {
  const html = fs.readFileSync(path.join(dir, '..', 'lb-custom', 'reason-gate.html'), 'utf8');
  assert.equal((html.match(/<textarea\b/g) ?? []).length, 1);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.match(html, /<button id="submit" type="button" disabled>确定<\/button>/);
  assert.match(html, /data-lb-reason-gate="inline-v1"/);
  assert.doesNotMatch(html, /lbDelaySeconds|location\.reload|sessionStorage/);
});

test('fresh defaults cover every minute, every day, with 30/5 minute grants and 5 second delays', async () => {
  const h = await setup();
  for (let day = 0; day < 7; day++) for (let minute = 0; minute < 1440; minute++) {
    const now = new Date(2026, 8, 6 + day, 0, minute).getTime() / 1000;
    const windows = [1, 2].map(set => h.context.reasonScheduleWindow(h.policy(set), now));
    assert.equal(windows.filter(Boolean).length, 1, `day ${day}, minute ${minute}`);
  }
  assert.equal(h.context.gOptions.delayAllowMins1, '30');
  assert.equal(h.context.gOptions.delayAllowMins2, '5');
  assert.equal(h.context.gOptions.delaySecs1, '5');
  assert.equal(h.context.gOptions.delaySecs2, '5');
  for (const set of [1, 2]) {
    assert.equal(h.context.gOptions[`disable${set}`], false);
    assert.equal(h.context.gOptions[`activeBlock${set}`], true);
    assert.equal(h.context.gOptions[`conjMode${set}`], false);
    assert.equal(h.context.gOptions[`limitMins${set}`], '');
    assert.equal(h.context.gOptions[`limitPeriod${set}`], '');
    assert.equal(h.context.gOptions[`delayAutoLoad${set}`], true);
  }
});

test('importable default configuration matches fresh-install defaults and has no runtime state', () => {
  const { defaultOptionsText } = require('./defaults.cjs');
  const text = fs.readFileSync(path.join(dir, '..', 'config', 'default-options.txt'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(text, defaultOptionsText());
  assert.match(text, /^disable1=false$/m);
  assert.match(text, /^disable2=false$/m);
  assert.match(text, /^delayAllowMins1=30$/m);
  assert.match(text, /^delayAllowMins2=5$/m);
  assert.doesNotMatch(text, /^(timedata\d+|oret|password|orp)=/m);
});

test('before granting, the actual blocker gates search, homepage and favorites', async () => {
  const h = await setup();
  for (const url of [search, home, fav]) {
    const { id, blocked } = h.check(url);
    assert.equal(blocked, true);
    assert.equal(h.updates.find(u => u.id === id).url, `${gateBase}?1&${url}`);
  }
});

test('search -> bilibili.com homepage and homepage -> space favorites share the grant without any opener', async () => {
  const h = await setup();
  await h.grant(1, search);
  for (const url of ['https://bilibili.com/', home, fav, search, 'https://www.bilibili.com/video/BV123/']) {
    const result = h.check(url);
    assert.equal(result.blocked, false, url);
    assert.equal(result.state.secsLeft, 1800);
    assert.equal(result.state.allowedSet, 0, 'must not rely on native per-tab allowance');
  }
});

test('all configured platforms and subdomains in the same set share one deadline', async () => {
  const h = await setup();
  await h.grant();
  h.setClock(timestamp(9, 12));
  for (const url of ['https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://x.com/home',
    'https://twitter.com/home', 'https://t.co/x', 'https://zhuanlan.zhihu.com/p/1',
    'https://www.douyin.com/', 'https://v.douyin.com/x', 'https://b23.tv/x']) {
    const result = h.check(url);
    assert.equal(result.blocked, false, url);
    assert.equal(result.state.secsLeft, 1080, url);
  }
});

test('new navigation and a second delayed completion never extend the original deadline', async () => {
  const h = await setup();
  await h.grant();
  h.setClock(timestamp(9, 10));
  await h.grant(1, home);
  assert.equal(h.check(fav).state.secsLeft, 1200);
  assert.equal(h.sessions.get(1, false, h.policy(1), timestamp(9, 10) / 1000).expiresAt, timestamp(9, 30) / 1000);
});

test('at the exact deadline, fresh tabs and already-open pages both gate again', async () => {
  const h = await setup();
  await h.grant();
  h.setClock(timestamp(9, 29, 59));
  assert.equal(h.check(fav).state.secsLeft, 1);
  h.setClock(timestamp(9, 30));
  assert.equal(h.check(fav).blocked, true);
  assert.equal(h.check(home, false, true).blocked, true);
});

test('a grant is clipped at 11:50 and cannot bypass the 5-minute group or reappear at noon', async () => {
  const h = await setup({ now: timestamp(11, 40) });
  await h.grant();
  assert.equal(h.check(home).state.secsLeft, 600);
  h.setClock(timestamp(11, 50));
  let result = h.check(home);
  assert.equal(result.blocked, true);
  assert.match(h.updates.find(u => u.id === result.id).url, /\?2&/);
  await h.grant(2, home);
  assert.equal(h.check(fav).state.secsLeft, 300);
  h.setClock(timestamp(11, 55));
  assert.equal(h.check(fav).blocked, true);
  h.setClock(timestamp(12));
  result = h.check(home);
  assert.equal(result.blocked, true);
  assert.match(h.updates.find(u => u.id === result.id).url, /\?1&/);
});

test('old group countdown completing after a schedule boundary does not issue a new grant', async () => {
  const h = await setup({ now: timestamp(11, 50) });
  await h.grant(1, search);
  assert.equal(h.sessions.get(1, false, h.policy(1), timestamp(11, 50) / 1000), null);
  assert.equal(h.check(home).blocked, true);
});

test('the five-minute overnight grant crosses midnight because the block group does not change', async () => {
  const h = await setup({ now: timestamp(23, 59) });
  await h.grant(2, home);
  assert.equal(h.check(fav).state.secsLeft, 300);
  h.setClock(timestamp(24, 1));
  assert.equal(h.check(fav).blocked, false);
  assert.equal(h.check(fav).state.secsLeft, 180);
  h.setClock(timestamp(24, 4));
  assert.equal(h.check(fav).blocked, true);
});

test('worker recreation restores the same deadline, while browser restart clears it', async () => {
  const first = await setup();
  await first.grant();
  const resumed = await setup({ now: timestamp(9, 20), session: first.session });
  assert.equal(resumed.check(fav).blocked, false);
  assert.equal(resumed.check(fav).state.secsLeft, 600);
  const restarted = await setup({ now: timestamp(9, 20) });
  assert.equal(restarted.check(fav).blocked, true);
});

test('normal/private contexts and overlapping block sets remain independent', async () => {
  const h = await setup();
  await h.grant();
  assert.equal(h.check(home, true).blocked, true);
  await h.grant(1, home, true);
  assert.equal(h.check(fav, true).blocked, false);
  h.context.gOptions.times2 = '0000-2400';
  assert.equal(h.check(home).blocked, true, 'set 1 must not override set 2');
});

test('lockdown/minimum-block and modified settings invalidate the grant', async () => {
  for (const change of [
    h => { h.context.gOptions.timedata1[4] = timestamp(10) / 1000; },
    h => { h.context.gOptions.timedata1[8] = timestamp(10) / 1000; },
    h => { h.context.gOptions.delayAllowMins1 = '10'; },
  ]) {
    const h = await setup(); await h.grant(); change(h);
    assert.equal(h.check(home).blocked, true);
  }
});

test('simultaneous completions share a single persisted deadline', async () => {
  const h = await setup();
  const grants = await Promise.all(Array.from({ length: 8 }, (_, i) => h.sessions.issue(1, false, h.policy(1), timestamp(9, 0, i) / 1000)));
  assert.equal(new Set(grants.map(g => g.expiresAt)).size, 1);
  assert.equal(grants[0].expiresAt, timestamp(9, 30) / 1000);
});

test('persistence errors fail closed and do not navigate or publish a grant', async () => {
  const session = memoryStorage(); session.set = async () => { throw new Error('test storage failure'); };
  const h = await setup({ session });
  await h.grant();
  assert.equal(h.updates.length, 0);
  assert.equal(h.check(home).blocked, true);
});

test('already-open gate pages resume automatically without renewing or releasing other groups/private tabs', async () => {
  const h = await setup();
  const same = h.tab(`${gateBase}?1&${fav}`);
  const other = h.tab(`${gateBase}?2&${home}`);
  const privateId = h.tab(`${gateBase}?1&${home}`, true);
  await h.grant();
  assert.equal(h.updates.find(u => u.id === same).url, fav);
  assert.equal(h.updates.some(u => u.id === other || u.id === privateId), false);
  h.setClock(timestamp(9, 5));
  const later = { id: 80, url: `${gateBase}?1&${home}`, incognito: false };
  await h.context.resumeSharedGate(later);
  assert.equal(h.updates.find(u => u.id === 80).url, home);
  assert.equal(h.check(search).state.secsLeft, 1500);
});

test('gate source is validated and original target query/fragment round-trip unchanged', async () => {
  const h = await setup();
  const url = `${fav}&text=%E4%B8%AD%E6%96%87#part-2`;
  const source = `${gateBase}?1&${url}`;
  const id = h.tab(source);
  const info = h.context.createBlockInfo(id, source);
  assert.equal(info.blockedURL, url);
  await h.context.allowBlockedPage(id, url, 1, true, 'https://evil.example/lb-custom?1&' + url);
  assert.equal(h.check(home).blocked, true);
  await h.context.allowBlockedPage(id, url, 1, true, source);
  assert.equal(h.check(home).blocked, false);
});

test('discarding remaining time revokes the entire shared grant', async () => {
  const h = await setup(); await h.grant();
  const { id } = h.check(home);
  h.context.gActiveTabId = id;
  h.context.discardRemainingTime();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.check(fav).blocked, true);
});

test('fresh-install initialization writes presets; existing settings are preserved', async () => {
  const h = await setup({ initialize: false });
  await h.context.retrieveOptions();
  assert.equal(h.context.gGotOptions, true);
  assert.equal(h.local.data.delayAllowMins1, '30');
  assert.equal(h.local.data.delayAllowMins2, '5');
  assert.equal(h.check(home).blocked, true);
  const saved = structuredClone(h.local.data); saved.setName1 = 'My custom name';
  const existing = await setup({ initialize: false, local: memoryStorage(saved) });
  await existing.context.retrieveOptions();
  assert.equal(existing.context.gOptions.setName1, 'My custom name');
});

test('a gate message waking the worker waits for options and restored session state', async () => {
  const first = await setup(); await first.grant();
  const cold = await setup({ initialize: false, now: timestamp(9, 20), session: first.session,
    local: memoryStorage(first.context.gOptions) });
  const source = `${gateBase}?1&${fav}`;
  const response = new Promise(resolve => {
    const keepAlive = cold.context.handleMessage({ type: 'blocked' }, { tab: { id: 100, incognito: false }, url: source }, resolve);
    assert.equal(keepAlive, true);
  });
  const info = await response;
  assert.equal(info.blockedURL, fav);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cold.updates.find(u => u.id === 100).url, fav);
});

test('non-reason-gate block sets keep original per-tab delayed behavior', async () => {
  const h = await setup();
  h.context.gOptions.blockURL1 = 'delayed.html?$S&$U';
  const id = h.tab(home);
  await h.context.allowBlockedPage(id, home, 1, true);
  assert.equal(h.context.checkTab(id, true, false), false);
  assert.equal(h.check(fav).blocked, true);
});

test('the real blocked-page countdown grants only after the fifth tick', async () => {
  const h = await setup();
  const source = `${gateBase}?1&${search}`;
  const id = h.tab(source);
  let countdown, tick;
  const element = { innerText: '5' };
  const page = vm.createContext({
    document: { hasFocus: () => true, getElementById: name => name === 'lbDelaySeconds' ? element : null },
    window: { setInterval(fn, ms, state) { assert.equal(ms, 1000); tick = fn; countdown = state; return 1; }, clearInterval() {} },
    chrome: { runtime: { async sendMessage(message) {
      if (message.type === 'blocked') return h.context.createBlockInfo(id, source);
      h.context.handleMessage(message, { tab: { id, incognito: false }, url: source }, () => {});
    } } },
  });
  vm.runInContext(fs.readFileSync(path.join(dir, 'blocked.js'), 'utf8'), page);
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 4; i++) tick(countdown);
  assert.equal(h.check(home).blocked, true);
  tick(countdown);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.check(fav).blocked, false);
  assert.equal(h.check(fav).state.secsLeft, 1800);
});

test('local fork manifest has its own identity, no store update, and unchanged permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.key, undefined);
  assert.equal(manifest.update_url, undefined);
  assert.equal(manifest.version, '1.7.3.2');
  for (const script of ['background.js', 'common.js', 'shared-session.js', 'blocked.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, script), 'utf8'), { filename: script }));
  }
});
