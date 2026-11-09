import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { PROPRIEDADES_COMPUTADORES as PC } from "../../contracts/ferramentas-computadores.ts";
import { PROPRIEDADES_MAQUINAS as P } from "../../contracts/ferramentas-maquinas.ts";

/**
 * Máquinas, nuvem e computadores (NOD-391, ADR-135; Onda 4, NOD-396). Nunca pelo chat: o que entrega um segredo
 * (a chave de máquina crua, a senha ou a chave SSH), o pareamento de um aparelho (a pessoa confere o código na tela
 * do aparelho), o login Google da nuvem (OAuth no navegador) e as mãos da pessoa no computador.
 *
 * maquinas.remover (ADA-245, jornada D): `vivo` e `pessoa_confirma` — a tela (POST /maquinas/:id/remover) e o
 * remover_computador de qualquer bot chamam o mesmo executor (src/use-cases/acoes/maquinas.ts); no chat é SEMPRE card.
 */

const falta = { estado: "falta", onda: "NOD-396" } as const;

/**
 * ADA-243 (2026-11-07): escolher a máquina padrão sai da Onda 4 e fica `vivo` — a tela "Onde os bots trabalham" do
 * onboarding (jornada B) e o seletor "Máquina padrão" chamam o mesmo executor que o gerir_maquinas de QUALQUER bot
 * (src/use-cases/acoes/maquinas.ts). Risco "muda": aplica direto em todo modo (se desfaz pedindo de novo).
 */
const VIVO_MAQUINAS = { estado: "vivo", via: { ferramenta: "gerir_maquinas" }, contrato: "tests/integration/paridade-maquinas.test.ts" } as const;

export const ACOES_MAQUINAS = [
  { id: "maquinas.criar_chave", titulo: "Emitir uma chave de máquina", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "a chave crua sai uma vez e é segredo: não pode ir para a conversa" } },
  { id: "maquinas.revogar_chave", titulo: "Revogar uma chave de máquina", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "maquinas.parear", titulo: "Gerar o código de pareamento de uma máquina", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "pareamento: a pessoa confere o código no aparelho" } },
  { id: "maquinas.aprovar_dispositivo", titulo: "Aprovar um aparelho pelo código", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "pareamento: a pessoa confere o código no aparelho" } },
  { id: "maquinas.convidar", titulo: "Convidar uma máquina", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "maquinas.editar", titulo: "Renomear ou ajustar uma máquina", risco: "muda", cartaoNoChat: false, chat: falta },
  {
    id: "maquinas.remover",
    titulo: "Remover o nod de um computador (os bots de lá passam para o padrão)",
    schema: { type: "object", properties: { computador: PC.computador, manter_ias: PC.manter_ias, manter_conexao: PC.manter_conexao }, required: ["computador"], additionalProperties: false },
    risco: "pessoa_confirma",
    cartaoNoChat: true,
    chat: { estado: "vivo", via: { ferramenta: "remover_computador", tipoNoLote: "remover_computador" }, contrato: "tests/integration/paridade-maquinas-remover.test.ts" },
    casoDeUso: "maquinas.remover",
    exigeOrigemHumana: true,
    lote: { tipo: "remover_computador" },
  },
  { id: "maquinas.desconectar", titulo: "Desconectar uma máquina", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "maquinas.atualizar_ia", titulo: "Atualizar a IA instalada numa máquina", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "maquinas.definir_padrao", titulo: "Escolher a máquina padrão", schema: { type: "object", properties: { maquina: P.maquina, qualquer_uma: P.qualquer_uma }, required: [], additionalProperties: false }, risco: "muda", cartaoNoChat: false, chat: VIVO_MAQUINAS, casoDeUso: "maquinas.definir_padrao" },
  { id: "maquinas.escolher_do_bot", titulo: "Escolher a máquina de um bot", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "maquinas.definir_bots", titulo: "Escolher os bots de uma máquina", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "maquinas.rodar_desta_vez", titulo: "Rodar desta vez noutra máquina", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "maquinas.instalar_ssh", titulo: "Instalar o nod numa máquina por SSH", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "maquinas.credencial_ssh", titulo: "Mandar a senha ou a chave SSH", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "senha ou chave SSH é segredo: só pelo campo seguro da tela" } },
  { id: "maquinas.confiar_ssh", titulo: "Confiar na nova impressão do servidor SSH", risco: "pessoa_confirma", cartaoNoChat: false, chat: falta },
  { id: "maquinas.cancelar_ssh", titulo: "Cancelar a instalação por SSH", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "nuvem.conectar_google", titulo: "Conectar a conta Google da nuvem", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "login OAuth do Google: só no navegador da pessoa" } },
  { id: "nuvem.criar_maquina", titulo: "Criar uma máquina na nuvem", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "nuvem.excluir_maquina", titulo: "Excluir uma máquina da nuvem", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "nuvem.dormir", titulo: "Pôr uma máquina da nuvem para dormir", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "nuvem.acordar", titulo: "Acordar uma máquina da nuvem", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "nuvem.dormir_apos", titulo: "Escolher quando a máquina da nuvem dorme", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "computador.operar", titulo: "Ligar, desligar ou reiniciar o computador", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "computador.trocar_lugar", titulo: "Mudar o computador de máquina", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "computador.operar_do_bot", titulo: "Ligar, desligar ou reiniciar o computador de um bot", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "computador.usar_tela", titulo: "Usar a tela do computador com as próprias mãos", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "são as mãos da pessoa no computador do bot" } },
] as const satisfies readonly DefinicaoAcao[];
