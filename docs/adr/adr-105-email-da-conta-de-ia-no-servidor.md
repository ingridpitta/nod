# ADR-105 — O e-mail e a organização da conta de IA moram no servidor

Status: aceito (decisão do Marlon, 2026-10-15, opção "3-a") · Data: 2026-10-15 · Emenda a
[ADR-019](adr-019-a-sonda-de-disponibilidade-pergunta-ao-cli-nunca-le-a-cr.md) ("o email do fornecedor NÃO é gravado")
e o item 6 da [ADR-102](adr-102-contas-da-pessoa-em-todas-as-maquinas.md)

## Contexto

Em Provedores de IA, cada conta mostra o e-mail e a organização só quando a página roda no app do Mac em que a conta
está logada (ADR-102 item 6). No dia 2026-10-15, com 7 contas na lista, o Marlon abriu a tela no MacBook-Pro: as
contas 1, 3 e 7 (logadas nele) tinham e-mail; as 2, 4, 5 e 6 (logadas só no MacBook-Air e na VM) mostravam só "pelo
Claude Code"/"pelo Codex". No outro Mac seria o contrário. Com dois apelidos parecidos e o mesmo plano, não dava para
lembrar qual conta era qual. A queixa foi "o e-mail está sumindo".

A ADR-102 tinha descartado o e-mail mascarado no servidor (3C). Na conversa, o mascarado foi descartado de novo, por
outro motivo: as contas 3 e 7 virariam as duas "mar•••@exemplo.com", e a máscara esconde justamente o que
diferencia as contas.

## Decisão

1. **A máquina manda o e-mail e a organização no anúncio das contas** (`ContaAnunciada.email`/`organizacao`, no
   `conectar` e no `inventario`). São os mesmos que o CLI já dizia para a impressão (`claude auth status`,
   `account/read` do Codex; o Codex não diz organização). Ausente = a máquina não sabe agora (app ou motor anterior,
   conta carregada do arquivo e ainda não relida).
2. **O servidor guarda em `contas_ia.email` e `contas_ia.organizacao`** (migração 0075, só adição). O servidor confere
   o anúncio com os mesmos normalizadores da máquina (`emailDaConta`, `organizacaoDaConta`); fora do formato, o campo
   some e a conta fica. Ausente nunca apaga o que já está guardado (coalesce). Um valor diferente substitui: a
   organização renomeada aparece no anúncio seguinte.
3. **A tela lê do servidor** (`ContaIa.email`/`organizacao`) em qualquer máquina, também fora do app. O app do Mac que
   conhece a conta ainda ganha, porque o que o CLI disse agora é o mais novo.
4. **Continua valendo a regra 2 da ADR-019:** a identidade que o CLI diz é cosmética. Nada autoriza, escolhe ou casa
   conta por e-mail; a chave da conta segue sendo a impressão (ADR-102 item 4). O e-mail não vai ao log, ao
   inventário (`Inventario`) nem ao arquivo `contas-locais.json` da máquina.

## Alternativas descartadas

- **Manter só no Mac (como estava).** É o problema relatado.
- **E-mail mascarado no servidor (3C da ADR-102).** Não diferencia contas do mesmo domínio.
- **O app de cada Mac repassar o e-mail aos outros, cifrado com uma chave da pessoa que o servidor não tem.** Protege
  mais, mas pede uma chave por pessoa sincronizada entre Macs e a VM. É caro para um rótulo de tela. Fica como saída se
  o e-mail em claro no banco virar problema (ver gatilho).

## Consequências

- O e-mail das contas de IA passa a ser **dado pessoal guardado em claro** no banco de produção, com a mesma RLS do resto
  de `contas_ia` (só a dona lê). Na prática ele já não era secreto: a impressão é um sha256 sem chave e se confirma
  por dicionário (limites conhecidos da ADR-102). Esta ADR assume isso.
- As contas criadas antes ganham o e-mail no próximo anúncio de uma máquina que as conheça com o app ou o motor novos.
  O motor da VM se atualiza sozinho (ADR-100); o app do Mac precisa de release.
- Testes que garantiam "o e-mail nunca sai da máquina" foram invertidos para "sai no anúncio, nunca no arquivo".

## Gatilho de reversão

- Um pedido de cliente, jurídico ou auditoria para não guardar e-mail de fornecedor em claro: volta à tela da
  ADR-102 (as colunas ficam vazias, a tela cai no app do Mac) ou passa para a cifra com chave da pessoa.
- Algum código passar a decidir algo pelo e-mail guardado (autorizar, escolher conta, casar conta): é violação da
  ADR-019 regra 2, não evolução desta.
