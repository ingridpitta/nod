import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { TEXTO_PERFIL_MUDOU } from "../../src/use-cases/confirmar-perfil.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { definirVozDoAgente } from "../../src/use-cases/ligacoes.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { listarVersoesDoPerfil, restaurarVersaoDoPerfil, verVersaoDoPerfil } from "../../src/use-cases/versoes-perfil.ts";
import { VERSAO_MAXIMA } from "../../src/contracts/versoes-perfil.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const SEGREDO = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";

async function bot(trx: Tx, dono: "pessoa" | "empresa" = "pessoa") {
  const deps = depsSobreTrx(trx, MARLON);
  const { data } = await executar(deps, criarAgente, { dono });
  await executar(deps, editarPerfil, { agenteId: data.agente.id, nome: "Vera", titulo: "Revisora", descricao: "Revisa os PRs." });
  return { deps, agenteId: data.agente.id, conversaId: data.conversa.id };
}

/** Bot recém-criado, ainda sem perfil confirmado: o bot pode propor o perfil (fora da reconfiguração). */
async function botSemConfirmar(trx: Tx) {
  const deps = depsSobreTrx(trx, MARLON);
  const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
  return { deps, agenteId: data.agente.id, conversaId: data.conversa.id };
}

async function propor(deps: Deps, agenteId: string, conversaId: string, descricao: string) {
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  const { data } = await atualizarPerfil(deps, { agenteId, conversaId, turnoId: turno?.id ?? "", descricao });
  if ("erro" in data) throw new Error(data.erro);
  return data;
}

/** Erro do Postgres (SQLSTATE) de um statement, dentro de um savepoint para a transação seguir viva. */
async function sqlstate(trx: Tx, fn: (s: Tx) => Promise<unknown>): Promise<string | null> {
  return trx.savepoint((s) => fn(s as Tx)).then(() => null, (e: { code?: string }) => e.code ?? "sem código");
}

describeIntegracao("NOD-20: histórico de versões do perfil", () => {
  it("salvar pela tela grava a v1 inicial e a versão nova com os campos que mudaram; a trilha só leva enum", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      const r = await executar(deps, editarPerfil, { agenteId, descricao: "Revisa os PRs e aponta riscos." });
      const { data } = await executar(deps, listarVersoesDoPerfil, { agenteId });
      expect(r.data.versao).toBe(data.atual);
      const [nova, anterior] = data.versoes;
      expect(nova).toMatchObject({ origem: "tela", campos: ["descricao"], perfil: { descricao: "Revisa os PRs e aponta riscos." } });
      expect(anterior).toMatchObject({ origem: "tela", perfil: { descricao: "Revisa os PRs." } });
      expect(data.versoes.at(-1)).toMatchObject({ versao: 1, origem: "inicial", campos: [] });
      const trilha = await trx<{ kind: string; regra: string; motivo: string | null }[]>`select kind, regra, motivo from trilha where agente_id = ${agenteId} and kind = 'perfil_versao'`;
      expect(trilha.length).toBe(data.total - 1);
      // Revisão 1 (M5): o número da versão vai na regra (enum + número), nunca texto livre.
      expect(trilha.every((t) => /^perfil:versao:tela:[0-9]+$/.test(t.regra) && t.motivo === null)).toBe(true);
      expect(trilha.map((t) => t.regra)).toContain(`perfil:versao:tela:${data.atual}`);
    });
  });

  it("salvar sem mudança não grava; missão e voz no mesmo Salvar viram UMA versão", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      const antes = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.total;
      const igual = await executar(deps, editarPerfil, { agenteId, descricao: "Revisa os PRs." });
      expect(igual.data.versao).toBeNull();
      expect((await executar(deps, listarVersoesDoPerfil, { agenteId })).data.total).toBe(antes);

      const r = await executar(deps, editarPerfil, { agenteId, descricao: "Outra missão.", voz: "bento", vozVelocidade: 1.25 });
      const { data } = await executar(deps, listarVersoesDoPerfil, { agenteId });
      expect(data.total).toBe(antes + 1);
      expect(data.versoes[0]).toMatchObject({ versao: r.data.versao, origem: "tela", campos: ["descricao", "voz", "vozVelocidade"], perfil: { voz: "bento", vozVelocidade: 1.25 } });
      await esperarErro(() => editarPerfil(deps, { agenteId, voz: "nao-existe" }), "entrada_invalida");
    });
  });

  it("o ajuste de voz numa ligação vira uma versão de origem voz", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, definirVozDoAgente, { agenteId, voz: "luna", vozVelocidade: undefined });
      const [v] = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.versoes;
      expect(v).toMatchObject({ origem: "voz", campos: ["voz"], perfil: { voz: "luna" } });
    });
  });

  it("a proposta confirmada vira uma versão com o id da proposta", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId, conversaId } = await botSemConfirmar(trx);
      const data = await propor(deps, agenteId, conversaId, "Missão proposta pelo bot.");
      await confirmarProposta(deps, { propostaId: data.proposta_id });
      const [v] = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.versoes;
      expect(v).toMatchObject({ origem: "proposta", propostaId: data.proposta_id, campos: ["descricao"] });
    });
  });

  it("segredo na missão sai redigido na versão; o perfil vivo fica como está e a versão igual não parece diferente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, editarPerfil, { agenteId, descricao: `Use a chave ${SEGREDO} no deploy.` });
      const { data } = await executar(deps, listarVersoesDoPerfil, { agenteId });
      const v = data.versoes[0];
      expect(v?.perfil.descricao).not.toContain(SEGREDO);
      expect(v?.perfil.descricao).toContain("«redigido: ");
      expect(v?.redigida).toBe(true);
      expect((await deps.repos.agentes.buscar(agenteId))?.descricao).toContain(SEGREDO);
      const linhas = await trx<{ n: number }[]>`select count(*)::int as n from agente_perfil_versoes where agente_id = ${agenteId} and descricao like ${`%${SEGREDO}%`}`;
      expect(linhas[0]?.n).toBe(0);
      // A Atual (redigida) comparada com o perfil vivo redigido: nada a restaurar.
      expect((await executar(deps, verVersaoDoPerfil, { agenteId, versao: v?.versao ?? 0 })).data.restauravel).toBe(false);
      await esperarErro(() => restaurarVersaoDoPerfil(deps, { agenteId, versao: v?.versao ?? 0 }), "estado_invalido");
    });
  });

  it("restaurar aplica o perfil da versão e cria outra versão; a Atual e a inexistente são recusadas", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, editarPerfil, { agenteId, descricao: "Missão nova.", forma: "shape-circle", cor: "c-blue", voz: "bento" });
      const lista = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data;
      const alvo = lista.versoes[1];
      if (!alvo) throw new Error("sem versão anterior");
      const det = (await executar(deps, verVersaoDoPerfil, { agenteId, versao: alvo.versao })).data;
      expect(det).toMatchObject({ numeroAtual: lista.atual, proxima: lista.atual + 1, restauravel: true, propostaPendente: null, atual: { descricao: "Missão nova." } });

      const r = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: alvo.versao });
      expect(r.data.versao).toMatchObject({ versao: lista.atual + 1, origem: "restauracao", restauradaDe: alvo.versao });
      expect(r.data.agente).toMatchObject({ descricao: alvo.perfil.descricao, forma: alvo.perfil.forma, cor: alvo.perfil.cor, voz: alvo.perfil.voz });
      await esperarErro(() => restaurarVersaoDoPerfil(deps, { agenteId, versao: r.data.versao.versao }), "estado_invalido");
      await esperarErro(() => restaurarVersaoDoPerfil(deps, { agenteId, versao: 999 }), "nao_encontrado");
      // Desfazer a restauração = restaurar a versão de antes dela.
      const desfeita = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: lista.atual });
      expect(desfeita.data.agente).toMatchObject({ descricao: "Missão nova.", forma: "shape-circle", voz: "bento" });
    });
  });

  it("restaurar com proposta de perfil pendente deixa a proposta obsoleta, com o aviso na conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId, conversaId } = await botSemConfirmar(trx);
      // O card nasce pendente; a pessoa edita pela tela enquanto ele espera, e depois restaura a versão de antes.
      const data = await propor(deps, agenteId, conversaId, "Missão do bot.");
      await executar(deps, editarPerfil, { agenteId, descricao: "Missão nova." });
      const lista = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data;
      expect((await executar(deps, verVersaoDoPerfil, { agenteId, versao: lista.atual - 1 })).data.propostaPendente?.id).toBe(data.proposta_id);

      const r = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: lista.atual - 1 });
      expect(r.data.propostasObsoletas).toEqual([data.proposta_id]);
      expect((await deps.repos.propostas.buscar(data.proposta_id))?.estado).toBe("recusada");
      const avisos = (await deps.repos.mensagens.listarDaConversa(conversaId, 100)).filter((m) => m.texto === TEXTO_PERFIL_MUDOU);
      expect(avisos).toHaveLength(1);
      await esperarErro(() => confirmarProposta(deps, { propostaId: data.proposta_id }), "estado_invalido");
    });
  });

  it("revisão 3 M1: restaurar só a forma não avisa nem derruba a proposta pendente; com texto, avisa e derruba", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId, conversaId } = await botSemConfirmar(trx);
      const data = await propor(deps, agenteId, conversaId, "Missão do bot.");
      await executar(deps, editarPerfil, { agenteId, forma: "shape-circle" });
      const v = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.atual;
      expect((await executar(deps, verVersaoDoPerfil, { agenteId, versao: v - 1 })).data.propostaPendente).toBeNull();
      const r = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: v - 1, esperada: v });
      expect(r.data.propostasObsoletas).toEqual([]);
      expect((await deps.repos.propostas.buscar(data.proposta_id))?.estado).toBe("pendente");
    });
  });

  it("bot de equipe de outra pessoa: listar, ver e restaurar são recusados", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx, "empresa");
      await executar(deps, editarPerfil, { agenteId, descricao: "Missão nova." });
      await vincularEscopo(trx, ANA);
      const daAna = depsSobreTrx(trx, ANA);
      expect(await daAna.repos.agentes.buscar(agenteId)).not.toBeNull();
      await esperarErro(() => listarVersoesDoPerfil(daAna, { agenteId }), "nao_permitido");
      await esperarErro(() => verVersaoDoPerfil(daAna, { agenteId, versao: 1 }), "nao_permitido");
      await esperarErro(() => restaurarVersaoDoPerfil(daAna, { agenteId, versao: 1 }), "nao_permitido");
      // Nem por SQL direto: a Ana não grava versão no bot da Marlon (o trigger confere o dono do bot).
      expect(await sqlstate(trx, (s) => s`insert into agente_perfil_versoes (tenant_id, owner_id, agente_id, versao, origem, nome, titulo, descricao, forma, cor)
        values (${ANA.tenantId}, ${ANA.pessoaId}, ${agenteId}, 99, 'tela', 'x', 'x', 'x', 'shape-hex', 'c-purple')`)).toBe("42501");
      await vincularEscopo(trx, MARLON);
    });
  });

  it("guarda as 50 últimas: a 51ª mudança poda a mais velha", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      for (let i = 0; i < 52; i++) await executar(deps, editarPerfil, { agenteId, descricao: `Missão ${i}` });
      const { data } = await executar(deps, listarVersoesDoPerfil, { agenteId });
      expect(data.total).toBe(50);
      const [n] = await trx<{ min: number; max: number }[]>`select min(versao)::int as min, max(versao)::int as max from agente_perfil_versoes where agente_id = ${agenteId}`;
      expect(n).toEqual({ min: data.atual - 49, max: data.atual });
      await esperarErro(() => restaurarVersaoDoPerfil(deps, { agenteId, versao: 1 }), "nao_encontrado");
    });
  });

  it("só acrescenta: nod_app sem UPDATE/DELETE, numeração só max+1, poda não abre por GUC de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, editarPerfil, { agenteId, descricao: "Missão nova." });
      expect(await sqlstate(trx, (s) => s`update agente_perfil_versoes set descricao = 'x' where agente_id = ${agenteId}`)).toBe("42501");
      // eslint-disable-next-line no-restricted-syntax -- o DELETE/TRUNCATE é o INSUMO da prova do só-acrescenta (0132), sob rollback: espera-se 42501/false
      expect(await sqlstate(trx, (s) => s`delete from agente_perfil_versoes where agente_id = ${agenteId}`)).toBe("42501");
      expect(await sqlstate(trx, (s) => s`insert into agente_perfil_versoes (tenant_id, owner_id, agente_id, versao, origem, nome, titulo, descricao, forma, cor)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${agenteId}, 999999, 'tela', 'x', 'x', 'x', 'shape-hex', 'c-purple')`)).toBe("P0001");
      expect(await sqlstate(trx, (s) => s`select set_config('nod.poda_versoes_tenant', ${MARLON.tenantId}, true), set_config('nod.poda_versoes_agente', ${agenteId}, true), nod_podar_versoes_perfil(${agenteId}::uuid)`)).toBe("42501");
      // eslint-disable-next-line no-restricted-syntax -- o DELETE/TRUNCATE é o INSUMO da prova do só-acrescenta (0132), sob rollback: espera-se 42501/false
      const [p] = await trx<{ upd: boolean; del: boolean; trunc: boolean }[]>`select has_table_privilege('nod_app', 'agente_perfil_versoes', 'UPDATE') as upd, has_table_privilege('nod_app', 'agente_perfil_versoes', 'DELETE') as del, has_table_privilege('nod_app', 'agente_perfil_versoes', 'TRUNCATE') as trunc`;
      expect(p).toEqual({ upd: false, del: false, trunc: false });
    });
  });

  it("QA bug 2: a poda só apaga versões de bot da própria pessoa (a de equipe de outra fica)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx, "empresa");
      await executar(deps, editarPerfil, { agenteId, descricao: "Missão nova." });
      // 52 versões gravadas direto (sem a poda do caso de uso): a Marlon pode inserir no bot dela, max+1.
      const [ult] = await trx<{ max: number }[]>`select max(versao)::int as max from agente_perfil_versoes where agente_id = ${agenteId}`;
      for (let v = (ult?.max ?? 0) + 1; v <= 52; v++) {
        await trx`insert into agente_perfil_versoes (tenant_id, owner_id, agente_id, versao, origem, nome, titulo, descricao, forma, cor)
          values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${agenteId}, ${v}, 'tela', 'x', 'x', ${`m${v}`}, 'shape-hex', 'c-purple')`;
      }
      const contar = async () => Number((await trx<{ n: number }[]>`select count(*)::int as n from agente_perfil_versoes where agente_id = ${agenteId}`)[0]?.n);
      // A Ana vê o bot (equipe), mas a poda dela não apaga nada dele.
      await vincularEscopo(trx, ANA);
      const [podaDaAna] = await trx<{ n: number }[]>`select nod_podar_versoes_perfil(${agenteId}::uuid) as n`;
      await vincularEscopo(trx, MARLON);
      expect(podaDaAna?.n).toBe(0);
      expect(await contar()).toBe(52);
      // A da dona poda: o cenário apagaria se a cerca do dono faltasse.
      expect(await deps.repos.versoesPerfil.podar(agenteId)).toBe(2);
      expect(await contar()).toBe(50);
    });
  });

  it("bot sem mudança nenhuma: a lista mostra a v1 virtual (o perfil de agora)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const { data } = await executar(deps, listarVersoesDoPerfil, { agenteId: criado.agente.id });
      expect(data).toMatchObject({ virtual: true, total: 1, atual: 1, versoes: [{ versao: 1, origem: "inicial", perfil: { nome: criado.agente.nome } }] });
      expect((await executar(deps, verVersaoDoPerfil, { agenteId: criado.agente.id, versao: 1 })).data.restauravel).toBe(false);
    });
  });

  // ---- revisão 1 (NOD-20) ----------------------------------------------------------------------------------------------

  it("restaurar com `esperada` recusa (perfil_mudou) quando outra mudança entrou depois; com a certa, restaura", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, editarPerfil, { agenteId, descricao: "Missão A." });
      const vista = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.atual;
      // Outra escrita (a voz numa ligação) entra depois que a tela leu.
      await executar(deps, definirVozDoAgente, { agenteId, voz: "luna", vozVelocidade: undefined });
      const e = await restaurarVersaoDoPerfil(deps, { agenteId, versao: vista - 1, esperada: vista }).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(ErroDeDominio);
      expect((e as ErroDeDominio).codigo).toBe("estado_invalido");
      expect((e as ErroDeDominio).cause).toBe("perfil_mudou");
      expect((await deps.repos.agentes.buscar(agenteId))?.voz).toBe("luna");
      const ok = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: vista - 1, esperada: vista + 1 });
      expect(ok.data.versao.versao).toBe(vista + 2);
      await esperarErro(() => restaurarVersaoDoPerfil(deps, { agenteId, versao: 1, esperada: 0 }), "entrada_invalida");
    });
  });

  it("restaurar versão com texto redigido pede aceitarRedacao; aceito, o marcador volta e o segredo some do perfil vivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, editarPerfil, { agenteId, descricao: `Use a chave ${SEGREDO} no deploy.` });
      const comSegredo = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.atual;
      await executar(deps, editarPerfil, { agenteId, descricao: "Sem chave." });
      const e = await restaurarVersaoDoPerfil(deps, { agenteId, versao: comSegredo }).then(() => null, (x: unknown) => x);
      expect((e as ErroDeDominio).cause).toBe("versao_redigida");
      expect((await deps.repos.agentes.buscar(agenteId))?.descricao).toBe("Sem chave.");
      const r = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: comSegredo, aceitarRedacao: true });
      expect(r.data.agente.descricao).toContain("«redigido: ");
      expect(r.data.agente.descricao).not.toContain(SEGREDO);
      // Só mexer na voz de uma versão redigida não troca texto: não pede o aceite.
      await executar(deps, editarPerfil, { agenteId, voz: "bento" });
      const atual = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.atual;
      const vozDeAntes = r.data.agente.voz ?? null;
      expect(vozDeAntes).not.toBe("bento");
      expect((await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: atual - 1 })).data.agente.voz ?? null).toBe(vozDeAntes);
    });
  });

  it("revisão 2 A1: restaurar por cima de um segredo de agora pede o aceite; o detalhe avisa (perdeSegredo)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, editarPerfil, { agenteId, descricao: `Use a chave ${SEGREDO} no deploy.` });
      const { atual } = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data;
      const det = (await executar(deps, verVersaoDoPerfil, { agenteId, versao: atual - 1 })).data;
      expect(det).toMatchObject({ restauravel: true, perdeSegredo: true });
      const e = await restaurarVersaoDoPerfil(deps, { agenteId, versao: atual - 1, esperada: atual }).then(() => null, (x: unknown) => x);
      expect((e as ErroDeDominio).cause).toBe("versao_redigida");
      expect((await deps.repos.agentes.buscar(agenteId))?.descricao).toContain(SEGREDO);
      // Só a forma muda: o texto com segredo fica como está, sem pedir aceite.
      await executar(deps, editarPerfil, { agenteId, forma: "shape-circle" });
      const depois = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.atual;
      expect((await executar(deps, verVersaoDoPerfil, { agenteId, versao: depois - 1 })).data.perdeSegredo).toBe(false);
      const soForma = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: depois - 1, esperada: depois });
      expect(soForma.data.agente.descricao).toContain(SEGREDO);
      // Aceito: volta o texto sem segredo, e o segredo sai do perfil vivo.
      const v = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.atual;
      const r = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: atual - 1, esperada: v, aceitarRedacao: true });
      expect(r.data.agente.descricao).toBe("Revisa os PRs.");
      // Sem segredo em lugar nenhum: nada a avisar.
      expect((await executar(deps, verVersaoDoPerfil, { agenteId, versao: 2 })).data.perdeSegredo).toBe(false);
    });
  });

  it("o que o Nod muda pelo chat grava origem chat e autor nod; a restauração do Nod também é do Nod", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await executar(deps, editarPerfil, { agenteId, descricao: "Missão do Nod.", peloNod: true });
      const [v] = (await executar(deps, listarVersoesDoPerfil, { agenteId })).data.versoes;
      expect(v).toMatchObject({ origem: "chat", autor: "nod", campos: ["descricao"] });
      const r = await executar(deps, restaurarVersaoDoPerfil, { agenteId, versao: (v?.versao ?? 2) - 1, peloNod: true });
      expect(r.data.versao).toMatchObject({ origem: "restauracao", autor: "nod" });
      await executar(deps, editarPerfil, { agenteId, descricao: "Da pessoa." });
      expect((await executar(deps, listarVersoesDoPerfil, { agenteId })).data.versoes[0]).toMatchObject({ origem: "tela", autor: "pessoa" });
      // O banco não aceita origem chat com autor pessoa.
      expect(await sqlstate(trx, (s) => s`insert into agente_perfil_versoes (tenant_id, owner_id, agente_id, versao, origem, autor, nome, titulo, descricao, forma, cor)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${agenteId}, ${r.data.versao.versao + 2}, 'chat', 'pessoa', 'x', 'x', 'x', 'shape-hex', 'c-purple')`)).toBe("23514"); // revisão 3 B4: max+1 (a "Da pessoa" é r+1), para cair na CHECK e não no gatilho da numeração
    });
  });

  it("revisão 4 A1: no Nod, título e missão voltam (ADR-081 só trava o nome)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { nod } = (await executar(deps, garantirNod, {})).data;
      const antes = (await deps.repos.agentes.buscar(nod.id))!;
      await executar(deps, editarPerfil, { agenteId: nod.id, titulo: "Ajudante novo", descricao: "Missão nova do Nod." });
      const r = await executar(deps, restaurarVersaoDoPerfil, { agenteId: nod.id, versao: 1 });
      expect(r.data.versao.campos).toEqual(["titulo", "descricao"]);
      const depois = (await deps.repos.agentes.buscar(nod.id))!;
      expect([depois.nome, depois.titulo, depois.descricao]).toEqual([antes.nome, antes.titulo, antes.descricao]);
    });
  });

  it("número de versão acima do int4 é entrada inválida, não 500", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await bot(trx);
      await esperarErro(() => verVersaoDoPerfil(deps, { agenteId, versao: VERSAO_MAXIMA + 1 }), "entrada_invalida");
      await esperarErro(() => restaurarVersaoDoPerfil(deps, { agenteId, versao: VERSAO_MAXIMA + 1 }), "entrada_invalida");
      await esperarErro(() => listarVersoesDoPerfil(deps, { agenteId, antes: VERSAO_MAXIMA + 1 }), "entrada_invalida");
      await esperarErro(() => verVersaoDoPerfil(deps, { agenteId, versao: VERSAO_MAXIMA }), "nao_encontrado");
    });
  });
});
