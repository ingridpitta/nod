/**
 * A pasta do bot no Mac da pessoa (ADR-052), para o painel dizer onde ela está. A regra é a de
 * `pastaDoBot` em src/domain/nativas.ts — a web não importa o domínio (fronteira da ADR-018), e o teste
 * web/pasta-do-bot confere as duas contra os mesmos nomes.
 */
export function caminhoDaPastaDoBot(nome: string): string {
  const limpo = nome.normalize("NFC").replace(/[/\\:\0]/g, "-").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `~/nod/${limpo === "" ? "bot" : limpo}`;
}
