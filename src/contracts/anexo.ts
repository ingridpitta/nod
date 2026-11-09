/**
 * Anexo de mensagem (ADR-046): arquivo que a pessoa manda na conversa para o MODELO ler naquele turno.
 * Não vai para o computador do bot nem para a pasta autorizada. Os bytes ficam no servidor; o plano
 * leva só estes metadados e o driver baixa o conteúdo pela rota interna com o token do turno.
 */

/** definido em 2026-09-24: 10 MB por arquivo, 5 por mensagem — cabe folgado no limite de imagem/PDF da API. */
export const TAMANHO_MAX_ANEXO = 10 * 1024 * 1024;
export const ANEXOS_POR_MENSAGEM = 5;

export const MIMES_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MIMES_TEXTO = ["text/plain", "text/markdown", "text/csv", "application/json"] as const;
export const MIME_PDF = "application/pdf";
export const MIMES_ANEXO = [...MIMES_IMAGEM, MIME_PDF, ...MIMES_TEXTO] as const;

export type MimeAnexo = (typeof MIMES_ANEXO)[number];
export type TipoAnexo = "imagem" | "pdf" | "texto";

export type AnexoMeta = {
  id: string;
  nome: string;
  mime: MimeAnexo;
  tamanho: number;
  /**
   * ADR-111 (memória longa): o anexo é de uma fala ANTERIOR da conversa, não da mensagem deste turno. O driver diz isso
   * ao modelo. Ausente = da mensagem do turno (o motor de antes ignora o campo e o mostra como anexo da mensagem).
   */
  anterior?: true;
};

/**
 * NOD-327: a família visual de um arquivo — decide o ícone do card (`web/lib/icones-arquivo.ts`, reaproveitado pela
 * Biblioteca da NOD-326) e qual prévia abre. Vem do mime; a extensão só desempata quando o mime é genérico.
 */
export type FamiliaArquivo = "planilha" | "documento" | "apresentacao" | "pdf" | "zip" | "html" | "imagem" | "texto" | "outro";

/**
 * NOD-323 (ADR-126): a mídia que o BOT gera na pasta dele e o proxy anexa (`anexar_midia`). Só o bot manda estes mimes;
 * a pessoa continua nos `MIMES_ANEXO` e nos 10 MiB de sempre. O tipo vem dos bytes (`src/domain/midia.ts`), nunca da
 * extensão; SVG e HTML não entram (executam script).
 */
export const MIMES_VIDEO = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const MIMES_AUDIO = ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg"] as const;
export const MIME_ZIP = "application/zip";
export const MIMES_MIDIA_DO_BOT = [...MIMES_IMAGEM, ...MIMES_VIDEO, ...MIMES_AUDIO, MIME_PDF, MIME_ZIP] as const;
export type MimeMidia = (typeof MIMES_MIDIA_DO_BOT)[number];

/** Como a mídia aparece: imagem e gif em prévia; vídeo com capa; áudio com player; pdf e zip como cartão de arquivo. */
export type FamiliaMidia = "imagem" | "gif" | "video" | "audio" | "pdf" | "zip";

const MIB = 1024 * 1024;
/** definido em 2026-10-23 (protótipo v3.1, j5-4): acima disso fica só o cartão "grande demais" — os bytes ficam na máquina. */
export const LIMITE_POR_FAMILIA: Record<FamiliaMidia, number> = { imagem: 20 * MIB, gif: 20 * MIB, video: 50 * MIB, audio: 25 * MIB, pdf: 20 * MIB, zip: 20 * MIB };
export const TAMANHO_MAX_MIDIA = 50 * MIB;
/** Por chamada de `anexar_midia` e por turno (o excedente vira recusa `limite_por_turno`). */
export const MIDIAS_POR_CHAMADA = 10;
export const MIDIAS_POR_TURNO = 20;

/** `midia`: prévia no chat; `cartao_grande`: só o cartão (passou do limite, ou é pdf/zip). O modelo lê isto. */
export type ExibicaoMidia = "midia" | "cartao_grande" | "cartao";

export type OrigemAnexo = "pessoa" | "captura" | "bot";

/** Códigos fechados de recusa do `anexar_midia` (o CHECK de `turnos.midia_recusas` guarda só código e contagem). */
export const MOTIVOS_RECUSA_MIDIA = ["fora_da_pasta", "credencial", "nao_existe", "nao_e_arquivo", "tipo_nao_suportado", "vazio", "falha_envio", "limite_por_turno"] as const;
export type MotivoRecusaMidia = (typeof MOTIVOS_RECUSA_MIDIA)[number];
export type RecusasMidia = { motivo: MotivoRecusaMidia; n: number }[];

/** O que a web e a Biblioteca (NOD-326) recebem de cada anexo da conversa — o `AnexoMeta` com o que a mídia do bot traz. */
export type AnexoDaConversa = Omit<AnexoMeta, "mime"> & {
  mime: string;
  origem?: OrigemAnexo;
  largura?: number;
  altura?: number;
  duracaoMs?: number;
  /** Passou do limite: os bytes ficaram na máquina (cartão "grande demais"). */
  semBytes?: true;
  /** A máquina onde o arquivo está (para "Fica na pasta do X no <máquina>" e o Finder). */
  maquina?: { id: string; nome: string };
};

/** O cabeçalho `x-nod-midia` do upload do proxy (JSON, url-encoded, até 8 KiB). */
export type CabecalhoMidia = {
  nome: string;
  /** Relativo a `~/nod`, começando pela pasta do bot. */
  caminhoRelativo: string;
  sha256: string;
  largura?: number;
  altura?: number;
  duracaoMs?: number;
  /** Sem bytes: o tamanho real do arquivo na máquina. */
  tamanhoReal?: number;
  mime: string;
};
export const TETO_CABECALHO_MIDIA = 8 * 1024;
