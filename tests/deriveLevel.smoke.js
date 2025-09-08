import assert from 'assert/strict';
import { deriveLevel } from '../config/progression.js';

assert.equal(deriveLevel(0).levelName, 'Shellborn');
assert.equal(deriveLevel(250000).progress, 1);
console.log('ok');
