-- The image's init client speaks latin1 unless told otherwise, which double-encodes the unicode row.
SET NAMES utf8mb4;

CREATE TABLE customers (
  id INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE
) COMMENT = 'People who place orders';

CREATE TABLE orders (
  id INT PRIMARY KEY,
  customer_id INT NOT NULL,
  total DECIMAL(12, 2) NOT NULL,
  placed_at DATETIME NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT orders_total_nonnegative CHECK (total >= 0)
);

CREATE INDEX orders_placed_at_idx ON orders (placed_at);

CREATE VIEW customer_totals AS
  SELECT c.id AS customer_id, c.name, COALESCE(SUM(o.total), 0) AS total
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
  GROUP BY c.id, c.name;

CREATE TABLE type_probe (
  id INT PRIMARY KEY,
  small_int SMALLINT,
  big_int BIGINT,
  exact_decimal DECIMAL(20, 4),
  unicode_text TEXT,
  flag BOOLEAN,
  doc JSON,
  payload VARBINARY(64),
  day DATE,
  moment DATETIME
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
   '{"a": 1, "b": [true, null]}', X'DEADBEEF', '2024-02-29', '2024-02-29 13:45:30'),
  (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- The data editor's round trip (plan 008): an auto-increment key and a default for every column,
-- so an insert of nothing but defaults succeeds. VARCHAR, since MySQL refuses a literal TEXT default.
CREATE TABLE edit_probe (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(255) NOT NULL DEFAULT 'new',
  qty INT DEFAULT 1,
  note TEXT NULL,
  doc JSON NULL
);

CREATE TABLE no_key_probe (
  label VARCHAR(255)
);

INSERT INTO edit_probe (label, qty, note, doc) VALUES
  ('first', 1, NULL, '{"tags": ["a"]}'),
  ('second', 2, 'kept', NULL);

INSERT INTO no_key_probe (label) VALUES ('loose');

CREATE TABLE `Line Items` (
  id INT PRIMARY KEY,
  sku VARCHAR(64) NOT NULL
);

INSERT INTO `Line Items` (id, sku) VALUES (1, 'SKU-1');
