import { randomUUID } from "node:crypto";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { ativarRotina, servicoRotinas } from "../../src/use-cases/ativar-rotina.ts";
import { criarRotina } from "../../src/use-cases/criar-rotina.ts";
import { verAgendaPeloAgente } from "../../src/use-cases/ver-agenda.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente, listarRotinasDoAgente, pausarRotinaPeloAgente, reativarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { encaminhar } from "../../src/use-cases/encaminhar.ts";
import { semNovidade } from "../../src/use-cases/sem-novidade.ts";
import { passar } from "../../src/use-cases/passar.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { verColegas } from "../../src/use-cases/ver-colegas.ts";
import { servicoSala } from "../../src/use-cases/servico-sala.ts";
import type { Deps, Services, UseCasesNod } from "../../src/use-cases/tipos.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "./ids.ts";
import { criarBancoMemoria, type BancoMemoria } from "./repos-memoria.ts";
import { avisarPessoa } from "../../src/use-cases/avisar-pessoa.ts";
import { ajustarBarraLateral } from "../../src/use-cases/ajustar-barra-lateral.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { gerirApps } from "../../src/use-cases/gerir-apps.ts";
import { gerirTimes } from "../../src/use-cases/gerir-times.ts";
import { gerirMaquinas } from "../../src/use-cases/gerir-maquinas.ts";
import { gerirCanvas } from "../../src/use-cases/gerir-canvas.ts";
import { removerComputadorPeloChat } from "../../src/use-cases/remover-computador.ts";
import { gerirAcessos } from "../../src/use-cases/gerir-acessos.ts";
import { naoLidosNoChat } from "../../src/use-cases/nao-lidos-no-chat.ts";
import { buscarConversas, lerConversa } from "../../src/use-cases/buscar-conversas.ts";

/**
 * Deps de teste da L7 (arquivo extra da lane): Services e UseCasesNod FALSOS com o que os casos de
 * uso de rotinas/salas/bot-a-bot tocam — rotinas.ativar e sala.* ligados aos casos reais; o resto
 * (planos, conectores, tokenTurno, catcher, barramento) registra a chamada ou lança "não
 * implementado neste teste" (nunca um catch vazio). `chamadas` é o espião dos testes.
 */
export type Chamadas = { interrompidos: string[]; conectores: { conectorId: string; tool: string }[]; frames: FrameSse[] };

const naoImplementado = (nome: string) => async (): Promise<never> => {
  throw new Error(`${nome}: não implementado neste teste`);
};

export function servicesFalsos(depsSobre: (trx: Tx) => Deps, agora: () => number, chamadas: Chamadas, opcoes: { interromper?: (turnoId: string) => Promise<boolean> } = {}): Services {
  let seq = 0;
  return {
    relogio: agora,
    tokenTurno: {
      cunhar: (turnoId) => `token-${turnoId}`,
      autorizar: () => null,
      revogar: () => undefined,
    },
    planos: { emitir: naoImplementado("planos.emitir"), buscar: () => null },
    rotinas: servicoRotinas(depsSobre),
    conectores: {
      async chamar(conectorId, tool) {
        chamadas.conectores.push({ conectorId, tool });
        return { conteudo: "conector falso", isError: false };
      },
      sondar: naoImplementado("conectores.sondar"),
    },
    interruptor: {
      registrar: () => undefined,
      async interromper(turnoId) {
        chamadas.interrompidos.push(turnoId);
        return opcoes.interromper ? opcoes.interromper(turnoId) : true;
      },
    },
    catcher: { registrar: async () => undefined },
    sala: servicoSala(depsSobre),
    barramento: {
      publicar(pessoaId, tipo, dados) {
        const frame: FrameSse = { streamId: "teste", seq: ++seq, pessoaId, tipo, dados };
        chamadas.frames.push(frame);
        return frame;
      },
    },
  };
}

export function useCasesFalsos(): UseCasesNod {
  return {
    lembrar: naoImplementado("useCases.lembrar"),
    atualizarPerfil: naoImplementado("useCases.atualizarPerfil"),
    pedirAcesso: naoImplementado("useCases.pedirAcesso"),
    criarRotina,
    listarRotinasDoAgente,
    verAgendaPeloAgente,
    pausarRotinaPeloAgente,
    reativarRotinaPeloAgente,
    atualizarRotinaPeloAgente,
    excluirRotinaPeloAgente,
    pedirAprovacao: naoImplementado("useCases.pedirAprovacao"),
    pedirAPessoa: naoImplementado("useCases.pedirAPessoa"),
    passar,
    encaminhar,
    semNovidade,
    pedirABot,
    verColegas,
    publicarArtefato: naoImplementado("useCases.publicarArtefato"),
    lerArtefato: naoImplementado("useCases.lerArtefato"),
    iniciarTarefa: naoImplementado("useCases.iniciarTarefa"),
    desligar: naoImplementado("useCases.desligar"),
    anotarEntrevista: naoImplementado("useCases.anotarEntrevista"),
    concluirEntrevista: naoImplementado("useCases.concluirEntrevista"),
    proporBot: naoImplementado("useCases.proporBot"),
    abrirTask: naoImplementado("useCases.abrirTask"),
    mandarParaTask: naoImplementado("useCases.mandarParaTask"),
    meChameAs: naoImplementado("useCases.meChameAs"),
    abrirFrentes: naoImplementado("useCases.abrirFrentes"),
    mandarParaFrente: naoImplementado("useCases.mandarParaFrente"),
    devolverResumo: naoImplementado("useCases.devolverResumo"),
    esperarComando: naoImplementado("useCases.esperarComando"),
    criarBots: naoImplementado("useCases.criarBots"),
    responderPedido: naoImplementado("useCases.responderPedido"),
    pedirCredencial: naoImplementado("useCases.pedirCredencial"),
    avisarPessoa,
    ajustarBarraLateral,
    gerirQuadro,
    gerirApps,
    naoLidosNoChat,
    gerirTimes,
    gerirMaquinas,
    gerirCanvas,
    removerComputador: removerComputadorPeloChat,
    gerirAcessos,
    buscarConversas,
    lerConversa,
    abrirConta: naoImplementado("useCases.abrirConta"),
    gerirBots: naoImplementado("useCases.gerirBots"),
    verAppsConectados: naoImplementado("useCases.verAppsConectados"),
    registrarRelatoDoNod: naoImplementado("useCases.registrarRelatoDoNod"),
  };
}

export type OpcoesDeps = { escopo?: Escopo; agora?: () => number; fusoPadrao?: string; interromper?: (turnoId: string) => Promise<boolean> };

/** Deps sobre os repos EM MEMÓRIA (tests/unit): tx = `(fn) => fn({} as never)` (Práticas §1). */
export function depsMemoria(opcoes: OpcoesDeps = {}): { deps: Deps; banco: BancoMemoria; chamadas: Chamadas; comEscopo(escopo: Escopo): Deps } {
  const escopo = opcoes.escopo ?? { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
  const { banco, repos } = criarBancoMemoria();
  const agora = opcoes.agora ?? (() => Date.now());
  const chamadas: Chamadas = { interrompidos: [], conectores: [], frames: [] };
  const montar = (e: Escopo): Deps => {
    const deps: Deps = {
      repos: repos(e),
      services: servicesFalsos(() => deps, agora, chamadas, { interromper: opcoes.interromper }),
      useCases: useCasesFalsos(),
      tx: (fn) => fn({} as never),
      escopo: e,
      agora,
      fusoPadrao: opcoes.fusoPadrao,
    };
    return deps;
  };
  return { deps: montar(escopo), banco, chamadas, comEscopo: montar };
}

/** Deps sobre a transação REAL do withRollback (tests/integration): tx = `(fn) => fn(trx)`. */
export function depsSobre(trx: Tx, escopo: Escopo, opcoes: OpcoesDeps = {}): { deps: Deps; repos: Repos; chamadas: Chamadas } {
  const agora = opcoes.agora ?? (() => Date.now());
  const chamadas: Chamadas = { interrompidos: [], conectores: [], frames: [] };
  const repos = criarRepos(trx, escopo);
  const deps: Deps = {
    repos,
    services: servicesFalsos((t) => ({ ...deps, repos: criarRepos(t, escopo) }), agora, chamadas, { interromper: opcoes.interromper }),
    useCases: useCasesFalsos(),
    tx: (fn) => fn(trx),
    escopo,
    agora,
    fusoPadrao: opcoes.fusoPadrao,
  };
  return { deps, repos, chamadas };
}

export { ativarRotina };

/** Entrada mínima válida de rotina para os testes (dias úteis às 08:00 em São Paulo). */
export function rotinaValida(extra: Partial<Record<"cron" | "fuso_iana" | "instrucao" | "fonte" | "entregavel" | "limites_aprovacao" | "politica_sem_dado", string>> = {}) {
  return {
    cron: "0 8 * * 1-5",
    fuso_iana: "America/Sao_Paulo",
    instrucao: "poste aqui um resumo dos PRs abertos",
    fonte: "PRs abertos do time nod",
    entregavel: "resumo em tópicos",
    limites_aprovacao: "nada sai para fora sem aprovação",
    politica_sem_dado: "diga que não houve",
    ...extra,
  };
}

export function contexto(agenteId: string, conversaId: string, turnoId: string = randomUUID()) {
  return { turnoId, agenteId, conversaId };
}
