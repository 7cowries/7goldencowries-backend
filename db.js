const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let dbPromise;
async function getDB() {
  if (!dbPromise) {
    dbPromise = open({
      filename: process.env.DATABASE_URL || './data.sqlite',
      driver: sqlite3.Database
    });
  }
  return dbPromise;
}
module.exports = { getDB };
