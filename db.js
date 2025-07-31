import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

const initDB = async () => {
  db = await open({
    filename: './cowries.db',
    driver: sqlite3.Database
  });
};

await initDB();

export default db;
