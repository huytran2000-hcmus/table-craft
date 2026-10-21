-- The image's init client speaks latin1 unless told otherwise, which double-encodes the unicode row.
SET NAMES utf8mb4;

CREATE TABLE customers (
  id INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE orders (
  id INT PRIMARY KEY,
  customer_id INT NOT NULL,
  total DECIMAL(12, 2) NOT NULL,
  placed_at DATETIME NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers (id)
);

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
