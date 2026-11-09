-- medido em 2026-09-17: criar_rotina aceitava UTC no domínio, mas confirmar falhava no CHECK do banco.
ALTER TABLE rotinas DROP CONSTRAINT rotinas_fuso_iana;
ALTER TABLE rotinas ADD CONSTRAINT rotinas_fuso_iana CHECK (
  fuso_iana = 'UTC' OR fuso_iana ~ '^[A-Za-z_]+/[A-Za-z_/+-]+$'
);
