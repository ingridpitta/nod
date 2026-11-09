-- definido em 2026-09-17: ADR-033 permite MCP remoto com TLS; dado pessoal continua proibido em HTTP sem TLS.
ALTER TABLE conectores DROP CONSTRAINT conector_http_nao_toca;
ALTER TABLE conectores ADD CONSTRAINT conector_http_nao_toca CHECK (
  transporte <> 'http' OR declaracao = 'nao-toca' OR url LIKE 'https://%'
);
