import type { IaDesktop } from "../../src/contracts/desktop.ts";
import type { AtualizacaoDaIa } from "../../src/contracts/estado-ia.ts";

/**
 * As frases da atualização do CLI na tela (definido em 2026-10-23, NOD-9, spec de produto e plano do Arquiteto de 20/10).
 * Uma fonte só para o cartão da IA, os Provedores de IA e a linha da conversa: a fase e o motivo são códigos fechados
 * (src/contracts/estado-ia.ts); a saída do CLI nunca chega aqui. Sem frase = a fase não pede aviso (a tela segue como
 * estava).
 */
export function fraseDaAtualizacao(a: AtualizacaoDaIa | null | undefined, nome: string, verbo: "atualizar" | "instalar" = "atualizar"): string | null {
  if (!a) return null;
  // QA do #511: o preparo do login que instala (a IA faltava) diz "instalar" nas falhas, não "atualizar".
  const inst = verbo === "instalar";
  const versao = (v: string | undefined) => (v ? ` para a ${v}` : "");
  switch (a.fase) {
    case "esperando":
      return `Vamos atualizar o ${nome} quando seus bots terminarem.`;
    case "aviso":
      return `Vamos atualizar o ${nome} em breve: os pedidos novos para ele vão esperar a atualização.`;
    case "segurando":
      return `Os pedidos novos para o ${nome} estão esperando a atualização, que roda assim que os bots terminarem.`;
    case "atualizando":
      return `Atualizando o ${nome}…`;
    case "pedindo_aprovacao":
      return "Confirme com a senha do Mac para continuar.";
    case "sucesso":
      return `${nome} atualizado${versao(a.depois)}.`;
    case "insuficiente":
      return `${inst ? "Instalamos" : "Atualizamos"} o ${nome}${versao(a.depois)}, mas o nod precisa da ${a.alvo}, que ainda não saiu. Vamos tentar de novo amanhã.`;
    case "falhou":
      if (a.motivo === "recusou") return "Você não autorizou a atualização.";
      if (a.motivo === "configurado") return `Este ${nome} é o que você configurou para o nod usar; o nod não mexe nele. Atualize-o pelo terminal.`;
      if (a.motivo === "sem_internet") return `Não deu para ${verbo} o ${nome}: sem conexão com a internet.`;
      if (a.motivo === "sem_espaco") return a.espaco ? `Não deu para ${verbo} o ${nome}: falta espaço no disco (tem ${a.espaco.livreMb} MB livres e precisa de ${a.espaco.precisaMb} MB).` : `Não deu para ${verbo} o ${nome}: falta espaço no disco.`;
      return inst ? `Não deu para instalar o ${nome} sozinho.` : "Não deu para atualizar sozinho.";
  }
}

/** Fases em curso (a tela mostra girando e não oferece "Atualizar" de novo). */
export function atualizacaoEmCurso(a: AtualizacaoDaIa | null | undefined): boolean {
  return !!a && (a.fase === "atualizando" || a.fase === "pedindo_aprovacao");
}

/** "Prefere o terminal?": o comando que atualiza a IA onde ela roda (o Mac ou a VM do motor). */
export function comandoDoTerminal(onde: "mac" | "vm", ia: IaDesktop): string | null {
  if (onde === "vm") return `nod-motor atualizar-ia ${ia === "claude-cli" ? "claude" : "codex"}`;
  return ia === "claude-cli" ? "claude update" : null;
}

/**
 * `instalada` < `minima`, comparando x.y.z como números ("2.1.290" < "2.1.300"; "2.1.9" < "2.1.10"). O pré-release vem
 * antes da final da mesma versão. A web não importa o compararVersoes dos adaptadores (ADR-018): a mesma regra, aqui.
 */
export function versaoAbaixo(instalada: string, minima: string): boolean {
  const partes = (v: string) => { const [nucleo = "", pre] = v.split(/-(.*)/s); return { n: nucleo.split(".").map((x) => Number.parseInt(x, 10) || 0), pre: pre ?? null }; };
  const a = partes(instalada);
  const b = partes(minima);
  for (let i = 0; i < Math.max(a.n.length, b.n.length); i += 1) {
    const d = (a.n[i] ?? 0) - (b.n[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return a.pre !== null && b.pre === null;
}
