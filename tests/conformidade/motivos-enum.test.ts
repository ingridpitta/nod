import { expect, it } from "vitest";
import {
  CODIGOS_ERRO,
  DESFECHOS_ITEM,
  DESFECHOS_ROTINA,
  MOTIVOS_APROVACAO_MANUAL,
  MOTIVOS_BLOQUEIO_ROTINA,
  MOTIVOS_FALHA,
  MOTIVOS_FALHA_COMPUTADOR,
  MOTIVOS_INATIVIDADE_PERMISSAO,
  MOTIVOS_INTERRUPCAO,
  MOTIVOS_LOCALIDADE,
  MOTIVOS_NEGACAO,
  MOTIVOS_PASSE,
  MOTIVOS_SEM_NOVIDADE,
} from "../../src/contracts/motivos.ts";
import { ESTADOS_TELA_COMPUTADOR, OPERACOES_COMPUTADOR } from "../../src/contracts/computador-motor.ts";
import { TIPOS_INCIDENTE } from "../../src/contracts/incidente.ts";
import { ESTADOS_MAQUINA_NUVEM, MOTIVOS_FALHA_NUVEM } from "../../src/contracts/provedor-nuvem.ts";
import { ALCANCES_RELATO, CATEGORIAS_RELATO } from "../../src/contracts/relato.ts";
import { ENUMS_DE_ESTADO } from "../../src/db/schema/agentes.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-004: os motivos vivem num enum só. Cada união `as const` de src/contracts/motivos.ts é um
 * CREATE TYPE da 0002, e este gate compara com pg_enum na ORDEM declarada — uma constante nova sem
 * migração (ou o contrário) falha aqui, não em produção.
 */
const MOTIVOS: Record<string, readonly string[]> = {
  motivo_passe: MOTIVOS_PASSE,
  // ADR-121 (0107, NOD-92): a máquina na nuvem.
  estado_maquina_nuvem: ESTADOS_MAQUINA_NUVEM,
  motivo_falha_nuvem: MOTIVOS_FALHA_NUVEM,
  motivo_negacao: MOTIVOS_NEGACAO,
  motivo_interrupcao: MOTIVOS_INTERRUPCAO,
  motivo_falha: MOTIVOS_FALHA,
  motivo_localidade: MOTIVOS_LOCALIDADE,
  desfecho_item: DESFECHOS_ITEM,
  desfecho_rotina: DESFECHOS_ROTINA,
  motivo_sem_novidade: MOTIVOS_SEM_NOVIDADE,
  codigo_erro: CODIGOS_ERRO,
  motivo_aprovacao_manual: MOTIVOS_APROVACAO_MANUAL,
  motivo_inatividade_permissao: MOTIVOS_INATIVIDADE_PERMISSAO,
  categoria_relato: CATEGORIAS_RELATO,
  alcance_relato: ALCANCES_RELATO,
  // ADR-045 (0021): o incidente é aviso de infraestrutura, e o tipo dele também é enum fechado.
  tipo_incidente: TIPOS_INCIDENTE,
  // Emenda da ADR-037 (0022): a falha do computador do bot tem código fechado, no banco e no runtime.
  motivo_falha_computador: MOTIVOS_FALHA_COMPUTADOR,
  // ADR-122 (0106): a tela do bot no computador da pessoa e a operação em curso no computador.
  estado_tela_computador: ESTADOS_TELA_COMPUTADOR,
  operacao_computador: OPERACOES_COMPUTADOR,
};

async function rotulos(tipo: string): Promise<string[]> {
  const linhas = await db<{ enumlabel: string }[]>`
    select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = ${tipo} order by e.enumsortorder`;
  return linhas.map((l) => l.enumlabel);
}

describeIntegracao("gate: enums de motivo (motivos.ts) == pg_enum", () => {
  for (const [tipo, lista] of Object.entries(MOTIVOS)) {
    it(`${tipo} tem exatamente os valores de motivos.ts, na mesma ordem`, async () => {
      expect(await rotulos(tipo)).toEqual([...lista]);
    });
  }

  for (const [tipo, lista] of Object.entries(ENUMS_DE_ESTADO)) {
    it(`${tipo} (estado) tem exatamente os valores de src/db/schema/agentes.ts`, async () => {
      expect(await rotulos(tipo)).toEqual([...lista]);
    });
  }

  // Emenda da ADR-044 (0026): o motivo da janela 'bloqueada' NÃO é enum — vai em rotina_execucoes.motivo,
  // text com CHECK. O gate aqui é que cada valor da lista TS passe no CHECK que o banco aplica.
  it("MOTIVOS_BLOQUEIO_ROTINA passam no CHECK de rotina_execucoes.motivo (text, sem enum)", async () => {
    const [c] = await db<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'rotina_execucoes'::regclass and conname = 'rotina_execucoes_motivo_sem_texto_livre'`;
    expect(c?.def).toContain("'^[a-z_]+$'");
    for (const motivo of MOTIVOS_BLOQUEIO_ROTINA) {
      const [r] = await db<{ ok: boolean }[]>`select ${motivo}::text ~ '^[a-z_]+$' as ok`;
      expect(r?.ok, motivo).toBe(true);
    }
  });

  it("nenhuma coluna de motivo em events/turnos/mensagens/rotina_execucoes/trilha é texto livre sem CHECK", async () => {
    const linhas = await db<{ table_name: string; column_name: string; udt_name: string }[]>`
      select table_name, column_name, udt_name from information_schema.columns
      where table_schema = 'public' and table_name in ('events', 'turnos', 'mensagens', 'rotina_execucoes', 'trilha')
        and column_name in ('motivo_interrupcao', 'motivo_falha', 'locality_reason', 'desfecho', 'motivo')
      order by table_name, column_name`;
    // Tabelas da 0002 + trilha (CHECK na 0001) + events (locality_reason virou motivo_localidade na
    // 0003; as partições herdam o tipo do pai). inventario_motores.motivo fica de fora de propósito:
    // é a prosa que a sonda do CLI reporta ("binário não encontrado"), sem dado pessoal e sem
    // enum possível (ADR-019).
    expect(linhas.map((l) => `${l.table_name}.${l.column_name}`)).toContain("events.locality_reason");
    expect(linhas.find((l) => l.table_name === "events")?.udt_name).toBe("motivo_localidade");
    expect(linhas.length).toBeGreaterThan(4);
    for (const l of linhas) {
      if (l.udt_name !== "text") continue;
      // As duas colunas `motivo text` (trilha, rotina_execucoes) têm CHECK ^[a-z_]+$ na migração.
      const [c] = await db<{ n: number }[]>`
        select count(*)::int as n from pg_constraint where conrelid = ${l.table_name}::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%motivo%'`;
      expect(c?.n, `${l.table_name}.${l.column_name} é text sem CHECK`).toBeGreaterThan(0);
    }
  });
});
