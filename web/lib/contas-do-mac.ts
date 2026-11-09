import type { ContasNaTela, IaDesktop, NodDesktop } from "../../src/contracts/desktop.ts";
import { PROVEDOR, type UiIas } from "../telas/cartao-ia.ts";
import { nesteMac } from "./plataforma-da-tela.ts";

/**
 * As várias contas de cada IA na página (definido em 2026-10-12, ADR-101, NOD-211; protótipo v3). Só dentro do app do
 * Mac: a lista, o apelido e o plano vêm de `nodDesktop.contas` e nunca vão ao servidor. Fora do app, a conversa só
 * aponta para o app do Mac (web/telas/ia-fora.ts).
 *
 * Ligar o "Trocar sozinho" pede o aviso dos termos do fornecedor antes (web/telas/aviso-termos.ts, v4); desligar é
 * direto. Remover pede confirmação e diz se o logout falhou. Sem DOM: o confirm e a ponte entram por parâmetro
 * (tests/unit/web/contas-do-mac.test.ts).
 */
export type DepsContasDoMac = {
  mac: () => Pick<NodDesktop, "contas"> | undefined;
  ui: () => UiIas;
  mudar: (m: Partial<UiIas>) => void;
  confirmar: (texto: string) => boolean;
  /** O aviso dos termos ao ligar "Trocar sozinho" (web/telas/aviso-termos.ts); true = ligar mesmo assim. */
  avisarTermos: (ia: IaDesktop) => Promise<boolean>;
};

export const NOTA_LOGOUT_FALHOU = "A conta saiu da lista, mas o logout não respondeu. Se quiser, apague a entrada dela no Acesso às Chaves do Mac.";

export function criarContasDoMac(d: DepsContasDoMac) {
  const guardar = (c: ContasNaTela | null | undefined) => {
    if (c) d.mudar({ contas: { ...d.ui().contas, [c.ia]: c } });
  };
  const comNota = (ia: IaDesktop, nota: string | null): Partial<UiIas> => {
    const resto = { ...d.ui().nota };
    delete resto[ia];
    return { nota: nota ? { ...resto, [ia]: nota } : resto };
  };
  const semForm = (ia: IaDesktop): Partial<UiIas> => {
    const resto = { ...d.ui().contaNova };
    delete resto[ia];
    return { contaNova: resto };
  };
  const ponte = () => d.mac()?.contas;
  const rotulo = (ia: IaDesktop, posicao: number) => d.ui().contas[ia]?.contas[posicao - 1]?.apelido || `conta ${posicao}`;

  return {
    /** Lê a lista e passa a ouvir as mudanças. Sem a ponte (navegador, app antigo), nada. */
    async iniciar(): Promise<void> {
      const c = ponte();
      if (!c) return;
      c.aoMudar((lista) => d.mudar({ contas: Object.fromEntries(lista.map((x) => [x.ia, x])) }));
      const lista = await c.listar().catch(() => [] as ContasNaTela[]);
      d.mudar({ contas: Object.fromEntries(lista.map((x) => [x.ia, x])) });
    },
    noApp: () => ponte() !== undefined,

    /** "Seguir com a conta N" na conversa: o próximo turno sai nela; a mensagem é mandada de novo pela pessoa. */
    async usar(ia: IaDesktop, posicao: number): Promise<boolean> {
      const c = ponte();
      if (!c) return false;
      const r = await c.usar(ia, posicao).catch(() => null);
      guardar(r);
      d.mudar(comNota(ia, r ? `Seguindo com a conta ${posicao} do ${PROVEDOR[ia].cli}. Mande a mensagem de novo.` : "Não deu para trocar de conta. Abra Provedores de IA."));
      return r !== null;
    },
    async mover(ia: IaDesktop, de: number, para: number): Promise<void> {
      guardar(await ponte()?.mover(ia, de, para).catch(() => null));
    },
    async definirTroca(ia: IaDesktop, posicao: number, ligado: boolean): Promise<void> {
      guardar(await ponte()?.definirTrocaAutomatica(ia, posicao, ligado).catch(() => null));
    },
    /** Ligar pede o aviso dos termos; recusado, o rádio volta ao que era (a lista redesenha). */
    async definirModo(ia: IaDesktop, modo: "perguntar" | "automatico"): Promise<void> {
      const atual = d.ui().contas[ia];
      if (!atual || atual.modo === modo) return;
      if (modo === "automatico" && !(await d.avisarTermos(ia))) { guardar({ ...atual }); return; }
      guardar(await ponte()?.definirModo(ia, modo).catch(() => null));
    },
    async remover(ia: IaDesktop, posicao: number): Promise<void> {
      const c = ponte();
      if (!c || d.ui().contas[ia]?.contas[posicao - 1]?.principal !== false) return;
      if (!d.confirmar(`Remover a conta ${rotulo(ia, posicao)}?\n\nO nod sai só desta conta (logout) e apaga a pasta dela ${nesteMac()}. As outras contas continuam conectadas.`)) return;
      const r = await c.remover(ia, posicao).catch(() => null);
      if (!r) { d.mudar(comNota(ia, "Não deu para remover a conta. Tente de novo.")); return; }
      guardar(r.contas);
      d.mudar(comNota(ia, r.logout ? null : NOTA_LOGOUT_FALHOU));
    },
    abrirForm: (ia: IaDesktop) => d.mudar({ contaNova: { ...d.ui().contaNova, [ia]: "" } }),
    digitarApelido: (ia: IaDesktop, apelido: string) => d.mudar({ contaNova: { ...d.ui().contaNova, [ia]: apelido } }),
    fecharForm: (ia: IaDesktop) => d.mudar(semForm(ia)),
    /** "Cancelar" no erro da adição (QA do NOD-211). */
    async fecharFalha(ia: IaDesktop): Promise<void> {
      const c = ponte();
      if (!c?.fecharFalha) return;
      guardar(await c.fecharFalha(ia).catch(() => null));
    },
    /** Cria a pasta e abre o login NELA; os passos do login aparecem no cartão da IA, como no primeiro login. */
    async adicionar(ia: IaDesktop, apelido: string): Promise<void> {
      const c = ponte();
      if (!c) return;
      const ok = await c.adicionar(ia, apelido.trim()).catch(() => false);
      d.mudar({ ...semForm(ia), ...comNota(ia, ok ? null : "Não deu para começar: termine o login aberto ou remova uma conta.") });
    },
  };
}

export type ContasDoMacWeb = ReturnType<typeof criarContasDoMac>;
