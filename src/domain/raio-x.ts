import type { ModoTurno, PlanoTurno } from "../contracts/plano-turno.ts";
import {
  SECOES_DO_PROMPT,
  TETO_CHAMADAS_RAIO_X,
  TETO_COMPACTACOES_RAIO_X,
  TETO_FERRAMENTAS_POR_CHAMADA,
  TETO_FERRAMENTAS_RAIO_X,
  type ChamadaRaioX,
  type ComposicaoRaioX,
  type ExecucaoRaioX,
  type FerramentaNaChamada,
  type GrupoDeFerramentas,
  type ParteDoPrompt,
  type ResumoRaioX,
  type SecaoDoPrompt,
} from "../contracts/raio-x.ts";
import type { EventoStream } from "../contracts/turno.ts";
import { secaoDaLinha } from "./prompt-sistema.ts";

/** Busca de ferramentas do Claude Code: com ela no `--tools`, as definições dos apps só entram quando buscadas. */
const BUSCA_DE_FERRAMENTAS = "ToolSearch";
/** Teto do texto de cada parte guardada com o modo dev ligado: o Raio-X mostra, não arquiva. */
export const TEXTO_RAIO_X_MAX_CHARS = 60_000;
/** Das chamadas acima do teto, ficam as primeiras (o começo do turno) e as últimas (onde ele acabou). */
const CHAMADAS_DO_COMECO = 100;

function cortar(texto: string): string {
  return texto.length > TEXTO_RAIO_X_MAX_CHARS ? `${texto.slice(0, TEXTO_RAIO_X_MAX_CHARS)}\n…[cortado: ${texto.length} caracteres]` : texto;
}

/**
 * A execução a partir dos eventos do stream (modo dev, 0036). `momentos[i]` é o ms, desde o início do turno, em
 * que `eventos[i]` chegou. A ferramenta pedida numa chamada chega ANTES do message_delta que a fecha (uma linha
 * `assistant` por bloco), então fica pendente até a próxima `chamada`; o resultado dela chega depois, pelo id.
 * Sem init, chamada nem result (o spawn falhou), não há o que mostrar: null.
 */
export function montarExecucao(eventos: readonly EventoStream[], momentos: readonly number[], duracaoMs: number): ExecucaoRaioX | null {
  const chamadas: ChamadaRaioX[] = [];
  const compactacoes: ExecucaoRaioX["compactacoes"] = [];
  const porId = new Map<string, FerramentaNaChamada>();
  let pendentes: FerramentaNaChamada[] = [];
  let init: Extract<EventoStream, { tipo: "init" }> | null = null;
  let result: Extract<EventoStream, { tipo: "result" }> | null = null;
  for (const [i, ev] of eventos.entries()) {
    const em = Math.max(0, Math.round(momentos[i] ?? duracaoMs));
    if (ev.tipo === "init") init = ev;
    else if (ev.tipo === "result") result = ev;
    else if (ev.tipo === "tool_use") {
      const f: FerramentaNaChamada = { nome: ev.nome.slice(0, 200), resultadoChars: null, erro: false };
      porId.set(ev.id, f);
      pendentes.push(f);
    } else if (ev.tipo === "tool_result") {
      const f = porId.get(ev.toolUseId);
      if (f) {
        f.resultadoChars = ev.texto.length;
        f.erro = ev.isError;
      }
    } else if (ev.tipo === "chamada") {
      chamadas.push({
        em,
        contexto: ev.entrada + ev.cacheLido + ev.cacheNovo,
        entrada: ev.entrada,
        cacheLido: ev.cacheLido,
        cacheNovo: ev.cacheNovo,
        saida: ev.saida,
        pensamento: ev.pensamento,
        subagente: ev.subagente,
        ferramentas: pendentes.slice(0, TETO_FERRAMENTAS_POR_CHAMADA),
      });
      pendentes = [];
    } else if (ev.tipo === "compactacao" && compactacoes.length < TETO_COMPACTACOES_RAIO_X) {
      compactacoes.push({ em, antes: ev.antes, depois: ev.depois, gatilho: ev.gatilho.slice(0, 40) });
    }
  }
  if (!init && !result && chamadas.length === 0) return null;
  const omitidas = Math.max(0, chamadas.length - TETO_CHAMADAS_RAIO_X);
  let restantes = TETO_FERRAMENTAS_RAIO_X;
  const mantidas = (omitidas === 0 ? chamadas : [...chamadas.slice(0, CHAMADAS_DO_COMECO), ...chamadas.slice(chamadas.length - (TETO_CHAMADAS_RAIO_X - CHAMADAS_DO_COMECO))])
    .map((c) => {
      const ferramentas = c.ferramentas.slice(0, restantes);
      restantes -= ferramentas.length;
      return { ...c, ferramentas };
    });
  return {
    chamadas: mantidas,
    chamadasOmitidas: omitidas,
    compactacoes,
    janela: result?.janela ?? null,
    modelo: init?.modelo || null,
    versaoCli: init?.versaoCli || null,
    custoSessaoUsd: result?.custoUsd ?? null,
    ferramentasNoInit: init?.ferramentas.length ?? 0,
    buscaDeFerramentas: init?.ferramentas.includes(BUSCA_DE_FERRAMENTAS) ?? false,
    duracaoMs: Math.max(0, Math.round(duracaoMs)),
  };
}

/** O prompt de sistema em partes, na ordem de SECOES_DO_PROMPT. A soma dos `chars` é o tamanho do prompt. */
export function partesDoPrompt(prompt: string, comTexto: boolean): ParteDoPrompt[] {
  const linhas = new Map<SecaoDoPrompt, string[]>();
  let atual: SecaoDoPrompt = "identidade";
  for (const linha of prompt.split("\n")) {
    atual = secaoDaLinha(linha) ?? atual;
    linhas.set(atual, [...(linhas.get(atual) ?? []), linha]);
  }
  const partes = SECOES_DO_PROMPT.flatMap((secao) => {
    const texto = linhas.get(secao)?.join("\n");
    return texto === undefined ? [] : [{ secao, chars: texto.length, ...(comTexto ? { texto: cortar(texto) } : {}) }];
  });
  // As quebras entre seções também são caracteres enviados: ficam com a seção que vem depois.
  return partes.map((p, i) => (i === 0 ? p : { ...p, chars: p.chars + 1 }));
}

/** Tamanho da definição que o proxy lista (name, description, inputSchema — catalogo.ts). */
function charsDaDefinicao(f: PlanoTurno["catalogo"]["ferramentas"][number]): number {
  return JSON.stringify({ name: f.nome, description: f.schema.description ?? "", inputSchema: f.schema }).length;
}

function grupoDe(f: PlanoTurno["catalogo"]["ferramentas"][number]): Pick<GrupoDeFerramentas, "grupo" | "origem"> {
  if (f.origem === "conector") return { grupo: f.nome.split("__")[0] || "app", origem: "conector" };
  if (f.origem === "computador") return { grupo: "computador", origem: "computador" };
  if (f.origem === "workspace") return { grupo: "pastas", origem: "workspace" };
  return { grupo: "nod", origem: "nod" };
}

/**
 * A composição do que o nod manda no turno, lida do PLANO que acabou de ser emitido. Os grupos de ferramentas
 * saem em ordem decrescente de tamanho: é a pergunta que o Raio-X responde ("o que ocupa a janela?").
 */
/** ADR-111: `experimentos` = as chaves que valeram no turno (o caso de uso resolve); ausente, a composição sai sem elas. */
export function composicaoDoPlano(plano: PlanoTurno, opcoes: { modo: ModoTurno; comTexto: boolean; experimentos?: NonNullable<ComposicaoRaioX["experimentos"]>; recomeco?: NonNullable<ComposicaoRaioX["recomeco"]>; memoria?: NonNullable<ComposicaoRaioX["memoria"]> }): ComposicaoRaioX {
  const grupos = new Map<string, GrupoDeFerramentas>();
  for (const f of plano.catalogo.ferramentas) {
    const g = grupoDe(f);
    const atual = grupos.get(g.grupo) ?? { ...g, quantidade: 0, chars: 0 };
    grupos.set(g.grupo, { ...atual, quantidade: atual.quantidade + 1, chars: atual.chars + charsDaDefinicao(f) });
  }
  return {
    modo: opcoes.modo,
    modelo: plano.entrada.modelo,
    harness: plano.harness ?? null,
    sessaoRetomada: plano.entrada.sessaoCli !== null,
    promptChars: plano.promptSistema.length,
    prompt: partesDoPrompt(plano.promptSistema, opcoes.comTexto),
    ferramentas: [...grupos.values()].sort((a, b) => b.chars - a.chars || a.grupo.localeCompare(b.grupo)),
    nativas: [...(plano.nativas ?? [])],
    entrada: {
      chars: plano.entrada.texto.length,
      anexos: plano.entrada.anexos?.length ?? 0,
      ...(opcoes.comTexto ? { texto: cortar(plano.entrada.texto) } : {}),
    },
    comTexto: opcoes.comTexto,
    ...(opcoes.experimentos ? { experimentos: opcoes.experimentos } : {}),
    ...(opcoes.recomeco ? { recomeco: opcoes.recomeco } : {}),
    ...(opcoes.memoria ? { memoria: opcoes.memoria } : {}),
  };
}

/** A faixa dev de uma resposta: o essencial da execução, sem as chamadas. */
export function resumoDoRaioX(turnoId: string, custoUsd: number | null, execucao: ExecucaoRaioX | null): ResumoRaioX {
  const chamadas = execucao?.chamadas ?? [];
  const principais = chamadas.filter((c) => !c.subagente);
  const base = principais.length ? principais : chamadas;
  const contexto = chamadas.reduce((s, c) => s + c.contexto, 0);
  return {
    turnoId,
    custoUsd,
    chamadas: chamadas.length + (execucao?.chamadasOmitidas ?? 0),
    compactacoes: execucao?.compactacoes.length ?? 0,
    picoContexto: base.length ? Math.max(...base.map((c) => c.contexto)) : null,
    janela: execucao?.janela ?? null,
    cachePct: contexto > 0 ? Math.round((100 * chamadas.reduce((s, c) => s + c.cacheLido, 0)) / contexto) : null,
    modelo: execucao?.modelo ?? null,
  };
}
