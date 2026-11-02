import { closeDatabase, pool } from './client.js';

let failed = false;

try {
  await pool.query('SELECT 1');
  console.log('Database connection successful.');
  // Avoid printing driver errors here because they may expose connection details.
} catch {
  failed = true;
  console.error('Database connection failed.');
} finally {
  try {
    await closeDatabase();
  } catch {
    failed = true;
    console.error('Database pool cleanup failed.');
  }
}

if (failed) {
  process.exitCode = 1;
}
