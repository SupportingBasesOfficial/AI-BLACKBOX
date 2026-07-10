# CONSTITUTION — Zero-Error Black Box (Dogfooding)

## Meta
- version: 1
- last_updated: 2025-07-09
- updated_by: zero-error/init
- changelog:
  - v1: Constitution inicial do próprio black box

## Invariantes
- Toda função tem tipo de retorno explícito
- Toda função exportada tem testes
- Nenhum `any` em TypeScript
- Nenhum `console.log` em produção (usar logger estruturado)
- Toda mudança passa pelos 8 validators
- Toda função < 50 linhas
- Imports organizados: externos → internos

## Direção
- Objetivo: Black box que garante 100% de corretude em IA-assisted development
- Prioridade: Funcionalidade > Performance > Estética
- Pronto = 100% do critério de aceitação

## Padrões
- Linguagem: TypeScript (ESM)
- Runtime: Node.js 20+
- Linter: ESLint
- Testes: Vitest

## Proibições
- Workarounds (sempre resolver a causa raiz)
- `any` em TypeScript (usar `unknown` + type guard)
- `console.log` em produção (usar logger estruturado)
- Imports não-usados
- Funções > 50 linhas
- TODO/FIXME/HACK no código
- Try/catch vazio ou que silencia erro
- Cast forçado (`as any`, `as unknown as X`)
- Lógica duplicada
- Abstrações usadas apenas uma vez

## Doutrina do 100%
- 100% é o critério de aceitação mínimo
- Workarounds são proibidos
- Estudo pré-execução é obrigatório
- Fluxo: ENTENDER → ESTUDAR → PLANEJAR → EXECUTAR → VERIFICAR

## Configuração de Validação
- requireTests: true
- preCommitTimeout: 30
- prePushTimeout: 120
- ciTimeout: 600
- mutationThreshold: 80
- coverageThreshold: 80
