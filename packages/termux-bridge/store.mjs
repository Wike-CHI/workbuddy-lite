import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';

export class SessionStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    this.save = this.db.prepare('INSERT INTO sessions (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body');
  }
  load() {
    return this.db.prepare('SELECT body FROM sessions').all().map(row => {
      const session = JSON.parse(row.body);
      if (session.running) session.error = 'INTERRUPTED';
      session.running = false; session.permissions = [];
      return session;
    });
  }
  put(session) { this.save.run(session.id, JSON.stringify(session)); }
  close() { this.db.close(); }
}
