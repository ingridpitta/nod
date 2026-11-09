import type { Inventario } from "../../../contracts/inventario.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, TokensTurno } from "../../../contracts/turno.ts";
import { SEM_CAPACIDADES } from "../../../contracts/harness.ts";
import { criarFalaDoMeio } from "../../../domain/mensagem-no-meio.ts";
import { entradaFerramentaObservavel } from "../../../domain/entrada-ferramenta-observavel.ts";
import { classificarResultado } from "../../../domain/stream-json.ts";
// Importado por caminho, como o plano autoriza (L3 registrou): o roteiro é módulo puro sem vitest e a
// gramática dos marcadores tem que ser UMA — copiar aqui faria as duas divergirem.
import { negadasDoRoteiro, roteiroPadrao, sessaoDoRoteiro, type Roteiro } from "../../../../tests/helpers/catcher-roteiro.ts";
import { criarClienteNod, type ClienteNod } from "../cliente-nod.ts";
import { conectarCerebro, type FabricaSocket } from "../cerebro-ligacao.ts";
import type { SinksTurno } from "../spi.ts";
import type { Adapter, ConfigDriver, Driver, Instance } from "../spi.ts";

/**
 * Driver catcher (Práticas §11, EMENDA 25): mesmo SPI do claude-cli, locality 'ambos', sem CLI e sem
 * custo. É o default de dev/CI (NOD_EXECUTOR=catcher). Marcadores no prompt disparam tool_use pelo
 * MESMO cliente-nod do proxy (in-process, sem processo filho) — o que o executor teria chamado passa
 * pela mesma rota interna que o CLI real usaria. Cada passo vira um registro (`aoRegistrar`, tipo
 * snake_case) que o servidor persiste em catcher_registros (Services.catcher.registrar, L9).
 */
export type RegistroCatcher = { turnoId: string; tipo: string; dados: Record<string, unknown> };

export type OpcoesCatcher = {
  /** URL do nod para as chamadas de ferramenta; ausente = tool_use responde "não executada". */
  urlNod?: string;
  /** Espião opcional (testes): cada passo também sai por `sinks.evento({ tipo: 'catcher' })`, que é o canal que o servidor persiste. */
  aoRegistrar?: (r: RegistroCatcher) => void;
  /** Atraso entre eventos (testes de interrupção no meio do streaming). */
  atrasoMs?: number;
  clienteNod?: (lig: { url: string; token: string }) => ClienteNod;
  /** Testes: o WebSocket do canal do cérebro (padrão: o global). */
  fabricaSocket?: FabricaSocket;
  /**
   * definido em 2026-10-07 (ADR-083 §6, S9): o catcher aceita mensagem no meio do roteiro, como a sessão viva do
   * Claude — responde "Respondendo: <mensagem>" logo depois do passo em curso. Desligado por padrão: com ele, um turno
   * de catcher com ferramenta absorveria a fala seguinte da pessoa, e os e2e de fila contam turnos separados.
   */
  sessaoViva?: boolean;
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A pausa do `[[espera]]` acorda a cada 50 ms para o Parar não esperar o roteiro inteiro. */
async function esperarAte(ms: number, parado: () => boolean): Promise<void> {
  const ate = Date.now() + ms;
  while (!parado() && Date.now() < ate) await dormir(Math.min(50, ate - Date.now()));
}

/** A mensagem que chega com a moldura (molduraMensagemNoMeio) volta só com o que a pessoa escreveu. */
const semMoldura = (texto: string) => /«([\s\S]*)»/.exec(texto)?.[1] ?? texto;

function ehRoteiro(v: unknown): v is Roteiro {
  return typeof v === "object" && v !== null && Array.isArray((v as { passos?: unknown }).passos);
}

const TOKENS_ZERADOS: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };

export function criarCatcherDriver(o: OpcoesCatcher = {}): Driver {
  return {
    // O catcher não é harness (não está em CAPACIDADES_HARNESS): declara só o que simula — a sessão viva, se ligada.
    meta: { id: "catcher", locality: "ambos", capacidades: { ...SEM_CAPACIDADES, mensagemNoMeio: o.sessaoViva === true } },
    async create(cfg: ConfigDriver): Promise<Instance> {
      const roteiroFixo = ehRoteiro(cfg.roteiro) ? cfg.roteiro : null;
      return {
        async sondar(): Promise<Inventario> {
          return { estado: "pronto", versao: "catcher", em: Date.now() };
        },

        adapter(plano: PlanoTurno): Adapter {
          let interrompido = false;
          let sinksDoTurno: SinksTurno | null = null;
          // definido em 2026-09-16 (L9, pendência L4 §1): o passo vai pelo SPI (EventoStream 'catcher'); o servidor liga aoEvento → catcher_registros.
          const registrar = (tipo: string, dados: Record<string, unknown>) => {
            sinksDoTurno?.evento({ tipo: "catcher", subtipo: tipo, dados });
            o.aoRegistrar?.({ turnoId: plano.turnoId, tipo, dados });
          };
          const ferramentas = plano.catalogo.ferramentas.map((f) => f.nomeMcp);
          const cliente = o.urlNod ? (o.clienteNod ?? criarClienteNod)({ url: o.urlNod, token: plano.tokenDeTurno }) : null;
          // ADR-083 §6: as mensagens do meio, respondidas entre um passo e outro; `rodando` = ainda há passo pela frente.
          const fila: string[] = [];
          const meio = criarFalaDoMeio();
          let rodando = false;

          return {
            aceitaMensagens: () => o.sessaoViva === true && rodando && !interrompido,
            receberMensagem(texto: string, id?: string): boolean {
              if (o.sessaoViva !== true || !rodando || interrompido) return false;
              fila.push(texto);
              registrar("mensagem_no_meio", { chars: texto.length });
              // X2 (revisto em 2026-10-08): como o stdin do Claude, a fila do catcher aceitou o texto — entrou.
              if (id !== undefined) sinksDoTurno?.mensagemEntrou?.(id);
              return true;
            },

            async rodarTurno(sinks): Promise<ResultadoTurno> {
              sinksDoTurno = sinks;
              await sinks.sinal("attempted");
              // ADR-072: o turno-cérebro de uma ligação, sem CLI e sem custo — para o e2e e o dev sem assinatura.
              if (plano.modoTurno === "ligacao" && plano.ligacaoVoz && o.urlNod) return rodarLigacaoCatcher({ plano, sinks, urlNod: o.urlNod, cliente, registrar, interrompido: () => interrompido, fabricaSocket: o.fabricaSocket });
              const roteiro = roteiroFixo ?? roteiroPadrao({ prompt: plano.entrada.texto, ferramentas });
              // 0005: o catcher NÃO fabrica sessão do CLI — um uuid aqui virava `--resume` fantasma no claude-cli
              // quando a pessoa trocava de executor na mesma conversa (medido 2026-09-16). Só o `[[sessao: …]]` do
              // roteiro (S9, 2026-10-07) reporta uma, para os testes de retomada e de fork.
              const sessaoCli: string | null = sessaoDoRoteiro(roteiro);
              registrar("plano_recebido", { ferramentas, modelo: plano.entrada.modelo, sessaoCli, passos: roteiro.passos.length, executor: plano.executor });

              const emitidos: EventoStream[] = [];
              const emitir = async (ev: EventoStream) => {
                if (o.atrasoMs) await dormir(o.atrasoMs);
                if (interrompido) return false;
                emitidos.push(ev);
                sinks.evento(ev);
                if (ev.tipo === "delta") sinks.delta(ev.texto);
                const resposta = meio.avaliar(ev, sinks.falaIntermediaria !== undefined);
                if (resposta !== null) sinks.falaIntermediaria?.(resposta);
                if (ev.tipo === "delta" || ev.tipo === "tool_use" || ev.tipo === "result") await sinks.sinal("producedOutput");
                return true;
              };
              /** Responde cada mensagem do meio que chegou durante o passo que acabou, como o modelo faria. */
              const responderFila = async () => {
                while (fila.length > 0 && !interrompido) {
                  const resposta = `Respondendo: ${semMoldura(fila.shift()!)}`;
                  // X1: o catcher lê a mensagem entre um passo e outro, e o que sai agora já é a resposta.
                  meio.armar();
                  if (!(await emitir({ tipo: "delta", texto: resposta }))) return;
                  await emitir({ tipo: "texto_bloco", texto: resposta });
                }
              };

              await sinks.sinal("promptSubmitted");
              await emitir({ tipo: "init", sessaoCli: null, ferramentas, modelo: plano.entrada.modelo, versaoCli: "catcher", apiKeySource: "none" });

              let texto = "";
              let custoUsd = 0;
              let falha: string | null = null;
              let numTurnos = 1;
              rodando = true;
              for (const p of roteiro.passos) {
                if (interrompido) break;
                await responderFila();
                if (p.tipo === "espera") {
                  await esperarAte(p.ms, () => interrompido);
                } else if (p.tipo === "delta") {
                  if (!(await emitir({ tipo: "delta", texto: p.texto }))) break;
                } else if (p.tipo === "texto") texto = p.texto;
                else if (p.tipo === "custo") custoUsd = p.custoUsd;
                else if (p.tipo === "falha") falha = p.subtype;
                else if (p.tipo === "tool_use") {
                  const id = `toolu_catcher_${emitidos.length}`;
                  const nome = p.nome.startsWith("mcp__nod__") ? p.nome.slice("mcp__nod__".length) : p.nome;
                  const nomeMcp: `mcp__nod__${string}` = `mcp__nod__${nome}`;
                  const inputObservavel = entradaFerramentaObservavel(nome, p.input);
                  registrar("tool_use", { id, nome, nomeMcp, noCatalogo: ferramentas.includes(nomeMcp), input: inputObservavel });
                  if (!(await emitir({ tipo: "tool_use", id, nome: nomeMcp, input: inputObservavel }))) break;
                  let resposta: { conteudo: string; isError: boolean };
                  if (!cliente) resposta = { conteudo: `catcher: ${nome} não executada (sem servidor)`, isError: false };
                  else {
                    try {
                      resposta = await cliente.chamarFerramenta(nome, p.input);
                    } catch {
                      // ADR-029: falha técnica é dita, nunca engolida como {} silencioso
                      resposta = { conteudo: "falha_tecnica", isError: true };
                    }
                  }
                  registrar("tool_result", { id, nome, isError: resposta.isError, chars: resposta.conteudo.length });
                  if (!(await emitir({ tipo: "tool_result", toolUseId: id, isError: resposta.isError, texto: resposta.conteudo }))) break;
                  numTurnos += 1;
                }
              }

              rodando = false;
              await responderFila();
              if (!interrompido) {
                await emitir({
                  tipo: "result",
                  sucesso: falha === null,
                  subtype: falha ?? "success",
                  sessaoCli,
                  texto,
                  custoUsd,
                  tokens: TOKENS_ZERADOS,
                  numTurnos,
                  negacoesPermissao: negadasDoRoteiro(roteiro),
                  erroCru: falha,
                });
              }
              const resultado = classificarResultado({ eventos: emitidos, exitCode: interrompido ? 143 : 0, signal: null, stderr: "", interrompidoPeloDriver: interrompido, falaDoMeio: meio, driver: "catcher" });
              registrar("resultado", { desfecho: resultado.desfecho, custoUsd: resultado.custoUsd, ferramentasChamadas: resultado.ferramentasChamadas, interrompido });
              return resultado;
            },

            async interromper(): Promise<void> {
              interrompido = true;
            },
          };
        },

        async dispose(): Promise<void> {
          // sem processo filho
        },
      };
    },
  };
}

/** Instância sem ligação: roteiro/prompt viram eventos, tool_use responde "não executada". */
export const catcherDriver: Driver = criarCatcherDriver();

/**
 * O laço de voz do catcher (definido em 2026-10-04, ADR-072): responde cada vez com o roteiro dos marcadores do texto
 * (a mesma gramática do turno: `[[tool: …]]` chama a ferramenta pelo cliente do proxy) ou, sem marcador, com
 * "Entendi: <o que a pessoa disse>." em dois pedaços. No `fim`, o resumo é "Resumo da ligação: N falas.".
 */
async function rodarLigacaoCatcher(c: {
  plano: PlanoTurno;
  sinks: SinksTurno;
  urlNod: string;
  cliente: ClienteNod | null;
  registrar: (tipo: string, dados: Record<string, unknown>) => void;
  interrompido: () => boolean;
  fabricaSocket?: FabricaSocket;
}): Promise<ResultadoTurno> {
  const { plano, sinks } = c;
  await sinks.sinal("promptSubmitted");
  const cerebro = await conectarCerebro({ urlNod: c.urlNod, token: plano.tokenDeTurno, ligacaoId: plano.ligacaoVoz!.ligacaoId, harness: "catcher", interrupcao: true, fabrica: c.fabricaSocket });
  c.registrar("ligacao_conectada", { ligacaoId: plano.ligacaoVoz!.ligacaoId });
  let vezes = 0;
  let resumo = "";
  let fila = Promise.resolve();
  await new Promise<void>((acabar) => {
    const espiao = setInterval(() => {
      if (c.interrompido()) {
        clearInterval(espiao);
        acabar();
      }
    }, 100);
    cerebro.aoFim(() => {
      clearInterval(espiao);
      acabar();
    });
    cerebro.aoMensagem((m) => {
      if (m.t === "fim") {
        resumo = `Resumo da ligação: ${vezes} fala(s) da pessoa.`;
        clearInterval(espiao);
        acabar();
        return;
      }
      if (m.t === "nota" && typeof m.n === "number") {
        const n = m.n;
        fila = fila.then(() => {
          cerebro.enviar({ t: "fala", n, seq: 0, delta: "Aviso recebido." });
          cerebro.enviar({ t: "fala-fim", n });
        });
        return;
      }
      if (m.t !== "vez" || m.n === 0) return;
      vezes++;
      const n = m.n;
      fila = fila.then(async () => {
        const roteiro = roteiroPadrao({ prompt: m.texto, ferramentas: plano.catalogo.ferramentas.map((f) => f.nomeMcp) });
        const temMarcador = /\[\[(delta|tool|texto):/.test(m.texto);
        let seq = 0;
        if (temMarcador) {
          for (const p of roteiro.passos) {
            if (p.tipo === "delta") cerebro.enviar({ t: "fala", n, seq: seq++, delta: p.texto });
            else if (p.tipo === "tool_use" && c.cliente) {
              const nome = p.nome.replace(/^mcp__nod__/, "");
              cerebro.enviar({ t: "atividade", tipo: "inicio", nome });
              try {
                await c.cliente.chamarFerramenta(nome, p.input);
              } catch {
                // a falha da ferramenta é do e2e; o laço segue
              }
              cerebro.enviar({ t: "atividade", tipo: "fim", nome });
            }
          }
        } else {
          const limpo = m.texto.replace(/^\[nod\][^\n]*\n/, "").trim();
          cerebro.enviar({ t: "fala", n, seq: seq++, delta: "Entendi: " });
          cerebro.enviar({ t: "fala", n, seq: seq++, delta: `${limpo}.` });
        }
        cerebro.enviar({ t: "fala-fim", n });
        await sinks.sinal("producedOutput");
      });
    });
  });
  await fila;
  cerebro.fechar();
  c.registrar("ligacao_encerrada", { vezes });
  const eventos: EventoStream[] = [
    { tipo: "init", sessaoCli: null, ferramentas: [], modelo: plano.entrada.modelo, versaoCli: "catcher", apiKeySource: "none" },
    ...(resumo ? [{ tipo: "delta" as const, texto: resumo }] : []),
    { tipo: "result", sucesso: true, subtype: "success", sessaoCli: null, texto: resumo, custoUsd: 0, tokens: TOKENS_ZERADOS, numTurnos: 1, negacoesPermissao: [], erroCru: null },
  ];
  for (const ev of eventos) sinks.evento(ev);
  return classificarResultado({ eventos, exitCode: c.interrompido() ? 143 : 0, signal: null, stderr: "", interrompidoPeloDriver: c.interrompido(), driver: "catcher" });
}
