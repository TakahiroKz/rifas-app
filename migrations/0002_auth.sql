-- Sesiones de administración y control de intentos de ingreso.

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                 -- SHA-256 (hex) del token de la cookie; el token nunca se guarda
  user_id    TEXT NOT NULL REFERENCES users(id),
  org_id     TEXT NOT NULL REFERENCES organizations(id),
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- Solo se guardan los intentos fallidos; se borran al ingresar bien o por antigüedad.
CREATE TABLE login_attempts (
  email TEXT NOT NULL,
  ip    TEXT NOT NULL,
  at    TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_email ON login_attempts (email, at);
CREATE INDEX idx_login_attempts_ip    ON login_attempts (ip, at);
