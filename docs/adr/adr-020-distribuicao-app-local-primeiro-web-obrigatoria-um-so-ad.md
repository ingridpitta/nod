# ADR-020 — Distribuição: app local primeiro, web obrigatória, um só ADR

**Status** invertido

## Decisão

Substitui o ADR-020 original e absorve num documento só as quatro decisões de distribuição. (1) ORDEM: app local primeiro (é o produto — sem ele não há executor), web em seguida e OBRIGATÓRIA. (2) MOTOR: Electron, macOS na v1 (arm64 e x64 single-arch), processo principal em TypeScript puro, ZERO módulo nativo, a janela carrega a web do servidor — não existe UI de desktop separada. Tauri rejeitado com motivo escrito: cobra Rust exatamente na metade onde mora todo o valor do app. (3) ASSINATURA: Developer ID + notarização desde a primeira versão (99 USD/ano); Windows NÃO assina. (4) AUTO-UPDATE: só a verificação de versão mínima — o servidor devolve a versão mínima aceita em toda resposta de trabalho e o app recusa trabalhar abaixo dela. Nenhuma linha de electron-updater. Mobile: descartado, a web responsiva decide no celular e NUNCA executa. A REGRA QUE SEPARA TUDO: nenhuma DECISÃO do produto pode exigir o app aberto, verificada por teste de fumaça com o app fechado.

## O que mudou

Inversão da ordem. Quatro ADRs propostos viram um. Mobile perde os gatilhos (dependiam de cliente pagante) e é descartado sem gatilho.

## Por quê

A inversão é consequência aritmética: navegador não spawna processo filho nem lê PATH, então existe um processo que precisa rodar naquela máquina. Mas a frase 'o desktop não pode virar um segundo servidor' permanece válida palavra por palavra, e o ADR-018 a transforma em invariante de compilador. Sobre o auto-update, é a melhor economia da rodada e eu verifiquei o número: electron/ do openmausbot tem 39.883 linhas e 15.949 delas são o electron-updater VENDORIZADO dentro do repo — mais de 40% do custo do Electron deles é uma escolha de auto-update, não o Electron. Trocar isso por um campo na resposta HTTP são dezenas de linhas. Sobre não assinar: parece grátis e não é — nas versões recentes do macOS o contorno virou uma visita a Ajustes do Sistema, por pessoa e por versão; 19 conversas de suporte por mês para economizar 99 dólares por ano.


## Implementação em 2026-09-17

Shell em `desktop/`, TypeScript compilado por alvo, sem módulos nativos npm. Dois DMGs (`arm64`,
`x64`) e workflow com Developer ID/notarização obrigatórios para release. Endereço HTTPS configurável;
a web do servidor é carregada sem Node, preload ou IPC. O preload pertence somente ao onboarding
local. O proxy MCP é executado pelo runtime Electron empacotado, sem Node externo.

A conta Google entra no navegador do sistema; a pessoa copia uma chave de **Chaves** para o app,
que a cifra com Keychain e obtém uma sessão web pelo servidor. A publicação assinada depende de
configurar os secrets Apple e validar os DMGs nos dois processadores. Ver [guia](../release-desktop.md).

## Emenda de 2026-11-04 (NOD-132): o item (4) passa a ter atualização automática

O app do Mac se atualiza pelo `autoUpdater` nativo do Electron (Squirrel.Mac), com o feed no servidor e os ZIPs num
bucket privado; continua sem `electron-updater` e sem dependência nova. A versão mínima e o 426 seguem iguais. Detalhes,
alternativas e gatilho de reversão em [ADR-149](adr-149-atualizacao-automatica-do-app-do-mac.md).
