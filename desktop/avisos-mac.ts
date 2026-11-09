import { MAX_DECISOES_BARRA_DESKTOP, VALORES_BARRA_DESKTOP, type BarraDesktop, type DecisaoBarraDesktop, type DecisoesBarraDesktop } from "../src/contracts/desktop-barra.ts";
import { LIMITES_AVISO, type AlvoAviso, type AvisoDesktop, type PreferenciasDesktop, type TemaDesktop } from "../src/contracts/desktop.ts";

/**
 * O que o processo principal aceita da janela web (definido em 2026-09-24, "aviso no Mac"). A janela
 * carrega uma página REMOTA (o servidor do time): cada argumento que chega por IPC é validado aqui e
 * copiado para um objeto novo — nada da página vai direto ao macOS. Sem Electron: testável no vitest
 * (tests/unit/desktop/avisos-mac.test.ts).
 */

/** A origem de uma URL ("https://nod.acme.com.br"); URL inválida ou opaca → null. */
export function origemDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const origem = new URL(url).origin;
    return origem === "null" ? null : origem;
  } catch {
    return null;
  }
}

/** O frame que chamou é o principal e está na origem do servidor configurado. */
export function remetenteWebValido(r: { frameUrl: string | null | undefined; frameDeTopo: boolean; servidor: string | null | undefined }): boolean {
  const servidor = origemDe(r.servidor);
  return r.frameDeTopo && servidor !== null && origemDe(r.frameUrl) === servidor;
}

const ID = /^[\w-]+$/;

function texto(v: unknown, max: number, vazio: boolean): string | null {
  if (typeof v !== "string" || v.length > max || (!vazio && v.trim() === "")) return null;
  return v;
}

function id(v: unknown): string | null {
  return typeof v === "string" && v.length <= LIMITES_AVISO.id && ID.test(v) ? v : null;
}

function lerAlvo(v: unknown): AlvoAviso | null {
  if (typeof v !== "object" || v === null || !("tipo" in v)) return null;
  if (v.tipo === "sua-vez") return { tipo: "sua-vez" };
  // NOD-114: o pedido nascido numa task abre a task (ADR-083); o id passa pela mesma régua.
  if (v.tipo === "trabalho") {
    const trabalhoId = "trabalhoId" in v ? id(v.trabalhoId) : null;
    const agenteId = "agenteId" in v ? id(v.agenteId) : null;
    const conversaId = "conversaId" in v ? id(v.conversaId) : null;
    return trabalhoId && agenteId && conversaId ? { tipo: "trabalho", trabalhoId, agenteId, conversaId } : null;
  }
  if (v.tipo !== "conversa" || !("conversaId" in v) || !("agenteId" in v)) return null;
  const conversaId = id(v.conversaId);
  const agenteId = id(v.agenteId);
  return conversaId && agenteId ? { tipo: "conversa", conversaId, agenteId } : null;
}

/** O aviso redigido pela web, ou null se algo não confere (título vazio, texto longo, alvo estranho). */
export function lerAviso(dados: unknown): AvisoDesktop | null {
  if (typeof dados !== "object" || dados === null || !("titulo" in dados) || !("corpo" in dados) || !("alvo" in dados)) return null;
  const titulo = texto(dados.titulo, LIMITES_AVISO.titulo, false);
  const corpo = texto(dados.corpo, LIMITES_AVISO.corpo, true);
  const alvo = lerAlvo(dados.alvo);
  // NOD-114: o grupo (o bot) é opcional; presente, passa pela régua do id — fora dela, o aviso inteiro é recusado.
  const grupo = "grupo" in dados && dados.grupo !== undefined ? id(dados.grupo) : undefined;
  if (titulo === null || corpo === null || !alvo || grupo === null) return null;
  return grupo ? { titulo, corpo, alvo, grupo } : { titulo, corpo, alvo };
}

/** O número do Dock: inteiro de 0 a 9999; qualquer outra coisa → null. */
export function lerContador(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? Math.min(n, LIMITES_AVISO.contador) : null;
}

/** O tema que a página pede (ou que está no arquivo): só os três valores; qualquer outra coisa → null. */
export function lerTemaDesktop(valor: unknown): TemaDesktop | null {
  return valor === "sistema" || valor === "claro" || valor === "escuro" ? valor : null;
}

/** NOD-119: a densidade da barra que a página pede (ou que está no arquivo); null = o padrão ou valor desconhecido. */
export function lerBarraDesktop(valor: unknown): BarraDesktop | null {
  return typeof valor === "string" && (VALORES_BARRA_DESKTOP as readonly string[]).includes(valor) ? (valor as BarraDesktop) : null;
}

/**
 * NOD-119: as gravações entram numa fila (o arrasto da borda grava a cada passo): sem corrida no rename do .tmp, e cada
 * uma roda depois da anterior, então a última vence. Uma falha não trava a fila; quem chamou recebe o erro.
 */
export function criarFilaDeGravacao(): (tarefa: () => Promise<void>) => Promise<void> {
  let fila: Promise<void> = Promise.resolve();
  return (tarefa) => {
    const vez = fila.then(tarefa);
    fila = vez.catch(() => undefined);
    return vez;
  };
}

/** NOD-119: o id de mensagem (uuid) e a decisão do card; qualquer outra coisa é recusada (null). */
const ID_MENSAGEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function lerDecisaoBarra(mensagemId: unknown, decisao: unknown): [string, DecisaoBarraDesktop] | null {
  if (typeof mensagemId !== "string" || !ID_MENSAGEM.test(mensagemId)) return null;
  return decisao === "aplicada" || decisao === "recusada" ? [mensagemId, decisao] : null;
}

/** A decisão nova vai para o fim (a mais recente); passando do teto, saem as mais antigas. */
export function comDecisaoBarra(atuais: DecisoesBarraDesktop, mensagemId: string, decisao: DecisaoBarraDesktop): DecisoesBarraDesktop {
  const entradas = Object.entries(atuais).filter(([id]) => id !== mensagemId);
  entradas.push([mensagemId, decisao]);
  return Object.fromEntries(entradas.slice(-MAX_DECISOES_BARRA_DESKTOP));
}

/**
 * NOD-119: a resposta do sendSync do preload (a barra e as decisões guardadas). Remetente fora da janela web (validar
 * lança) ou leitura que falha recebem o padrão: o preload nunca fica sem returnValue.
 */
export function respostaSincrona<T>(validar: () => void, valor: () => T, padrao: T): T {
  try {
    validar();
    return valor();
  } catch {
    return padrao;
  }
}

/** NOD-119: a barra pedida pela página; null volta ao padrão, valor desconhecido é erro. */
export function barraDoPedido(barra: unknown): BarraDesktop | null {
  const lida = lerBarraDesktop(barra);
  if (barra !== null && lida === null) throw new Error("entrada_invalida");
  return lida;
}

/** NOD-119: a decisão do card que chega pelo IPC entra nas guardadas; id ou decisão inválidos são erro. */
export function decisoesComPedido(atuais: DecisoesBarraDesktop, mensagemId: unknown, decisao: unknown): DecisoesBarraDesktop {
  const lida = lerDecisaoBarra(mensagemId, decisao);
  if (!lida) throw new Error("entrada_invalida");
  return comDecisaoBarra(atuais, lida[0], lida[1]);
}

/** O campo `decisoesBarra` do preferencias.json: sem arquivo, corrompido ou com lixo, só o que é válido (até o teto). */
export function lerDecisoesBarra(conteudo: string | null): DecisoesBarraDesktop {
  let lido: unknown = null;
  try {
    lido = conteudo === null ? null : JSON.parse(conteudo);
  } catch {
    // arquivo corrompido: sem decisões
  }
  const campo = typeof lido === "object" && lido !== null && "decisoesBarra" in lido ? lido.decisoesBarra : null;
  if (typeof campo !== "object" || campo === null || Array.isArray(campo)) return {};
  let r: DecisoesBarraDesktop = {};
  for (const [id, d] of Object.entries(campo)) {
    const ok = lerDecisaoBarra(id, d);
    if (ok) r = comDecisaoBarra(r, ok[0], ok[1]);
  }
  return r;
}

/**
 * preferencias.json: sem arquivo, corrompido ou sem o campo, os avisos e o som (NOD-196) nascem ligados e o tema segue
 * o sistema.
 */
export function lerPreferencias(conteudo: string | null): Pick<PreferenciasDesktop, "avisos" | "tema" | "som"> & { barra: BarraDesktop | null } {
  let lido: unknown = null;
  try {
    lido = conteudo === null ? null : JSON.parse(conteudo);
  } catch {
    // arquivo corrompido: volta ao padrão
  }
  const obj = typeof lido === "object" && lido !== null ? lido : {};
  return {
    avisos: "avisos" in obj && typeof obj.avisos === "boolean" ? obj.avisos : true,
    tema: ("tema" in obj ? lerTemaDesktop(obj.tema) : null) ?? "sistema",
    som: "som" in obj && typeof obj.som === "boolean" ? obj.som : true,
    barra: "barra" in obj ? lerBarraDesktop(obj.barra) : null,
  };
}

/** O agrupamento dos avisos no Centro de Notificações: o grupo do nod; com bot (NOD-114), um grupo por bot dentro dele. */
export const GRUPO_AVISOS = "nod-sua-vez";

export function grupoDoAviso(aviso: Pick<AvisoDesktop, "grupo">): string {
  return aviso.grupo ? `${GRUPO_AVISOS}:${aviso.grupo}` : GRUPO_AVISOS;
}

/**
 * As opções do `new Notification` do Electron para um aviso (NOD-196). Som desligado → `silent: true`: o aviso aparece
 * igual (banner, clique, Dock), só sem som. Som ligado → `silent: false`, que só deixa o macOS tocar o som padrão; o Foco
 * e os Ajustes do Sistema continuam mandando.
 */
export function opcoesDoAviso(aviso: AvisoDesktop, p: { som: boolean }): { title: string; body: string; groupId: string; silent: boolean } {
  return { title: aviso.titulo, body: aviso.corpo, groupId: grupoDoAviso(aviso), silent: !p.som };
}
