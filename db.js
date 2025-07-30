import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('database.db');
console.log('🔍 Using database:', dbPath);  // Add this line to debug

const db = new Database(dbPath);
export default db;

