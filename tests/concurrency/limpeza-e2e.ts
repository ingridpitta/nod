import { vincularEscopo } from "../../src/db/tx.ts";
import type { Db, Escopo } from "../../src/shared/types.ts";

/**
 * Limpeza própria do E2E (terceiro modo, ADR-011 refinado): as linhas COMMITAM porque o servidor
 * completo roda laços reais; ao fim, tudo que pertence à pessoa do teste é apagado por owner_id,
 * como nod_app sob o escopo dela (a policy deixa a dona apagar o que é dela), e a linha em
 * `pessoas` como nod_dono. Ordem respeita as FKs da 0002.
 *
 * O que FICA, por desenho: `trilha` é imutável por trigger e REVOKE (ADR-004) — as linhas de
 * tool_call/negacao do e2e permanecem em nod_test, de uma pessoa aleatória que não volta a existir.
 */
export async function limparPessoaE2E(db: Db, dbDono: Db, escopo: Escopo, ids: { agentes: string[]; conversas: string[] }): Promise<void> {
  const p = escopo.pessoaId;
  await db.begin(async (trx) => {
    await vincularEscopo(trx, escopo);
    await trx`set local lock_timeout = '5s'`;
    await trx`delete from relato_prosa where owner_id = ${p}`;
    await trx`delete from relatos where owner_id = ${p}`;
    await trx`delete from turno_diagnosticos where owner_id = ${p}`;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    // ADR-108 (0080): o aviso de troca aponta para agente e conversa — sai antes deles.
    await trx`delete from trocas_de_ia where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from computador_acoes where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    // 0093 (ADR-115): o registro do modo aponta para decisões e turnos (PR 6: o total também grava).
    await trx`delete from acoes_pelo_modo where owner_id = ${p}`;
    await trx`delete from itens_aprovacao where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from concessoes where owner_id = ${p}`;
    // ADR-051 (0031): a versão aponta para a mensagem e o artefato para agente/conversa — saem antes deles.
    await trx`delete from artefato_estados where owner_id = ${p}`;
    await trx`delete from artefato_versoes where owner_id = ${p}`;
    await trx`delete from artefatos where owner_id = ${p}`;
    await trx`delete from anexos where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from agente_memorias where owner_id = ${p}`;
    // NOD-58 (0118): o diário da memória aponta para o agente.
    await trx`delete from memoria_diario where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from incidentes where owner_id = ${p}`;
    await trx`delete from rotina_execucoes where owner_id = ${p}`;
    await trx`delete from rotina_janelas where owner_id = ${p}`;
    // 0097 (NOD-293): a resposta guardada do POST de nativa aponta para o turno — o hook de verdade a grava (PR 6, e2e).
    await trx`delete from nativas_idempotencia where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    // ADR-083 (0060): o trabalho aponta para agente, conversa e rotina, e os turnos apontam para ele — sai entre os dois.
    await trx`delete from trabalhos where owner_id = ${p}`;
    // ADR-075 (0048): a ligação aponta para agente e conversa, e os turnos apontam para ela — sai entre os dois.
    await trx`delete from ligacao_falas where owner_id = ${p}`;
    await trx`delete from ligacoes where owner_id = ${p}`;
    await trx`delete from preferencias where owner_id = ${p}`;
    // 0108 (NOD-313): a contagem e o card de ritmo apontam para a rotina — saem antes dela (a FK também cascateia).
    // 0130 (NOD-84): o endereço e o log de chamadas do webhook apontam para a rotina.
    await trx`delete from rotina_chamadas where owner_id = ${p}`;
    await trx`delete from rotina_gatilhos where owner_id = ${p}`;
    await trx`delete from rotina_ritmo where owner_id = ${p}`;
    await trx`delete from rotinas where owner_id = ${p}`;
    await trx`delete from sala_membros where owner_id = ${p}`;
    await trx`delete from salas where owner_id = ${p}`;
    // 0039: o "lido até" aponta para a conversa — sai antes dela.
    await trx`delete from leituras where owner_id = ${p}`;
    if (ids.conversas.length) await trx`delete from conversas where id in ${trx(ids.conversas)}`;
    await trx`delete from conversas where owner_id = ${p}`;
    if (ids.agentes.length) await trx`delete from agentes where id in ${trx(ids.agentes)}`;
    await trx`delete from agentes where owner_id = ${p}`;
    // 0147 (NOD-437): os times da pessoa.
    await trx`delete from times where owner_id = ${p}`;
    await trx`delete from computadores where owner_id = ${p}`;
    await trx`delete from composio_sessoes where owner_id = ${p}`;
    await trx`delete from composio_configuracoes where owner_id = ${p}`;
    await trx`delete from conectores where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  // As tabelas de conta (0109) não têm RLS de pessoa: o dono apaga o que as rotas de /api/conta criaram (o fuzz do
  // NOD-398 chama todas elas e pode deixar sessão, pareamento ou entrada da pessoa).
  const t = escopo.tenantId;
  await dbDono`delete from entradas_conta where (destino_tenant_id = ${t} and destino_pessoa_id = ${p}) or sessao_id in (select id from sessoes where tenant_id = ${t} and pessoa_id = ${p})`;
  await dbDono`delete from pareamentos_conta where tenant_id = ${t} and pessoa_id = ${p}`;
  await dbDono`delete from bootstrap_instalacoes where tenant_id = ${t} and pessoa_id = ${p}`;
  await dbDono`delete from sessoes_corte where tenant_id = ${t} and pessoa_id = ${p}`;
  await dbDono`delete from sessoes where tenant_id = ${t} and pessoa_id = ${p}`;
  await dbDono`delete from pessoas where tenant_id = ${escopo.tenantId} and id = ${p}`;
}

/** Um tenant criado só para o teste sai no fim, se nada mais aponta para ele (a trilha é imutável: se registrou algo nele, ele fica). */
export async function limparTenantE2E(dbDono: Db, tenantId: string): Promise<void> {
  // Esperado falhar quando algo do teste ficou apontando para ele (a trilha é imutável); o log diz qual, para não esconder
  // um vazamento de verdade.
  await dbDono`delete from tenants where id = ${tenantId}`.catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`limparTenantE2E: o tenant ${tenantId} ficou (${(e as Error).message.slice(0, 160)})`);
  });
}

/**
 * A varredura das sobras (revisão 5, médio 3): a limpeza do e2e apaga uma lista fixa de tabelas, e o fuzz chama TODA ação
 * do registro (maquinas.criar_chave grava em maquina_tokens, que a lista não tinha). Aqui a lista vem do catálogo: toda
 * tabela do schema public com owner_id, apagada pela própria pessoa (RLS ligado, escopo vinculado), em passadas até a
 * ordem das chaves estrangeiras se resolver. Devolve as tabelas que ainda têm linha da pessoa ou que a contagem não leu (vazio = limpo).
 */
export async function varrerSobrasDaPessoa(db: Db, dbDono: Db, escopo: Escopo): Promise<string[]> {
  const tabelas = (await db<{ t: string }[]>`select c.table_name as t from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name where c.table_schema = 'public' and c.column_name = 'owner_id' and x.table_type = 'BASE TABLE' order by 1`).map((r) => r.t);
  const contar = async (): Promise<string[]> => {
    const sobras: string[] = [];
    // A contagem é do DONO (vê toda tabela, com ou sem grant à app) com o escopo vinculado (as de FORCE RLS também). Não
    // conseguir ler é sobra, não "limpo" (revisão 6): a falha aparece com a tabela e o erro.
    await dbDono.begin(async (trx) => {
      await vincularEscopo(trx, escopo);
      for (const t of tabelas) {
        const r = await trx.savepoint((s) => s<{ n: number }[]>`select count(*)::int as n from ${s(t)} where owner_id = ${escopo.pessoaId}`).then(([x]) => x?.n ?? 0, (e: Error) => e);
        if (r instanceof Error) sobras.push(`${t} (não li: ${r.message.slice(0, 80)})`);
        else if (r > 0) sobras.push(`${t} (${r})`);
      }
    });
    return sobras;
  };
  for (let passada = 0; passada < 6; passada++) {
    let apagou = 0;
    let falhou = 0;
    await db.begin(async (trx) => {
      await vincularEscopo(trx, escopo);
      for (const t of tabelas) {
        await trx
          .savepoint(async (s) => {
            apagou += (await s`delete from ${s(t)} where owner_id = ${escopo.pessoaId}`).count;
          })
          .catch(() => {
            falhou++;
          });
      }
    });
    if (falhou === 0 || apagou === 0) break;
  }
  return contar();
}
