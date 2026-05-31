const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('pouches.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('gas_station','convenience_store','smoke_shop')),
    address TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    flavor TEXT NOT NULL,
    strength TEXT NOT NULL,
    nicotine_mg REAL
  );

  CREATE TABLE IF NOT EXISTS price_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    reported_by TEXT DEFAULT 'Anonymous',
    reported_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed some brands/products
const existingProducts = db.prepare('SELECT COUNT(*) as c FROM products').get();
if (existingProducts.c === 0) {
  const insertProduct = db.prepare('INSERT INTO products (brand, flavor, strength, nicotine_mg) VALUES (?, ?, ?, ?)');
  const products = [
    ['ZYN', 'Cool Mint', '3mg', 3],
    ['ZYN', 'Cool Mint', '6mg', 6],
    ['ZYN', 'Citrus', '3mg', 3],
    ['ZYN', 'Citrus', '6mg', 6],
    ['ZYN', 'Spearmint', '3mg', 3],
    ['ZYN', 'Spearmint', '6mg', 6],
    ['ZYN', 'Coffee', '6mg', 6],
    ['On!', 'Mint', '3.5mg', 3.5],
    ['On!', 'Mint', '8mg', 8],
    ['On!', 'Berry', '3.5mg', 3.5],
    ['On!', 'Coffee', '3.5mg', 3.5],
    ['VELO', 'Mint', '4mg', 4],
    ['VELO', 'Citrus', '4mg', 4],
    ['VELO', 'Black Cherry', '4mg', 4],
    ['Rogue', 'Mint', '3mg', 3],
    ['Rogue', 'Mint', '6mg', 6],
    ['Rogue', 'Wintergreen', '3mg', 3],
    ['Rogue', 'Fruit', '3mg', 3],
    ['Grizzly', 'Wintergreen', '4mg', 4],
    ['LUCY', 'Wintergreen', '4mg', 4],
    ['LUCY', 'Mango', '4mg', 4],
  ];
  const insertMany = db.transaction((rows) => rows.forEach(r => insertProduct.run(...r)));
  insertMany(products);
}

// Seed some demo locations and prices
const existingLocs = db.prepare('SELECT COUNT(*) as c FROM locations').get();
if (existingLocs.c === 0) {
  const insLoc = db.prepare('INSERT INTO locations (name, type, address, lat, lng) VALUES (?, ?, ?, ?, ?)');
  const insPrice = db.prepare('INSERT INTO price_reports (location_id, product_id, price, reported_by) VALUES (?, ?, ?, ?)');

  const seed = db.transaction(() => {
    const l1 = insLoc.run("Sunoco Station", "gas_station", "123 Main St", 40.7128, -74.0060).lastInsertRowid;
    const l2 = insLoc.run("7-Eleven", "convenience_store", "456 Broadway", 40.7158, -74.0020).lastInsertRowid;
    const l3 = insLoc.run("Smoke & Vape World", "smoke_shop", "789 W 42nd St", 40.7580, -73.9855).lastInsertRowid;
    const l4 = insLoc.run("QuikTrip", "gas_station", "321 5th Ave", 40.7484, -73.9967).lastInsertRowid;
    const l5 = insLoc.run("Cumberland Farms", "convenience_store", "654 Lexington Ave", 40.7614, -73.9776).lastInsertRowid;

    insPrice.run(l1, 1, 5.49, "Demo");
    insPrice.run(l1, 2, 5.49, "Demo");
    insPrice.run(l1, 8, 3.99, "Demo");
    insPrice.run(l2, 1, 4.99, "Demo");
    insPrice.run(l2, 3, 4.99, "Demo");
    insPrice.run(l2, 11, 4.49, "Demo");
    insPrice.run(l3, 1, 4.75, "Demo");
    insPrice.run(l3, 2, 4.75, "Demo");
    insPrice.run(l3, 8, 3.50, "Demo");
    insPrice.run(l3, 9, 3.50, "Demo");
    insPrice.run(l4, 4, 5.29, "Demo");
    insPrice.run(l4, 15, 4.99, "Demo");
    insPrice.run(l5, 1, 5.19, "Demo");
    insPrice.run(l5, 6, 5.19, "Demo");
  });
  seed();
}

// --- API Routes ---

// Get all locations with their latest price info
app.get('/api/locations', (req, res) => {
  const locations = db.prepare(`
    SELECT l.*,
      COUNT(DISTINCT pr.product_id) as product_count,
      MIN(pr.price) as min_price,
      MAX(pr.price) as max_price,
      MAX(pr.reported_at) as last_updated
    FROM locations l
    LEFT JOIN price_reports pr ON pr.location_id = l.id
    GROUP BY l.id
    ORDER BY l.name
  `).all();
  res.json(locations);
});

// Get single location with all price reports
app.get('/api/locations/:id', (req, res) => {
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!loc) return res.status(404).json({ error: 'Not found' });

  const prices = db.prepare(`
    SELECT pr.id, pr.price, pr.reported_by, pr.reported_at,
      p.brand, p.flavor, p.strength, p.nicotine_mg, p.id as product_id
    FROM price_reports pr
    JOIN products p ON p.id = pr.product_id
    WHERE pr.location_id = ?
    ORDER BY p.brand, p.flavor, p.strength, pr.reported_at DESC
  `).all(req.params.id);

  // Latest price per product
  const seen = new Set();
  const latestPrices = prices.filter(r => {
    const key = r.product_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json({ ...loc, prices: latestPrices });
});

// Add a new location
app.post('/api/locations', (req, res) => {
  const { name, type, address, lat, lng } = req.body;
  if (!name || !type || lat == null || lng == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const validTypes = ['gas_station', 'convenience_store', 'smoke_shop'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  const result = db.prepare(
    'INSERT INTO locations (name, type, address, lat, lng) VALUES (?, ?, ?, ?, ?)'
  ).run(name, type, address || '', lat, lng);
  res.json({ id: result.lastInsertRowid });
});

// Delete a location
app.delete('/api/locations/:id', (req, res) => {
  db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Get all products
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY brand, flavor, strength').all();
  res.json(products);
});

// Report a price
app.post('/api/price-reports', (req, res) => {
  const { location_id, product_id, price, reported_by } = req.body;
  if (!location_id || !product_id || price == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (typeof price !== 'number' || price <= 0 || price > 999) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  const result = db.prepare(
    'INSERT INTO price_reports (location_id, product_id, price, reported_by) VALUES (?, ?, ?, ?)'
  ).run(location_id, product_id, price, reported_by || 'Anonymous');
  res.json({ id: result.lastInsertRowid });
});

// Delete a price report
app.delete('/api/price-reports/:id', (req, res) => {
  db.prepare('DELETE FROM price_reports WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Search locations by brand/product
app.get('/api/search', (req, res) => {
  const { brand, product_id, max_price } = req.query;
  let query = `
    SELECT l.*, pr.price, p.brand, p.flavor, p.strength, pr.reported_at
    FROM price_reports pr
    JOIN locations l ON l.id = pr.location_id
    JOIN products p ON p.id = pr.product_id
    WHERE 1=1
  `;
  const params = [];
  if (brand) { query += ' AND p.brand LIKE ?'; params.push(`%${brand}%`); }
  if (product_id) { query += ' AND p.id = ?'; params.push(product_id); }
  if (max_price) { query += ' AND pr.price <= ?'; params.push(parseFloat(max_price)); }
  query += ' ORDER BY pr.price ASC';
  res.json(db.prepare(query).all(...params));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
