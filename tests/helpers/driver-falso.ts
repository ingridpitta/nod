import { randomUUID } from "node:crypto";
import type { Adapter, ConfigDriver, Driver, Instance } from "../../src/adapters/executor/spi.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno } from "../../src/contracts/turno.ts";
import { classificarResultado } from "../../src/domain/stream-json.ts";
import { eventosDoRoteiro, roteiroPadrao, type Roteiro } from "./catcher-roteiro.ts";

export type OpcoesDriverFalso = {
  /** Roteiro fixo para todo turno; ausente = marcadores do prompt / roteiroPadrao. */
  roteiro?: Roteiro;
  /** Inventário que `sondar()` devolve (default: pronto). */
  inventario?: Inventario;
  /** Responde tool_use do roteiro (o teste injeta o que o "servidor" devolveria). */
  responder?: (nome: string, input: Record<string, unknown>) => string;
  /** Atraso entre eventos, para testes de interrupção no meio do streaming. */
  atrasoMs?: number;
  /** Observador: cada plano que chegou ao adapter (para asserções sobre o catálogo/prompt). */
  aoReceberPlano?: (plano: PlanoTurno) => void;
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Driver 'catcher' de teste no MESMO SPI do claude-cli (ADR-012): recebe o plano e os sinks,
 * emite os eventos do roteiro respeitando o write-ahead (attempted → promptSubmitted ANTES do
 * primeiro evento, ADR-009) e classifica o resultado pelo mesmo domínio (stream-json). interromper()
 * corta o stream sem `result` → 'interrompido', como o SIGTERM real (s6).
 */
export function driverFalso(opcoes: OpcoesDriverFalso = {}): Driver {
  return {
    meta: { id: "catcher", locality: "ambos" },
    async create(_cfg: ConfigDriver): Promise<Instance> {
      return {
        async sondar(): Promise<Inventario> {
          return opcoes.inventario ?? { estado: "pronto", versao: "catcher", em: Date.now() };
        },
        adapter(plano: PlanoTurno): Adapter {
          opcoes.aoReceberPlano?.(plano);
          let interrompido = false;
          return {
            async rodarTurno(sinks): Promise<ResultadoTurno> {
              await sinks.sinal("attempted");
              const roteiro = opcoes.roteiro ?? roteiroPadrao({ prompt: plano.entrada.texto, ferramentas: plano.catalogo.ferramentas.map((f) => f.nomeMcp) });
              const sessaoCli = plano.entrada.sessaoCli ?? randomUUID();
              const eventos = eventosDoRoteiro(roteiro, {
                sessaoCli,
                ferramentas: plano.catalogo.ferramentas.map((f) => f.nomeMcp),
                modelo: plano.entrada.modelo,
                responder: opcoes.responder,
              });
              await sinks.sinal("promptSubmitted");
              const emitidos: EventoStream[] = [];
              for (const ev of eventos) {
                if (interrompido) break;
                if (opcoes.atrasoMs) await dormir(opcoes.atrasoMs);
                if (interrompido) break;
                emitidos.push(ev);
                sinks.evento(ev);
                if (ev.tipo === "delta") sinks.delta(ev.texto);
                if (ev.tipo === "delta" || ev.tipo === "tool_use" || ev.tipo === "result") await sinks.sinal("producedOutput");
              }
              return classificarResultado({
                eventos: emitidos,
                exitCode: interrompido ? 143 : 0,
                signal: null,
                stderr: "",
                interrompidoPeloDriver: interrompido,
              });
            },
            async interromper(): Promise<void> {
              interrompido = true;
            },
          };
        },
        async dispose(): Promise<void> {
          // nada a liberar: sem processo filho
        },
      };
    },
  };
}
