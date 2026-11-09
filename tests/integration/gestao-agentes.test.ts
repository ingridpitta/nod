import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { listarFrota } from "../../src/use-cases/listar-frota.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { fixarAgente, ocultarAgente } from "../../src/use-cases/fixar-ocultar-agente.ts";
import { ANA, MARLON, depsSobreTrx, esperarErro } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { concederLote } from "../../src/use-cases/conceder.ts";
import { permitirSempre } from "../../src/use-cases/permitir-sempre.ts";
import { autoriaDoAgente } from "../../src/use-cases/registrar-negacao.ts";
import { pastaDoBot } from "../../src/domain/nativas.ts";
import { resolverAlvo } from "../../src/use-cases/apoio-l7.ts";

const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });

async function conectorSondado(d: Deps, slug: string, catalogo: CapacidadeConector[]) {
  const criado = await d.repos.conectores.criar({ nome: slug, slug, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  const sondado = await d.repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo, agora: Date.now() });
  if (!sondado) throw new Error("conector não sondado");
  return sondado;
}

describeIntegracao("gestão de agentes: ciclo de vida e organização", () => {
  it("organiza, marca leitura, fixa e oculta sem perder perfil nem parar rotinas; gestão encontra ocultos", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "UAT gestão" });
      // 0039: "não lido" é o "lido até" da conversa, então precisa de uma fala do bot para marcar.
      await d.repos.mensagens.criar({ conversaId: b.conversa.id, autoria: autoriaDoAgente(MARLON, b.agente.id), kind: "texto", texto: "Pronto.", confianca: "confiavel" });
      await gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", secao: "  Design  ", naoLido: true });
      await fixarAgente(d, { agenteId: b.agente.id, fixado: true });
      await ocultarAgente(d, { agenteId: b.agente.id, oculto: true });
      expect((await listarFrota(d, {})).data.agentes.some((a) => a.id === b.agente.id)).toBe(false);
      expect((await listarFrota(d, { gerenciar: true })).data.agentes.find((a) => a.id === b.agente.id)).toMatchObject({ secao: "Design", naoLido: true, fixado: true, oculto: true });
      await gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", secao: "", naoLido: false });
      expect(await d.repos.agentes.buscar(b.agente.id)).toMatchObject({ secao: "" });
      expect((await listarFrota(d, { gerenciar: true })).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(false);
      await esperarErro(() => gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", secao: "a".repeat(61) }), "entrada_invalida");
    });
  });

  it("excluir pausa agenda, revoga acesso, interrompe fila, bloqueia reativação e novas mensagens; restaurar preserva histórico sem reativar", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Descartável" });
      const rotina = await d.repos.rotinas.criar({ agenteId: b.agente.id, conversaId: b.conversa.id, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "UAT", fonte: "teste", entregavel: "chat", limitesAprovacao: "sem externos", politicaSemDado: "avisar", proximaExecucao: Date.now() + 300000 });
      const c = await d.repos.conectores.criar({ nome: "Fixture", slug: `teste-${b.agente.id}`, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const mensagem = (await d.repos.mensagens.listarDaConversa(b.conversa.id))[0]!;
      await d.repos.concessoes.conceder({ agenteId: b.agente.id, conectorId: c!.id, capacidade: "ler", mensagemId: mensagem.id });
      const { data: enviado } = await enviarMensagem(d, { conversaId: b.conversa.id, texto: "Histórico preservado", inventario: { estado: "pronto", versao: "t", em: 0 } });
      await gerirAgente(d, { agenteId: b.agente.id, acao: "excluir" });
      expect(await d.repos.agentes.buscar(b.agente.id)).toBeNull();
      expect((await listarFrota(d, { gerenciar: true })).data.agentes.find((a) => a.id === b.agente.id)?.excluidoEm).toBeTruthy();
      expect((await d.repos.rotinas.buscar(rotina!.id))?.estado).toBe("pausada");
      expect(await d.repos.concessoes.doAgente(b.agente.id)).toHaveLength(0);
      expect((await d.repos.turnos.buscar(enviado.turno.id))?.estado).toBe("interrompido");
      await esperarErro(() => enviarMensagem(d, { conversaId: b.conversa.id, texto: "não executar" }), "nao_encontrado");
      await expectRejected(tx, () => d.repos.rotinas.atualizarEstado(rotina!.id, "ativa"), "23514");
      await gerirAgente(d, { agenteId: b.agente.id, acao: "restaurar" });
      expect(await d.repos.agentes.buscar(b.agente.id)).toMatchObject({ oculto: false, excluidoEm: null });
      expect((await d.repos.rotinas.buscar(rotina!.id))?.estado).toBe("pausada");
      expect((await d.repos.mensagens.listarDaConversa(b.conversa.id)).some((m) => m.texto === "Histórico preservado")).toBe(true);
      expect(await d.repos.concessoes.doAgente(b.agente.id)).toHaveLength(0);
    });
  });

  it("a dona duplica o bot inteiro: avatar, perfil longo, memória, acessos com consentimento novo, regras ativas e rotinas no mesmo estado; nunca o histórico", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "A".repeat(60), titulo: "Design", descricao: "Clareza" });
      await editarPerfil(d, { agenteId: b.agente.id, forma: "shape-cloud", cor: "c-amber", descricao: "Clareza" });
      expect((await d.repos.agentes.buscar(b.agente.id))?.confirmado).toBe(true);
      await d.repos.memorias.criar({ agenteId: b.agente.id, tipo: "preferencia", texto: "PR sempre em rascunho", origem: "pessoa" });
      const gh = await conectorSondado(d, `gh-${b.agente.id}`, [cap("pr_ver", true), cap("pr_comentar", false), cap("pr_merge", false)]);
      const lote = await concederLote(d, { agenteId: b.agente.id, conectorId: gh.id, capacidades: ["pr_ver", "pr_comentar"] });
      // Concessão cuja capacidade saiu do catálogo depois: não dá alcance a nada, não vai para a cópia.
      await d.repos.concessoes.conceder({ agenteId: b.agente.id, conectorId: gh.id, capacidade: "sumiu", mensagemId: lote.data.mensagemId ?? "" });
      const decisao = await d.repos.decisoes.criar({ tipo: "aprovacao", agenteId: b.agente.id, conversaId: b.conversa.id, turnoId: null, prazoDecisaoEm: Date.now() + 86_400_000, frase: "Comentar no PR" });
      const [item] = await d.repos.itensAprovacao.criarLote(decisao?.id ?? "", [{ idx: 0, texto: "Comentar no PR 1", destino: { conector: gh.slug, ferramenta: "pr_comentar", argumentos: {} }, origemSensivel: false }]);
      await permitirSempre(d, { decisaoId: decisao?.id ?? "", itemIds: [item?.id ?? ""] });
      // Regra de antes da ADR-047 para merge: hoje não nasceria, então não é propagada.
      await d.repos.permissoesPermanentes.criar({ agenteId: b.agente.id, conectorId: gh.id, capacidade: "pr_merge", itemOrigemId: item?.id ?? "", mensagemId: lote.data.mensagemId ?? "", regraVersao: 1 });
      const rotina = { conversaId: b.conversa.id, fusoIana: "UTC", fonte: "teste", entregavel: "chat", limitesAprovacao: "sem externos", politicaSemDado: "avisar", proximaExecucao: Date.now() + 300000 };
      await d.repos.rotinas.criar({ ...rotina, agenteId: b.agente.id, cron: "*/5 * * * *", instrucao: "Revisar PRs abertos", exigeAprovacao: false });
      await d.repos.rotinas.criar({ ...rotina, agenteId: b.agente.id, cron: "0 9 * * 1", instrucao: "Resumo da semana", estado: "pausada" });

      const { data: copia, events } = await duplicarAgente(d, { agenteId: b.agente.id });
      expect(copia.agente).toMatchObject({ titulo: "Design", descricao: "Clareza", forma: "shape-cloud", cor: "c-amber", fixado: false, oculto: false, secao: "", naoLido: false });
      expect(copia.agente.nome.length).toBeLessThanOrEqual(60);
      expect(copia.conversa.id).not.toBe(b.conversa.id);
      expect(await d.repos.memorias.listarDoAgente(copia.agente.id)).toMatchObject([{ tipo: "preferencia", texto: "PR sempre em rascunho", origem: "pessoa" }]);

      const mensagens = await d.repos.mensagens.listarDaConversa(copia.conversa.id);
      const daCopia = new Set(mensagens.map((m) => m.id));
      const concessoes = await d.repos.concessoes.doAgente(copia.agente.id);
      expect(concessoes.map((c) => c.capacidade).sort()).toEqual(["pr_comentar", "pr_ver"]);
      expect(concessoes.every((c) => daCopia.has(c.mensagemId))).toBe(true);
      const regras = await d.repos.permissoesPermanentes.ativasDoAgente(copia.agente.id);
      expect(regras).toMatchObject([{ capacidade: "pr_comentar", itemOrigemId: item?.id }]);
      expect(daCopia.has(regras[0]?.mensagemId ?? "")).toBe(true);
      expect(mensagens.map((m) => m.kind).sort()).toEqual(["consentimento", "consentimento", "sistema"]);
      expect(mensagens.find((m) => m.kind === "sistema")?.texto).toMatch(/^Rotina ativa/);

      // Mesma tx = mesmo criado_em: a ordem da listagem não é garantida, então compara por instrução.
      const rs = (await d.repos.rotinas.listarDoAgente(copia.agente.id)).sort((x, y) => x.instrucao.localeCompare(y.instrucao));
      expect(rs.map((r) => ({ instrucao: r.instrucao, estado: r.estado, exigeAprovacao: r.exigeAprovacao, conversaId: r.conversaId }))).toEqual([
        { instrucao: "Resumo da semana", estado: "pausada", exigeAprovacao: true, conversaId: copia.conversa.id },
        // NOD-316: o exige_aprovacao (campo morto) não é copiado — vale o DEFAULT da coluna.
        { instrucao: "Revisar PRs abertos", estado: "ativa", exigeAprovacao: true, conversaId: copia.conversa.id },
      ]);
      expect((events ?? []).map((e) => e.kind).sort()).toEqual(["agente_atualizado", "concessao_criada", "concessao_criada", "mensagem_criada", "rotina_criada", "rotina_criada"]);
      expect(await d.repos.concessoes.doAgente(b.agente.id)).toHaveLength(3);
    });
  });

  it("bot de equipe duplicado por outra pessoa não herda memória, acessos nem regras, e as rotinas dela nascem pausadas com aprovação", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "empresa", nome: "Equipe" });
      await d.repos.memorias.criar({ agenteId: b.agente.id, tipo: "fato", texto: "do Marlon", origem: "pessoa" });
      const gh = await conectorSondado(d, `gh-${b.agente.id}`, [cap("pr_ver", true)]);
      await concederLote(d, { agenteId: b.agente.id, conectorId: gh.id, capacidades: ["pr_ver"] });
      await vincularEscopo(tx, ANA);
      const outra = depsSobreTrx(tx, ANA);
      const conversa = await outra.repos.conversas.criar({ tipo: "propria", agenteId: b.agente.id });
      await outra.repos.rotinas.criar({ agenteId: b.agente.id, conversaId: conversa!.id, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "UAT", fonte: "teste", entregavel: "chat", limitesAprovacao: "sem externos", politicaSemDado: "avisar", proximaExecucao: Date.now() + 300000, exigeAprovacao: false });

      const { data: copia } = await duplicarAgente(outra, { agenteId: b.agente.id });
      expect(copia.agente.ownerId).toBe(ANA.pessoaId);
      expect(await outra.repos.memorias.listarDoAgente(copia.agente.id)).toHaveLength(0);
      expect(await outra.repos.concessoes.doAgente(copia.agente.id)).toHaveLength(0);
      expect(await outra.repos.permissoesPermanentes.ativasDoAgente(copia.agente.id)).toHaveLength(0);
      expect(await outra.repos.mensagens.listarDaConversa(copia.conversa.id)).toHaveLength(0);
      expect(await outra.repos.rotinas.listarDoAgente(copia.agente.id)).toMatchObject([{ estado: "pausada", exigeAprovacao: true }]);
    });
  });

  it("NOD-289 (M1): a dona leva a máquina do original se a chave está viva; revogada ou vencida, sem máquina", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const chave = async () => (await d.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      const [viva, revogada, vencida] = [await chave(), await chave(), await chave()];
      await d.repos.maquinaTokens.revogar(revogada, Date.now());
      await d.repos.maquinaTokens.vencerEm(vencida, Date.now() - 60_000);
      for (const [maquina, esperado] of [[viva, viva], [revogada, null], [vencida, null]] as const) {
        const { data: b } = await criarAgente(d, { dono: "pessoa", nome: `Maq ${randomBytes(3).toString("hex")}` });
        await d.repos.agentes.definirMaquina([b.agente.id], maquina);
        const { data: copia } = await duplicarAgente(d, { agenteId: b.agente.id });
        expect((await d.repos.agentes.buscar(copia.agente.id))?.maquinaId ?? null).toBe(esperado);
      }
    });
  });

  it("NOD-289 (M1): bot de equipe duplicado por outra pessoa nasce sem máquina", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const viva = (await d.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      const { data: b } = await criarAgente(d, { dono: "empresa", nome: `Equipe maq ${randomBytes(3).toString("hex")}` });
      await d.repos.agentes.definirMaquina([b.agente.id], viva);
      await vincularEscopo(tx, ANA);
      const outra = depsSobreTrx(tx, ANA);
      const { data: copia } = await duplicarAgente(outra, { agenteId: b.agente.id });
      expect((await outra.repos.agentes.buscar(copia.agente.id))?.maquinaId ?? null).toBeNull();
    });
  });

  it("NOD-289 (M3): duplicar duas vezes dá '(cópia)' e '(cópia 2)', pastas distintas e cada um achável pelo nome", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const nome = `Eng ${randomBytes(3).toString("hex")}`;
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome });
      const um = (await duplicarAgente(d, { agenteId: b.agente.id })).data.agente;
      const dois = (await duplicarAgente(d, { agenteId: b.agente.id })).data.agente;
      expect([um.nome, dois.nome]).toEqual([`${nome} (cópia)`, `${nome} (cópia 2)`]);
      expect(pastaDoBot(um.nome)).not.toBe(pastaDoBot(dois.nome));
      expect((await resolverAlvo(d.repos, b.agente, um.nome)).id).toBe(um.id);
      expect((await resolverAlvo(d.repos, b.agente, dois.nome)).id).toBe(dois.id);
      // Nome de 60 caracteres: as cópias seguem cabendo e únicas.
      const { data: longo } = await criarAgente(d, { dono: "pessoa", nome: `L${randomBytes(3).toString("hex")}`.padEnd(60, "x") });
      const l1 = (await duplicarAgente(d, { agenteId: longo.agente.id })).data.agente.nome;
      const l2 = (await duplicarAgente(d, { agenteId: longo.agente.id })).data.agente.nome;
      expect(l1.length).toBeLessThanOrEqual(60);
      expect(l2.length).toBeLessThanOrEqual(60);
      expect(l1).not.toBe(l2);
    });
  });

  it("NOD-289 (M2): pedida com rotinasPausadas, a cópia da dona vem com as rotinas pausadas e sem 'Rotina ativa'", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: `Rot ${randomBytes(3).toString("hex")}` });
      await d.repos.rotinas.criar({ agenteId: b.agente.id, conversaId: b.conversa.id, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "UAT", fonte: "teste", entregavel: "chat", limitesAprovacao: "sem externos", politicaSemDado: "avisar", proximaExecucao: Date.now() + 300000 });
      const { data: copia } = await duplicarAgente(d, { agenteId: b.agente.id, rotinasPausadas: true });
      expect(copia.rotinasPausadasNaCopia).toBe(1);
      expect(await d.repos.rotinas.listarDoAgente(copia.agente.id)).toMatchObject([{ estado: "pausada" }]);
      expect((await d.repos.mensagens.listarDaConversa(copia.conversa.id)).some((m) => /^Rotina ativa/.test(m.texto))).toBe(false);
      // Regressão: sem a opção (a caixa da dona), a rotina segue ativa.
      const { data: daCaixa } = await duplicarAgente(d, { agenteId: b.agente.id });
      expect(daCaixa.rotinasPausadasNaCopia).toBe(0);
      expect(await d.repos.rotinas.listarDoAgente(daCaixa.agente.id)).toMatchObject([{ estado: "ativa" }]);
    });
  });

  it("duplicar põe a cópia na seção do original, logo abaixo dele (0041)", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const secao = `Devs ${Math.random().toString(36).slice(2, 8)}`;
      const ids: string[] = [];
      for (const nome of ["Dev 1", "Dev 2", "Dev 3"]) ids.push((await criarAgente(d, { dono: "pessoa", nome })).data.agente.id);
      for (const id of ids) await gerirAgente(d, { agenteId: id, acao: "organizar", secao });
      await gerirAgente(d, { agenteId: ids[0]!, acao: "organizar", ordem: ids });

      const { data } = await duplicarAgente(d, { agenteId: ids[1]! });

      expect(data.agente).toMatchObject({ secao, fixado: false, posicao: 2 });
      const naSecao = (await listarFrota(d, {})).data.agentes.filter((x) => x.secao === secao);
      expect(naSecao.map((x) => x.nome)).toEqual(["Dev 1", "Dev 2", "Dev 2 (cópia)", "Dev 3"]);
    });
  });

  it("soltar um bot arrastado fixa e grava a ordem do grupo num pedido só; id de outra pessoa não muda nada (0041)", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const [a, b, c] = [(await criarAgente(d, { dono: "pessoa", nome: "Primeiro" })).data, (await criarAgente(d, { dono: "pessoa", nome: "Segundo" })).data, (await criarAgente(d, { dono: "pessoa", nome: "Terceiro" })).data];
      await fixarAgente(d, { agenteId: a.agente.id, fixado: true });
      await fixarAgente(d, { agenteId: b.agente.id, fixado: true });
      await vincularEscopo(tx, ANA);
      const daAna = (await criarAgente(depsSobreTrx(tx, ANA), { dono: "pessoa", nome: "Da Ana" })).data;
      await vincularEscopo(tx, MARLON);
      // O Terceiro é solto no começo da grade, antes dos dois que já estavam lá.
      const { data } = await gerirAgente(d, { agenteId: c.agente.id, acao: "organizar", fixado: true, ordem: [c.agente.id, a.agente.id, daAna.agente.id, b.agente.id] });
      expect(data.agente).toMatchObject({ fixado: true, posicao: 0 });
      const fixados = (await listarFrota(d, {})).data.agentes.filter((x) => x.fixado && [a, b, c].some((y) => y.agente.id === x.id));
      expect(fixados.map((x) => x.nome)).toEqual(["Terceiro", "Primeiro", "Segundo"]);
      await vincularEscopo(tx, ANA);
      expect((await depsSobreTrx(tx, ANA).repos.agentes.buscar(daAna.agente.id))?.posicao).toBeNull();
      await vincularEscopo(tx, MARLON);
      // Desafixar para uma seção: sai da grade e entra na seção, na ordem mandada.
      await gerirAgente(d, { agenteId: a.agente.id, acao: "organizar", fixado: false, secao: "Devs", ordem: [a.agente.id] });
      expect(await d.repos.agentes.buscar(a.agente.id)).toMatchObject({ fixado: false, secao: "Devs", posicao: 0 });
      await esperarErro(() => gerirAgente(d, { agenteId: a.agente.id, acao: "organizar", ordem: [b.agente.id] }), "entrada_invalida");
      await esperarErro(() => gerirAgente(d, { agenteId: a.agente.id, acao: "organizar", ordem: [a.agente.id, a.agente.id] }), "entrada_invalida");
      await esperarErro(() => gerirAgente(d, { agenteId: a.agente.id, acao: "organizar", fixado: "sim" as never }), "entrada_invalida");
      await gerirAgente(d, { agenteId: b.agente.id, acao: "excluir" });
      await esperarErro(() => gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", fixado: true }), "estado_invalido");
    });
  });

  it("agente de equipe não pode ser organizado, excluído ou restaurado por outra pessoa", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "empresa", nome: "Equipe" });
      await vincularEscopo(tx, ANA);
      const outra = depsSobreTrx(tx, ANA);
      for (const acao of ["organizar", "excluir", "restaurar"] as const) await esperarErro(() => gerirAgente(outra, { agenteId: b.agente.id, acao, secao: "Minha" }), "nao_permitido");
      expect(await outra.repos.agentes.excluir(b.agente.id, Date.now())).toBeNull();
      await vincularEscopo(tx, MARLON);
      expect((await d.repos.agentes.buscar(b.agente.id))?.excluidoEm).toBeNull();
    });
  });
  it("restaurar não revive a fila nem a agenda antiga de outra pessoa em um agente de equipe", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "empresa", nome: "Compartilhado" });
      await vincularEscopo(tx, ANA);
      const outra = depsSobreTrx(tx, ANA);
      const conversa = await outra.repos.conversas.criar({ tipo: "propria", agenteId: b.agente.id });
      const r = await outra.repos.rotinas.criar({ agenteId: b.agente.id, conversaId: conversa!.id, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "UAT", fonte: "teste", entregavel: "chat", limitesAprovacao: "sem externos", politicaSemDado: "avisar", proximaExecucao: Date.now() - 1000 });
      const { data: enviado } = await enviarMensagem(outra, { conversaId: conversa!.id, texto: "Não deve voltar", inventario: { estado: "pronto", versao: "t", em: 0 } });
      await vincularEscopo(tx, MARLON);
      await gerirAgente(d, { agenteId: b.agente.id, acao: "excluir" });
      await gerirAgente(d, { agenteId: b.agente.id, acao: "restaurar" });
      await vincularEscopo(tx, ANA);
      expect(await outra.repos.agentes.execucaoBloqueada(enviado.turno.id)).toBe(true);
      expect((await outra.repos.rotinas.buscar(r!.id))?.estado).toBe("pausada");
      expect((await outra.repos.rotinas.ativasVencidas(Date.now())).some((x) => x.id === r!.id)).toBe(false);
      await outra.repos.rotinas.atualizarEstado(r!.id, "ativa");
      expect((await outra.repos.rotinas.buscar(r!.id))?.estado).toBe("ativa");
    });
  });

});
