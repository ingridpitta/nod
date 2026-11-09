import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno, modoDoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { abrirTurno } from "../../src/use-cases/quadro.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { pessoaDeTeste } from "../helpers/pessoa-de-teste.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
/** NOD-443: quem participa do quadro da dona (Marlon) e pede ao bot dela. */
const PARTICIPANTE = pessoaDeTeste("Ana Participa Plano 443");

const CATALOGO = [
  { nome: "listar_contatos", descricao: "lista", schema: { type: "object" as const }, readOnlyHint: true },
  { nome: "enviar_email", descricao: "envia", schema: { type: "object" as const }, readOnlyHint: false },
];

describeIntegracao("emitirPlanoTurno (ADR-024): interseção, profundidade e token", () => {
  beforeAll(async () => {
    await PARTICIPANTE.criar();
  });

  it("diretório só anuncia colegas confirmados e visíveis da mesma dona", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Origem" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const colega = await agenteComConversa(trx, MARLON, { nome: "EspecialistaVisivel" });
      await repos.agentes.atualizarPerfil(colega.agenteId, { confirmado: true, descricao: "Revisa lançamentos" });
      const oculto = await agenteComConversa(trx, MARLON, { nome: "ColegaOculto" });
      await repos.agentes.atualizarPerfil(oculto.agenteId, { confirmado: true });
      await repos.agentes.ocultar(oculto.agenteId, true);
      await agenteComConversa(trx, MARLON, { nome: "RascunhoSemPerfil" });
      const agora = () => Date.now();
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora() + 60_000, profundidade: 0, entradaTexto: "Quem pode ajudar?", entradaConfianca: "confiavel", modelo: "haiku" });
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const { data } = await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID() });
      expect(data.promptSistema).toContain("EspecialistaVisivel");
      expect(data.promptSistema).toContain("Revisa lançamentos");
      expect(data.promptSistema).not.toContain("ColegaOculto");
      expect(data.promptSistema).not.toContain("RascunhoSemPerfil");
    });
  });
  it("catálogo = nod do modo + (conector habilitado ∩ concessão do agente); token autoriza uma vez e falha após revogar; plano guardado junto do token; evento turno_despachado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const conector = await repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(conector?.id ?? "", { ok: true, catalogo: CATALOGO, agora: Date.now() });
      const outro = await repos.conectores.criar({ nome: "Desligado", slug: "desligado", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: conector?.id ?? "", capacidade: "listar_contatos", mensagemId: consentimento?.id ?? "" });
      await repos.concessoes.conceder({ agenteId, conectorId: outro?.id ?? "", capacidade: "qualquer", mensagemId: consentimento?.id ?? "" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "revisa PRs" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });

      const agora = () => Date.now();
      const tokens = criarTokenTurno({ agora });
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens }), agora, trx });
      const maquina = randomUUID();
      const r = await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: maquina });
      const nomes = r.data.catalogo.ferramentas.map((f) => f.nome);
      expect(nomes).toContain("exemplo__listar_contatos");
      expect(nomes).not.toContain("exemplo__enviar_email");
      expect(nomes.some((n) => n.startsWith("desligado__"))).toBe(false);
      expect(nomes).toContain("pedir_a_bot");
      expect(nomes).toContain("pedir_aprovacao");
      expect(r.data.catalogo.servidores).toEqual([{ conectorId: conector?.id, nome: "exemplo", trust: "untrusted", transporte: "stdio" }]);
      expect(r.data).toMatchObject({ turnoId: turno?.id, agenteId, conversaId, machineId: maquina, executor: "catcher", superficie: "maquina_da_pessoa", localidade: "local" });
      expect(r.data.autoria.machine_id).toBe(maquina);
      expect(r.data.promptSistema).toContain("revisa PRs");
      // ADR-066: a política de execução é só prazo e orçamento — saíram o gate da rotina e a trava herdada.
      expect(Object.keys(r.data.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
      expect(r.data.expiraEm).toBeGreaterThan(agora());

      // Token: autoriza com a identidade do turno; o plano vive junto dele; revogar derruba os dois.
      expect(tokens.autorizar(r.data.tokenDeTurno)).toEqual({ turnoId: turno?.id, tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, agenteId });
      expect(tokens.planoDe(turno?.id ?? "")).toEqual(r.data);
      tokens.revogar(turno?.id ?? "");
      expect(tokens.autorizar(r.data.tokenDeTurno)).toBeNull();
      expect(tokens.planoDe(turno?.id ?? "")).toBeNull();

      expect(r.events?.map((e) => e.kind)).toEqual(["turno_despachado"]);
      expect(r.events?.[0]?.autoria.decidido_por).toBe("regra:montagem-ferramentas");
      // NOD-348: o despacho diz o bot do turno (a fala viva da sala, mesmo sem o turno_criado antes).
      expect(r.events?.[0]?.dados).toMatchObject({ agente_id: agenteId });
      const gravado = await repos.events.gravarComOutbox(r.events ?? []);
      expect(gravado.ids).toHaveLength(1);
    });
  });

  it("NOD-443 (revisão 5 do PR #628, achado 1): o turno a pedido de outra pessoa não leva o histórico da dona nem o conector dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const conector = await repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(conector?.id ?? "", { ok: true, catalogo: CATALOGO, agora: Date.now() });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "SEGREDO-NA-CONVERSA", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: conector?.id ?? "", capacidade: "listar_contatos", mensagemId: consentimento?.id ?? "" });
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const turnoCom = async (sobProcuracaoDe?: string) => {
        const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "o que tem aí?", entradaConfianca: "confiavel", modelo: "m", ...(sobProcuracaoDe ? { sobProcuracaoDe } : {}) });
        return (await emitirPlanoTurno(deps, { turnoId: t?.id ?? "", machineId: randomUUID(), executor: "catcher" })).data;
      };
      // A referência: o turno da dona leva o histórico e a leitura do conector.
      const daDona = await turnoCom();
      expect(daDona.promptSistema).toContain("SEGREDO-NA-CONVERSA");
      expect(daDona.catalogo.ferramentas.map((f) => f.nome)).toContain("exemplo__listar_contatos");
      const deOutra = await turnoCom(randomUUID());
      expect(deOutra.promptSistema).not.toContain("SEGREDO-NA-CONVERSA");
      expect(deOutra.promptSistema).toContain('"historico":[]');
      expect(deOutra.catalogo.ferramentas.filter((f) => f.origem === "conector")).toEqual([]);
      expect(deOutra.catalogo.servidores).toEqual([]);
    });
  });

  it("NOD-443 (revisão 6 do PR #628, achados 1, 2 e 4): o turno a pedido de quem participa não tem o Sobre mim, os colegas, as rotinas nem os artefatos da dona", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const colega = await agenteComConversa(trx, MARLON, { nome: "ColegaDaDona" });
      await repos.agentes.atualizarPerfil(colega.agenteId, { confirmado: true, descricao: "DESCRICAO-DO-COLEGA" });
      await repos.perfil.atualizar({ sobreMim: "SOBRE-MIM-DA-DONA" });
      await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "ROTINA-DA-DONA", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 3_600_000 });
      await repos.preferencias.gravar({ experimentos: { quadro: true } });
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const turnoCom = async (sobProcuracaoDe?: string) => {
        const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "o que tem aí?", entradaConfianca: "confiavel", modelo: "m", ...(sobProcuracaoDe ? { sobProcuracaoDe } : {}) });
        return (await emitirPlanoTurno(deps, { turnoId: t?.id ?? "", machineId: randomUUID(), executor: "catcher" })).data;
      };
      const DA_DONA = ["SOBRE-MIM-DA-DONA", "ColegaDaDona", "DESCRICAO-DO-COLEGA", "ROTINA-DA-DONA"];
      // A referência: o turno da dona leva tudo isto.
      const daDona = await turnoCom();
      for (const s of DA_DONA) expect(daDona.promptSistema, s).toContain(s);
      expect(daDona.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["ver_colegas", "ler_artefato", "listar_rotinas"]));
      const deOutra = await turnoCom(randomUUID());
      for (const s of [...DA_DONA, "Diretório de colegas", "Inventário de rotinas"]) expect(deOutra.promptSistema, s).not.toContain(s);
      const nomes = deOutra.catalogo.ferramentas.map((f) => f.nome);
      for (const f of ["ver_colegas", "ler_artefato", "listar_rotinas", "pedir_a_bot", "lembrar"]) expect(nomes, f).not.toContain(f);
      expect(nomes).toContain("gerir_quadro");
    });
  });

  it("NOD-443 (revisão 7 do PR #628, achado 1): o turno que o quadro abre a pedido de quem participa (abrirTurno, delegação) não leva as frentes e tasks da dona, nem Sobre mim, colegas e rotinas", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const colega = await agenteComConversa(trx, MARLON, { nome: "ColegaDaDona" });
      await repos.agentes.atualizarPerfil(colega.agenteId, { confirmado: true, descricao: "DESCRICAO-DO-COLEGA" });
      await repos.perfil.atualizar({ sobreMim: "SOBRE-MIM-DA-DONA" });
      await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "ROTINA-DA-DONA", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 3_600_000 });
      await repos.trabalhos.criar({ agenteId, conversaId, titulo: "FRENTE-DA-DONA", origem: "pessoa", forma: "frente" });
      await repos.preferencias.gravar({ experimentos: { quadro: true } });
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const agente = (await repos.agentes.buscar(agenteId))!;
      // O caminho real: o lote do quadro abre o turno do bot responsável (origem "delegacao", sem trabalho).
      const abrir = async (pedidoPor?: string) => {
        const aberto = await abrirTurno(deps, { autor: { tipo: "pessoa" }, ops: [], executor: "catcher", ...(pedidoPor ? { pedidoPor } : {}) }, agente, "faça a tarefa do quadro", false);
        const turno = await repos.turnos.buscar(aberto!.turnoId);
        expect(turno).toMatchObject({ origem: "delegacao", trabalhoId: null, sobProcuracaoDe: pedidoPor ?? PESSOA_MARLON });
        return (await emitirPlanoTurno(deps, { turnoId: aberto!.turnoId, machineId: randomUUID(), executor: "catcher" })).data;
      };
      const DA_DONA = ["FRENTE-DA-DONA", "Trabalhos em andamento", "SOBRE-MIM-DA-DONA", "ColegaDaDona", "DESCRICAO-DO-COLEGA"];
      // A referência: o turno que a própria dona abre pelo quadro leva as frentes dela, o Sobre mim e os colegas (o
      // inventário de rotinas não entra na delegação; a ausência dele no turno da participante é conferida abaixo).
      const daDona = await abrir();
      expect(daDona.modoTurno).toBe("delegacao");
      for (const s of DA_DONA) expect(daDona.promptSistema, s).toContain(s);
      const deOutra = await abrir(PARTICIPANTE.id);
      expect(deOutra.modoTurno).toBe("delegacao");
      expect(deOutra.autoria).toMatchObject({ sob_procuracao_de: PARTICIPANTE.id });
      for (const s of [...DA_DONA, "ROTINA-DA-DONA", "Diretório de colegas", "Inventário de rotinas"]) expect(deOutra.promptSistema, s).not.toContain(s);
    });
  });

  it("rotina e colega recebem sessão nova; conversa mantém sua sessão interativa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const sessao = randomUUID();
      await repos.conversas.atualizarSessaoCli(conversaId, sessao, "catcher");
      for (const origem of ["conversa", "rotina", "peer"] as const) {
        const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem, prazoEm: agora() + 600_000, profundidade: origem === "peer" ? 1 : 0, entradaTexto: "verificar", entradaConfianca: "confiavel", modelo: "m" });
        const plano = (await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: "m", executor: "catcher" })).data;
        expect(plano.entrada.sessaoCli).toBe(origem === "conversa" ? sessao : null);
      }
    });
  });

  it("turno peer legado: sem pedir_a_bot nem encaminhar (E12.4, ADR-058) e sem nativas; ADR-066: a rotina, com ou sem janela, não tem gate, ganha ver_colegas e, no Claude Code, o kit do terminal", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const peer = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "peer", prazoEm: agora() + 600_000, profundidade: 1, entradaTexto: "pergunta", entradaConfianca: "nao_confiavel", modelo: "m" });
      const planoPeer = (await emitirPlanoTurno(deps, { turnoId: peer?.id ?? "", machineId: "m" })).data;
      const nomesPeer = planoPeer.catalogo.ferramentas.map((f) => f.nome);
      expect(nomesPeer).not.toContain("pedir_a_bot");
      expect(nomesPeer).not.toContain("encaminhar");
      expect(nomesPeer).toContain("lembrar");
      expect(planoPeer.profundidade).toBe(1);
      expect(planoPeer.confiancaEntrada).toBe("nao_confiavel");

      const rotina = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "rotina", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "rotina", entradaConfianca: "confiavel", modelo: "m" });
      const planoRotina = (await emitirPlanoTurno(deps, { turnoId: rotina?.id ?? "", machineId: "m" })).data;
      // ADR-066: antes, rotina sem janela identificável ligava o gate (fail-closed). Agora não há gate a ligar.
      expect(Object.keys(planoRotina.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
      // ADR-044: pedir_acesso entra na rotina. ADR-051: publicar/ler artefato também.
      // ADR-066: ver_colegas também (leitura que não incomoda ninguém). NOD-114: a rotina pode avisar a pessoa.
      expect(planoRotina.catalogo.ferramentas.map((f) => f.nome).filter((n) => !n.includes("__"))).toEqual(["lembrar", "pedir_aprovacao", "pedir_acesso", "ver_colegas", "pedir_a_pessoa", "pedir_a_bot", "sem_novidade", "publicar_artefato", "ler_artefato", "abrir_frentes", "mandar_para_frente", "me_chame_as", "avisar_pessoa", "buscar_conversas", "ler_conversa", "ler_mais"]);

      // A ligação turno → rotina é a JANELA reivindicada (rotinaJanelas.buscarPorTurno, 0004). Com ou sem ela — e com
      // exige_aprovacao false ou true —, a política é a mesma: quem decide quando parar é o modo do bot.
      const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", exigeAprovacao: false, proximaExecucao: agora() + 1000 });
      const instante = agora();
      await repos.rotinaJanelas.reivindicar({ rotinaId: r?.id ?? "", instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" });
      await repos.rotinaJanelas.vincularTurno({ rotinaId: r?.id ?? "", instanteAgendado: instante, turnoId: rotina?.id ?? "" });
      const comJanela = (await emitirPlanoTurno(deps, { turnoId: rotina?.id ?? "", machineId: "m" })).data;
      expect(Object.keys(comJanela.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
      expect(comJanela.modoTurno).toBe("rotina");

      // ADR-066: com o Claude Code e o hook do nod (executor local), o kit do terminal vale na rotina; o peer legado fica sem.
      await repos.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: agora() });
      expect((await emitirPlanoTurno(deps, { turnoId: rotina?.id ?? "", machineId: "m", executor: "local" })).data.nativas).toEqual([...NATIVAS_DO_TERMINAL]);
      expect((await emitirPlanoTurno(deps, { turnoId: peer?.id ?? "", machineId: "m", executor: "local" })).data.nativas ?? []).toEqual([]);

      await expect(emitirPlanoTurno(deps, { turnoId: "00000000-0000-4000-8000-000000000000", machineId: "m" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("modoDoTurno: criação enquanto o agente não foi confirmado; sala pela conversa; executor local recusado sem inventário pronto", async () => {
    // ADR-044: retomada ligada a uma rotina continua rotina; sem ligação, é conversa.
    expect(modoDoTurno({ origem: "retomada", profundidade: 0 }, { tipo: "propria" }, { confirmado: true }, true)).toBe("rotina");
    expect(modoDoTurno({ origem: "retomada", profundidade: 0 }, { tipo: "propria" }, { confirmado: true })).toBe("conversa");
    expect(modoDoTurno({ origem: "conversa", profundidade: 0 }, { tipo: "propria" }, { confirmado: false })).toBe("criacao");
    expect(modoDoTurno({ origem: "conversa", profundidade: 0 }, { tipo: "propria" }, { confirmado: true })).toBe("conversa");
    expect(modoDoTurno({ origem: "sala", profundidade: 0 }, { tipo: "sala" }, { confirmado: true })).toBe("sala");
    // ADR-058/062: a profundidade só corta o salto (no limite); o modo vem da origem (peer é o turno legado de perguntar_a_bot).
    expect(modoDoTurno({ origem: "conversa", profundidade: 1 }, null, { confirmado: true })).toBe("conversa");
    expect(modoDoTurno({ origem: "peer", profundidade: 1 }, null, { confirmado: true })).toBe("peer");
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      await expect(emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: "m", executor: "local" })).rejects.toMatchObject({ codigo: "executor_indisponivel" });
      await repos.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: agora() });
      const local = (await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: "m" })).data;
      expect(local.executor).toBe("local");
    });
  });
});
