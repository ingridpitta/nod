import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { CAPACIDADES_HARNESS } from "../../src/contracts/harness.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import { disponibilidadeLigacao, ligar, type ContextoLigacao } from "../../src/use-cases/ligacoes.ts";
import { MODELOS_LIGACAO_PADRAO } from "../../src/contracts/modelos.ts";
import { lerModelosLigacao } from "../../src/domain/modelo-ligacao.ts";
import { USO_FORA_DO_CLAUDE } from "../../src/domain/comandos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
describeIntegracao("harness por agente", () => {
  it("persiste, duplica, congela preferência da tarefa e mantém histórico sem reutilizar sessão de outro harness", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId, harness: "codex-cli", modelo: "gpt-6-astra" });
      expect(await repos.agentes.buscar(agenteId)).toMatchObject({ harness: "codex-cli", modelo: "gpt-6-astra" });
      const copia = await duplicarAgente(deps, { agenteId });
      expect(copia.data.agente).toMatchObject({ harness: "codex-cli", modelo: "gpt-6-astra" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", agenteId, conversaId, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "gpt-6-astra", harness: "codex-cli" });
      await editarPerfil(deps, { agenteId, harness: "claude-cli", modelo: "haiku" });
      await repos.conversas.atualizarSessaoCli(conversaId, randomUUID(), "local");
      const plano = (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses: { "codex-cli": pronto, "claude-cli": pronto } })).data;
      expect(plano.harness).toBe("codex-cli"); expect(plano.entrada.modelo).toBe("gpt-6-astra"); expect(plano.entrada.sessaoCli).toBeNull();
      expect(plano.catalogo.ferramentas.some((f) => f.nome === "atualizar_perfil")).toBe(true);
      await expect(emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).rejects.toThrow("executor_indisponivel");
    });
  });
  // ADR-103: o terminal do Codex só vai a quem consegue; o app ou o motor de antes roda o Codex isolado.
  it("o Codex leva o kit do terminal só para a máquina que anunciou o terminal dele; sem anúncio (processo local), vale o driver", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId, harness: "codex-cli", modelo: "auto" });
      const plano = async (capacidadesDaMaquina?: Parameters<typeof emitirPlanoTurno>[1]["capacidadesDaMaquina"]) => {
        const turno = await repos.turnos.enfileirar({ executor: "catcher", agenteId, conversaId, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: "auto", harness: "codex-cli" });
        return (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses: { "codex-cli": pronto }, ...(capacidadesDaMaquina ? { capacidadesDaMaquina } : {}) })).data;
      };
      const comTerminal = await plano({ "codex-cli": { ...CAPACIDADES_HARNESS["codex-cli"], terminal: true } });
      expect(comTerminal.nativas).toEqual(expect.arrayContaining(["Bash", "apply_patch", "web_search"]));
      expect(comTerminal.pastaDoBot).toBeTruthy();
      expect(comTerminal.promptSistema).toContain("Você tem o terminal e os arquivos do Codex");
      // App de antes: anunciou o Codex sem terminal, ou não anunciou capacidade nenhuma.
      for (const anuncio of [{ "codex-cli": { ...CAPACIDADES_HARNESS["codex-cli"], terminal: false } }, {}]) {
        const antigo = await plano(anuncio);
        expect(antigo.nativas ?? []).not.toContain("Bash");
        expect(antigo.promptSistema).not.toContain("terminal e os arquivos do Codex");
      }
      expect((await plano()).nativas).toContain("Bash");
      // NOD-323 (revisão 3 do #507): anexar_midia só para a máquina que anunciou o proxy novo; "não sei" segue com ela.
      const comMidia = (p: Awaited<ReturnType<typeof plano>>) => p.catalogo.ferramentas.some((f) => f.nome === "anexar_midia");
      expect(comMidia(comTerminal)).toBe(true);
      const semProxyNovo = await plano({ "codex-cli": { ...CAPACIDADES_HARNESS["codex-cli"], terminal: true, anexarMidia: false } });
      expect(comMidia(semProxyNovo)).toBe(false);
      expect(semProxyNovo.promptSistema).not.toContain("anexar_midia");
      expect(comMidia(await plano())).toBe(true);
    });
  });

  it("/uso só vira /cost quando a IA escolhida para o turno é o Claude Code; no automático com só o Codex pronto, não (NOD-179)", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const entrada = async (harness: "auto" | "codex-cli" | "claude-cli", harnesses: Parameters<typeof emitirPlanoTurno>[1]["harnesses"]) => {
        const turno = await repos.turnos.enfileirar({ executor: "catcher", agenteId, conversaId, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "/uso", entradaConfianca: "confiavel", modelo: "auto", harness });
        const plano = (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses })).data;
        return { harness: plano.harness, texto: plano.entrada.texto };
      };
      expect(await entrada("claude-cli", { "claude-cli": pronto, "codex-cli": pronto })).toEqual({ harness: "claude-cli", texto: "/cost" });
      const codex = await entrada("codex-cli", { "claude-cli": pronto, "codex-cli": pronto });
      expect(codex.harness).toBe("codex-cli");
      expect(codex.texto).not.toContain("/cost");
      expect(codex.texto).toContain(USO_FORA_DO_CLAUDE);
      // O automático escolhe o Codex quando é a única IA pronta: o /uso segue a escolha, não o perfil.
      const auto = await entrada("auto", { "codex-cli": pronto });
      expect(auto.harness).toBe("codex-cli");
      expect(auto.texto).not.toContain("/cost");
    });
  });

  it("automático funciona só com Codex disponível e não exige inventário do Claude", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", agenteId, conversaId, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
      const p = (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses: { "codex-cli": pronto } })).data;
      expect(p).toMatchObject({ harness: "codex-cli", entrada: { modelo: "gpt-5.6-sol" } });
    });
  });
  it("a guia do onboarding no automático roda no mais potente do harness no chat, e na ligação no modelo de voz (NOD-164); outro bot e modelo escolhido não mudam", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const outro = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId, harness: "auto", modelo: "auto" });
      await editarPerfil(deps, { agenteId: outro.agenteId, harness: "auto", modelo: "auto" });
      await repos.onboarding.definirGuia(agenteId);
      const plano = async (id: string, modelo: string, harnesses: Parameters<typeof emitirPlanoTurno>[1]["harnesses"]) => {
        const conversa = id === agenteId ? conversaId : outro.conversaId;
        const turno = await repos.turnos.enfileirar({ executor: "catcher", agenteId: id, conversaId: conversa, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo, harness: "auto" });
        return (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      };
      expect((await plano(agenteId, "auto", { "claude-cli": pronto })).entrada.modelo).toBe("fable");
      expect((await plano(agenteId, "auto", { "codex-cli": pronto })).entrada.modelo).toBe("gpt-6-astra");
      expect((await plano(agenteId, "haiku", { "claude-cli": pronto })).entrada.modelo).toBe("haiku");
      // revisto em 2026-10-10 (emenda da ADR-036): o Recomendado do Claude é o Opus.
      expect((await plano(outro.agenteId, "auto", { "claude-cli": pronto })).entrada.modelo).toBe("opus");

      const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };
      const { turno } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      const naLigacao = (await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
      expect(naLigacao.ligacaoVoz?.modelo).toBe(MODELOS_LIGACAO_PADRAO["claude-cli"].modelo);
      expect(naLigacao.entrada.modelo).toBe("fable");
    });
  });
});

describeIntegracao("modelo da ligação resolvido no servidor (NOD-164)", () => {
  const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };
  it("sem config vale o padrão; com config vale a configurada; a guia, explícita ou no auto, recebe a config", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, escopo);
      const guia = await agenteComConversa(trx, escopo);
      const codex = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId: codex.agenteId, harness: "codex-cli", modelo: "auto" });
      await repos.onboarding.definirGuia(guia.agenteId);
      const configurada = lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: "claude-sonnet-5-5 esforco=low", NOD_MODELO_LIGACAO_CODEX: "gpt-6-astra" });
      // "produto" dispensa o consentimento de voz (ADR-077); o modelo não depende de quem iniciou.
      const voz = async (id: string, modelosLigacao?: typeof configurada) => {
        const { turno, ligacao } = (await ligar(deps, { agenteId: id, contexto, executor: "local", iniciadaPor: "produto" })).data;
        const plano = (await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto }, ...(modelosLigacao ? { modelosLigacao } : {}) })).data;
        await repos.ligacoes.encerrar(ligacao.id, { motivo: "pessoa_desligou", agora: agora() });
        return plano.ligacaoVoz;
      };

      const padrao = MODELOS_LIGACAO_PADRAO["claude-cli"];
      expect(await voz(agenteId)).toEqual(expect.objectContaining({ modelo: padrao.modelo, esforco: padrao.esforco, pensamentoAdaptativo: false }));
      expect((await voz(agenteId, lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: "claude-sonnet-4-6" })))?.esforco).toBeUndefined();
      expect(await voz(agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "claude-sonnet-5-5", esforco: "low", pensamentoAdaptativo: false }));
      expect(await voz(codex.agenteId)).toEqual(expect.objectContaining({ modelo: "gpt-5.6-luna" }));
      expect(await voz(codex.agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "gpt-6-astra" }));
      expect((await voz(codex.agenteId, configurada))?.pensamentoAdaptativo).toBeUndefined();

      // A guia recebe a config, com modelo explícito ou no "auto" (decisão de 2026-10-05: o mesmo modelo de voz das outras).
      await editarPerfil(deps, { agenteId: guia.agenteId, harness: "claude-cli", modelo: "sonnet" });
      expect(await voz(guia.agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "claude-sonnet-5-5", esforco: "low" }));
      await editarPerfil(deps, { agenteId: guia.agenteId, harness: "auto", modelo: "auto" });
      expect(await voz(guia.agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "claude-sonnet-5-5", esforco: "low", pensamentoAdaptativo: false }));
      expect(await voz(guia.agenteId)).toEqual(expect.objectContaining({ modelo: padrao.modelo, esforco: padrao.esforco, pensamentoAdaptativo: false }));
    });
  });
});

describeIntegracao("roteamento por capacidade do computador", () => {
it("fila não deixa um computador com Claude reivindicar um turno fixado no Codex", async () => {
  await withRollback(escopo, async (trx) => {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
    const turno = await repos.turnos.enfileirar({ executor: "catcher", agenteId, conversaId, origem: "conversa", prazoEm: Date.now() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "auto", harness: "codex-cli" });
    expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), harnessesProntos: ["claude-cli"] })).toBeNull();
    expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), harnessesProntos: ["codex-cli"] })).toMatchObject({ id: turno!.id, harness: "codex-cli" });
  });
});
it("NOD-171: com os prontos da pessoa, o computador com Claude reivindica o fixado no Codex só quando nenhuma máquina tem o Codex", async () => {
  await withRollback(escopo, async (trx) => {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
    const turno = await repos.turnos.enfileirar({ executor: "catcher", agenteId, conversaId, origem: "conversa", prazoEm: Date.now() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "auto", harness: "codex-cli" });
    expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), harnessesProntos: ["claude-cli"], harnessesProntosPessoa: ["claude-cli", "codex-cli"] })).toBeNull();
    expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), harnessesProntos: ["claude-cli"], harnessesProntosPessoa: ["claude-cli"] })).toMatchObject({ id: turno!.id });
  });
});

});

describeIntegracao("NOD-171: harness fixado e indisponível", () => {
  const codexAusente: Inventario = { estado: "ausente", motivo: "Harness não encontrado neste computador", em: Date.now() };
  type Harnesses = Partial<Record<"claude-cli" | "codex-cli", Inventario>>;
  /** Deps cujo `planos.emitir` é o de verdade (emitirPlanoTurno) sobre os harnesses dados; guarda os planos que saíram. */
  const montar = async (trx: Parameters<Parameters<typeof withRollback>[1]>[0], harnesses: Harnesses) => {
    const base = await agenteComConversa(trx, escopo);
    const agora = () => Date.now();
    const emitidos: string[] = [];
    const servicos = servicosDeTeste({ agora });
    const services: Services = { ...servicos, planos: { ...servicos.planos, emitir: async (_t, turnoId, machineId) => {
      emitidos.push(turnoId);
      return (await emitirPlanoTurno(deps, { turnoId, machineId, executor: "local", harnesses })).data;
    } } };
    const deps = depsSobre(base.repos, escopo, { agora, trx, services });
    return { ...base, deps, emitidos, agora };
  };
  const enfileirar = (b: Awaited<ReturnType<typeof montar>>, harness: "auto" | "codex-cli" | "claude-cli", modelo: string) =>
    b.repos.turnos.enfileirar({ executor: "catcher", agenteId: b.agenteId, conversaId: b.conversaId, origem: "conversa", prazoEm: b.agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo, harness });
  const puxar = (b: Awaited<ReturnType<typeof montar>>, extra: Partial<Parameters<typeof despacharTurno>[1]> = {}) =>
    despacharTurno(b.deps, { machineId: randomUUID(), executor: "local", inventario: pronto, ...extra });

  it("local: agente no Codex ausente com o Claude pronto termina interrompido com a negação do Codex, sem 'motor pronto'", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "claude-cli": pronto, "codex-cli": codexAusente });
      const turno = await enfileirar(b, "codex-cli", "auto");
      expect((await puxar(b)).data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      expect(await b.repos.turnos.buscar(turno!.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "motor_ausente" });
      const negacao = await b.repos.mensagens.ultimaDaConversa(b.conversaId);
      expect(negacao).toMatchObject({ kind: "negacao", payload: { nome: "codex-cli", ia: "codex-cli" } });
      expect(negacao?.texto).toContain("Codex não instalado: Harness não encontrado neste computador");
      expect(negacao?.texto).not.toContain("motor pronto");
      expect(negacao?.texto).not.toContain("claude-cli");
    });
  });

  it("app do Mac: máquina só com o Claude e nenhuma máquina da pessoa com o Codex — o turno não fica pendente e nenhum plano sai", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "claude-cli": pronto });
      const turno = await enfileirar(b, "codex-cli", "auto");
      // Sem os harnesses da pessoa (como antes da NOD-171), o turno fica pendente.
      expect((await puxar(b, { harnessesProntos: ["claude-cli"] })).data).toMatchObject({ plano: null, turno: null, motivo: "fila_vazia" });
      expect(await b.repos.turnos.buscar(turno!.id)).toMatchObject({ estado: "pendente" });
      // Sonda lenta é transitória (NOD-178): o turno espera a re-sonda em vez de ser recusado.
      const lento: Inventario = { ...codexAusente, causa: "sonda_lenta", motivo: "O Codex demorou a responder" };
      expect((await puxar(b, { harnessesProntos: ["claude-cli"], harnessesDaPessoa: { "claude-cli": pronto, "codex-cli": lento } })).data.motivo).toBe("fila_vazia");
      expect(await b.repos.turnos.buscar(turno!.id)).toMatchObject({ estado: "pendente" });
      // NOD-9: o nod atualizando o CLI também é transitório — o turno espera a atualização terminar.
      const atualizando: Inventario = { ...codexAusente, causa: "atualizando", motivo: "Atualizando o Codex… Os pedidos para ele esperam e rodam assim que terminar." };
      expect((await puxar(b, { harnessesProntos: ["claude-cli"], harnessesDaPessoa: { "claude-cli": pronto, "codex-cli": atualizando } })).data.motivo).toBe("fila_vazia");
      expect(await b.repos.turnos.buscar(turno!.id)).toMatchObject({ estado: "pendente" });
      const antigo: Inventario = { ...codexAusente, causa: "cli_antigo", versao: "0.158.0", minima: "0.159.0", motivo: "O Codex deste Mac (0.158.0) é mais antigo que o testado pelo nod. Atualize para a versão 0.159.0 ou mais nova." };
      const r = await puxar(b, { harnessesProntos: ["claude-cli"], harnessesDaPessoa: { "claude-cli": pronto, "codex-cli": antigo } });
      expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      expect(b.emitidos).toEqual([]);
      expect(await b.repos.turnos.buscar(turno!.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      expect((await b.repos.mensagens.ultimaDaConversa(b.conversaId))?.texto).toContain("Codex desatualizado: O Codex deste Mac (0.158.0)");
    });
  });

  it("app do Mac com duas máquinas: o turno do Codex espera pela máquina que tem o Codex pronto", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "claude-cli": pronto, "codex-cli": pronto });
      const turno = await enfileirar(b, "codex-cli", "auto");
      const harnessesDaPessoa = { "claude-cli": pronto, "codex-cli": pronto };
      expect((await puxar(b, { harnessesProntos: ["claude-cli"], harnessesDaPessoa })).data.motivo).toBe("fila_vazia");
      expect(await b.repos.turnos.buscar(turno!.id)).toMatchObject({ estado: "pendente" });
      expect((await puxar(b, { harnessesProntos: ["codex-cli"], harnessesDaPessoa })).data.plano).toMatchObject({ harness: "codex-cli" });
    });
  });

  it("modelo inválido vira recusa escrita e não volta para a fila; modelo antigo continua resolvendo", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "claude-cli": pronto, "codex-cli": pronto });
      const invalido = await enfileirar(b, "codex-cli", "sonnet");
      expect((await puxar(b)).data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      expect(await b.repos.turnos.buscar(invalido!.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      const recusa = await b.repos.mensagens.ultimaDaConversa(b.conversaId);
      expect(recusa?.texto).toContain("Codex: o modelo sonnet não é aceito");
      // A tela pede outro modelo (avisoModeloRecusado) em vez de dizer que a IA já voltou.
      expect(recusa?.payload).toMatchObject({ kind: "negacao", nome: "codex-cli", modelo: "sonnet" });
      expect(recusa?.texto).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      // Sem laço: o próximo puxar não acha o mesmo turno.
      expect((await puxar(b)).data.motivo).toBe("fila_vazia");
      const antigo = await enfileirar(b, "auto", "haiku");
      expect((await puxar(b)).data.plano).toMatchObject({ turnoId: antigo!.id, harness: "claude-cli", entrada: { modelo: "haiku" } });
    });
  });
});

describeIntegracao("NOD-213: bot 'auto' com modelo GPT roda no Codex", () => {
  type Harnesses = Partial<Record<"claude-cli" | "codex-cli", Inventario>>;
  const montar = async (trx: Parameters<Parameters<typeof withRollback>[1]>[0], harnesses: Harnesses) => {
    const base = await agenteComConversa(trx, escopo);
    const agora = () => Date.now();
    const servicos = servicosDeTeste({ agora });
    const services: Services = { ...servicos, planos: { ...servicos.planos, emitir: async (_t, turnoId, machineId) => (await emitirPlanoTurno(deps, { turnoId, machineId, executor: "local", harnesses })).data } };
    const deps = depsSobre(base.repos, escopo, { agora, trx, services });
    const turno = await base.repos.turnos.enfileirar({ executor: "catcher", agenteId: base.agenteId, conversaId: base.conversaId, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "gpt-5.6-sol", harness: "auto" });
    return { ...base, deps, turno: turno! };
  };
  const puxar = (b: Awaited<ReturnType<typeof montar>>, extra: Partial<Parameters<typeof despacharTurno>[1]> = {}) =>
    despacharTurno(b.deps, { machineId: randomUUID(), executor: "local", inventario: pronto, ...extra });

  it("com o Codex (falso) e o Claude prontos, o turno roda no Codex com o modelo GPT — antes era recusado como modelo do Claude", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "claude-cli": pronto, "codex-cli": pronto });
      expect((await puxar(b)).data.plano).toMatchObject({ turnoId: b.turno.id, harness: "codex-cli", entrada: { modelo: "gpt-5.6-sol" } });
    });
  });

  it("app do Mac: a fila manda o turno para a máquina com o Codex, não para a do Claude", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "claude-cli": pronto, "codex-cli": pronto });
      const harnessesDaPessoa = { "claude-cli": pronto, "codex-cli": pronto };
      expect((await puxar(b, { harnessesProntos: ["claude-cli"], harnessesDaPessoa })).data.motivo).toBe("fila_vazia");
      expect(await b.repos.turnos.buscar(b.turno.id)).toMatchObject({ estado: "pendente" });
      expect((await puxar(b, { harnessesProntos: ["codex-cli"], harnessesDaPessoa })).data.plano).toMatchObject({ harness: "codex-cli" });
    });
  });

  it("com o Codex fora e o Claude pronto, a negação nomeia o Codex (nunca o Claude, nunca modelo recusado)", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "claude-cli": pronto, "codex-cli": { estado: "nao_autenticado", motivo: "faça login", em: Date.now() } });
      expect((await puxar(b)).data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      const negacao = await b.repos.mensagens.ultimaDaConversa(b.conversaId);
      expect(negacao).toMatchObject({ kind: "negacao", payload: { nome: "codex-cli", ia: "codex-cli" } });
      expect(negacao?.payload).not.toHaveProperty("modelo");
      expect(negacao?.texto).toContain("Codex sem conta conectada");
    });
  });
});

describeIntegracao("Codex sem app-server: recusa própria do Ligar (NOD-167)", () => {
  const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };
  it("o Mac anunciou o Codex sem app-server: recusa em pt-BR antes de tocar; sem IA pronta continua sem_ia; desligado no servidor continua codex_em_breve", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId, harness: "codex-cli", modelo: "auto" });
      const semAppServer = { ...contexto, iaSemLacoDeVoz: true };
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: semAppServer })).data).toEqual({
        disponivel: false, motivo: "codex_sem_app_server", texto: "Atualize o Codex para ligar: a versão instalada no seu Mac não atende ligação. Por enquanto, converse por texto.", ouvir: false,
      });
      await expect(ligar(deps, { agenteId, contexto: semAppServer, executor: "local", iniciadaPor: "produto" })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "codex_sem_app_server" });
      expect(await repos.ligacoes.viva()).toBeNull();
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...semAppServer, iaPronta: false } })).data).toMatchObject({ motivo: "sem_ia" });
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...semAppServer, codexSemVoz: true } })).data).toMatchObject({ motivo: "codex_em_breve" });
    });
  });
});
