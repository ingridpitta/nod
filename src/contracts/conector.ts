import type { Visibilidade } from "./agente.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { JsonSchema } from "./ferramentas-nod.ts";
import type { MotivoNegacao } from "./motivos.ts";

/** Declarada pela pessoa no registro; não declarou = TOCA (ADR-002, default fechado). */
export type SensibilidadeDeclarada = "toca" | "nao-toca" | "nao-declarou";

export type TransporteConector = "stdio" | "http";

/** Resultado da regra pura de classificação por ORIGEM (src/domain/dado-pessoal.ts). */
export type ClassificacaoOrigem = {
  conectorId: string;
  fonte: string;
  concessaoId: string;
  declaracao: SensibilidadeDeclarada;
  tocaDadoPessoal: boolean;
  versaoRegra: 1;
};

/** Ferramenta descoberta na sonda (tools/list), com readOnlyHint capturado ali (ADR-013). */
export type CapacidadeConector = {
  nome: string;
  descricao: string;
  schema: JsonSchema;
  readOnlyHint: boolean;
  /** definido em 2026-09-25 (revisão do PR #68): a anotação MCP `destructiveHint`, capturada na sonda; leva ao grupo apagar. */
  destructiveHint?: boolean;
  /**
   * definido em 2026-09-25: só na resposta de GET /conectores — o grupo que a pessoa lê no card
   * (grupoDaCapacidade, src/domain/grupos-de-acesso.ts). Nunca gravado: o banco guarda o que a sonda viu.
   */
  grupo?: "ler" | "criar" | "alterar" | "comentar" | "outras" | "apagar";
};

/**
 * Conector = servidor MCP registrado pela pessoa. Nasce desabilitado; env fica cifrado no servidor
 * (valor `true` = placeholder "mantido", recusado para chave nova). http + toca é recusado (CHECK).
 */
export type Conector = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  visibility: Visibilidade;
  nome: string;
  slug: string;
  transporte: TransporteConector;
  comando: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string | true>;
  declaracao: SensibilidadeDeclarada;
  habilitado: boolean;
  catalogo: CapacidadeConector[];
  sondadoEm: EpochMs | null;
  /** definido em 2026-10-26 (NOD-374): `causa` = 401/403 (o app recusou o acesso; reconectar, não re-sondar). */
  ultimaFalha: { motivo: MotivoNegacao; em: EpochMs; causa?: "acesso_recusado" } | null;
  criadoEm: EpochMs;
  /**
   * definido em 2026-10-26 (NOD-374, src/domain/disjuntor-conector.ts): o estado do disjuntor do app. O repositório sempre
   * preenche; opcionais só para quem monta um Conector à mão (testes, telas antigas). O app aparece em "Fora do ar" quando
   * `ultimaFalha` e `foraDoArDesde` existem — a falha aberta sem `foraDoArDesde` ainda não persistiu o bastante.
   */
  falhasSeguidas?: number;
  timeoutsSeguidos?: number;
  ultimoTimeoutEm?: EpochMs | null;
  proximaSondaEm?: EpochMs | null;
  foraDoArDesde?: EpochMs | null;
};

/**
 * Forma que conectoresRepo DEVOLVE (definido em 2026-09-16): o repositório não tem a chave de cifra,
 * então `env` sai só com as chaves → `true` (placeholder "mantido") e o valor cifrado vem à parte
 * em `envCifrado`, para o serviço decifrar com src/db/cifra.ts na hora de spawnar/mesclar
 * placeholders (L5). Nada legível sai do banco; a web recebe `Conector`, nunca isto.
 */
export type ConectorGuardado = Conector & { envCifrado: string | null };
