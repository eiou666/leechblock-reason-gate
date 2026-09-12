/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. https://mozilla.org/MPL/2.0/. */

// Local-only, one-time migration: preserve set 1 and all unrelated settings.
function nightPasswordMigration(options, password) {
  if (!password || options.nightPasswordMigration === 1) return {};
  if (+options.numSets < 2 || !reasonSharedPolicy(2, options)) return {};
  if (+options.numSets >= MAX_SETS) throw new Error('No unused block set for the night password rule');
  const set = +options.numSets + 1;
  const patch = {
    numSets: String(set), nightPasswordMigration: 1, nightPasswordSet: set,
    times2: '0600-0700,1150-1200,1750-1800,2200-2300'
  };
  for (const name of Object.keys(PER_SET_OPTIONS)) {
    const value = options[`${name}2`];
    if (value !== undefined) patch[`${name}${set}`] = Array.isArray(value) ? value.slice() : value;
  }
  for (const kind of ['block', 'allow', 'refer', 'keyword']) patch[`${kind}RE${set}`] = options[`${kind}RE2`] || '';
  Object.assign(patch, {
    [`setName${set}`]: '夜间密码 · 全局放行5分钟',
    [`times${set}`]: '0000-0600,2300-2400',
    [`blockURL${set}`]: PASSWORD_BLOCK_URL,
    [`passwordRequire${set}`]: '0',
    [`passwordSetSpec${set}`]: password,
    [`delayAllowMins${set}`]: '5',
    [`disable${set}`]: false
  });
  return patch;
}
