-- Esquema inicial multi-tenant. Fechas en UTC (ISO 8601); montos en pesos colombianos enteros.
-- Modelo "disperso": un número `activo` NO tiene fila; solo existen filas para `apartado` y `vendido`.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE organizations (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  whatsapp_phone TEXT NOT NULL,            -- formato internacional sin '+', p. ej. 57XXXXXXXXXX
  created_at     TEXT NOT NULL
);

CREATE TABLE memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  org_id  TEXT NOT NULL REFERENCES organizations(id),
  role    TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE raffles (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id),
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  total_numbers INTEGER NOT NULL CHECK (total_numbers BETWEEN 10 AND 10000),
  number_width  INTEGER NOT NULL CHECK (number_width BETWEEN 1 AND 4),
  ticket_price  INTEGER CHECK (ticket_price IS NULL OR ticket_price >= 0),
  status        TEXT NOT NULL CHECK (status IN ('borrador', 'activa', 'cerrada')),
  draw_date     TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE TABLE tickets (
  raffle_id        TEXT NOT NULL REFERENCES raffles(id),
  number           INTEGER NOT NULL CHECK (number >= 0),
  org_id           TEXT NOT NULL REFERENCES organizations(id),
  status           TEXT NOT NULL CHECK (status IN ('apartado', 'vendido')),
  payment_status   TEXT CHECK (payment_status IN ('pagado', 'debe')),
  due_date         TEXT,                     -- AAAA-MM-DD; obligatorio si payment_status = 'debe'
  buyer_name       TEXT,
  buyer_phone      TEXT,
  note             TEXT,
  reservation_code TEXT,
  reserved_at      TEXT,
  reserved_until   TEXT,
  sold_at          TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (raffle_id, number),
  CHECK (status <> 'apartado' OR (reserved_until IS NOT NULL AND payment_status IS NULL)),
  CHECK (status <> 'vendido' OR payment_status IS NOT NULL),
  CHECK (payment_status IS NOT 'debe' OR due_date IS NOT NULL)
) WITHOUT ROWID;

CREATE INDEX idx_tickets_expiry ON tickets (reserved_until) WHERE status = 'apartado';
CREATE INDEX idx_tickets_debt   ON tickets (raffle_id, due_date) WHERE payment_status = 'debe';
CREATE INDEX idx_tickets_code   ON tickets (raffle_id, reservation_code);

-- Historial inmutable de transiciones (incluye apartados caducados).
CREATE TABLE ticket_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           TEXT NOT NULL REFERENCES organizations(id),
  raffle_id        TEXT NOT NULL REFERENCES raffles(id),
  number           INTEGER NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('reserve', 'expire', 'sell', 'update_payment', 'release')),
  from_status      TEXT NOT NULL CHECK (from_status IN ('activo', 'apartado', 'vendido')),
  to_status        TEXT NOT NULL CHECK (to_status IN ('activo', 'apartado', 'vendido')),
  actor            TEXT NOT NULL CHECK (actor IN ('public', 'admin', 'system')),
  reservation_code TEXT,
  meta             TEXT,                     -- JSON opcional
  at               TEXT NOT NULL
);

CREATE INDEX idx_events_raffle ON ticket_events (raffle_id, id);
CREATE INDEX idx_events_number ON ticket_events (raffle_id, number, id);
