import { join } from "node:path";
import { IAS_DESKTOP, type IaDesktop } from "../src/contracts/desktop.ts";
import type { IdDriver } from "../src/adapters/executor/spi.ts";
import type { Inventario } from "../src/contracts/inventario.ts";
import { compararVersoes, PISO_CLI } from "../src/adapters/executor/flag-floors.ts";
import { criarAtualizadorDeIas, inventarioComAtualizacao, type AtualizadorDeIas, type DepsAtualizador, type PassoAtualizar } from "../desktop/atualizador-ias.ts";
import { PACOTE_DA_IA } from "../desktop/instalar-ia.ts";
import { criarLimiteDePedidos, dentroDe, type EstadoDoPedido, fraseDoTerminal, lerFimNoTerminal } from "./atualizar-ias.ts";

/**
 * A fiação da atualização das IAs no motor (extraída de motor/main.ts em 2026-10-23, devolução do #501): o binário e a
 * origem, os turnos de cada IA (+ o pedido ao root ocupando), o "alguma IA atualizando" que segura o motor, o pedido
 * da tela/terminal com o limite de 3 por hora e o inventário com a fase. main.ts só liga as pontas reais.
 */
export type DepsIasDoMotor = {
  /** A casa do `nod`: o que o nod instalou mora em `<home>/.local`. */
  home: string;
  /** O binário que o nod usa para a IA (resolverBinario do motor). */
  bin(ia: IaDesktop): Promise<string | null>;
  /** Veio de NOD_*_BIN: o nod não mexe. */
  configurado(ia: IaDesktop): boolean;
  lerVersao(bin: string): Promise<string | null>;
  /** As IAs dos turnos rodando agora (uma entrada por turno). */
  iasDosTurnos(): IaDesktop[];
  /** O motor drenando ou com o pedido ao root gravado: conta como turno em toda IA. */
  motorOcupado(): boolean;
  passos(ia: IaDesktop): PassoAtualizar[];
  depois(): void;
  aoMudar(ia: IaDesktop): void;
  ler(): Promise<unknown>;
  gravar: DepsAtualizador["gravar"];
  agora(): number;
  hoje(agora: number): string;
  agendar: DepsAtualizador["agendar"];
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
  log(nivel: "info" | "aviso", evento: string, campos: Record<string, string | number | boolean | null>): void;
};

export type IasDoMotor = {
  atualizador: AtualizadorDeIas;
  /** Alguma IA está trocando o binário agora (o motor não reinicia por cima). */
  iasAtualizando(): boolean;
  /** O pedido da tela ou do terminal: "limite" = o 4º na hora; senão, a promessa do fim. */
  pedirAtualizacao(ia: IaDesktop, origem: "tela" | "terminal"): "limite" | Promise<unknown>;
  comAtualizacao(inventarios: Partial<Record<IdDriver, Inventario>>): Partial<Record<IdDriver, Inventario>>;
};

export function criarIasDoMotor(d: DepsIasDoMotor): IasDoMotor {
  const pedidosPorHora = criarLimiteDePedidos(d.agora);
  const local = join(d.home, ".local");
  /** O log `ia_binario` sai uma vez por caminho (o binário fora do ~/.local é a causa de "atualizou e nada mudou"). */
  const binariosAvisados = new Set<string>();
  const atualizador = criarAtualizadorDeIas({
    binario: async (ia) => {
      const bin = await d.bin(ia);
      if (!bin) return { versao: null, origem: null };
      const configurado = d.configurado(ia);
      const versao = await d.lerVersao(bin);
      if (!configurado && !dentroDe(bin, local) && !binariosAvisados.has(bin)) {
        binariosAvisados.add(bin);
        d.registrar("ia_binario", { ia, fora_do_local: true, bin, versao });
      }
      return { versao, origem: configurado ? "configurado" : "path" };
    },
    piso: (ia) => PISO_CLI[ia],
    comparar: compararVersoes,
    // Emenda da ADR-100: com o motor drenando ou com o pedido ao root gravado, a IA não começa (conta como ocupada).
    turnos: (ia) => d.iasDosTurnos().filter((x) => x === ia).length + (d.motorOcupado() ? 1 : 0),
    emLigacao: () => false,
    passos: (ia) => d.passos(ia),
    depois: () => d.depois(),
    aoMudar: (ia) => d.aoMudar(ia),
    ler: d.ler,
    gravar: d.gravar,
    agora: d.agora,
    hoje: d.hoje,
    agendar: d.agendar,
    registrar: d.registrar,
  });
  return {
    atualizador,
    iasAtualizando: () => IAS_DESKTOP.some((ia) => { const f = atualizador.estado(ia)?.fase; return f === "atualizando" || f === "pedindo_aprovacao"; }),
    pedirAtualizacao(ia, origem) {
      if (!pedidosPorHora.cabe(ia)) {
        d.log("aviso", "ia_atualizacao_limite", { ia, origem });
        return "limite";
      }
      return atualizador.atualizar(ia).catch(() => null);
    },
    comAtualizacao(inventarios) {
      const saida: Partial<Record<IdDriver, Inventario>> = { ...inventarios };
      for (const ia of IAS_DESKTOP) {
        const inv = inventarios[ia];
        if (inv) saida[ia] = inventarioComAtualizacao(inv, atualizador.estado(ia), PACOTE_DA_IA[ia].nome);
      }
      return saida;
    },
  };
}

/**
 * Quem pode rodar `nod-motor atualizar-ia` (2026-10-23, devolução do #501): só o dono da pasta do motor (o `nod`).
 * Root (uid ou euid 0) é recusado sempre (QA do #501, achado 3): o sudo troca HOME para /root, a pasta do motor vira
 * a de root (dona 0 ou inexistente) e o npm rodaria como root em /root/.local.
 */
export function quemNaoPodeAtualizar(ids: { uid: number | null; euid: number | null }, donoDaPasta: number | null): string | null {
  if (ids.uid === 0 || ids.euid === 0) return "Não rode como root nem com sudo: rode como o usuário do motor (nod), sem sudo.";
  if (ids.uid === null || donoDaPasta === null) return null; // fora do POSIX, ou a pasta ainda não existe: nada a conferir
  if (ids.uid !== donoDaPasta || (ids.euid !== null && ids.euid !== donoDaPasta)) return "Rode como o usuário do motor (o dono da pasta do motor), sem sudo.";
  return null;
}

/** definido em 2026-10-23 (devolução do #501): o serviço respondeu, mas o fim não chegou no prazo (EX_TEMPFAIL). */
export const SAIDA_SEM_FIM = 75;

/**
 * O laço do terminal (extraído de main.ts): lê o estado que o serviço devolve até o fim, o prazo ou o silêncio.
 * "direto" = o serviço não respondeu em 15 s (quem chama roda o npm daqui). Com resposta e sem fim no prazo, sai com
 * SAIDA_SEM_FIM — nunca 0: o fim pode nunca chegar (o motor reiniciou e o pedido em memória se perdeu).
 */
export async function esperarNoTerminal(d: {
  nome: string;
  ia: IaDesktop;
  pedidoEm: number;
  lerEstado(): Promise<EstadoDoPedido | null>;
  esperar(ms: number): Promise<unknown>;
  agora(): number;
  escrever(texto: string): void;
  erro(texto: string): void;
  esperaDaRespostaMs: number;
  esperaDoServicoMs: number;
}): Promise<number | "direto"> {
  let respondeu = false;
  let ultima = "";
  while (d.agora() - d.pedidoEm < (respondeu ? d.esperaDoServicoMs : d.esperaDaRespostaMs)) {
    await d.esperar(1_000);
    const e = await d.lerEstado();
    if (!e || e.ia !== d.ia || e.pedidoEm !== d.pedidoEm) continue;
    respondeu = true;
    const fim = lerFimNoTerminal(e);
    if (fim === "limite") { d.erro(`${d.nome}: já foram 3 pedidos na última hora. Tente de novo mais tarde.\n`); return 1; }
    if (fim === "em_dia") { d.escrever(`${d.nome} já está em dia.\n`); return 0; }
    const frase = fraseDoTerminal(d.nome, e.atualizacao);
    if (frase !== ultima) { d.escrever(`${frase}\n`); ultima = frase; }
    if (fim === "sucesso") return 0;
    if (fim === "falhou") return 1;
  }
  if (!respondeu) return "direto";
  d.erro(`${d.nome}: o fim não chegou em ${Math.round(d.esperaDoServicoMs / 60_000)} min. Se o motor reiniciou nesse meio, o pedido se perdeu: confira na tela (Provedores de IA) ou rode o comando de novo.\n`);
  return SAIDA_SEM_FIM;
}
