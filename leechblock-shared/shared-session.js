/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// A grant belongs to a block set, never to a tab, opener, host or URL.
// session storage survives MV3 worker suspension, but not browser restart.
function reasonSharedPolicy(set, options) {
	let gate;
	try { gate = new URL(options[`blockURL${set}`]); } catch { return null; }
	if (gate.protocol != "http:" || gate.hostname != "127.0.0.1"
			|| gate.port != "8765" || gate.pathname != "/lb-custom/reason-gate.html") return null;
	const minutes = +options[`delayAllowMins${set}`];
	if (!Number.isFinite(minutes) || minutes <= 0 || !options[`times${set}`]) return null;
	const values = Object.keys(PER_SET_OPTIONS).map(key => options[`${key}${set}`]);
	return {
		gate: gate.origin + gate.pathname,
		minutes,
		times: options[`times${set}`],
		days: options[`days${set}`],
		disabled: options[`disable${set}`],
		signature: JSON.stringify([values, options.clockOffset, options.matchSubdomains,
			options[`blockRE${set}`], options[`allowRE${set}`], options[`referRE${set}`],
			options[`timedata${set}`]?.[4], options[`timedata${set}`]?.[8]])
	};
}

function reasonScheduleWindow(policy, now) {
	if (!policy || policy.disabled) return null;
	const date = new Date(now * 1000);
	if (!policy.days?.[date.getDay()]) return null;
	const mins = date.getHours() * 60 + date.getMinutes();
	const periods = getMinPeriods(policy.times);
	for (const period of periods) {
		if (period.start <= mins && mins < period.end) {
			const start = new Date(date); start.setHours(0, period.start, 0, 0);
			const end = new Date(date); end.setHours(0, period.end, 0, 0);
			// 22:00–24:00 and 00:00–07:00 are one continuous overnight group.
			const first = periods[0], last = periods[periods.length - 1];
			if (periods.length > 1 && first.start == 0 && last.end == 1440) {
				if (period.start == 0 && policy.days[(date.getDay() + 6) % 7]) {
					start.setDate(start.getDate() - 1); start.setHours(0, last.start, 0, 0);
				}
				if (period.end == 1440 && policy.days[(date.getDay() + 1) % 7]) {
					end.setHours(0, first.end, 0, 0);
				}
			}
			return { start: start.getTime() / 1000, end: end.getTime() / 1000 };
		}
	}
	return null;
}

class ReasonGateSessions {
	constructor(storage) {
		this.storage = storage;
		this.records = {};
		this.pending = {};
		this.ready = storage.get(null).then(records => { this.records = records; });
	}
	key(set, incognito) { return `reasonGateShared:${incognito ? "private" : "normal"}:${set}`; }
	get(set, incognito, policy, now) {
		const grant = this.records[this.key(set, incognito)];
		const window = reasonScheduleWindow(policy, now);
		return grant && window && grant.signature === policy.signature
			&& Number.isFinite(grant.startedAt) && Number.isFinite(grant.expiresAt)
			&& grant.startedAt <= now && now < grant.expiresAt
			&& grant.windowStart === window.start && grant.windowEnd === window.end
			&& grant.expiresAt <= window.end
			? grant : null;
	}
	async issue(set, incognito, policy, now) {
		await this.ready;
		const key = this.key(set, incognito);
		// Simultaneous countdowns share the first deadline, never extend it.
		if (this.pending[key]) await this.pending[key];
		const existing = this.get(set, incognito, policy, now);
		if (existing) return existing;
		const window = reasonScheduleWindow(policy, now);
		if (!window) return null;
		const grant = { signature: policy.signature, startedAt: now,
			expiresAt: Math.min(now + policy.minutes * 60, window.end),
			windowStart: window.start, windowEnd: window.end };
		// Publish only after the persistence operation succeeds (fail closed).
		const write = this.storage.set({ [key]: grant });
		this.pending[key] = write;
		try { await write; this.records[key] = grant; }
		finally { delete this.pending[key]; }
		return grant;
	}
	async revoke(set, incognito) {
		await this.ready;
		const key = this.key(set, incognito);
		if (this.pending[key]) await this.pending[key];
		delete this.records[key];
		await this.storage.remove(key);
	}
	changed(changes, area) {
		if (area != "session") return;
		for (const [key, change] of Object.entries(changes)) {
			if (!key.startsWith("reasonGateShared:")) continue;
			if (change.newValue === undefined) delete this.records[key];
			else this.records[key] = change.newValue;
		}
	}
}

function parseReasonGate(url, options, internalGate = "") {
	try {
		const gate = new URL(url);
		const match = gate.search.slice(1).match(/^([1-9]\d*)&(https?:\/\/.+)$/);
		if (!match) return null;
		const set = +match[1];
		const policy = reasonSharedPolicy(set, options);
		if (!policy || (gate.origin + gate.pathname != policy.gate
				&& gate.href.split(/[?#]/)[0] !== internalGate)) return null;
		const target = match[2] + gate.hash;
		if (!["http:", "https:"].includes(new URL(target).protocol)) return null;
		return { set, target, policy };
	} catch { return null; }
}

// Updating default values alone cannot change an existing browser's settings.
// Apply this requested display change once, only to the two local gate sets.
function reasonGateCountdownMigration(options) {
	if (options.reasonGateCountdownMigration === 1) return {};
	const patch = { reasonGateCountdownMigration: 1 };
	for (const set of [1, 2]) {
		if (+options.numSets >= set && reasonSharedPolicy(set, options)) {
			patch[`showTimer${set}`] = false;
		}
	}
	return patch;
}

function reasonGateDefaults() {
	const sites = ["douyin.com", "bilibili.com", "b23.tv", "youtube.com", "youtu.be",
		"x.com", "twitter.com", "t.co", "zhihu.com"].flatMap(site => [site, `*.${site}`]).join(" ");
	const options = { numSets: "2", simplified: false, sync: false };
	for (let set = 1; set <= 2; set++) {
		Object.assign(options, {
			[`setName${set}`]: set == 1 ? "指定时段 · 全局放行30分钟" : "其他时段 · 全局放行5分钟",
			[`sites${set}`]: sites,
			[`times${set}`]: set == 1 ? "0700-1150,1200-1750,1800-2200" : "0000-0700,1150-1200,1750-1800,2200-2400",
			[`days${set}`]: Array(7).fill(true),
			[`disable${set}`]: false,
			[`showTimer${set}`]: false,
			[`conjMode${set}`]: false,
			[`limitMins${set}`]: "",
			[`limitPeriod${set}`]: "",
			[`blockURL${set}`]: "http://127.0.0.1:8765/lb-custom/reason-gate.html?$S&$U",
			[`activeBlock${set}`]: true,
			[`delayFirst${set}`]: true,
			[`delayFirstMode${set}`]: "1",
			[`delaySecs${set}`]: "5",
			[`delayAllowMins${set}`]: set == 1 ? "30" : "5",
			[`delayAutoLoad${set}`]: true
		});
		const regexps = getRegExpSites(sites, false);
		for (const kind of ["block", "allow", "refer", "keyword"]) options[`${kind}RE${set}`] = regexps[kind];
	}
	cleanOptions(options);
	cleanTimeData(options);
	return options;
}
