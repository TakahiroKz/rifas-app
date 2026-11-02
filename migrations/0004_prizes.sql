-- Loterías, premios por regla de terminación y ganadores.

-- Resultados de sorteos. org_id NULL = oficial (global, de la fuente); con org_id = ingresado a mano por esa organización.
CREATE TABLE draw_results (
  id         TEXT PRIMARY KEY,
  lottery_id TEXT NOT NULL,
  draw_date  TEXT NOT NULL,                  -- AAAA-MM-DD (hora de Colombia)
  number     TEXT NOT NULL CHECK (number GLOB '[0-9][0-9][0-9][0-9]'),
  series     TEXT,
  source     TEXT NOT NULL CHECK (source IN ('gane', 'manual')),
  source_ref TEXT,                           -- p. ej. número de sorteo de la fuente
  org_id     TEXT REFERENCES organizations(id),
  raw        TEXT,                           -- dato crudo para auditoría
  fetched_at TEXT NOT NULL,
  CHECK ((source = 'manual') = (org_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_draw_results_official ON draw_results (lottery_id, draw_date) WHERE org_id IS NULL;
CREATE UNIQUE INDEX uq_draw_results_manual   ON draw_results (org_id, lottery_id, draw_date) WHERE org_id IS NOT NULL;

CREATE TABLE raffle_prizes (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  raffle_id    TEXT NOT NULL REFERENCES raffles(id),
  place        INTEGER NOT NULL CHECK (place >= 1),
  description  TEXT NOT NULL,
  lottery_id   TEXT NOT NULL,
  match_type   TEXT NOT NULL CHECK (match_type IN ('first', 'last')),
  digits       INTEGER NOT NULL CHECK (digits BETWEEN 1 AND 4),
  draw_date    TEXT NOT NULL,
  on_no_winner TEXT NOT NULL CHECK (on_no_winner IN ('reprogramar', 'finalizar')),
  max_attempts INTEGER CHECK (max_attempts IS NULL OR max_attempts >= 1),   -- NULL = sin límite
  status       TEXT NOT NULL CHECK (status IN ('pendiente', 'anunciado', 'finalizado')),
  created_at   TEXT NOT NULL,
  UNIQUE (raffle_id, place)
);
CREATE INDEX idx_prizes_pending ON raffle_prizes (draw_date) WHERE status = 'pendiente';

-- Historial de intentos (incluye los reprogramados).
CREATE TABLE prize_draw_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        TEXT NOT NULL REFERENCES organizations(id),
  prize_id      TEXT NOT NULL REFERENCES raffle_prizes(id),
  attempt_no    INTEGER NOT NULL CHECK (attempt_no >= 1),
  draw_date     TEXT NOT NULL,
  result_number TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('ganador', 'sin_ganador')),
  created_at    TEXT NOT NULL,
  UNIQUE (prize_id, attempt_no)
);

-- Un premio por cada número vendido que coincide. Se guarda una copia de los datos del comprador al confirmar.
CREATE TABLE prize_winners (
  prize_id       TEXT NOT NULL REFERENCES raffle_prizes(id),
  number         INTEGER NOT NULL,
  attempt_id     INTEGER NOT NULL REFERENCES prize_draw_attempts(id),
  org_id         TEXT NOT NULL REFERENCES organizations(id),
  buyer_name     TEXT,
  buyer_phone    TEXT,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pagado', 'debe')),
  created_at     TEXT NOT NULL,
  PRIMARY KEY (prize_id, number)
) WITHOUT ROWID;
