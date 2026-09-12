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

test('night migration preserves daytime settings, copies sites, and runs only once', async () => {
  const h = await setup();
  const original = structuredClone(h.context.gOptions);
  const patch = h.context.nightPasswordMigration(h.context.gOptions, 'test-only-password');
  Object.assign(h.context.gOptions, patch);
  assert.equal(patch.numSets, '3');
  assert.equal(patch.times2, '0600-0700,1150-1200,1750-1800,2200-2300');
  assert.equal(patch.times3, '0000-0600,2300-2400');
  assert.equal(patch.sites3, original.sites2);
  for (const key of Object.keys(original)) {
    if (key !== 'times2' && key !== 'numSets') assert.deepEqual(structuredClone(h.context.gOptions[key]), original[key], key);
  }
  assert.equal(Object.keys(h.context.nightPasswordMigration(h.context.gOptions, 'test-only-password')).length, 0);
});

async function setupNight(now) {
  const h = await setup({ now });
  Object.assign(h.context.gOptions, h.context.nightPasswordMigration(h.context.gOptions, 'test-only-password'));
  h.run('gNumSets = +gOptions.numSets; cleanOptions(gOptions); cleanTimeData(gOptions); createRegExps();');
  return h;
}

test('night configuration covers every minute exactly once and only 23:00-06:00 requires a password', async () => {
  const h = await setupNight(timestamp(23));
  for (let minute = 0; minute < 1440; minute++) {
    const now = timestamp(0, minute) / 1000;
    const active = [1, 2, 3].filter(set => h.context.reasonScheduleWindow(h.policy(set), now));
    assert.equal(active.length, 1);
    assert.equal(active[0] === 3, minute < 360 || minute >= 1380);
  }
});

test('night grant requires the exact password, rejects reason-page bypass and remains globally shared for five minutes', async () => {
  const h = await setupNight(timestamp(23, 10));
  const blocked = h.check(home);
  const source = `chrome-extension://test/password.html?3&${home}`;
  assert.equal(h.updates.find(u => u.id === blocked.id).url, source);
  const id = h.tab(source);
  await h.context.allowBlockedPage(id, home, 3, true, source, 'wrong');
  assert.equal(h.check(fav).blocked, true);
  await h.context.allowBlockedPage(id, home, 3, true, `chrome-extension://test/reason-gate.html?3&${home}`, 'test-only-password');
  assert.equal(h.check(fav).blocked, true);
  await h.context.allowBlockedPage(id, home, 3, true, source);
  assert.equal(h.check(fav).blocked, true);
  await h.context.allowBlockedPage(id, home, 3, true, source, 'test-only-password');
  assert.equal(h.check(fav).blocked, false);
  assert.equal(h.check('https://www.youtube.com/').state.secsLeft, 300);
  h.setClock(timestamp(23, 15));
  assert.equal(h.check(fav).blocked, true);
});

test('23:00 and 06:00 boundaries require the new gate instead of carrying an old grant', async () => {
  const h = await setupNight(timestamp(22, 59));
  await h.grant(2, home);
  assert.equal(h.check(fav).state.secsLeft, 60);
  h.setClock(timestamp(23));
  assert.equal(h.check(fav).blocked, true);
  h.setClock(timestamp(29, 59)); // next day 05:59
  const source = `chrome-extension://test/password.html?3&${home}`;
  await h.context.allowBlockedPage(h.tab(source), home, 3, true, source, 'test-only-password');
  assert.equal(h.check(fav).state.secsLeft, 60);
  h.setClock(timestamp(30));
  const result = h.check(fav);
  assert.equal(result.blocked, true);
  assert.match(h.updates.find(u => u.id === result.id).url, /reason-gate\.html\?2&/);
});

test('password grant crosses midnight and survives worker re-creation without extension', async () => {
  const h = await setupNight(timestamp(23, 59));
  const source = `chrome-extension://test/password.html?3&${home}`;
  await h.context.allowBlockedPage(h.tab(source), home, 3, true, source, 'test-only-password');
  h.setClock(timestamp(24, 1));
  assert.equal(h.check(fav).state.secsLeft, 180);
  const resumed = await setup({ now: timestamp(24, 1), initialize: false, session: h.session,
    local: memoryStorage(h.context.gOptions) });
  await resumed.context.retrieveOptions();
  assert.equal(resumed.check(fav).blocked, false);
  assert.equal(resumed.check(fav).state.secsLeft, 180);
});

test('night migration appends a set without overwriting an unrelated existing group', async () => {
  const h = await setup();
  h.context.gOptions.numSets = '3';
  h.context.gOptions.sites3 = 'example.com';
  const patch = h.context.nightPasswordMigration(h.context.gOptions, 'test-only-password');
  assert.equal(patch.numSets, '4');
  assert.equal(patch.nightPasswordSet, 4);
  assert.equal(patch.sites3, undefined);
});

test('native password-page submission sends the password to the real background validator', async () => {
  const h = await setupNight(timestamp(23, 20));
  const source = `chrome-extension://test/password.html?3&${home}`;
  const id = h.tab(source);
  const input = { value: 'test-only-password' };
  const page = vm.createContext({
    document: { getElementById: name => name === 'lbPasswordInput' ? input : null },
    console,
    chrome: { runtime: { async sendMessage(message) {
      if (message.type === 'blocked') return null;
      h.context.handleMessage(message, { tab: { id, incognito: false }, url: source }, () => {});
    } } }
  });
  vm.runInContext(fs.readFileSync(path.join(dir, 'blocked.js'), 'utf8'), page);
  vm.runInContext(`gBlockedSet = '3'; gBlockedURL = ${JSON.stringify(home)}; gHashCode = hashCode32('test-only-password'); onSubmitPassword();`, page);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.check(fav).blocked, false);
  assert.equal(h.check(fav).state.secsLeft, 300);
});

test('reloading applies the local night defaults to existing settings and fresh installations', async () => {
  for (const existing of [false, true]) {
    const original = await setup();
    const h = await setup({ initialize: false, local: memoryStorage(existing ? original.context.gOptions : {}) });
    h.context.gNightGatePassword = 'test-only-password';
    await h.context.retrieveOptions();
    assert.equal(h.context.gNumSets, 3);
    assert.equal(h.local.data.passwordSetSpec3, 'test-only-password');
    assert.equal(h.local.data.delayAllowMins1, '30');
    assert.equal(h.local.data.delayAllowMins2, '5');
    assert.equal(h.local.data.delayAllowMins3, '5');
  }
});

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
    runtime: { getURL: name => `chrome-extension://test/${name}`, async sendMessage() {}, async getContexts() { return []; } },
    offscreen: { Reason: { WORKERS: 'WORKERS' }, async createDocument() {} },
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
  context.importScripts = (...names) => names.forEach(name => {
    if (name === 'night-password.local.js') return; // Never read the user's secret in tests.
    vm.runInContext(fs.readFileSync(path.join(dir, name), 'utf8'), context, { filename: name });
  });
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
async function inlinePage(h, { elapsed = 0, infoOverride, failSend = false, initialError, syncSendError = false, internal = false } = {}) {
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
  const source = `${internal ? 'chrome-extension://test/reason-gate.html' : gateBase}?1&${search}`;
  const id = h.tab(source);
  const elements = { app, reason, submit };
  const context = vm.createContext({
    document: { getElementById: name => elements[name] ?? null },
    location: new URL(source),
    performance: { now: () => clock },
    window: { setTimeout(fn, ms) { timers.push({ fn, at: clock + ms }); return timers.length; } },
    chrome: { runtime: { getURL: name => `chrome-extension://test/${name}`, sendMessage(message) {
      if (message.type === 'blocked') {
        if (initialError) {
          if (syncSendError) throw initialError;
          return Promise.reject(initialError);
        }
        return Promise.resolve(infoOverride ?? h.context.createBlockInfo(id, source));
      }
      messages.push(message);
      if (rejectNextSend) {
        rejectNextSend = false;
        const error = new Error(failSend === 'invalidated' ? 'Extension context invalidated.' : 'Could not establish connection. Receiving end does not exist.');
        if (syncSendError) throw error;
        return Promise.reject(error);
      }
      // Exercise the actual background grant logic, not just message shape.
      return h.context.allowBlockedPage(id, message.blockedURL, message.blockedSet, true, source);
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
    assert.equal(h.updates.find(u => u.id === id).url, `chrome-extension://test/reason-gate.html?1&${url}`);
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
  for (const id of [other, privateId]) {
    assert.ok(h.updates.filter(u => u.id === id).every(u => u.url.startsWith('chrome-extension://test/reason-gate.html?')),
      'ungranted tabs may move to the built-in gate but must not reach the target');
  }
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
  assert.equal(manifest.version, '1.7.3.6');
  for (const script of ['background.js', 'common.js', 'shared-session.js', 'blocked.js', 'content.js', 'ticker.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, script), 'utf8'), { filename: script }));
  }
});

test('countdown display migration updates both saved gate sets in local or sync storage only once', async () => {
  for (const area of ['local', 'sync']) {
    const base = await setup();
    const saved = { ...structuredClone(base.context.gOptions), showTimer1: true, showTimer2: true,
      timerVisible: true, timerBadge: true, setName1: 'Custom name', delayAllowMins1: '17',
      numSets: '3', sites3: 'example.com', showTimer3: true, sync: area === 'sync' };
    const storage = memoryStorage(saved);
    const h = await setup({ initialize: false, local: area === 'local' ? storage : memoryStorage({ sync: true }) });
    if (area === 'sync') h.context.chrome.storage.sync = storage;
    await h.context.retrieveOptions();
    assert.equal(h.context.gGotOptions, true);
    assert.deepEqual(storage.data, { ...saved, showTimer1: false, showTimer2: false, reasonGateCountdownMigration: 1 });
    assert.equal(h.context.gOptions.showTimer1, false);
    assert.equal(h.context.gOptions.showTimer2, false);
    // A later explicit choice must survive both option refresh and worker restart.
    await storage.set({ showTimer1: true });
    await h.context.retrieveOptions(true);
    assert.equal(h.context.gOptions.showTimer1, true);
    const restarted = await setup({ initialize: false, local: area === 'local' ? storage : memoryStorage({ sync: true }) });
    if (area === 'sync') restarted.context.chrome.storage.sync = storage;
    await restarted.context.retrieveOptions();
    assert.equal(restarted.context.gOptions.showTimer1, true);
    assert.equal(restarted.context.gOptions.showTimer2, false);
  }
});

test('countdown display migration does not change a set that no longer uses the reason gate', async () => {
  const base = await setup();
  const saved = { ...structuredClone(base.context.gOptions), blockURL2: 'blocked.html?$S&$U',
    showTimer1: true, showTimer2: true, timerVisible: false, timerBadge: false };
  const h = await setup({ initialize: false, local: memoryStorage(saved) });
  await h.context.retrieveOptions();
  assert.deepEqual(h.local.data, { ...saved, showTimer1: false, reasonGateCountdownMigration: 1 });
});

test('countdown display migration retries failed persistence without marking the migration complete', async () => {
  const base = await setup();
  const saved = { ...structuredClone(base.context.gOptions), showTimer1: true, showTimer2: true };
  const storage = memoryStorage(saved), set = storage.set;
  storage.set = async () => { throw new Error('test migration storage failure'); };
  const h = await setup({ initialize: false, local: storage });
  const warnings = [];
  h.context.console = { log() {}, warn(message) { warnings.push(message); } };
  await h.context.retrieveOptions();
  assert.equal(h.context.gGotOptions, false);
  assert.deepEqual(storage.data, saved);
  assert.match(warnings[0], /test migration storage failure/);
  storage.set = set;
  await h.context.retrieveOptions();
  assert.equal(h.context.gGotOptions, true);
  assert.equal(storage.data.showTimer1, false);
  assert.equal(storage.data.showTimer2, false);
  assert.equal(storage.data.reasonGateCountdownMigration, 1);
});

test('countdown display is hidden by the per-set switch while both grant deadlines still block on expiry', async () => {
  for (const [set, now, duration] of [[1, timestamp(9), 1800], [2, timestamp(23), 300]]) {
    const h = await setup({ now, initialize: false });
    await h.context.retrieveOptions();
    assert.equal(h.local.data.showTimer1, false);
    assert.equal(h.local.data.showTimer2, false);
    assert.equal(h.context.gOptions.timerVisible, true, 'do not disable the global page timer');
    assert.equal(h.context.gOptions.timerBadge, true, 'do not change the global badge preference');
    await h.grant(set);
    const result = h.check(home);
    assert.equal(result.blocked, false);
    assert.equal(result.state.secsLeft, duration);
    const messages = [], titles = [];
    h.context.chrome.tabs.sendMessage = async (id, message) => { messages.push(message); };
    Object.assign(h.context.chrome.action, { setTitle(details) { titles.push(details.title); },
      setBadgeText() {}, setBadgeBackgroundColor() {} });
    h.context.updateTimer(result.id);
    assert.equal(messages.at(-1).type, 'timer');
    assert.equal(messages.at(-1).text, null);
    assert.equal(titles.at(-1), 'LeechBlock [' + h.context.formatTime(duration) + ']');
    const page = await contentPage();
    page.context.gTimer = { hidden: false };
    page.context.handleMessage(messages.at(-1), {}, () => {});
    assert.equal(page.context.gTimer.hidden, true, 'the actual content script hides an existing timer box');
    h.setClock(now + duration * 1000);
    assert.equal(h.check(home).blocked, true);
    assert.equal(h.check(fav).blocked, true);
  }
});

// Exercise the real content-script lifecycle, including Chrome's synchronous
// invalid-context exception and rejected message promises after a reload.
async function contentPage({ missingRuntime = false } = {}) {
  const listeners = new Map(), receivers = new Set(), messages = [], warnings = [];
  const chrome = { runtime: {
    id: missingRuntime ? undefined : 'test-extension',
    async sendMessage(message) { messages.push(message); },
    onMessage: { addListener(fn) { receivers.add(fn); }, removeListener(fn) { receivers.delete(fn); } },
  } };
  const context = vm.createContext({
    chrome, console: { warn(message) { warnings.push(message); } },
    document: { URL: home, referrer: search },
    window: {
      addEventListener(name, fn) { listeners.set(name, fn); },
      removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(dir, 'content.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, chrome, listeners, receivers, messages, warnings };
}

test('content script still sends loaded, referrer, focus and blur notifications', async () => {
  const page = await contentPage();
  page.listeners.get('focus')(); page.listeners.get('blur')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(page.messages.map(m => m.type), ['loaded', 'referrer', 'focus', 'focus']);
  assert.equal(page.messages[2].focus, true);
  assert.equal(page.messages[3].focus, false);
  assert.equal(page.warnings.length, 0);
});

test('invalidated content scripts stop all listeners, remove stale UI and never send again', async () => {
  for (const asynchronous of [false, true]) {
    const page = await contentPage();
    let sends = 0, removed = 0;
    page.context.gTimer = { parentNode: { removeChild() { removed++; } } };
    page.context.gAlert = { parentNode: { removeChild() { removed++; } } };
    page.chrome.runtime.sendMessage = () => {
      sends++;
      const error = new Error('Extension context invalidated.');
      if (asynchronous) return Promise.reject(error);
      throw error;
    };
    assert.doesNotThrow(() => page.listeners.get('blur')());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.context.gContentActive, false);
    assert.equal(page.listeners.size, 0);
    assert.equal(page.receivers.size, 0);
    assert.equal(removed, 2);
    page.context.onFocus(); page.context.onBlur(); page.context.notifyLoaded();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sends, 1);
    assert.equal(page.warnings.length, 0);
  }
});

test('an absent runtime id stops even initial content notifications without throwing', async () => {
  const page = await contentPage({ missingRuntime: true });
  assert.equal(page.messages.length, 0);
  assert.equal(page.listeners.size, 0);
  assert.equal(page.receivers.size, 0);
});

test('temporary missing receivers do not disable content notifications; unexpected errors stay visible', async () => {
  const page = await contentPage();
  page.chrome.runtime.sendMessage = () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
  page.context.onFocus();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.context.gContentActive, true);
  assert.equal(page.warnings.length, 0);
  page.chrome.runtime.sendMessage = async message => page.messages.push(message);
  page.context.onBlur();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.messages.at(-1).focus, false);
  page.chrome.runtime.sendMessage = () => Promise.reject(new Error('Unexpected serialization failure'));
  page.context.onFocus();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.warnings[0], /Unexpected serialization failure/);
});

test('ticker options wait for one shared offscreen creation before sending', async () => {
  const h = await setup();
  const messages = [];
  let finishCreation, creations = 0;
  h.context.chrome.offscreen.createDocument = () => {
    creations++;
    return new Promise(resolve => { finishCreation = resolve; });
  };
  h.context.chrome.runtime.sendMessage = async message => { messages.push(message); };
  const startup = h.context.createTicker();
  const refresh = h.context.refreshTicker();
  assert.equal(startup, h.context.createTicker());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(creations, 1);
  assert.equal(messages.length, 0);
  h.context.gOptions.processTabsSecs = '3';
  finishCreation();
  await Promise.all([startup, refresh]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'ticker');
  assert.equal(messages[0].tickerSecs, 3, 'use the current options after startup finishes');
});

test('a restarted worker reuses the offscreen ticker instead of creating a duplicate', async () => {
  const h = await setup();
  let query, creations = 0, sends = 0;
  h.context.chrome.runtime.getContexts = async filter => { query = filter; return [{}]; };
  h.context.chrome.offscreen.createDocument = async () => { creations++; };
  h.context.chrome.runtime.sendMessage = async () => { sends++; };
  await h.context.refreshTicker();
  assert.equal(creations, 0);
  assert.equal(sends, 1);
  assert.equal(query.contextTypes[0], 'OFFSCREEN_DOCUMENT');
  assert.equal(query.documentUrls[0], 'chrome-extension://test/ticker.html');
});

test('ticker creation and delivery failures are handled and later refreshes recover', async () => {
  const h = await setup(), warnings = [];
  h.context.console = { log() {}, warn(message) { warnings.push(message); } };
  let failCreation = true, failSend = true, successfulSends = 0;
  h.context.chrome.offscreen.createDocument = async () => {
    if (failCreation) { failCreation = false; throw new Error('test create failure'); }
  };
  h.context.chrome.runtime.sendMessage = async () => {
    if (failSend) { failSend = false; throw new Error('test send failure'); }
    successfulSends++;
  };
  await h.context.refreshTicker();
  await h.context.refreshTicker();
  await h.context.refreshTicker();
  assert.equal(successfulSends, 1);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /test create failure/);
  assert.match(warnings[1], /test send failure/);
});

test('ticker reuses an existing document on Chrome versions without runtime.getContexts', async () => {
  const h = await setup();
  delete h.context.chrome.runtime.getContexts;
  h.context.self = { clients: { async matchAll() { return [{ url: 'chrome-extension://test/ticker.html' }]; } } };
  let creations = 0;
  h.context.chrome.offscreen.createDocument = async () => { creations++; };
  await h.context.createTicker();
  assert.equal(creations, 0);
});

test('initial gate messaging failures leave the gate disabled for both sync and async errors', async () => {
  for (const syncSendError of [false, true]) {
    const h = await setup();
    const page = await inlinePage(h, { initialError: new Error('Extension context invalidated.'), syncSendError });
    page.advance(10000);
    assert.equal(page.submit.disabled, true);
    assert.match(page.submit.title, /刷新/);
    assert.equal(page.messages.length, 0);
    assert.equal(h.check(home).blocked, true);
  }
});

test('a synchronous invalid-context throw during submission retains the reason and cannot grant', async () => {
  const h = await setup();
  const page = await inlinePage(h, { failSend: 'invalidated', syncSendError: true });
  page.reason.value = '查找学习相关视频';
  page.advance(5000);
  assert.doesNotThrow(() => page.submit.click());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.submit.disabled, true);
  assert.equal(page.reason.value, '查找学习相关视频');
  assert.match(page.submit.title, /刷新/);
  page.pressSubmit(); page.submit.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.messages.length, 1);
  assert.equal(h.check(home).blocked, true);
});

test('a synchronous transient gate failure can be retried without bypassing the gate', async () => {
  const h = await setup(), page = await inlinePage(h, { failSend: true, syncSendError: true });
  page.reason.value = '查找学习相关视频'; page.advance(5000); page.submit.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.submit.disabled, false);
  assert.equal(h.check(home).blocked, true);
  page.submit.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.check(home).blocked, false);
});

test('offscreen ticks survive a missing receiver and stop only when their context is invalidated', async () => {
  let tick, clears = 0, sends = 0;
  const warnings = [];
  const chrome = { runtime: { onMessage: { addListener() {} }, sendMessage() {
    sends++;
    return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
  } } };
  const context = vm.createContext({
    chrome, console: { warn(message) { warnings.push(message); } },
    window: { setInterval(fn) { tick = fn; return 7; }, clearInterval(id) { assert.equal(id, 7); clears++; } },
  });
  vm.runInContext(fs.readFileSync(path.join(dir, 'ticker.js'), 'utf8'), context);
  await tick();
  assert.equal(clears, 0);
  chrome.runtime.sendMessage = async () => { sends++; };
  await tick();
  assert.equal(sends, 2);
  chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
  await tick();
  assert.equal(clears, 1);
  assert.equal(warnings.length, 0);
});


test('plain Enter obeys the wait and reason rules and grants exactly once', async () => {
  const h = await setup(), page = await inlinePage(h);
  let prevented = 0;
  const enter = () => page.reason.dispatch('keydown', { key: 'Enter', preventDefault() { prevented++; } });
  page.reason.value = '查找学习相关视频';
  page.advance(4999); enter();
  assert.equal(page.messages.length, 0);
  page.advance(1);
  page.reason.value = '不足'; enter();
  assert.equal(page.messages.length, 0);
  assert.equal(page.reason.validity, '至少输入5个非空白字符');
  page.reason.value = '查找学习相关视频'; enter(); enter();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, 4);
  assert.equal(page.messages.length, 1);
  assert.equal(h.check(home).blocked, false);
});

test('IME confirmation, Shift+Enter and held Enter do not submit', async () => {
  const h = await setup(), page = await inlinePage(h);
  page.advance(5000); page.reason.value = '查找学习相关视频';
  for (const flags of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { repeat: true }]) {
    page.reason.dispatch('keydown', { key: 'Enter', ...flags,
      preventDefault() { assert.fail('Do not intercept composition or newline'); } });
  }
  assert.equal(page.messages.length, 0);
  assert.equal(h.check(home).blocked, true);
});


test('built-in gate submits with Enter after 5 seconds without any HTTP service', async () => {
  const h = await setup(), page = await inlinePage(h, { internal: true });
  page.reason.value = '查找学习相关视频';
  const enter = () => page.reason.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  page.advance(4999); enter(); assert.equal(page.messages.length, 0);
  page.advance(1); enter();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.messages.length, 1);
  assert.equal(h.check(home).blocked, false);
  h.setClock(timestamp(9, 30));
  const result = h.check(home);
  assert.equal(result.blocked, true);
  assert.equal(h.updates.find(u => u.id === result.id).url, `chrome-extension://test/reason-gate.html?1&${home}`);
});

test('legacy error tabs move to built-in gate without issuing a grant', async () => {
  const h = await setup();
  const id = h.tab(`${gateBase}?1&${search}`);
  await h.context.resumeSharedGateTabs();
  assert.equal(h.updates.find(u => u.id === id).url, `chrome-extension://test/reason-gate.html?1&${search}`);
  assert.equal(h.check(search).blocked, true);
});

test('internal source validation rejects other extensions and preserves query fragments', async () => {
  const h = await setup(), url = home + '&query=x#anchor';
  const source = `chrome-extension://test/reason-gate.html?1&${url}`;
  const id = h.tab(source);
  await h.context.allowBlockedPage(id, url, 1, true, source.replace('://test/', '://evil/'));
  assert.equal(h.check(home).blocked, true);
  await h.context.allowBlockedPage(id, url, 1, true, source);
  assert.equal(h.check(home).blocked, false);
  assert.equal(h.updates.find(u => u.id === id).url, url);
});

test('built-in gate bundles its script and contains no HTTP dependency', () => {
  const html = fs.readFileSync(path.join(dir, 'reason-gate.html'), 'utf8');
  assert.match(html, /data-lb-reason-gate="inline-v1"/);
  assert.match(html, /<script src="blocked.js"><\/script>/);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
});
