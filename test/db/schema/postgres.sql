CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  total NUMERIC(12, 2) NOT NULL,
  placed_at TIMESTAMP NOT NULL
);

CREATE INDEX orders_placed_at_idx ON orders (placed_at);

CREATE VIEW customer_totals AS
  SELECT c.id AS customer_id, c.name, COALESCE(SUM(o.total), 0) AS total
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
  GROUP BY c.id, c.name;

CREATE TABLE type_probe (
  id INTEGER PRIMARY KEY,
  small_int SMALLINT,
  big_int BIGINT,
  exact_decimal NUMERIC(20, 4),
  unicode_text TEXT,
  flag BOOLEAN,
  doc JSONB,
  payload BYTEA,
  day DATE,
  moment TIMESTAMP
);

INSERT INTO customers (id, name, email) VALUES
  (1, 'Ada Lovelace', 'ada@example.com'),
  (2, 'Grace Hopper', 'grace@example.com');

INSERT INTO orders (id, customer_id, total, placed_at) VALUES
  (1, 1, 19.99, '2024-02-29 09:00:00'),
  (2, 1, 5.00, '2024-03-01 10:30:00'),
  (3, 2, 120.50, '2024-03-02 16:45:00');

INSERT INTO type_probe VALUES
  (1, 42, 9007199254740993, 1234567890123456.7890, 'héllo, 世界 🌍', TRUE,
   '{"a": 1, "b": [true, null]}', '\xdeadbeef', '2024-02-29', '2024-02-29 13:45:30'),
  (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
