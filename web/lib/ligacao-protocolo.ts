import type {
  AcaoComandoVoz,
  CAUSAS_CEREBRO_CAIU as CausasCerebroCaiu,
  CausaCerebroCaiu,
  ESTADOS_IA_DA_LIGACAO as EstadosIa,
  EstadoIaDaLigacao,
  IAS_DA_LIGACAO as IasDaLigacao,
  IaDaLigacao,
  CABECALHO_MICROFONE_BYTES as CabMicrofone,
  CABECALHO_VOZ_BYTES as CabVoz,
  FaseLigacao,
  MENSAGEM_MAX_BYTES as MaxBytes,
  MOTIVOS_FIM_LIGACAO as MotivosFim,
  MotivoFimLigacao,
  MsgMidiaCliente,
  MsgMidiaServidor,
  QUADRO_MICROFONE as QuadroMicrofone,
  QUADRO_MS as QuadroMs,
  QUADRO_VOZ as QuadroVoz,
  RotaSaida,
  TAXA_MICROFONE_HZ as TaxaMicrofone,
  TAXA_VOZ_HZ as TaxaVoz,
  TipoFalaBot,
  VERSAO_PROTOCOLO_VOZ as VersaoProtocolo,
  FECHAMENTOS_VOZ as FechamentosVoz,
  SUGESTOES_MAX as SugestoesMax,
  SUGESTAO_MAX_CHARS as SugestaoMaxChars,
} from "../../src/contracts/voz.ts";
import type { CamposEntrevista, EtapaOnboarding, TamanhoTime, ETAPAS_ONBOARDING as EtapasOnboarding, TAMANHOS_TIME as TamanhosTime } from "../../src/contracts/onboarding.ts";

/**
 * Protocolo nod-voz/1 do lado do renderer (definido em 2026-10-04, ADR-071). A web só faz `import type` de src/: os
 * valores de src/contracts/voz.ts são repetidos aqui com o TIPO da origem (`typeof X`), então qualquer mudança lá
 * deixa de compilar aqui em vez de divergir em silêncio.
 */
export const VERSAO_PROTOCOLO: typeof VersaoProtocolo = 1;
export const QUADRO_MICROFONE: typeof QuadroMicrofone = 0x01;
export const QUADRO_VOZ: typeof QuadroVoz = 0x02;
export const TAXA_MICROFONE_HZ: typeof TaxaMicrofone = 16_000;
export const TAXA_VOZ_HZ: typeof TaxaVoz = 24_000;
export const QUADRO_MS: typeof QuadroMs = 20;
export const CABECALHO_MICROFONE_BYTES: typeof CabMicrofone = 5;
export const CABECALHO_VOZ_BYTES: typeof CabVoz = 7;
export const MENSAGEM_MAX_BYTES: typeof MaxBytes = 64 * 1024;
/**
 * O que o motor da ligação (web/lib/ligacao.ts) avisa por conta própria, fora do protocolo: microfone, áudio do
 * navegador, reconexão e quedas. Mora aqui (sem DOM) para a tela poder importar o tipo sem puxar o motor.
 */
export type EstadoLocalLigacao =
  | "microfone-negado"
  | "microfone-restrito"
  | "microfone-indisponivel"
  /** O microfone abriu mas só manda silêncio absoluto (zeros): aparelho errado ou bloqueado pelo sistema. */
  | "microfone-mudo"
  | "audio-suspenso"
  | "reconectando"
  | "conectado"
  | "caiu"
  | "encerrada-pelo-servidor"
  | "voz-fora"
  | "ja-em-ligacao"
  | "sessao-expirada"
  | "comando-falhou";

/** Motivos do 👎 em "Como foi a ligação?" (definido em 2026-10-04, protótipo HiFiMac). */
export type MotivoAvaliacaoLigacao = "demorou" | "nao_entendeu" | "interrompeu" | "voz" | "outro";

/** Onboarding por ligação (definido em 2026-10-04, ADR-077): os chips "Diga algo como" e as etapas que a mídia anuncia. */
export const SUGESTOES_MAX: typeof SugestoesMax = 4;
export const SUGESTAO_MAX_CHARS: typeof SugestaoMaxChars = 80;
const ETAPAS: typeof EtapasOnboarding = ["ola", "executor", "chamando", "entrevista", "configurando", "concluido"];
const TAMANHOS: typeof TamanhosTime = ["so_eu", "2_10", "11_50", "51_mais"];

/** Os campos da entrevista conferidos um a um: texto curto ou null; o tamanho só dos quatro códigos. */
function lerCampos(v: unknown): CamposEntrevista | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  const texto = (x: unknown, max: number): string | null | undefined => (x === null || x === undefined ? null : typeof x === "string" && x.length <= max ? x : undefined);
  const apelido = texto(c.apelido, 60);
  const comoConheceu = texto(c.comoConheceu, 200);
  const objetivo = texto(c.objetivo, 500);
  const tamanhoTime = c.tamanhoTime === null || c.tamanhoTime === undefined ? null : typeof c.tamanhoTime === "string" && (TAMANHOS as readonly string[]).includes(c.tamanhoTime) ? (c.tamanhoTime as TamanhoTime) : undefined;
  if (apelido === undefined || comoConheceu === undefined || objetivo === undefined || tamanhoTime === undefined) return null;
  return { apelido, comoConheceu, objetivo, tamanhoTime };
}

/** 320 amostras: 20 ms a 16 kHz. */
export const AMOSTRAS_POR_QUADRO = (TAXA_MICROFONE_HZ * QUADRO_MS) / 1000;

export const FECHAMENTOS: typeof FechamentosVoz = {
  versao: 4400,
  sessao: 4401,
  origem: 4403,
  naoEncontrada: 4404,
  jaEmLigacao: 4409,
  encerrada: 4410,
  abuso: 4429,
  vozFora: 4503,
};

const MOTIVOS_FIM: typeof MotivosFim = [
  "pessoa_desligou",
  "bot_desligou",
  "tempo_maximo",
  "limite_diario",
  "cerebro_caiu",
  "midia_caiu",
  "reinicio_servidor",
  "drenagem",
  "nao_atendida",
  "recusada",
  "voz_indisponivel",
  "ociosidade",
  "limite_da_assinatura",
  "erro",
  "sem_ia",
];

/** Rede de segurança (definido em 2026-10-05): os códigos do aviso "a IA caiu", conferidos um a um como o resto. */
const CAUSAS_CEREBRO: typeof CausasCerebroCaiu = ["conta_sem_acesso", "falhou", "limite"];
const IAS_LIGACAO: typeof IasDaLigacao = ["claude-cli", "codex-cli"];
const ESTADOS_IA: typeof EstadosIa = ["pronto", "nao_autenticado", "ausente"];
const ehIa = (v: unknown): v is IaDaLigacao => typeof v === "string" && (IAS_LIGACAO as readonly string[]).includes(v);

const ehVersao = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/.test(v);

/** O estado das IAs do Mac: no máximo uma linha por IA conhecida; qualquer linha fora do formato invalida a lista. */
function lerIas(v: unknown): EstadoIaDaLigacao[] | null {
  if (!Array.isArray(v) || v.length > IAS_LIGACAO.length) return null;
  const ias: EstadoIaDaLigacao[] = [];
  for (const x of v) {
    if (typeof x !== "object" || x === null) return null;
    const i = x as Record<string, unknown>;
    const estado = ESTADOS_IA.find((e) => e === i.estado);
    if (!ehIa(i.id) || !estado || ias.some((y) => y.id === i.id)) return null;
    // NOD-171: o CLI abaixo do piso passa com as duas versões; versão fora do formato derruba só a causa.
    const antigo = estado === "ausente" && i.causa === "cli_antigo" && ehVersao(i.versao) && ehVersao(i.minima) ? { causa: "cli_antigo" as const, versao: i.versao, minima: i.minima } : {};
    const lenta = i.causa === "sonda_lenta" ? { causa: "sonda_lenta" as const } : null;
    const atualizando = estado === "ausente" && i.causa === "atualizando" ? { causa: "atualizando" as const } : null;
    ias.push({ id: i.id, estado, ...(lenta ?? atualizando ?? antigo) });
  }
  return ias;
}

/** Fechamentos depois dos quais reconectar não adianta: a sessão, a ligação ou a versão não valem mais. */
/**
 * A rota pelo nome do aparelho de saída padrão (definido em 2026-10-04): o Chromium do Mac dá nomes como "Padrão -
 * AirPods Pro (Bluetooth)", "Fones de ouvido externos (Built-in)" ou "Alto-falantes (MacBook Pro) (Built-in)". Fone
 * vem antes porque o fone com fio também é "Built-in". Caixa de som Bluetooth e nome desconhecido não contam como fone.
 */
export function rotaPeloNome(nome: string): RotaSaida {
  const n = nome.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/fone|headphone|headset|earphone|earbud|airpods|earpods|\bbuds|beats|auricular|\bwh-|\bwf-|jabra|sennheiser|plantronics|quietcomfort/.test(n)) return "fone";
  if (/speaker|alto-?falante|alto falante|built-in|integrad|macbook|imac|display|monitor|hdmi|\btv\b/.test(n)) return "alto-falante";
  return "desconhecida";
}

export function fechamentoDefinitivo(codigo: number): boolean {
  return codigo === FECHAMENTOS.versao || codigo === FECHAMENTOS.sessao || codigo === FECHAMENTOS.origem || codigo === FECHAMENTOS.naoEncontrada || codigo === FECHAMENTOS.jaEmLigacao || codigo === FECHAMENTOS.encerrada || codigo === FECHAMENTOS.abuso || codigo === FECHAMENTOS.vozFora;
}

/** Quadro 0x01: tipo (1 byte) + sequência u32 LE + PCM16LE mono a 16 kHz. */
export function quadroMicrofone(seq: number, pcm: Int16Array): ArrayBuffer {
  const buf = new ArrayBuffer(CABECALHO_MICROFONE_BYTES + pcm.length * 2);
  const v = new DataView(buf);
  v.setUint8(0, QUADRO_MICROFONE);
  v.setUint32(1, seq >>> 0, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(CABECALHO_MICROFONE_BYTES + i * 2, pcm[i] ?? 0, true);
  return buf;
}

/** Quadro 0x02 (voz do bot): tipo + sequência u32 LE + utt u16 LE + PCM16LE mono a 24 kHz. Fora do formato → null. */
export function lerQuadroVoz(buf: ArrayBuffer): { seq: number; utt: number; pcm: Int16Array } | null {
  if (buf.byteLength < CABECALHO_VOZ_BYTES || buf.byteLength > MENSAGEM_MAX_BYTES || (buf.byteLength - CABECALHO_VOZ_BYTES) % 2 !== 0) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== QUADRO_VOZ) return null;
  const n = (buf.byteLength - CABECALHO_VOZ_BYTES) / 2;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = v.getInt16(CABECALHO_VOZ_BYTES + i * 2, true);
  return { seq: v.getUint32(1, true), utt: v.getUint16(5, true), pcm };
}

export function mensagemCliente(m: MsgMidiaCliente): string {
  return JSON.stringify(m);
}

const FASES: Record<FaseLigacao, true> = { chamando: true, conectando: true, ouvindo: true, pensando: true, falando: true, trabalhando: true, reconectando: true, aguardando_escolha: true, encerrada: true };
const TIPOS_FALA: Record<TipoFalaBot, true> = { conteudo: true, espera: true, leitura: true, aviso: true };
const ACOES: Record<AcaoComandoVoz, true> = { aprovar: true, recusar: true };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max = 4_000): v is string => typeof v === "string" && v.length <= max;

/**
 * Uma mensagem de controle do servidor, conferida campo a campo (a web nunca confia no formato do que chega). Texto
 * fora do JSON, tipo desconhecido ou campo do tipo errado → null, e a mensagem é ignorada.
 */
export function lerMsgServidor(texto: string): MsgMidiaServidor | null {
  if (texto.length > MENSAGEM_MAX_BYTES) return null;
  let o: unknown;
  try {
    o = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null || !("t" in o)) return null;
  const m = o as Record<string, unknown>;
  switch (m.t) {
    case "pronto":
      return num(m.maxS) ? { t: "pronto", maxS: m.maxS, stt: { parciais: typeof m.stt === "object" && m.stt !== null && (m.stt as Record<string, unknown>).parciais === true } } : null;
    case "estado":
      return typeof m.fase === "string" && m.fase in FASES ? { t: "estado", fase: m.fase as FaseLigacao, ...(str(m.rotulo, 200) ? { rotulo: m.rotulo } : {}) } : null;
    case "legenda":
      return num(m.id) && str(m.texto) && typeof m.final === "boolean" ? { t: "legenda", id: m.id, texto: m.texto, final: m.final } : null;
    case "bot-fala":
      return num(m.utt) && typeof m.tipo === "string" && m.tipo in TIPOS_FALA && str(m.texto) ? { t: "bot-fala", utt: m.utt, tipo: m.tipo as TipoFalaBot, texto: m.texto } : null;
    case "subir":
    case "interromper":
      return num(m.utt) ? { t: m.t, utt: m.utt } : null;
    case "janela":
      return str(m.decisaoId, 64) && num(m.ate) ? { t: "janela", decisaoId: m.decisaoId, ate: m.ate } : null;
    case "janela-fechada":
      return str(m.decisaoId, 64) ? { t: "janela-fechada", decisaoId: m.decisaoId } : null;
    case "comando":
      return str(m.comandoId, 128) && str(m.decisaoId, 64) && typeof m.acao === "string" && m.acao in ACOES ? { t: "comando", comandoId: m.comandoId, decisaoId: m.decisaoId, acao: m.acao as AcaoComandoVoz } : null;
    case "cerebro":
      return typeof m.online === "boolean" ? { t: "cerebro", online: m.online } : null;
    case "aviso":
      return str(m.texto, 500) ? { t: "aviso", texto: m.texto } : null;
    case "fim":
      return typeof m.motivo === "string" && (MOTIVOS_FIM as readonly string[]).includes(m.motivo) ? { t: "fim", motivo: m.motivo as MotivoFimLigacao } : null;
    case "onboarding": {
      const campos = lerCampos(m.campos);
      return typeof m.etapa === "string" && (ETAPAS as readonly string[]).includes(m.etapa) && campos ? { t: "onboarding", etapa: m.etapa as EtapaOnboarding, campos } : null;
    }
    case "sugestoes":
      return Array.isArray(m.itens) && m.itens.length <= SUGESTOES_MAX && m.itens.every((x) => str(x, SUGESTAO_MAX_CHARS) && x.trim() !== "") ? { t: "sugestoes", itens: m.itens as string[] } : null;
    case "sem-ia": {
      const ias = lerIas(m.ias);
      const causa = CAUSAS_CEREBRO.find((c) => c === m.causa);
      const ia = m.ia === null || m.ia === undefined ? null : ehIa(m.ia) ? m.ia : undefined;
      return causa && ias && ia !== undefined && num(m.ate) ? { t: "sem-ia", causa: causa satisfies CausaCerebroCaiu, ia, ias, ate: m.ate } : null;
    }
    case "ia-voltou": {
      const ia = m.ia === null || m.ia === undefined ? null : ehIa(m.ia) ? m.ia : undefined;
      return ia !== undefined && typeof m.trocou === "boolean" ? { t: "ia-voltou", ia, trocou: m.trocou } : null;
    }
    case "pong":
      return { t: "pong" };
    default:
      return null;
  }
}
