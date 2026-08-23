#!/usr/bin/env node
/**
 * Local development database.
 *
 * Starts a real PostgreSQL server from the `embedded-postgres` binaries so the
 * project can be run, migrated, seeded and tested on a machine without Docker
 * or a system Postgres install. Data lives under `.devdb/` and persists between
 * runs.
 *
 * Usage:
 *   node scripts/dev-db.js start    # initialise (first run) and start
 *   node scripts/dev-db.js stop
 *   node scripts/dev-db.js status
 *   node scripts/dev-db.js reset    # delete the data directory and re-initialise
 */

const EmbeddedPostgres = require('embedded-postgres').default;
const { existsSync, rmSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const net = require('node:net');

const ROOT = resolve(__dirname, '..');
const DATA_DIR = join(ROOT, '.devdb', 'data');
const PORT = Number(process.env.DEV_DB_PORT || 5433);
const USER = process.env.DEV_DB_USER || 'erp';
const PASSWORD = process.env.DEV_DB_PASSWORD || 'erp_password';
const DATABASE = process.env.DEV_DB_NAME || 'school_erp';

function createServer() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // Creating a dedicated OS user is a Linux-only convenience and fails on Windows.
    createPostgresUser: process.platform === 'linux',
  });
}

function isPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const finish = (value) => {
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(1200);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

async function start() {
  if (await isPortOpen(PORT)) {
    console.log(`Database already running on port ${PORT}`);
    printUrl();
    return;
  }

  const server = createServer();
  const firstRun = !existsSync(DATA_DIR);

  if (firstRun) {
    mkdirSync(join(ROOT, '.devdb'), { recursive: true });
    console.log('Initialising a new PostgreSQL cluster (first run only)...');
    await server.initialise();
  }

  await server.start();

  if (firstRun) {
    await server.createDatabase(DATABASE);
    console.log(`Created database "${DATABASE}"`);
  }

  // Extensions the schema relies on.
  const client = server.getPgClient();
  client.database = DATABASE;
  await client.connect();
  for (const extension of ['uuid-ossp', 'pg_trgm', 'unaccent', 'btree_gin']) {
    await client.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
  }
  await client.end();

  console.log(`PostgreSQL is listening on port ${PORT}`);
  printUrl();
  console.log('\nLeave this process running. Press Ctrl+C to stop the database.');

  const shutdown = async () => {
    console.log('\nStopping the database...');
    await server.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive.
  setInterval(() => undefined, 1 << 30);
}

async function stop() {
  const server = createServer();
  await server.stop().catch(() => undefined);
  console.log('Database stopped');
}

async function status() {
  const running = await isPortOpen(PORT);
  console.log(running ? `Running on port ${PORT}` : 'Not running');
  if (running) printUrl();
}

async function reset() {
  await stop();
  if (existsSync(join(ROOT, '.devdb'))) {
    rmSync(join(ROOT, '.devdb'), { recursive: true, force: true });
    console.log('Removed the existing data directory');
  }
  await start();
}

function printUrl() {
  console.log(
    `DATABASE_URL=postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}?schema=public`,
  );
}

const command = process.argv[2] || 'start';
const commands = { start, stop, status, reset };

if (!commands[command]) {
  console.error(`Unknown command "${command}". Use start, stop, status or reset.`);
  process.exit(1);
}

commands[command]().catch((error) => {
  console.error('Database command failed:', error.message);
  process.exit(1);
});
