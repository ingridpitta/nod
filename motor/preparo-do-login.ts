import { statfs } from "node:fs/promises";
import { dirname } from "node:path";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { AtualizacaoDaIa, MotivoAtualizacao } from "../src/contracts/estado-ia.ts";
import type { PreparoDoLogin } from "../src/contracts/preparo-do-login.ts";
import { discoDoStatfs } from "../src/domain/memoria-mac.ts";
import type { AtualizadorDeIas, FimDoPasso, PassoAtualizar } from "../desktop/atualizador-ias.ts";

/**
 * NOD-8 passo 10 (definido em 2026-10-24, plano do Arquiteto): o passo 1 do login de uma conta na VM (ADR-102 item 3).
 * Antes de abrir o `auth login`, a IA que falta é instalada e a que está abaixo do piso (`PISO_CLI`) é atualizada, pelo
 * mesmo `npm_local` da NOD-9 (ADR-100). Atualizar vai pelo orquestrador (gatilho clique, sem esperar brecha); instalar
 * roda o passo direto (o orquestrador não instala: sem versão, `decidirAtualizacao` diz "nada"), como o
 * `nod-motor atualizar-ia` sem serviço. Antes de tudo, 2 GB livres em ~/.local; senão `sem_espaco`, sem rodar o npm.
 */
export const ESPACO_DO_PREPARO_MB = 2048;

export type PassoDoPreparo = Pick<PreparoDoLogin, "acao" | "antes">;
export type FimDoPreparo = { ok: boolean; depois?: string; atualizacao: AtualizacaoDaIa };

export type PreparoNoMotor = {
  /** null = a IA está pronta (ou o binário é de NOD_*_BIN: o nod não mexe). */
  precisa(ia: IaDesktop): Promise<PassoDoPreparo | null>;
  rodar(ia: IaDesktop, passo: PassoDoPreparo): Promise<FimDoPreparo>;
};

export type DepsPreparoNoMotor = {
  bin(ia: IaDesktop): Promise<string | null>;
  configurado(ia: IaDesktop): boolean;
  lerVersao(bin: string): Promise<string | null>;
  piso(ia: IaDesktop): string;
  comparar(a: string, b: string): -1 | 0 | 1;
  /** ~/.local do `nod` (o prefixo do npm_local). */
  pastaLocal: string;
  /** O livre em MB onde a IA vai morar; null = sem leitura (o preparo segue: o npm diz se faltar). */
  livreMb?(pasta: string): Promise<number | null>;
  atualizador: Pick<AtualizadorDeIas, "atualizar">;
  passo(ia: IaDesktop): PassoAtualizar;
  /** Reler as IAs (vigia.sondarAgora): o inventário novo sobe com a versão que ficou. */
  sondar(): Promise<void>;
  agora(): number;
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
  /** Pausa entre as releituras enquanto outra atualização da mesma IA roda (padrão: setTimeout). */
  esperar?(ms: number): Promise<void>;
};

/**
 * QA do #511: com uma atualização da mesma IA já rodando (a automática da NOD-9, ou um "Atualizar" da tela), o
 * orquestrador volta na hora com `atualizando`/`pedindo_aprovacao`. O preparo espera ela acabar (relendo a cada 2 s, até
 * 15 min) em vez de dar `preparo_falhou`; no fim, a releitura acha a versão nova e volta o `sucesso` dela.
 */
const EM_CURSO: ReadonlySet<AtualizacaoDaIa["fase"]> = new Set(["atualizando", "pedindo_aprovacao"]);
export const ESPERA_DA_OUTRA_MS = 2_000;
export const TENTATIVAS_DA_ESPERA = 450;

/** O livre da pasta ou, se ela ainda não existe, do primeiro pai que existe (o ~/.local nasce na instalação). */
export async function livreEmMb(pasta: string): Promise<number | null> {
  for (let p = pasta; ; p = dirname(p)) {
    const s = await statfs(p).catch(() => null);
    if (s) return discoDoStatfs(s)?.livreMb ?? null;
    if (dirname(p) === p) return null;
  }
}

function motivoDoPasso(f: FimDoPasso): MotivoAtualizacao {
  if (f.resultado === "ok") return "insuficiente";
  if (f.resultado === "sem_npm" || f.resultado === "recusou") return "falhou";
  return f.resultado;
}

export function criarPreparoNoMotor(d: DepsPreparoNoMotor): PreparoNoMotor {
  const livre = d.livreMb ?? livreEmMb;
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async precisa(ia) {
      if (d.configurado(ia)) return null;
      const bin = await d.bin(ia);
      if (!bin) return { acao: "instalar" };
      const versao = await d.lerVersao(bin).catch(() => null);
      // Versão ilegível: o binário existe; quem decide é o login (como hoje), não um npm às cegas.
      if (versao === null || d.comparar(versao, d.piso(ia)) >= 0) return null;
      return { acao: "atualizar", antes: versao };
    },
    async rodar(ia, passo) {
      const alvo = d.piso(ia);
      const inicio = d.agora();
      const base = { alvo, caminho: "npm_local" as const, ...(passo.antes ? { antes: passo.antes } : {}) };
      const mb = await livre(d.pastaLocal).catch(() => null);
      if (mb !== null && mb < ESPACO_DO_PREPARO_MB) {
        d.registrar("motor_preparo_login", { ia, acao: passo.acao, resultado: "sem_espaco", livre_mb: mb });
        return { ok: false, atualizacao: { ...base, fase: "falhou", motivo: "sem_espaco", em: d.agora(), espaco: { livreMb: mb, precisaMb: ESPACO_DO_PREPARO_MB } } };
      }
      let fim: FimDoPreparo;
      if (passo.acao === "atualizar") {
        const pedir = () => d.atualizador.atualizar(ia, { agora: true }).catch(() => null);
        let a = await pedir();
        for (let i = 0; a && EM_CURSO.has(a.fase) && i < TENTATIVAS_DA_ESPERA; i++) {
          await esperar(ESPERA_DA_OUTRA_MS);
          a = await pedir();
        }
        const atualizacao: AtualizacaoDaIa = !a ? { ...base, fase: "falhou", motivo: "falhou", em: d.agora() }
          : EM_CURSO.has(a.fase) ? { ...base, fase: "falhou", motivo: "tempo_esgotado", em: d.agora() }
          : a;
        fim = { ok: atualizacao.fase === "sucesso", ...(atualizacao.depois ? { depois: atualizacao.depois } : {}), atualizacao };
      } else {
        const f = await d.passo(ia).rodar(alvo).catch((): FimDoPasso => ({ resultado: "falhou", antes: null, depois: null, atende: false }));
        const ok = f.atende;
        const depois = f.depois ?? undefined;
        fim = {
          ok,
          ...(depois ? { depois } : {}),
          atualizacao: { ...base, fase: ok ? "sucesso" : f.resultado === "ok" ? "insuficiente" : "falhou", em: d.agora(), ...(depois ? { depois } : {}), ...(ok ? {} : { motivo: motivoDoPasso(f) }), ...(f.espaco ? { espaco: f.espaco } : {}) },
        };
      }
      // O atualizador já relê no fim dele; o instalar relê aqui. Reler de novo é barato e garante a versão nova.
      if (fim.ok) await d.sondar().catch(() => undefined);
      d.registrar("motor_preparo_login", { ia, acao: passo.acao, resultado: fim.atualizacao.fase, motivo: fim.atualizacao.motivo ?? null, depois: fim.depois ?? null, ms: d.agora() - inicio });
      return fim;
    },
  };
}
