import type { PreferenciaHarness } from "../contracts/harness.ts";
import { validarInteligencia } from "../domain/harness.ts";
import { inteligenciaDoAgente, inteligenciaDoLegado } from "../domain/inteligencia.ts";
import { CORES_AGENTE, ESFORCOS_AGENTE, FORMAS_AGENTE, type Agente, type EsforcoAgente, type FormaAgente, type CorAgente } from "../contracts/agente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod, nomeReservadoAoNod } from "../domain/nod.ts";
import { VELOCIDADES_VOZ } from "../contracts/vozes.ts";
import { ehIdVoz } from "../domain/vozes.ts";
import { registrarVersaoDoPerfil } from "./versoes-perfil.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaEditarPerfil = {
  agenteId: string;
  nome?: string;
  forma?: FormaAgente;
  cor?: CorAgente;
  titulo?: string;
  descricao?: string;
  modelo?: string;
  harness?: PreferenciaHarness;
  /** "" ou null = o padrão do modelo; ausente = não muda. */
  esforco?: string | null;
  /** Qualquer valor aqui é recusado: o dono é imutável (E1.2; trigger nod_agente_dono_imutavel no banco). */
  dono?: unknown;
  /**
   * definido em 2026-10-30 (NOD-20): a voz e a velocidade no mesmo PATCH, para um Salvar da tela virar UMA versão (antes a
   * tela mandava a voz em outra rota, e cada Salvar gravava duas). null = a voz derivada do id; ausente = não muda.
   */
  voz?: unknown;
  vozVelocidade?: unknown;
  /** NOD-20: pelo gerir_bots (o Nod no chat): a versão sai com origem chat. Só o executor do lote liga; a rota não repassa. */
  peloNod?: boolean;
};

function campo(v: unknown, nome: string, permiteVazio: boolean): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ErroDeDominio("entrada_invalida", { cause: nome });
  const t = v.trim();
  if (!permiteVazio && t === "") throw new ErroDeDominio("entrada_invalida", { cause: nome });
  return t;
}

function esforcoValido(v: string): EsforcoAgente {
  const e = ESFORCOS_AGENTE.find((x) => x === v);
  if (!e) throw new ErroDeDominio("entrada_invalida", { cause: "esforco" });
  return e;
}

/** PATCH direto pela pessoa (sem proposta): nome/título/descrição/modelo. Quem tenta mudar o dono recebe dono_imutavel. */
export const editarPerfil: CasoDeUso<EntradaEditarPerfil, { agente: Agente; versao: number | null }> = async (deps, input) => {
  if (input.dono !== undefined) throw new ErroDeDominio("dono_imutavel");
  if (input.forma !== undefined && !FORMAS_AGENTE.some((forma) => forma === input.forma)) throw new ErroDeDominio("entrada_invalida");
  if (input.cor !== undefined && !CORES_AGENTE.some((cor) => cor === input.cor)) throw new ErroDeDominio("entrada_invalida");
  const perfil = {
    forma: input.forma,
    cor: input.cor,
    nome: campo(input.nome, "nome", false),
    titulo: campo(input.titulo, "titulo", true),
    descricao: campo(input.descricao, "descricao", true),
    harness: input.harness,
    modelo: campo(input.modelo, "modelo", false),
    esforco: input.esforco === undefined ? undefined : input.esforco === null || input.esforco === "" ? null : esforcoValido(input.esforco),
  };
  if ((perfil.nome?.length ?? 0) > 60 || (perfil.titulo?.length ?? 0) > 120 || (perfil.descricao?.length ?? 0) > 8000) throw new ErroDeDominio("entrada_invalida");
  const voz = input.voz === null ? null : input.voz === undefined ? undefined : ehIdVoz(input.voz) ? input.voz : false;
  const velocidade = input.vozVelocidade === undefined ? undefined : (VELOCIDADES_VOZ as readonly unknown[]).includes(input.vozVelocidade) ? (input.vozVelocidade as number) : false;
  if (voz === false || velocidade === false) throw new ErroDeDominio("entrada_invalida", { cause: "voz" });
  if (Object.values(perfil).every((v) => v === undefined) && voz === undefined && velocidade === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "nada a editar" });

  const visto = await deps.repos.agentes.buscar(input.agenteId);
  if (!visto) throw new ErroDeDominio("nao_encontrado");
  // NOD-20: trava a linha ANTES de ler o perfil de antes (a versão compara antes×depois e numera max+1). Visível (equipe)
  // mas de outra pessoa: a trava não acha a linha, como o UPDATE não acharia.
  const existente = await deps.repos.agentes.buscarParaAtualizar(input.agenteId);
  if (!existente) throw new ErroDeDominio("nao_permitido");
  // ADR-081: o Nod não se renomeia, e nenhum outro bot vira "Nod".
  if (perfil.nome !== undefined && perfil.nome !== existente.nome) {
    if (ehNod(existente)) throw new ErroDeDominio("nod_protegido", { cause: "renomear" });
    if (nomeReservadoAoNod(perfil.nome)) throw new ErroDeDominio("entrada_invalida", { cause: "nome reservado ao Nod" });
  }
  if (perfil.harness !== undefined || perfil.modelo !== undefined) validarInteligencia(perfil.harness ?? existente.harness ?? "auto", perfil.modelo ?? existente.modelo);
  const modeloMudou = perfil.harness !== undefined && perfil.harness !== existente.harness || perfil.modelo !== undefined && perfil.modelo !== existente.modelo;
  // 0068 (emenda da ADR-036): o pedido antigo {harness, modelo, esforco} vira a inteligência do bot, que grava os derivados.
  const mexeNaIa = perfil.harness !== undefined || perfil.modelo !== undefined || perfil.esforco !== undefined;
  const inteligencia = mexeNaIa
    ? inteligenciaDoLegado(inteligenciaDoAgente(existente), { harness: perfil.harness ?? existente.harness ?? "auto", modelo: perfil.modelo ?? existente.modelo, ...(perfil.esforco !== undefined ? { esforco: perfil.esforco } : {}) })
    : undefined;
  const mexeNoPerfil = Object.values(perfil).some((v) => v !== undefined);
  let agente = !mexeNoPerfil ? existente : await deps.repos.agentes.atualizarPerfil(input.agenteId, { nome: perfil.nome, titulo: perfil.titulo, descricao: perfil.descricao, forma: perfil.forma, cor: perfil.cor, ...(inteligencia ? { inteligencia } : {}), ...(perfil.descricao !== undefined || perfil.titulo !== undefined ? { confirmado: true } : {}) });
  // Visível (equipe) mas de outra pessoa: o repositório devolve null em vez de 42501.
  if (!agente) throw new ErroDeDominio("nao_permitido");
  if (voz !== undefined || velocidade !== undefined) {
    agente = await deps.repos.agentes.definirVoz(input.agenteId, { voz, velocidade });
    if (!agente) throw new ErroDeDominio("nao_permitido");
  }
  const versao = await registrarVersaoDoPerfil(deps, { antes: existente, depois: agente, origem: input.peloNod ? "chat" : "tela" });

  if (modeloMudou) {
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
  }

  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  return {
    data: { agente, versao: versao?.versao ?? null },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, dados: { agente_id: agente.id, acao: "perfil_editado", nome: agente.nome } })],
  };
};
