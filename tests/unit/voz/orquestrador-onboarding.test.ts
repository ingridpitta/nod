import { describe, expect, it } from "vitest";
import type { MotivoFimLigacao, MsgMidiaServidor } from "../../../src/contracts/voz.ts";
import { criarServicoVoz, type EstadoVozOnboarding, type PersistenciaVoz, type RegistroLigacao } from "../../../src/adapters/voz/orquestrador.ts";
import { criarProvedoresFalsos } from "../../../src/adapters/voz/voz-falsa.ts";
import type { CanalVoz } from "../../../src/adapters/voz/ws.ts";

/** O orquestrador na ligação de onboarding (definido em 2026-10-04, ADR-077), com canais e provedores falsos. */
function canalFalso() {
  const json: Record<string, unknown>[] = [];
  let aoMsg: ((m: { texto: string } | { binario: Uint8Array }) => void) | null = null;
  const canal: CanalVoz = {
    enviarJson: (m) => json.push(m as Record<string, unknown>),
    enviarBinario: () => undefined,
    fechar: () => undefined,
    aoMensagem: (fn) => { aoMsg = fn; },
    aoFechar: () => undefined,
    pendente: () => 0,
  };
  return { canal, json, receber: (m: object) => aoMsg?.({ texto: JSON.stringify(m) }) };
}

const esperar = async (f: () => boolean, ms = 2_000) => {
  const ate = Date.now() + ms;
  while (!f()) {
    if (Date.now() > ate) throw new Error("tempo esgotado");
    await new Promise((r) => setTimeout(r, 10));
  }
};

function montar(estado: EstadoVozOnboarding, prazos: { naoAtendidaMs?: number } = {}) {
  const encerradas: MotivoFimLigacao[] = [];
  const persistencia: PersistenciaVoz = {
    atender: async () => undefined,
    gravarFala: async () => undefined,
    encerrar: async (_r, motivo) => { encerradas.push(motivo); },
    estadoOnboarding: async () => estado,
  };
  const voz = criarServicoVoz({ provedores: criarProvedoresFalsos({ silencioso: true }), persistencia, prazos });
  const r: RegistroLigacao = {
    ligacaoId: "l1", tenantId: "t", pessoaId: "p", agenteId: "a", conversaId: "c", turnoId: "tu", voz: "clara", velocidade: 1, nomeBot: "Nina", genero: "feminina", maxS: 600,
    onboarding: true, aguardandoConsentimento: true, saudacao: "Oi! Eu sou a Nina, sua primeira bot aqui no nod. Como você quer que eu te chame?",
  };
  voz.registrar(r);
  return { voz, encerradas };
}

const CAMPOS = { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null };

describe("orquestrador na ligação de onboarding", () => {
  it("recusa a mídia até o consentimento; liberada, fala o roteiro e manda os chips da etapa", async () => {
    const { voz } = montar({ etapa: "entrevista", campos: CAMPOS, passo: "bot", nomeBot: null, pessoaNome: "Ana Souza" });
    const antes = canalFalso();
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: antes.canal })).toBe(4403);
    voz.liberar("l1");
    const m = canalFalso();
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.canal })).toBeNull();
    await esperar(() => m.json.some((x) => x.t === "sugestoes"));
    const msgs = m.json as MsgMidiaServidor[];
    expect(msgs.find((x) => x.t === "bot-fala")).toMatchObject({ texto: "Oi! Eu sou a Nina, sua primeira bot aqui no nod. Como você quer que eu te chame?" });
    expect(msgs.find((x) => x.t === "onboarding")).toMatchObject({ etapa: "entrevista" });
    expect(msgs.find((x) => x.t === "sugestoes")).toEqual({ t: "sugestoes", itens: ["Me chama de Ana"] });
    await voz.fechar();
  });

  it("quando uma ferramenta do onboarding termina no cérebro, relê o estado e manda a etapa nova (configurando = pílula)", async () => {
    const estado: EstadoVozOnboarding = { etapa: "entrevista", campos: CAMPOS, passo: "bot", nomeBot: null, pessoaNome: null };
    const { voz } = montar(estado);
    voz.liberar("l1");
    const m = canalFalso();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.canal });
    const c = canalFalso();
    expect(voz.anexarCerebro({ turnoId: "tu", ligacaoId: "l1", canal: c.canal })).toBeNull();
    // O aquecimento do cérebro conta a primeira fala do roteiro, não o "Oi! Aqui é".
    expect(String((c.json.find((x) => x.t === "vez") as { texto?: string } | undefined)?.texto)).toContain("Oi! Eu sou a Nina");
    estado.etapa = "configurando";
    estado.campos = { apelido: "Ana", comoConheceu: "Indicação", objetivo: "Organizar meu dia", tamanhoTime: "so_eu" };
    c.receber({ t: "atividade", tipo: "inicio", nome: "concluir_entrevista" });
    c.receber({ t: "atividade", tipo: "fim", nome: "concluir_entrevista" });
    await esperar(() => m.json.some((x) => x.t === "onboarding" && x.etapa === "configurando"));
    await esperar(() => m.json.some((x) => x.t === "sugestoes" && JSON.stringify(x.itens) === JSON.stringify(["Pode ser Secretário"])));
    await voz.fechar();
  });

  it("sem o Atender, a ligação do onboarding vira não atendida", async () => {
    const { voz, encerradas } = montar({ etapa: "chamando", campos: CAMPOS, passo: "bot", nomeBot: null, pessoaNome: null }, { naoAtendidaMs: 30 });
    await esperar(() => encerradas.length > 0);
    expect(encerradas).toEqual(["nao_atendida"]);
    await voz.fechar();
  });
});
