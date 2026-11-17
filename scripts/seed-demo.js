// Fills a database with 30 days of fake history so you can see the app working.
// Usage: DB_PATH=./data/mock.db node scripts/seed-demo.js
import { openDb } from '../src/db.js';
import { mockProfile } from '../src/duolingo.js';

const store = openDb(process.env.DB_PATH || './data/mock.db');
const names = ['alex', 'priya', 'sam', 'jordan', 'mei', 'luca'];
const now = Date.now();
for (const name of names) {
  if (store.getFriend(name)) continue;
  const id = store.addFriend(mockProfile(name, now - 30 * 86_400_000), now - 30 * 86_400_000);
  for (let t = now - 30 * 86_400_000; t <= now; t += 3 * 3_600_000) {
    // Skip some days so not everyone practises every day.
    if ((Math.floor(t / 86_400_000) + name.length) % 7 === 0) continue;
    store.recordSnapshot(id, mockProfile(name, t), t);
  }
}
store.setMeta('last_refresh_at', now);
console.log(`Seeded ${names.length} demo friends into ${process.env.DB_PATH || './data/mock.db'}`);
store.close();
