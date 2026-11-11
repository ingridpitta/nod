import { causaDaEntrega } from "../../../domain/stream-json.ts";
import { apelidoValido, contaNoLimiteValida } from "../../../domain/contas-da-ia.ts";
import { CONTAS_ANUNCIADAS_MAX, ESTADOS_CONTA_NA_MAQUINA, type ContaAnunciada, type EstadoContaNaMaquina, type ProgressoDoLogin } from "../../../contracts/contas-ia.ts";
import { ACOES_DO_PREPARO, type PreparoDoLogin } from "../../../contracts/preparo-do-login.ts";
import { ehIaComConta, IMPRESSAO } from "../../../domain/contas-da-pessoa.ts";
import { emailDaConta, organizacaoDaConta } from "../../../domain/estado-ia.ts";
import type { RelatoEspera } from "../../../contracts/espera.ts";
import { DESFECHOS_COMANDO_COMPUTADOR, ESTADOS_ANUNCIO_COMPUTADOR, ESTADOS_TELA_COMPUTADOR, OPERACOES_COMPUTADOR, TETO_PARTE_LOGINS_B64, type AnuncioComputador, type EstadoComputadorRelatado, type ResultadoComandoComputador } from "../../../contracts/computador-motor.ts";
import type { ResultadoComputador } from "../../../contracts/computador.ts";
import { ESTADOS_VM_LOCAL, type VmLocalAnunciada } from "../../../contracts/vm-local.ts";
import type { ProgressoDeInstalacao } from "../../../contracts/instalacoes-ssh.ts";
import { SAIDA_ESPERA_MAX } from "../../../domain/espera-comando.ts";
import { CAUSAS_DO_MAC, CAUSAS_SEM_IA, MOTIVO_DA_CAUSA, MOTIVO_DA_CAUSA_DO_MAC, type CausaSemIa, type Inventario } from "../../../contracts/inventario.ts";
import type { LeituraDisco, LeituraMemoria, NivelPressao } from "../../../contracts/trabalho.ts";
import { motivoAtualizando, motivoCliAntigo } from "../../../domain/cli-antigo.ts";
import { CAMINHOS_ATUALIZACAO, FASES_ATUALIZACAO, MOTIVOS_ATUALIZACAO, type AtualizacaoDaIa } from "../../../contracts/estado-ia.ts";
import { motivoSondaLenta } from "../../../domain/sonda-lenta.ts";
import { MOTIVOS_FALHA, MOTIVOS_FALHA_COMPUTADOR, MOTIVOS_INTERRUPCAO, MOTIVOS_PASSE } from "../../../contracts/motivos.ts";
import type { Entrega, FalaIntermediaria, TrechoVivo, VigiaVivo } from "../../../contracts/ponte.ts";
import { TETO_COMANDOS, TETO_DESCRICAO_COMANDO, TETO_SO_DO_TERMINAL, type CatalogoDeComandos, type ComandoDoMac } from "../../../contracts/comandos.ts";
import {
  TETO_CHAMADAS_RAIO_X,
  TETO_COMPACTACOES_RAIO_X,
  TETO_FERRAMENTAS_POR_CHAMADA,
  TETO_FERRAMENTAS_RAIO_X,
  type ChamadaRaioX,
  type CompactacaoRaioX,
  type ExecucaoRaioX,
  type FerramentaNaChamada,
} from "../../../contracts/raio-x.ts";
import { ESTADOS_DA_TAREFA, ESTADOS_DO_SUBAGENTE, type SinaisTurno, type SubagenteVivo, type TarefaDoBot } from "../../../contracts/turno.ts";
import { TETO_TAREFAS, TETO_TITULO_TAREFA } from "../../../domain/tarefas-do-bot.ts";
import { NOME_DE_FERRAMENTA, TETO_DESCRICAO_SUBAGENTE, TETO_SUBAGENTES } from "../../../domain/subagentes.ts";
import { LIMIARES_REPETICAO } from "../../../domain/vigia-turno.ts";
import { usoDoPlanoValido } from "../../../domain/uso-do-plano.ts";
import { caminhoValido, resumoCheckpointValido } from "../../../domain/checkpoints.ts";
import { DESFECHOS_ARQUIVO, type DesfechoArquivo, type RelatoDesfazer } from "../../../contracts/checkpoint.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { PRAZO_LIMITE_MAXIMO_MS } from "../../../domain/inteligencia.ts";
import { TEXTO_ENTREGA_MAX_CHARS } from "../../../shared/constantes.ts";
import { UUID } from "../roteador.ts";
import type { TipoAnexo } from "../../../contracts/anexo.ts";
import { HARNESSES, SEM_CAPACIDADES, type CapacidadesHarness, type IdHarness } from "../../../contracts/harness.ts";

export function exigir(condicao: unknown): asserts condicao {
  if (!condicao) throw new ErroDeDominio("entrada_invalida");
}
export function objeto(v: unknown): Record<string, unknown> {
  exigir(v && typeof v === "object" && !Array.isArray(v));
  return v as Record<string, unknown>;
}
export function texto(v: unknown, max = TEXTO_ENTREGA_MAX_CHARS): v is string { return typeof v === "string" && v.length <= max; }
/** NOD-353: o id do tool_use (Claude `toolu_…`, Codex `call_…`): só letras, dígitos, `_` e `-`. */
const idDaChamada = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
/** ADR-165: o resumo do argumento é uma linha curta (o executor manda até 120); texto maior que 1000 é recusado, não cortado. */
const resumoDoTrecho = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= 1_000 ? v : null);
/**
 * Trechos do turno vivo. São efêmeros: um item fora do formato é descartado sozinho e uma lista acima
 * dos tetos vira vazia, sem nunca derrubar a renovação (que é o lease do turno).
 */
export function trechos(v: unknown): TrechoVivo[] {
  if (!Array.isArray(v) || v.length > 2_000) return [];
  const saida: TrechoVivo[] = [];
  let total = 0;
  for (const t of v) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const o = t as Record<string, unknown>;
    // NOD-350: o único trecho com duas chaves — a lista e se a volta do principal acabou (`ocioso`, opcional).
    if (Array.isArray(o.subagentes) && Object.keys(o).every((k) => k === "subagentes" || k === "ocioso") && (o.ocioso === undefined || typeof o.ocioso === "boolean")) {
      const s = subagentesDoTrecho(o.subagentes);
      if (s) saida.push(o.ocioso === undefined ? { subagentes: s } : { subagentes: s, ocioso: o.ocioso });
      continue;
    }
    // NOD-353: a ferramenta com o id da chamada e o fim dela — os outros trechos de duas chaves. ADR-165: e o `resumo`
    // (opcional, de três chaves com o id): fora do formato ele cai e a ferramenta segue sem ele; o corte em 160 e a
    // segunda redação são do frameDaFerramenta.
    const chaves = Object.keys(o);
    if ("ferramenta" in o && (chaves.length === 2 || chaves.length === 3) && chaves.every((k) => k === "ferramenta" || k === "id" || k === "resumo") && ("id" in o || "resumo" in o)) {
      // id fora do formato: a ferramenta segue sem id (fecha na próxima, como no app antigo).
      if (nomeDeFerramenta(o.ferramenta)) {
        const resumo = resumoDoTrecho(o.resumo);
        saida.push({ ferramenta: o.ferramenta, ...(idDaChamada(o.id) ? { id: o.id } : {}), ...(resumo ? { resumo } : {}) });
      }
      continue;
    }
    if (Object.keys(o).length === 2 && "fim" in o && "falhou" in o) {
      if (idDaChamada(o.fim) && typeof o.falhou === "boolean") saida.push({ fim: o.fim, falhou: o.falhou });
      continue;
    }
    if (Object.keys(o).length !== 1) continue;
    if (texto(o.texto, 16_000)) { total += o.texto.length; saida.push({ texto: o.texto }); }
    else if (nomeDeFerramenta(o.ferramenta)) saida.push({ ferramenta: o.ferramenta });
    else if (Array.isArray(o.tarefas)) { const t = tarefasDoTrecho(o.tarefas); if (t) saida.push({ tarefas: t }); }
    else if (o.vigia !== undefined) { const v = vigiaDoTrecho(o.vigia); if (v) saida.push({ vigia: v }); }
  }
  return total > 16_000 ? [] : saida;
}
/** definido em 2026-10-01 (ADR-067): falas ainda não confirmadas que cabem numa renovação; acima disso o executor reenvia. */
const TETO_FALAS_POR_RENOVACAO = 50;
/**
 * Falas da sessão viva (ADR-067). Diferente dos trechos, cada fala vira mensagem gravada: fora do formato a
 * renovação inteira é recusada (entrada_invalida), e o executor as reenvia na próxima.
 */
export function falas(v: unknown): FalaIntermediaria[] {
  if (v === undefined) return [];
  exigir(Array.isArray(v) && v.length <= TETO_FALAS_POR_RENOVACAO);
  return v.map((f) => {
    const o = objeto(f);
    exigir(typeof o.seq === "number" && Number.isSafeInteger(o.seq) && o.seq >= 1 && texto(o.texto));
    return { seq: o.seq, texto: o.texto };
  });
}
/** definido em 2026-10-07 (ADR-083, #194): no máximo um RSS por turno vivo; 64 cobre o pico de 25 turnos do diário. */
const TETO_TURNOS_MEMORIA = 64;
const TETO_MB = 1_048_576;
/**
 * A memória do Mac na renovação (#194), estrita: o nível do macOS, o total e o RSS por turno, só números e ids. Ausente =
 * app antigo. Qualquer coisa fora do contrato derruba a renovação (400), como o resto da validação da ponte.
 */
export function memoria(v: unknown): LeituraMemoria | undefined {
  if (v === undefined) return undefined;
  const o = objeto(v);
  exigir((o.nivel === "verde" || o.nivel === "amarela" || o.nivel === "vermelha") && typeof o.totalMb === "number" && Number.isFinite(o.totalMb) && o.totalMb >= 0 && o.totalMb <= TETO_MB);
  exigir(Array.isArray(o.porTurno) && o.porTurno.length <= TETO_TURNOS_MEMORIA);
  const porTurno = (o.porTurno as unknown[]).map((x) => {
    const t = objeto(x);
    exigir(typeof t.turnoId === "string" && UUID.test(t.turnoId) && typeof t.mb === "number" && Number.isFinite(t.mb) && t.mb >= 0 && t.mb <= TETO_MB);
    return { turnoId: t.turnoId, mb: t.mb };
  });
  // ADR-085: o processador é opcional (app anterior à 0.4.0-rc.6 não manda); a carga por núcleo vai até 1000 (um Mac
  // travado passa de 20 — medido em 06/10: 265 em 12 núcleos). Revisão do #209: fora disso o processador é ignorado, e
  // não a leitura toda — um campo novo com defeito não pode derrubar a renovação do turno.
  const p = o.processador !== null && typeof o.processador === "object" && !Array.isArray(o.processador) ? (o.processador as Record<string, unknown>) : null;
  const valido = p !== null && (p.nivel === "verde" || p.nivel === "amarela" || p.nivel === "vermelha") && typeof p.carga === "number" && Number.isFinite(p.carga) && p.carga >= 0 && p.carga <= 1000;
  // ADR-091: o uso da CPU (0 a 1) é opcional como o resto; fora disso some só ele, e a leitura vale como a de um app anterior.
  const uso = valido && typeof p.uso === "number" && Number.isFinite(p.uso) && p.uso >= 0 && p.uso <= 1 ? p.uso : undefined;
  // Revisão do #224: `null` é "o app mede, mas não conseguiu" (a tela diz "sem leitura"); fora do formato, como app anterior.
  const disco = o.disco === null ? null : discoValido(o.disco);
  return { nivel: o.nivel, totalMb: o.totalMb, porTurno, ...(valido ? { processador: { nivel: p.nivel as NivelPressao, carga: p.carga as number, ...(uso !== undefined ? { uso } : {}) } } : {}), ...(disco !== undefined ? { disco } : {}) };
}
/** definido em 2026-10-09 (#219): 1 EB em MB, folga para qualquer volume; acima disso é defeito. */
const TETO_DISCO_MB = 1_099_511_627_776;
/**
 * O disco do Mac (#219, emenda à ADR-085), opcional como o processador: fora do formato (números inteiros, livre até o
 * total) é ignorado sozinho — "sem leitura", nada espera —, nunca derruba a leitura nem a renovação.
 */
function discoValido(v: unknown): LeituraDisco | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const d = v as Record<string, unknown>;
  const mb = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= TETO_DISCO_MB;
  return mb(d.livreMb) && mb(d.totalMb) && d.totalMb > 0 && d.livreMb <= d.totalMb ? { livreMb: d.livreMb, totalMb: d.totalMb } : undefined;
}
const NOME_FERRAMENTA = /^[A-Za-z0-9_.-]+$/;
const nomeDeFerramenta = (v: unknown): v is string => texto(v, 200) && NOME_FERRAMENTA.test(v);
const inteiroAte = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
/**
 * O vigia do turno (NOD-73), estrito: só as chaves do contrato, nome no padrão de ferramenta, números inteiros e a
 * repetição num dos limiares. Qualquer coisa a mais (um `input`, um comando) descarta o trecho inteiro.
 */
function vigiaDoTrecho(v: unknown): VigiaVivo | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !["mudoMs", "aberta", "emFundo", "repeticao"].includes(k))) return null;
  if (!inteiroAte(o.mudoMs, 366 * 86_400_000) || !inteiroAte(o.emFundo, 1_000)) return null;
  if (o.aberta !== undefined && !nomeDeFerramenta(o.aberta)) return null;
  let repeticao: VigiaVivo["repeticao"];
  if (o.repeticao !== undefined) {
    const r = o.repeticao;
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    const ro = r as Record<string, unknown>;
    if (Object.keys(ro).length !== 2 || !nomeDeFerramenta(ro.nome) || !(LIMIARES_REPETICAO as readonly unknown[]).includes(ro.vezes)) return null;
    repeticao = { nome: ro.nome, vezes: ro.vezes as number };
  }
  return { mudoMs: o.mudoMs, ...(o.aberta !== undefined ? { aberta: o.aberta } : {}), emFundo: o.emFundo, ...(repeticao ? { repeticao } : {}) };
}
const CHAVES_SUBAGENTE = ["chamadas", "descricao", "duracaoMs", "estado", "id", "natureza", "passo"].join();
const ID_TAREFA = /^[A-Za-z0-9_-]{1,40}$/;
// Uma linha, sem controle: o que a tela mostra. A descrição vem do modelo (redigida no Mac); o passo é um rótulo do nod.
// eslint-disable-next-line no-control-regex
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]*$/;
const SETE_DIAS_MS = 7 * 24 * 3_600_000;
/**
 * NOD-350 (definido em 2026-10-23): a lista dos subagentes num trecho vivo, estrita como o vigia — só as chaves do
 * contrato, `descricao` ≤80 (vazia no comando), `passo` só o nome cru da ferramenta (o servidor faz o rótulo), estados do enum, inteiros ≥0 e o teto de 20. Um `summary`,
 * um `prompt`, args ou qualquer chave a mais descartam o trecho inteiro.
 */
function subagentesDoTrecho(v: unknown[]): SubagenteVivo[] | null {
  if (v.length > TETO_SUBAGENTES) return null;
  const saida: SubagenteVivo[] = [];
  const ids = new Set<string>();
  for (const bruto of v) {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
    const s = bruto as Record<string, unknown>;
    if (Object.keys(s).sort().join() !== CHAVES_SUBAGENTE) return null;
    if (typeof s.id !== "string" || !ID_TAREFA.test(s.id) || ids.has(s.id)) return null;
    if (s.natureza !== "agente" && s.natureza !== "comando") return null;
    if (!texto(s.descricao, TETO_DESCRICAO_SUBAGENTE) || !SEM_CONTROLE.test(s.descricao) || (s.natureza === "comando" && s.descricao !== "")) return null;
    if (!ESTADOS_DO_SUBAGENTE.some((e) => e === s.estado)) return null;
    if (s.passo !== null && (typeof s.passo !== "string" || !NOME_DE_FERRAMENTA.test(s.passo))) return null;
    if (!inteiroAte(s.chamadas, 1_000_000) || !inteiroAte(s.duracaoMs, SETE_DIAS_MS)) return null;
    ids.add(s.id);
    saida.push({ id: s.id, natureza: s.natureza, descricao: s.descricao, estado: s.estado as SubagenteVivo["estado"], passo: s.passo, chamadas: s.chamadas, duracaoMs: s.duracaoMs });
  }
  return saida;
}
/** A lista de tarefas do bot num trecho vivo: fora do formato ou acima dos tetos, o trecho some sozinho. */
function tarefasDoTrecho(v: unknown[]): TarefaDoBot[] | null {
  if (v.length > TETO_TAREFAS) return null;
  const saida: TarefaDoBot[] = [];
  for (const bruta of v) {
    const t = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
    if (!texto(t.id, 40) || !texto(t.titulo, TETO_TITULO_TAREFA) || !ESTADOS_DA_TAREFA.some((e) => e === t.estado)) return null;
    saida.push({ id: t.id, titulo: t.titulo, estado: t.estado as TarefaDoBot["estado"] });
  }
  return saida;
}
export function uuid(v: unknown): string { exigir(typeof v === "string" && UUID.test(v)); return v; }
/**
 * NOD-214: a sessão do CLI que a renovação traz (app ≥ PR 1 da NOD-214). Fora do formato vira ausente — nunca derruba a
 * renovação, que é o lease do turno.
 */
export function sessaoDaRenovacao(v: unknown): string | undefined { return typeof v === "string" && UUID.test(v) ? v : undefined; }
/**
 * Auditoria A4 (definido em 2026-10-15): os turnos que o processo da máquina roda agora, no `conectar` (app com a A4).
 * Ausente ou fora do formato = undefined, e o `conectar` segue a regra de antes (app antigo); nunca derruba o conectar,
 * que é a volta da máquina. O teto é o da memória por turno (um pool de laços não passa disso).
 */
export function turnosEmAndamento(v: unknown): Set<string> | undefined {
  if (!Array.isArray(v) || v.length > TETO_TURNOS_MEMORIA || !v.every((x) => typeof x === "string" && UUID.test(x))) return undefined;
  return new Set(v as string[]);
}
const TIPOS_ANEXO: readonly TipoAnexo[] = ["imagem", "pdf", "texto"];
/**
 * #189 (definido em 2026-10-07): os ids das mensagens que o app escreveu (ou não conseguiu escrever) na sessão. Ausente
 * = app antigo (undefined, e a absorção segue como antes); fora do formato, a renovação é recusada e o app reenvia.
 */
/**
 * definido em 2026-10-08 (revisão do épico, S15): as capacidades que a máquina anuncia por harness no conectar. Só ids
 * integrados e só as chaves de CapacidadesHarness, cada uma `true` só se veio `true` (`anexos`: só os tipos conhecidos);
 * o resto é ignorado (o anúncio é extra: app antigo não manda, e nada que dependa dele acontece). Nunca recusa o conectar.
 */
export function capacidadesAnunciadas(v: unknown): Partial<Record<IdHarness, CapacidadesHarness>> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const anunciadas = v as Record<string, unknown>;
  const saida: Partial<Record<IdHarness, CapacidadesHarness>> = {};
  for (const h of HARNESSES) {
    const c = anunciadas[h.id];
    if (!h.integrado || typeof c !== "object" || c === null || Array.isArray(c)) continue;
    const bruto = c as Record<string, unknown>;
    // NOD-207: `anexos` é uma lista; fica só o que é tipo de anexo conhecido.
    const anexos = Array.isArray(bruto.anexos) ? TIPOS_ANEXO.filter((t) => (bruto.anexos as unknown[]).includes(t)) : [];
    saida[h.id] = { ...SEM_CAPACIDADES, ...Object.fromEntries(Object.entries(SEM_CAPACIDADES).filter(([, v]) => typeof v === "boolean").map(([k]) => [k, bruto[k] === true])), anexos };
  }
  return Object.keys(saida).length > 0 ? saida : undefined;
}

export function idsDeMensagens(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  exigir(Array.isArray(v) && v.length <= TETO_FALAS_POR_RENOVACAO);
  return (v as unknown[]).map(uuid);
}
export function sinais(v: unknown): SinaisTurno {
  const s = objeto(v);
  exigir(["attempted", "rejected", "promptSubmitted", "producedOutput"].every((k) => typeof s[k] === "boolean"));
  return { attempted: s.attempted as boolean, rejected: s.rejected as boolean, promptSubmitted: s.promptSubmitted as boolean, producedOutput: s.producedOutput as boolean };
}
/** `nome`: o harness anunciado (ex.: "Codex"), para a frase de lentidão dizer quem demorou. */
export function inventario(v: unknown, agora: number, nome = "harness"): Inventario {
  const i = objeto(v);
  const inv = inventarioSemAtualizacao(i, agora, nome);
  // NOD-9: a fase da atualização do CLI atravessa reescrita (atualizacaoAnunciada); fora do formato, cai fora sozinha.
  const atualizacao = atualizacaoAnunciada(i.atualizacao);
  return atualizacao ? { ...inv, atualizacao } : inv;
}
function inventarioSemAtualizacao(i: Record<string, unknown>, agora: number, nome: string): Inventario {
  if (i.estado === "pronto") { exigir(texto(i.versao, 100)); return { estado: "pronto", versao: i.versao, em: agora }; }
  exigir(i.estado === "ausente" || i.estado === "nao_autenticado");
  // NOD-9 (definido em 2026-10-22): o nod está atualizando o CLI ali; a causa atravessa com a frase do servidor, e a fila
  // a trata como `sonda_lenta` (o turno fixado espera). Só em `ausente`: o app que atualiza anuncia o CLI como fora.
  if (i.estado === "ausente" && i.causa === "atualizando") return { estado: "ausente", motivo: motivoAtualizando(nome), causa: "atualizando", em: agora };
  // NOD-178: a causa atravessa (só o valor conhecido), e o motivo continua reescrito aqui, nunca o texto do Mac.
  if (i.causa === "sonda_lenta") return { estado: i.estado, motivo: motivoSondaLenta(nome), causa: "sonda_lenta", em: agora };
  // NOD-171: o CLI abaixo do piso atravessa com as duas versões (só no formato x.y.z[-pre]); a frase continua do servidor.
  if (i.estado === "ausente" && i.causa === "cli_antigo" && versaoSemver(i.versao) && versaoSemver(i.minima)) {
    return { estado: "ausente", motivo: motivoCliAntigo(nome, i.versao, i.minima), causa: "cli_antigo", versao: i.versao, minima: i.minima, em: agora };
  }
  // revisto em 2026-10-10 (PR 2 do plano das IAs): as causas do app novo (sem Node, configuração quebrada) atravessam, com
  // a frase do servidor; antes viravam "não encontrado" e a tela pedia "Instalar".
  const doMac = CAUSAS_DO_MAC.find((c) => c === i.causa);
  if (i.estado === "ausente" && doMac) return { estado: "ausente", motivo: MOTIVO_DA_CAUSA_DO_MAC[doMac].replace("{nome}", nome), causa: doMac, em: agora };
  if (i.estado === "ausente") return { estado: "ausente", motivo: "Harness não encontrado neste computador", em: agora };
  // definido em 2026-10-05: a causa é código fechado e a frase é do servidor — texto do Mac nunca vira motivo.
  const causa = causaSemIa(i.causa);
  return { estado: "nao_autenticado", motivo: causa ? MOTIVO_DA_CAUSA[causa] : "Entre na conta do harness neste computador", ...(causa ? { causa } : {}), em: agora };
}
const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/;
const versaoSemver = (v: unknown): v is string => typeof v === "string" && SEMVER.test(v);
/** definido em 2026-10-22 (NOD-9, J4 da NOD-8): o teto do espaço em MB (1 PB); acima disso o número não é de um disco. */
const ESPACO_MAX_MB = 1_000_000_000;
const mb = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= ESPACO_MAX_MB;
const instante = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
/**
 * NOD-9 (definido em 2026-10-22, revisão do Arquiteto): a atualização do CLI que a máquina anuncia. É extra: fora do
 * formato vira undefined e o anúncio segue (nunca recusa o conectar). Reescrita aqui: `fase`/`motivo`/`caminho` só pelos
 * enums, versões só no formato x.y.z[-pre] (a mesma forma de `extrairVersao`), instantes numéricos; o resto cai fora.
 */
export function atualizacaoAnunciada(v: unknown): AtualizacaoDaIa | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;
  const fase = FASES_ATUALIZACAO.find((f) => f === a.fase);
  if (!fase || !versaoSemver(a.alvo) || !instante(a.em)) return undefined;
  const motivo = MOTIVOS_ATUALIZACAO.find((m) => m === a.motivo);
  const caminho = CAMINHOS_ATUALIZACAO.find((c) => c === a.caminho);
  const e = typeof a.espaco === "object" && a.espaco !== null ? (a.espaco as Record<string, unknown>) : null;
  return {
    fase,
    ...(versaoSemver(a.antes) ? { antes: a.antes } : {}),
    ...(versaoSemver(a.depois) ? { depois: a.depois } : {}),
    alvo: a.alvo,
    ...(motivo ? { motivo } : {}),
    ...(caminho ? { caminho } : {}),
    em: a.em,
    ...(instante(a.seguraEm) ? { seguraEm: a.seguraEm } : {}),
    ...(e && mb(e.livreMb) && mb(e.precisaMb) ? { espaco: { livreMb: e.livreMb, precisaMb: e.precisaMb } } : {}),
  };
}
/** Só os códigos conhecidos passam; app antigo (sem o campo) ou valor estranho = sem causa. */
export function causaSemIa(v: unknown): CausaSemIa | undefined {
  return CAUSAS_SEM_IA.find((c) => c === v);
}
/** definido em 2026-10-05: o motivo cru do executor remoto é diagnóstico da pessoa; cabe em 8 KiB ou não entra. */
const ERRO_CRU_MAX_CHARS = 8_000;
const inteiro = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const inteiroOuNull = (v: unknown): v is number | null => v === null || inteiro(v);

/**
 * Raio-X da execução (modo dev, 0036). É telemetria: fora do formato ou acima dos tetos vira `undefined` e a
 * entrega segue — um turno nunca é recusado pelo Raio-X. Só os campos do contrato atravessam, reconstruídos aqui.
 */
export function execucao(v: unknown): ExecucaoRaioX | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const x = v as Record<string, unknown>;
  if (!Array.isArray(x.chamadas) || x.chamadas.length > TETO_CHAMADAS_RAIO_X || !Array.isArray(x.compactacoes) || x.compactacoes.length > TETO_COMPACTACOES_RAIO_X) return undefined;
  const chamadas: ChamadaRaioX[] = [];
  for (const bruta of x.chamadas as unknown[]) {
    if (!bruta || typeof bruta !== "object") return undefined;
    const c = bruta as Record<string, unknown>;
    const numeros = [c.em, c.contexto, c.entrada, c.cacheLido, c.cacheNovo, c.saida, c.pensamento];
    if (!numeros.every(inteiro) || typeof c.subagente !== "boolean" || !Array.isArray(c.ferramentas) || c.ferramentas.length > TETO_FERRAMENTAS_POR_CHAMADA) return undefined;
    const ferramentas: FerramentaNaChamada[] = [];
    for (const fb of c.ferramentas as unknown[]) {
      const f = (fb && typeof fb === "object" ? fb : {}) as Record<string, unknown>;
      if (!texto(f.nome, 200) || !inteiroOuNull(f.resultadoChars) || typeof f.erro !== "boolean") return undefined;
      ferramentas.push({ nome: f.nome, resultadoChars: f.resultadoChars, erro: f.erro });
    }
    chamadas.push({ em: c.em as number, contexto: c.contexto as number, entrada: c.entrada as number, cacheLido: c.cacheLido as number, cacheNovo: c.cacheNovo as number, saida: c.saida as number, pensamento: c.pensamento as number, subagente: c.subagente, ferramentas });
  }
  if (chamadas.reduce((n, c) => n + c.ferramentas.length, 0) > TETO_FERRAMENTAS_RAIO_X) return undefined;
  const compactacoes: CompactacaoRaioX[] = [];
  for (const bruta of x.compactacoes as unknown[]) {
    const c = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
    if (!inteiro(c.em) || !inteiroOuNull(c.antes) || !inteiroOuNull(c.depois) || !texto(c.gatilho, 40)) return undefined;
    compactacoes.push({ em: c.em, antes: c.antes, depois: c.depois, gatilho: c.gatilho });
  }
  const custo = x.custoSessaoUsd;
  if (!inteiro(x.chamadasOmitidas) || !inteiroOuNull(x.janela) || !inteiro(x.ferramentasNoInit) || !inteiro(x.duracaoMs) || typeof x.buscaDeFerramentas !== "boolean") return undefined;
  if (!(x.modelo === null || texto(x.modelo, 100)) || !(x.versaoCli === null || texto(x.versaoCli, 100))) return undefined;
  if (!(custo === null || (typeof custo === "number" && Number.isFinite(custo) && custo >= 0))) return undefined;
  // Chat limpo (PR 1): opcional (o app do Mac de antes não manda); presente, tem de ser inteiro não negativo.
  if (x.blocosColados !== undefined && !inteiro(x.blocosColados)) return undefined;
  return {
    chamadas, chamadasOmitidas: x.chamadasOmitidas, compactacoes, janela: x.janela, modelo: x.modelo, versaoCli: x.versaoCli,
    custoSessaoUsd: custo, ferramentasNoInit: x.ferramentasNoInit, buscaDeFerramentas: x.buscaDeFerramentas, duracaoMs: x.duracaoMs,
    ...(x.blocosColados !== undefined ? { blocosColados: x.blocosColados as number } : {}),
  };
}

/** O catálogo do "/" (0038). Como o Raio-X, é extra: fora do formato vira undefined e a entrega segue. */
export function comandos(v: unknown): CatalogoDeComandos | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const c = v as Record<string, unknown>;
  if (!Array.isArray(c.comandos) || c.comandos.length > TETO_COMANDOS || !Array.isArray(c.soDoTerminal) || c.soDoTerminal.length > TETO_SO_DO_TERMINAL) return undefined;
  const nome = (x: unknown): x is string => texto(x, 160) && /^[\w.:-]+$/.test(x);
  const lista: ComandoDoMac[] = [];
  for (const bruto of c.comandos as unknown[]) {
    const k = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
    if (!nome(k.nome) || !texto(k.descricao, TETO_DESCRICAO_COMANDO) || !texto(k.origem, 60) || !(k.argumento === undefined || texto(k.argumento, 120))) return undefined;
    lista.push({ nome: k.nome, descricao: k.descricao, origem: k.origem, ...(k.argumento !== undefined ? { argumento: k.argumento as string } : {}) });
  }
  if (!(c.soDoTerminal as unknown[]).every(nome) || !(c.versaoCli === null || texto(c.versaoCli, 60))) return undefined;
  return { comandos: lista, soDoTerminal: c.soDoTerminal as string[], versaoCli: c.versaoCli as string | null };
}

/**
 * definido em 2026-10-11: o motivo de cada negação do hook do nod. Extra como o uso do plano: fora do formato, some e a
 * pílula fica com o texto de antes; nunca recusa a entrega.
 */
function negacoesDoNod(v: unknown): { nome: string; motivo: string }[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > 1000) return undefined;
  const ok = v.every((x) => {
    const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null;
    return o !== null && typeof o.nome === "string" && o.nome.length <= 200 && typeof o.motivo === "string" && o.motivo.length <= 1000;
  });
  return ok ? (v as { nome: string; motivo: string }[]).map(({ nome, motivo }) => ({ nome, motivo })) : undefined;
}

/** NOD-245: quantas ferramentas chamadas (e negações) a entrega guarda — as últimas; o resto é cortado, não recusado. */
export const LISTA_DA_ENTREGA_MAX = 1000;

/**
 * NOD-353: os índices das chamadas que falharam, extra como o uso do plano — fora do formato some e a entrega segue. Os
 * índices andam junto com o corte das `LISTA_DA_ENTREGA_MAX` últimas chamadas.
 */
export function ferramentasFalharam(v: unknown, total: number): number[] {
  if (!Array.isArray(v) || v.length > total || !v.every((i) => Number.isSafeInteger(i) && i >= 0 && i < total)) return [];
  const corte = Math.max(0, total - LISTA_DA_ENTREGA_MAX);
  return [...new Set(v as number[])].filter((i) => i >= corte).map((i) => i - corte).sort((a, b) => a - b);
}

export function entrega(v: unknown, machineId: string, agora: number = Date.now()): Entrega {
  const e = objeto(v), r = objeto(e.resultado), f = objeto(e.fala), t = objeto(r.tokens);
  exigir(Number.isSafeInteger(e.seqLocal) && Number(e.seqLocal) > 0);
  exigir(f.tipo === "texto" ? texto(f.texto) : f.tipo === "passe" && MOTIVOS_PASSE.some((m) => m === f.motivo));
  exigir(["sucesso", "falha", "interrompido"].includes(String(r.desfecho)) && texto(r.texto));
  exigir(r.sessaoCli === null || (typeof r.sessaoCli === "string" && UUID.test(r.sessaoCli)));
  exigir(r.custoUsd === null || (typeof r.custoUsd === "number" && Number.isFinite(r.custoUsd) && r.custoUsd >= 0));
  exigir(["entrada", "saida", "cacheLeitura", "cacheCriacao"].every((k) => Number.isSafeInteger(t[k]) && Number(t[k]) >= 0));
  // revisto em 2026-10-15 (NOD-245): mais de 1000 itens não recusa mais a entrega (um turno com 2333 ferramentas virava
  // 400 e "máquina sem contato"): as listas guardam só as últimas LISTA_DA_ENTREGA_MAX, abaixo. Cada item segue conferido.
  exigir([r.ferramentasChamadas, r.negacoesPermissao].every((a) => Array.isArray(a) && a.every((x) => texto(x, 200))));
  exigir(r.motivoFalha === undefined || MOTIVOS_FALHA.some((m) => m === r.motivoFalha));
  exigir(r.motivoInterrupcao === undefined || MOTIVOS_INTERRUPCAO.some((m) => m === r.motivoInterrupcao));
  const validados = sinais(r.sinais);
  const raioX = execucao(r.execucao);
  const catalogo = comandos(r.comandos);
  const causa = causaSemIa(r.causaSemIa);
  const doNod = negacoesDoNod(r.negacoesDoNod);
  // NOD-179: o uso do plano também é extra; fora do formato ou com número absurdo, some e a entrega segue.
  const uso = r.usoDoPlano === undefined ? undefined : usoDoPlanoValido(r.usoDoPlano, agora);
  // definido em 2026-09-17: erroCru remoto não entra no log; só os campos do contrato validado atravessam HTTP.
  // revisto em 2026-10-05: ele passa a ATRAVESSAR, com teto, só para o diagnóstico gravado da pessoa (ADR-041) — em
  // produção o diagnóstico de todo turno falho vinha vazio, porque o campo morria aqui. Continua fora do log
  // (ponte-interna, `erroCruNoLog: false` na ponte das máquinas).
  const erroCru = typeof r.erroCru === "string" && r.erroCru.length <= ERRO_CRU_MAX_CHARS ? r.erroCru : null;
  // NOD-171: extra como o uso do plano. Só com o limite e até 31 dias à frente; fora disso some (a frase fica sem hora).
  // NOD-280 (definido em 2026-10-15): o que passa de 8 dias chega cortado em 8 (PRAZO_LIMITE_MAXIMO_MS) — a conta não fica
  // presa um mês e a frase diz a mesma hora que o servidor grava.
  const voltaEm = r.motivoFalha === "limite_do_plano" && Number.isSafeInteger(r.limiteVoltaEm) && Number(r.limiteVoltaEm) > 0 && Number(r.limiteVoltaEm) <= agora + 31 * 86_400_000 ? Math.min(Number(r.limiteVoltaEm), agora + PRAZO_LIMITE_MAXIMO_MS) : null;
  // ADR-101 (2026-10-12): a decisão do Mac sobre as contas no limite, só num turno falho; fora do formato some. Não só
  // com `limite_do_plano`: o limite do Codex chega como `erro_execucao` com o texto do fornecedor, e o servidor só a usa
  // quando ele mesmo classifica o turno como limite (assentar-turno).
  const contaNoLimite = typeof r.motivoFalha === "string" ? contaNoLimiteValida(r.contaNoLimite, agora) : undefined;
  // NOD-264 (C20): a causa do turno sem result, só em forma de código; fora disso some e a entrega segue.
  // NOD-293 (C20): o turno falho também leva (`falha:<subtype>`, `turno_recusado`): ele vira `trabalho_incompleto` quando o
  // modelo já tinha escrito, e chegava sem causa. Sucesso nunca leva.
  const causaDoFim = r.desfecho !== "sucesso" ? causaDaEntrega(r.causa) : null;
  // Revisão do épico (S19, 2026-10-08): o que o CLI recebeu e não foi confirmado numa renovação.
  const entregues = idsDeMensagens(e.mensagensEntregues);
  const falharam = ferramentasFalharam(r.ferramentasFalharam, (r.ferramentasChamadas as string[]).length);
  // NOD-54 (ADR-134): o resumo do checkpoint é extra; fora do formato some e o turno fica sem "Desfazer".
  const checkpoint = resumoCheckpointValido(r.checkpoint);
  return { turnoId: uuid(e.turnoId), machineId, seqLocal: Number(e.seqLocal), fala: f as Entrega["fala"], ...(entregues?.length ? { mensagensEntregues: entregues } : {}), resultado: {
    desfecho: r.desfecho as Entrega["resultado"]["desfecho"], texto: r.texto, sessaoCli: r.sessaoCli as string | null,
    custoUsd: r.custoUsd as number | null, ...(r.custoDesconhecido === true && r.custoUsd === null ? { custoDesconhecido: true } : {}), sinais: validados, tokens: t as Entrega["resultado"]["tokens"],
    ferramentasChamadas: (r.ferramentasChamadas as string[]).slice(-LISTA_DA_ENTREGA_MAX), ...(falharam.length > 0 ? { ferramentasFalharam: falharam } : {}), negacoesPermissao: (r.negacoesPermissao as string[]).slice(-LISTA_DA_ENTREGA_MAX),
    motivoFalha: r.motivoFalha as Entrega["resultado"]["motivoFalha"], motivoInterrupcao: r.motivoInterrupcao as Entrega["resultado"]["motivoInterrupcao"],
    ...(raioX ? { execucao: raioX } : {}),
    ...(catalogo ? { comandos: catalogo } : {}),
    ...(erroCru ? { erroCru } : {}),
    ...(causaDoFim ? { causa: causaDoFim } : {}),
    ...(causa ? { causaSemIa: causa } : {}),
    ...(doNod ? { negacoesDoNod: doNod } : {}),
    ...(uso ? { usoDoPlano: uso } : {}),
    ...(voltaEm !== null ? { limiteVoltaEm: voltaEm } : {}),
    ...(contaNoLimite ? { contaNoLimite } : {}),
    // ADR-102 (R6): só num turno interrompido, e só o booleano.
    ...(r.desfecho === "interrompido" && r.contaAusente === true ? { contaAusente: true as const } : {}),
    ...(checkpoint ? { checkpoint } : {}),
  } };
}

/**
 * ADR-099 (parte 2, definido em 2026-10-12): o relato de uma espera. A saída vem cortada pelo app (as últimas linhas); o
 * teto aqui é 4× o que se guarda, só para recusar o absurdo — o servidor corta de novo (ultimasLinhas).
 */
export function relatoEspera(v: unknown): RelatoEspera {
  const r = objeto(v);
  const id = uuid(r.id);
  if (r.tipo === "iniciou") return { id, tipo: "iniciou" };
  if (r.tipo === "caiu") {
    exigir(r.motivo === "pasta_ausente" || r.motivo === "nao_iniciou");
    return { id, tipo: "caiu", motivo: r.motivo };
  }
  exigir(r.tipo === "terminou");
  exigir(r.codigo === null || (typeof r.codigo === "number" && Number.isInteger(r.codigo) && r.codigo >= -1 && r.codigo <= 255));
  exigir(texto(r.saida, 4 * SAIDA_ESPERA_MAX));
  return { id, tipo: "terminou", codigo: r.codigo as number | null, saida: r.saida };
}

/**
 * NOD-54 (ADR-134): o relato de um desfazer. Progresso (`feitos` de `total`) ou fim: o resultado (até 1000 arquivos, cada
 * caminho como a tela mostra) ou a falha. Fora do formato, 400: a máquina guarda e manda de novo, e o servidor nunca grava
 * caminho torto.
 */
export function relatoDesfazer(v: unknown): RelatoDesfazer {
  const r = objeto(v);
  const turnoId = uuid(r.turnoId);
  exigir(Number.isSafeInteger(r.feitos) && Number.isSafeInteger(r.total) && Number(r.feitos) >= 0 && Number(r.total) >= 0 && Number(r.total) <= 1_000_000);
  exigir(Number.isSafeInteger(r.tentativa) && Number(r.tentativa) >= 1);
  const base = { turnoId, tentativa: Number(r.tentativa), feitos: Number(r.feitos), total: Number(r.total) };
  if (r.falha !== undefined) {
    exigir(r.falha === "sem_checkpoint" || r.falha === "erro");
    return { ...base, falha: r.falha };
  }
  if (r.resultado === undefined) return base;
  const arquivos = objeto(r.resultado).arquivos;
  exigir(Array.isArray(arquivos) && arquivos.length <= 1000);
  return { ...base, resultado: { arquivos: arquivos.map((a) => {
    const x = objeto(a);
    exigir(caminhoValido(x.caminho) && DESFECHOS_ARQUIVO.includes(x.desfecho as DesfechoArquivo));
    return { caminho: x.caminho, desfecho: x.desfecho as DesfechoArquivo };
  }) } };
}

/**
 * ADR-102 (2026-10-13): as contas que a máquina anuncia (`conectar` e `inventario`). É extra como as capacidades: app
 * ou motor antigo não manda (undefined, nada muda), e o anúncio nunca é recusado por isto — item fora do formato some.
 * Impressão (sha256 hex), IA com conta, estado conhecido, plano curto, o apelido sugerido e (ADR-105, 2026-10-15) o
 * e-mail e a organização que o CLI disse, pelos mesmos normalizadores da máquina; fora do formato, o campo some.
 */
export function contasAnunciadas(v: unknown, agora: number): ContaAnunciada[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const saida: ContaAnunciada[] = [];
  const vistas = new Set<string>();
  for (const bruto of v.slice(0, CONTAS_ANUNCIADAS_MAX)) {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) continue;
    const o = bruto as Record<string, unknown>;
    if (typeof o.impressao !== "string" || !IMPRESSAO.test(o.impressao) || !ehIaComConta(o.ia) || !ESTADOS_CONTA_NA_MAQUINA.includes(o.estado as EstadoContaNaMaquina)) continue;
    if (vistas.has(`${o.ia}:${o.impressao}`)) continue;
    vistas.add(`${o.ia}:${o.impressao}`);
    const plano = typeof o.plano === "string" && /^[\p{L}\p{N} ._-]{1,40}$/u.test(o.plano) ? o.plano : null;
    const logadaEm = Number.isSafeInteger(o.logadaEm) && Number(o.logadaEm) > 0 && Number(o.logadaEm) <= agora + 60_000 ? Number(o.logadaEm) : 0;
    // Red team do PR #306: um apelido com "@" seria o e-mail (a ADR-101 usava a organização, "<e-mail>'s Organization").
    const apelido = typeof o.apelidoSugerido === "string" && o.apelidoSugerido.includes("@") ? null : apelidoValido(o.apelidoSugerido);
    const email = emailDaConta(o.email);
    const organizacao = organizacaoDaConta(o.organizacao);
    saida.push({
      impressao: o.impressao, ia: o.ia, estado: o.estado as EstadoContaNaMaquina, plano, corporativa: o.corporativa === true, logadaEm,
      ...(apelido ? { apelidoSugerido: apelido } : {}), ...(email ? { email } : {}), ...(organizacao ? { organizacao } : {}),
    });
  }
  return saida;
}

const FASES_DO_PROGRESSO: readonly ProgressoDoLogin["fase"][] = ["preparando", "abrindo", "aguardando_pessoa", "conferindo", "pronto", "falhou"];
/** O progresso de um login relatado pela máquina; o conteúdo (link oficial, código, chave) é conferido no serviço. */
export function progressoDoLogin(v: unknown): ProgressoDoLogin {
  const o = objeto(v);
  exigir(typeof o.loginId === "string" && UUID.test(o.loginId) && FASES_DO_PROGRESSO.includes(o.fase as ProgressoDoLogin["fase"]));
  const p: ProgressoDoLogin = { loginId: o.loginId, fase: o.fase as ProgressoDoLogin["fase"] };
  if (o.url !== undefined) { exigir(texto(o.url, 4_096)); p.url = o.url; }
  if (o.codigoDispositivo !== undefined) { exigir(texto(o.codigoDispositivo, 20)); p.codigoDispositivo = o.codigoDispositivo; }
  if (o.pedeCodigo !== undefined) { exigir(typeof o.pedeCodigo === "boolean"); p.pedeCodigo = o.pedeCodigo; }
  if (o.chavePublica !== undefined) { exigir(texto(o.chavePublica, 2_048)); p.chavePublica = o.chavePublica; }
  if (o.erro !== undefined) { exigir(texto(o.erro, 40)); p.erro = o.erro; }
  if (o.impressao !== undefined) { exigir(typeof o.impressao === "string" && IMPRESSAO.test(o.impressao)); p.impressao = o.impressao; }
  if (o.preparo !== undefined) p.preparo = preparoDoLogin(o.preparo);
  return p;
}

/** NOD-8: a versão de um CLI no preparo ("2.1.304", "0.159.0-alpha.2"); nada que vire marcação ou caminho. */
const VERSAO_DO_PREPARO = /^\d{1,6}(\.\d{1,6}){1,3}([-+][0-9A-Za-z.-]{1,24})?$/;
/** NOD-8: a etapa do preparo, uma linha curta (sem caracteres de controle). */
const LINHA_DO_PREPARO = /^[^\p{Cc}]{1,80}$/u;
const CAMPOS_DO_PREPARO = new Set(["acao", "linha", "antes", "depois", "atualizacao"]);
/** NOD-8 (definido em 2026-10-22; `atualizacao` no passo 9): o passo 1 do login. Campo fora da lista ou fora do formato = 400 (o motor repete sem). */
export function preparoDoLogin(v: unknown): PreparoDoLogin {
  const o = objeto(v);
  exigir(Object.keys(o).every((k) => CAMPOS_DO_PREPARO.has(k)) && ACOES_DO_PREPARO.includes(o.acao as PreparoDoLogin["acao"]));
  const p: PreparoDoLogin = { acao: o.acao as PreparoDoLogin["acao"] };
  if (o.linha !== undefined) { exigir(typeof o.linha === "string" && LINHA_DO_PREPARO.test(o.linha)); p.linha = o.linha; }
  if (o.antes !== undefined) { exigir(typeof o.antes === "string" && VERSAO_DO_PREPARO.test(o.antes)); p.antes = o.antes; }
  if (o.depois !== undefined) { exigir(typeof o.depois === "string" && VERSAO_DO_PREPARO.test(o.depois)); p.depois = o.depois; }
  // Passo 9: a mesma leitura do anúncio da NOD-9; aqui fora do formato é 400 (o motor repete sem o preparo).
  if (o.atualizacao !== undefined) { const a = atualizacaoAnunciada(o.atualizacao); exigir(a !== undefined); p.atualizacao = a; }
  return p;
}

/**
 * NOD-94: o progresso de uma instalação por SSH relatado pela instaladora. A forma é conferida aqui; a etapa, o motivo e
 * a impressão, no serviço (instalacoes-por-ssh.ts). As linhas do script (no máximo 20, cada uma cortada em 300) já vêm
 * sem segredo da instaladora — o servidor não as loga.
 */
export function progressoDeInstalacao(v: unknown): ProgressoDeInstalacao {
  const o = objeto(v);
  exigir(typeof o.id === "string" && UUID.test(o.id) && (o.etapa !== undefined || o.erro !== undefined));
  const p: ProgressoDeInstalacao = { id: o.id };
  if (o.etapa !== undefined) { exigir(texto(o.etapa, 40)); p.etapa = o.etapa as ProgressoDeInstalacao["etapa"]; }
  if (o.erro !== undefined) { exigir(texto(o.erro, 40)); p.erro = o.erro as ProgressoDeInstalacao["erro"]; }
  if (o.impressao !== undefined) { exigir(texto(o.impressao, 200)); p.impressao = o.impressao; }
  if (o.linhas !== undefined) {
    exigir(Array.isArray(o.linhas) && o.linhas.length <= 20 && o.linhas.every((l) => texto(l, 300)));
    p.linhas = o.linhas as string[];
  }
  return p;
}

/** As impressões de que a máquina saiu (logout feito). */
export function impressoes(v: unknown): string[] {
  exigir(Array.isArray(v) && v.length <= CONTAS_ANUNCIADAS_MAX && v.every((x) => typeof x === "string" && IMPRESSAO.test(x)));
  return v as string[];
}

/**
 * NOD-96 PR 3 (definido em 2026-10-22): o anúncio `computador` da máquina. Fora do formato vira ausente (o computador não
 * vai para ela) — nunca derruba o `conectar`. `falta` só com nomes curtos de pacote.
 */
export function anuncioComputador(v: unknown): AnuncioComputador | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const estado = ESTADOS_ANUNCIO_COMPUTADOR.find((e) => e === r.estado);
  if (!estado) return undefined;
  const falta = Array.isArray(r.falta) ? r.falta.filter((x): x is string => typeof x === "string" && /^[a-z0-9][a-z0-9.+-]{0,63}$/.test(x)).slice(0, 20) : [];
  return falta.length > 0 ? { estado, falta } : { estado };
}
/**
 * NOD-93 (ADR-127 §4): o `vmLocal` do Mac. Fora do formato vira ausente (o Mac segue sem preparo na tela), nunca derruba
 * o `conectar`. Números inteiros não negativos; `motivo` curto, sem quebra de linha.
 */
export function anuncioVmLocal(v: unknown): VmLocalAnunciada | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const estado = ESTADOS_VM_LOCAL.find((e) => e === r.estado);
  const inteiro = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
  if (!estado || !inteiro(r.desde)) return undefined;
  return {
    estado, desde: r.desde,
    ...(inteiro(r.bytes) ? { bytes: r.bytes } : {}),
    ...(inteiro(r.total) ? { total: r.total } : {}),
    ...(typeof r.motivo === "string" && r.motivo.length <= 300 && !/[\r\n]/.test(r.motivo) ? { motivo: r.motivo } : {}),
  };
}
const ID_COMANDO = /^[A-Za-z0-9_-]{1,64}$/;
const B64_CHAVE = /^[A-Za-z0-9+/]{43}=$/;
/** A resposta do supervisor a um comando. O `resultado` vai ao agente como veio (o supervisor é da pessoa, como o motor). */
export function resultadoComandoComputador(v: unknown): ResultadoComandoComputador {
  const r = objeto(v);
  exigir(typeof r.id === "string" && ID_COMANDO.test(r.id));
  const desfecho = DESFECHOS_COMANDO_COMPUTADOR.find((x) => x === r.desfecho);
  exigir(desfecho);
  const saida: ResultadoComandoComputador = { id: r.id, desfecho };
  if (desfecho === "ok" && r.resultado !== undefined) saida.resultado = objeto(r.resultado) as ResultadoComputador;
  if (desfecho === "falhou") saida.motivo = MOTIVOS_FALHA_COMPUTADOR.find((m) => m === r.motivo) ?? "acao_falhou";
  if (desfecho === "esperando_tela") saida.quem = Array.isArray(r.quem) ? r.quem.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 32) : [];
  if (r.progresso !== undefined) {
    const p = objeto(r.progresso);
    if (typeof p.pct === "number" && p.pct >= 0 && p.pct <= 100 && texto(p.etapa, 200)) saida.progresso = { pct: p.pct, etapa: p.etapa };
  }
  // NOD-96 PR 5: a X25519 nova do supervisor depois do Redefinir.
  if (desfecho === "ok" && typeof r.supervisorPub === "string" && B64_CHAVE.test(r.supervisorPub)) saida.supervisorPub = r.supervisorPub;
  // NOD-365: a parte do pacote da loja (cifrada) na troca de máquina.
  if (desfecho === "ok" && r.logins !== undefined) {
    const l = objeto(r.logins);
    const inteiro = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
    exigir(inteiro(l.parte) && inteiro(l.total) && l.parte < l.total && typeof l.dados === "string" && l.dados.length <= TETO_PARTE_LOGINS_B64 && /^[A-Za-z0-9+/]*={0,2}$/.test(l.dados));
    saida.logins = { parte: l.parte, total: l.total, dados: l.dados };
  }
  return saida;
}
/** A foto do computador. `computadorId` vazio = supervisor ainda sem computador (só a X25519 importa). */
export function estadoComputadorRelatado(v: unknown): EstadoComputadorRelatado {
  const r = objeto(v);
  exigir(typeof r.computadorId === "string" && (r.computadorId === "" || UUID.test(r.computadorId)));
  exigir(typeof r.ligado === "boolean" && typeof r.supervisorPub === "string" && B64_CHAVE.test(r.supervisorPub));
  exigir(Array.isArray(r.telas) && r.telas.length <= 64);
  const numero = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
  const telas = (r.telas as unknown[]).map((t) => {
    const o = objeto(t);
    exigir(typeof o.agenteId === "string" && UUID.test(o.agenteId));
    const estado = ESTADOS_TELA_COMPUTADOR.find((e) => e === o.estado);
    exigir(estado);
    return { agenteId: o.agenteId, estado, ultimaAcaoEm: numero(o.ultimaAcaoEm), memoriaMb: numero(o.memoriaMb) };
  });
  const foto: EstadoComputadorRelatado = { computadorId: r.computadorId, ligado: r.ligado, supervisorPub: r.supervisorPub, telas };
  // NOD-96 PR 5: a operação em curso (Atualizar, Redefinir, Sair de todos). Fora do formato vira ausente.
  if (r.operacao && typeof r.operacao === "object" && !Array.isArray(r.operacao)) {
    const o = r.operacao as Record<string, unknown>;
    const tipo = OPERACOES_COMPUTADOR.find((x) => x === o.tipo);
    if (tipo && typeof o.pct === "number" && Number.isFinite(o.pct) && o.pct >= 0 && o.pct <= 100 && typeof o.etapa === "string" && o.etapa.length <= 200) foto.operacao = { tipo, pct: o.pct, etapa: o.etapa };
  } else if (r.operacao === null) foto.operacao = null;
  return foto;
}
