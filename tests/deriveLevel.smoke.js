import assert from 'assert/strict';
import { deriveLevel } from '../config/progression.js';

const shellborn = deriveLevel(0);
assert.equal(shellborn.levelTier, 'shellborn');
assert.equal(shellborn.progress, 0);
assert.equal(shellborn.nextNeed, 10000);

const waveSeeker = deriveLevel(15000);
assert.equal(waveSeeker.levelTier, 'wave-seeker');
assert.equal(waveSeeker.xpIntoLevel, 5000);
assert.equal(Math.round(waveSeeker.progress * 100), 25);

const ascendant = deriveLevel(300000);
assert.equal(ascendant.levelName, 'Cowrie Ascendant');
assert.equal(ascendant.progress, 1);
assert.ok(ascendant.nextNeed >= 1);
console.log('ok');
