import { MODELO_AGENTE_PADRAO as MODELO_PADRAO } from "../../contracts/modelos.ts";
import postgres from "postgres";
import { criarDb } from "../client.ts";
import { abrirTxEscopada } from "../tx.ts";
import type { Conn, Transacao } from "../../shared/types.ts";
import { idDeterministico } from "./id-deterministico.ts";

/**
 * Seed idempotente por UUID determinístico (Práticas §12): upsert ON CONFLICT (tenant_id, id)
 * DO UPDATE ... WHERE algo mudou — rodar duas vezes produz o mesmo estado e a segunda passagem
 * devolve zero mudanças. Identidade (tenants/pessoas) entra como nod_dono (nod_app só lê);
 * agentes/conversas/sala entram como nod_app sob abrirTxEscopada da pessoa dona, porque sob
 * FORCE ROW LEVEL SECURITY o dono do banco sem policy própria não escreve em tabela escopada.
 * O CI NUNCA chama (Práticas §6): testes criam as próprias linhas.
 *
 * Estes ids existem SÓ aqui (EMENDA 9): tests/helpers/ids.ts reexporta apenas identidade.
 */
/** O tenant único desde a 0001 (é o DEFAULT de tenant_id): o valor é fixo, nunca recalculado. */
export const TENANT_PADRAO = "172e1fdf-428d-48cb-b052-3bd7d2573e18";
export const PESSOA_MARLON = idDeterministico("pessoa:marlon");
export const PESSOA_ANA = idDeterministico("pessoa:ana");
export const AGENTE_VERA = idDeterministico("agente:marlon:vera");
export const AGENTE_TUCA = idDeterministico("agente:ana:tuca");
export const CONVERSA_VERA = idDeterministico("conversa:marlon:vera");
export const CONVERSA_TUCA = idDeterministico("conversa:ana:tuca");
/** Fixo pelo mesmo motivo do tenant: é o id que a sala geral já tem nos bancos semeados. */
export const SALA_GERAL = "a2ae8249-3a42-4892-ae18-4c199a4be23c";
export const CONVERSA_GERAL = idDeterministico("conversa:sala:geral");

const AGENTES = [
  { id: AGENTE_VERA, dono: PESSOA_MARLON, conversaId: CONVERSA_VERA, nome: "Vera", titulo: "Revisora de PRs", descricao: "Revisa PRs do time nod e responde curto.", forma: "shape-hex", cor: "c-purple" },
  { id: AGENTE_TUCA, dono: PESSOA_ANA, conversaId: CONVERSA_TUCA, nome: "Tuca", titulo: "Triagem", descricao: "Tria pedidos e aponta quem resolve.", forma: "shape-circle", cor: "c-teal" },
] as const;

export type ResultadoSeed = { mudancas: number };

/** Dependências do seed: a conexão do dono (identidade) e uma fábrica de tx escopada por pessoa (exemplos). */
export type DepsSeed = { dono: Conn; txPorPessoa: (pessoaId: string) => Transacao };

/**
 * Allowlist do login Google (ADR-030): quem não tem e-mail aqui não entra pelo Google. Sempre em
 * minúsculas (o CHECK pessoas_email_formato da 0006 recusa caixa alta em vez de gravar dado torto).
 * Ana fica SEM e-mail até o endereço real ser confirmado (definido em 2026-09-16): adivinhar um
 * endereço abriria a conta de outra pessoa; null só impede o login Google dela.
 * O e-mail do dono vem de NOD_SEED_EMAIL (definido em 2026-10-02: endereço de pessoa não fica no
 * código); vazio = sem login Google para ele, como a Ana.
 */
export const EMAIL_MARLON: string | null = process.env.NOD_SEED_EMAIL?.trim().toLowerCase() || null;
export const EMAIL_ANA: string | null = null;

async function semearIdentidade(dono: Conn): Promise<number> {
  let n = 0;
  n += (
    await dono`
      insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod')
      on conflict (id) do update set nome = excluded.nome where tenants.nome is distinct from excluded.nome
      returning id`
  ).length;
  n += (
    await dono`
      insert into pessoas (tenant_id, id, nome, iniciais, email) values
        (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'Marlon', 'MW', ${EMAIL_MARLON}),
        (${TENANT_PADRAO}, ${PESSOA_ANA}, 'Ana', 'AN', ${EMAIL_ANA})
      on conflict (tenant_id, id) do update set nome = excluded.nome, iniciais = excluded.iniciais, email = excluded.email
      where (pessoas.nome, pessoas.iniciais, pessoas.email) is distinct from (excluded.nome, excluded.iniciais, excluded.email)
      returning id`
  ).length;
  return n;
}

/** O seed sobre dependências injetadas: o teste roda sob rollback (dono + app), o script sobre pools. */
export async function semearCom(deps: DepsSeed): Promise<ResultadoSeed> {
  let mudancas = await semearIdentidade(deps.dono);
  for (const a of AGENTES) {
    mudancas += await deps.txPorPessoa(a.dono)(async (trx) => {
      let n = 0;
      n += (
        await trx`
          insert into agentes (tenant_id, id, owner_id, visibility, nome, titulo, descricao, dono, forma, cor, modelo, confirmado)
          values (${TENANT_PADRAO}, ${a.id}, ${a.dono}, 'privado', ${a.nome}, ${a.titulo}, ${a.descricao}, 'pessoa', ${a.forma}, ${a.cor}, ${MODELO_PADRAO}, true)
          on conflict (tenant_id, id) do update set nome = excluded.nome, titulo = excluded.titulo, descricao = excluded.descricao,
            forma = excluded.forma, cor = excluded.cor, modelo = excluded.modelo, confirmado = excluded.confirmado
          where (agentes.nome, agentes.titulo, agentes.descricao, agentes.forma, agentes.cor, agentes.modelo, agentes.confirmado)
            is distinct from (excluded.nome, excluded.titulo, excluded.descricao, excluded.forma, excluded.cor, excluded.modelo, excluded.confirmado)
          returning id`
      ).length;
      n += (
        await trx`
          insert into conversas (tenant_id, id, owner_id, tipo, agente_id) values (${TENANT_PADRAO}, ${a.conversaId}, ${a.dono}, 'propria', ${a.id})
          on conflict (tenant_id, id) do nothing returning id`
      ).length;
      return n;
    });
  }

  // Sala 'geral' (Vera + Tuca), dona Marlon: o grant de leitura vai ao dono de cada bot (ADR-027).
  mudancas += await deps.txPorPessoa(PESSOA_MARLON)(async (trx) => {
    let n = 0;
    n += (
      await trx`
        insert into conversas (tenant_id, id, owner_id, tipo, sala_id) values (${TENANT_PADRAO}, ${CONVERSA_GERAL}, ${PESSOA_MARLON}, 'sala', ${SALA_GERAL})
        on conflict (tenant_id, id) do nothing returning id`
    ).length;
    n += (
      await trx`
        insert into salas (tenant_id, id, owner_id, nome, conversa_id, politica, lead_agente_id)
        values (${TENANT_PADRAO}, ${SALA_GERAL}, ${PESSOA_MARLON}, 'geral', ${CONVERSA_GERAL}, 'lead', ${AGENTE_VERA})
        on conflict (tenant_id, id) do update set nome = excluded.nome, politica = excluded.politica, lead_agente_id = excluded.lead_agente_id
        where (salas.nome, salas.politica, salas.lead_agente_id) is distinct from (excluded.nome, excluded.politica, excluded.lead_agente_id)
        returning id`
    ).length;
    n += (
      await trx`
        insert into sala_membros (tenant_id, owner_id, sala_id, agente_id, pessoa_leitora_id) values
          (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${SALA_GERAL}, ${AGENTE_VERA}, ${PESSOA_MARLON}),
          (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${SALA_GERAL}, ${AGENTE_TUCA}, ${PESSOA_ANA})
        on conflict (tenant_id, sala_id, agente_id) do update set pessoa_leitora_id = excluded.pessoa_leitora_id, removido_em = null
        where (sala_membros.pessoa_leitora_id, sala_membros.removido_em) is distinct from (excluded.pessoa_leitora_id, null::timestamptz)
        returning id`
    ).length;
    return n;
  });
  return { mudancas };
}

/** `npm run db:seed`: pools reais — nod_dono para identidade, nod_app escopado por pessoa para o resto. */
export async function semear(urls: { urlDono: string; urlApp: string }): Promise<ResultadoSeed> {
  const dono = postgres(urls.urlDono, { prepare: false, max: 1, onnotice: () => {} });
  const app = criarDb(urls.urlApp, { max: 2 });
  try {
    return await semearCom({ dono, txPorPessoa: (pessoaId) => abrirTxEscopada(app, { tenantId: TENANT_PADRAO, pessoaId }) });
  } finally {
    await dono.end({ timeout: 2 });
    await app.end({ timeout: 2 });
  }
}
