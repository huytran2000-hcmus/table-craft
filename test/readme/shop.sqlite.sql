-- The demo shop for SQLite (plan 016): the PostgreSQL seed's rows, built with a recursive CTE.
-- Dates are ISO-8601 TEXT and prices REAL, SQLite having neither a date nor a numeric type.

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  joined_on TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL CHECK (price > 0),
  stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  status TEXT NOT NULL DEFAULT 'pending',
  placed_at TEXT NOT NULL
);
CREATE INDEX orders_placed_at_idx ON orders (placed_at);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL
);

WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40),
  named AS (
    SELECT i,
      json_extract('["Ana","Ben","Chloe","Duc","Elena","Farid","Grace","Hiro","Ines","Jonas"]',
        '$[' || (i % 10) || ']') AS first_name,
      json_extract('["Silva","Nguyen","Weber","Brooks","Tanaka","Martin","Okafor","Kowalski"]',
        '$[' || ((i * 3) % 8) || ']') AS last_name
    FROM n
  )
INSERT INTO customers (id, name, email, city, joined_on)
SELECT i,
  first_name || ' ' || last_name,
  lower(first_name) || '.' || lower(last_name) || i || '@example.com',
  json_extract('["Lisbon","Hanoi","Berlin","Austin","Osaka","Toronto","Lyon","Melbourne"]',
    '$[' || ((i / 5) % 8) || ']'),
  date('2025-01-06', '+' || (i * 9) || ' days')
FROM named ORDER BY i;

WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30)
INSERT INTO products (id, name, category, price, stock)
SELECT i,
  json_extract('["Espresso beans","Pour-over kettle","Ceramic mug","Oat milk","Hand grinder",'
    || '"Paper filters","Cold brew jar","Green tea","Milk frother","Travel tumbler"]',
    '$[' || ((i - 1) % 10) || ']')
    || ' ' || json_extract('["Classic","Plus","Pro"]', '$[' || ((i - 1) / 10) || ']'),
  json_extract('["Coffee","Brewing","Tableware","Pantry","Brewing",'
    || '"Brewing","Brewing","Tea","Brewing","Tableware"]', '$[' || ((i - 1) % 10) || ']'),
  round(4.5 + ((i * 37) % 120) * 0.75, 2) + 0.49,
  (i * 13) % 90
FROM n ORDER BY i;

WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200)
INSERT INTO orders (id, customer_id, status, placed_at)
SELECT i,
  1 + (i * 7) % 40,
  CASE
    WHEN i > 190 THEN 'pending'
    WHEN i % 17 = 0 THEN 'cancelled'
    WHEN i > 170 THEN 'shipped'
    ELSE 'delivered'
  END,
  datetime('2026-01-02 08:00', '+' || (i * 31) || ' hours', '+' || ((i * 47) % 600) || ' minutes')
FROM n ORDER BY i;

WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 198),
  line (l) AS (SELECT 1 UNION ALL SELECT l + 1 FROM line WHERE l < 3)
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT n.i, p.id, 1 + (n.i + line.l) % 4, p.price
FROM n CROSS JOIN line
  JOIN products AS p ON p.id = 1 + (n.i * 11 + line.l * 7) % 30
ORDER BY n.i, line.l;

CREATE VIEW customer_revenue AS
SELECT c.id, c.name, count(DISTINCT o.id) AS orders, round(sum(i.quantity * i.unit_price), 2) AS revenue
FROM customers AS c
  JOIN orders AS o ON o.customer_id = c.id AND o.status <> 'cancelled'
  JOIN order_items AS i ON i.order_id = o.id
GROUP BY c.id, c.name;
