-- Anti-acaparamiento: huella (hash, nunca la IP) de quien apartó, para limitar apartados vigentes por cliente.
ALTER TABLE tickets ADD COLUMN reserved_by TEXT;
CREATE INDEX idx_tickets_reserved_by ON tickets (raffle_id, reserved_by) WHERE status = 'apartado';
