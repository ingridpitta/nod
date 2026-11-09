import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { ItemRemocao, OpcoesRemover, ResultadoRemoverDaqui } from "../src/contracts/remover-computador.ts";
import { TEXTOS_REMOCAO, type IaDoNpm } from "../motor/desinstalar.ts";
import { pastaDaIa } from "./ferramentas.ts";

/**
 * ADA-245 (jornada D): o "Remover o nod deste computador" no app do Mac (`window.nodDesktop.removerDaqui`). O .app
 * fica (sai pelo Lixo, como todo app do Mac); daqui saem:
 *  - as IAs que o próprio app instalou (userData/ferramentas/<ia>, ferramentas.ts) quando a caixa "Tirar também…" está
 *    ligada. As IAs que a pessoa instalou por fora nunca são tocadas;
 *  - as contas e a conexão quando "Continuar ligado" está desligado: primeiro o logout de cada conta (precisa do binário
 *    da IA, por isso antes de apagar as IAs), depois a conexão para e o arquivo dela some.
 * Sem Electron: o main.ts injeta o disco e as ações. Os textos são os do motor do Windows (TEXTOS_REMOCAO), sem jargão.
 */
export type DepsRemoverDaqui = {
  /** userData/ferramentas: onde o app instala cada IA (pastaDaIa). */
  baseDasIas: string;
  existe(caminho: string): Promise<boolean>;
  apagar(caminho: string): Promise<void>;
  /** Logout de todas as contas deste Mac; false = alguma não saiu. */
  sairDasContas(): Promise<boolean>;
  /** Para a conexão e apaga o arquivo dela (conexao.enc). */
  desligar(): Promise<void>;
  /**
   * Só para a conexão e o executor deste Mac (o arquivo dela fica). Revisão do PR #694: com "Continuar ligado" o nod
   * também para aqui, senão este Mac seguia pegando turnos (e com as IAs já apagadas) depois da tela dizer "removido".
   */
  parar(): Promise<void>;
};

/** A IA do app (desktop) no vocabulário dos textos de remoção. */
const IA_DO_TEXTO: Record<IaDesktop, IaDoNpm> = { "claude-cli": "claude", "codex-cli": "codex" };
const IAS_DO_APP = Object.keys(IA_DO_TEXTO) as IaDesktop[];

const item = (id: ItemRemocao["id"], estado: ItemRemocao["estado"], texto: string): ItemRemocao => ({ id, estado, texto });

/** O texto de falha do desligar no Mac (o do Windows aponta um arquivo; aqui a saída é abrir o app e desconectar). */
export const TEXTO_NAO_SAIU_NO_MAC = "Não deu para desligar este computador da sua conta. Abra o nod e desconecte em Computadores";

async function contaNoMac(d: DepsRemoverDaqui): Promise<ItemRemocao[]> {
  const saiuDasContas = await d.sairDasContas().catch(() => false);
  const desligou = await d.desligar().then(() => true, () => false);
  if (!desligou) return [item("conta", "falhou", TEXTO_NAO_SAIU_NO_MAC)];
  // Logout que falhou não impede o desligar (a conexão sai de todo jeito), mas a tela não diz "saiu" sem ressalva.
  return [item("parou", "feito", TEXTOS_REMOCAO.parou), item("conta", saiuDasContas ? "feito" : "falhou", saiuDasContas ? TEXTOS_REMOCAO.saiu : TEXTO_NAO_SAIU_NO_MAC)];
}

async function iasNoMac(d: DepsRemoverDaqui): Promise<ItemRemocao> {
  const doNod: IaDesktop[] = [];
  for (const ia of IAS_DO_APP) if (await d.existe(pastaDaIa(d.baseDasIas, ia)).catch(() => false)) doNod.push(ia);
  if (doNod.length === 0) return item("ias", "feito", TEXTOS_REMOCAO.semIas);
  const ficaram: IaDesktop[] = [];
  for (const ia of doNod) await d.apagar(pastaDaIa(d.baseDasIas, ia)).catch(() => { ficaram.push(ia); });
  if (ficaram.length > 0) return item("ias", "falhou", TEXTOS_REMOCAO.iasFicaram(ficaram.map((ia) => IA_DO_TEXTO[ia]), d.baseDasIas));
  return item("ias", "feito", TEXTOS_REMOCAO.ias(doNod.map((ia) => IA_DO_TEXTO[ia])));
}

export async function removerDaquiNoMac(o: OpcoesRemover, d: DepsRemoverDaqui): Promise<ResultadoRemoverDaqui> {
  const itens: ItemRemocao[] = [];
  // A conta antes das IAs: o logout roda o binário delas.
  if (o.manterConexao) {
    // Para antes de apagar as IAs (um turno em curso não segura o binário); a conexão e os logins ficam.
    if (await d.parar().then(() => true, () => false)) itens.push(item("parou", "feito", TEXTOS_REMOCAO.parou));
    itens.push(item("conta", "mantido", TEXTOS_REMOCAO.continua));
  } else itens.push(...(await contaNoMac(d)));
  itens.push(o.manterIas ? item("ias", "mantido", TEXTOS_REMOCAO.iasFicam) : await iasNoMac(d));
  // A ordem da tela de Fim: parou, ias, conta.
  const ordem: Record<ItemRemocao["id"], number> = { parou: 0, programa: 1, ias: 2, conta: 3 };
  return { itens: itens.sort((a, b) => ordem[a.id] - ordem[b.id]) };
}
