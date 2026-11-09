import type { PreferenciaHarness } from "./harness.ts";
import type { InteligenciaBot } from "./inteligencia.ts";
import type { EpochMs, TenantId } from "./ids.ts";

export const FORMAS_AGENTE = ["shape-square", "shape-hex", "shape-circle", "shape-pebble", "shape-capsule", "shape-triangle", "shape-cloud", "shape-drop"] as const;
export const CORES_AGENTE = ["c-red", "c-pink", "c-purple", "c-blue", "c-teal", "c-green", "c-orange", "c-black", "c-brown", "c-amber", "c-gray", "c-cream"] as const;

export type FormaAgente = (typeof FORMAS_AGENTE)[number];
export type CorAgente = (typeof CORES_AGENTE)[number];

/** Imutável após a criação (trigger nod_agente_dono_imutavel na 0002; erro `dono_imutavel`). */
export type DonoAgente = "pessoa" | "empresa";

export type Visibilidade = "privado" | "equipe";

/** Níveis do `--effort` do Claude Code, na ordem (medido no `--help` da 2.1.284). */
export const ESFORCOS_AGENTE = ["low", "medium", "high", "xhigh", "max"] as const;
export type EsforcoAgente = (typeof ESFORCOS_AGENTE)[number];

/**
 * Como o bot aprova as próprias ações (ADR-059, 0040): 'manual' pede a pessoa para o que muda algo; 'automatico'
 * aprova sozinho e para no arriscado e na credencial (ADR-066: conteúdo de fora não para mais); 'total' aprova tudo,
 * até a credencial do Mac (PR 6 dos modos de aprovação, ADR-115). Só a dona muda.
 */
export const MODOS_APROVACAO = ["manual", "automatico", "total"] as const;
export type ModoAprovacao = (typeof MODOS_APROVACAO)[number];

/**
 * Agente (bot). Nasce 'Novo agente' (EMENDA 17) e o modelo propõe o perfil por `atualizar_perfil`.
 * Sem `cwd` (EMENDA 11, ADR-014 literal): o driver cria um mkdtemp por turno e apaga no finally.
 */
export type Agente = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  visibility: Visibilidade;
  nome: string;
  titulo: string;
  /** O que ele faz — prosa da pessoa ou proposta confirmada; vai no --append-system-prompt. */
  descricao: string;
  dono: DonoAgente;
  forma: FormaAgente;
  cor: CorAgente;
  /** Pin (Grok Bot). */
  fixado: boolean;
  /** Hide (Grok Bot). */
  oculto: boolean;
  /** Perfil confirmado pela pessoa (nada aplicado antes disso). */
  confirmado: boolean;
  /**
   * revisto em 2026-10-10 (0068, emenda da ADR-036): `harness`, `modelo` e `esforco` são DERIVADOS de `inteligencia`
   * (o repositório grava os quatro juntos) e continuam aqui para a tela de Inteligência antiga e para os caminhos que
   * enfileiram turnos: modo auto = `auto/auto`; fixa = a IA e o modelo escolhido dela (`auto` = o recomendado);
   * `esforco` = o raciocínio escolhido para o Claude.
   */
  modelo: string;
  harness?: PreferenciaHarness;
  /** O `--effort` do Claude Code (0037). Ausente ou null = o padrão do modelo. */
  esforco?: EsforcoAgente | null;
  /** 0068: o modo, a ordem e o modelo e o raciocínio por IA. Ausente = fixture anterior (vale o derivado de harness/modelo). */
  inteligencia?: InteligenciaBot;
  /** ADR-059 (0040). Ausente = 'manual' (planos e fixtures anteriores ao modo). */
  modoAprovacao?: ModoAprovacao;
  /** ADR-090 (0066): a máquina onde o bot trabalha — o id da chave da máquina. Ausente ou null = qualquer uma (o padrão da pessoa). */
  maquinaId?: string | null;
  /** Duplicate copia perfil, nunca memória nem histórico. */
  duplicadoDe: string | null;
  secao?: string;
  /** A ordem na barra lateral, dentro da grade de fixados ou da seção (0041); null = nunca arrastado, vem depois. */
  posicao?: number | null;
  naoLido?: boolean;
  excluidoEm?: EpochMs | null;
  /** definido em 2026-10-04 (0048, ADR-071): a voz do bot nas ligações (id de VOZES_NOD); null = derivada do id. */
  voz?: string | null;
  /** Velocidade da fala nas ligações: 1, 1,25 ou 1,5. */
  vozVelocidade?: number;
  /**
   * definido em 2026-10-07 (0061, ADR-081): 'nod' = o bot fixo da pessoa (um por pessoa). Não se exclui, não se oculta,
   * não se renomeia, não se move nem se duplica (`nod_protegido`). Ausente = bot comum.
   */
  papel?: PapelAgente | null;
  /** NOD-23 (0127): desde quando /configurar ligou a entrevista de reconfiguração; null ou ausente = fora do modo. */
  configurandoDesde?: EpochMs | null;
  /** NOD-23 (0127): turno do /configurar que abriu o modo; separa falas anteriores da entrevista. */
  configurandoTurnoId?: string | null;
  criadoEm: EpochMs;
};

export type PapelAgente = "nod";
