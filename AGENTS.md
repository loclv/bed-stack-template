# AGENTS.md
You are an expert in TypeScript, and web application development. You write maintainable, performant, and accessible code.
## Rule 1: No Hardcoding
- All configuration values (URLs, model names, thresholds, limits, keys, etc.) must be read from environment variables or a config file.
- Do not hardcode magic numbers, strings, or URLs in the logic code.
- Use clearly named constants for default values, placed in a centralized location (such as a config module or at the top of the file).
- When adding a new feature, always ask: "Could this value change depending on the environment?" → If yes, make it an environment variable.
## Rule 2: SOLID Principles
- Single Responsibility: Each function/module should only do one thing. Do not bundle too much logic into a single handler.
- Open/Closed: Design for extension (adding new providers, adding endpoints) without modifying existing code.
- Liskov Substitution: Implementations sharing the same trait/interface must be interchangeable.
- Interface Segregation: Do not force a module to depend on interfaces it does not use.
- Dependency Inversion: Depend on abstractions (interfaces), do not depend directly on concrete implementations.
## Rule 3: Function Documentation
- Each function/method must have a brief comment describing what it does.
- Use doc comments (`/** */` in TS) so the IDE can display them.
- Minimum formatting format:
  ```typescript
  /**
   * Brief description of what the function does.
   */
  function myFunction() {}
  ```
- If the function is complex, add `@param`, `@returns`, and `@throws` tags as needed.
- Do not comment on obvious things (e.g., `/** Get user ID */` for a getter function that is already self-documenting).
## Rule 4: AI Development Process
When receiving a code change request, the AI must follow this process:
### 4.1 Confirm Requirements
- Read the requirements carefully and ask for clarification if anything is unclear.
- Define the scope: which files are affected, which features are related.
### 4.2 Research
- Search the existing codebase to understand the context (symbols, references, patterns currently in use).
- Search the web if necessary (docs, best practices, API references).
- Propose options, compare pros/cons, and select the optimal solution.
### 4.3 Create a Detailed Plan
Create a plan file in the `plan/` directory with the format: `plan/YYYY-MM-DD_<short-name>.md`

The plan must include all of the following sections:
#### Requirements
- A brief summary of the requirements.
#### Selected Option
- Description of the approach and the rationale for choosing it.
#### Database / Migration (if applicable)
- Migration file content (full SQL).
- Command to run the migration (local + remote).
- File name: `migrations/XXXX_<name>.sql`
#### Code Structure
- Newly created files: file name, purpose.
- Constants: name, value, purpose.
- Types (interfaces): name, fields, serialization/deserialization.
- Helpers: function name, brief description.
- Handlers: name, method + route, logic description.
#### Detailed Processing Flow
- Step-by-step description for each endpoint:
  ```text
  1. Extract auth → 401 if missing
  2. Validate → 400 if invalid
  3. Query/Logic
  4. Response
  ```
#### Changes to Existing Files
- Which file, line number (estimate), and what is added/modified.
#### Test Plan
- Build command.
- Migration command (if applicable).
- Curl commands to test each case.
- Table of expected results.
### 4.5 Implementation
- Code according to the established plan.
- Comply with Rule 1 (no hardcoding), Rule 2 (SOLID), and Rule 3 (doc comments).
### 4.6 Testing
- Build the project, ensuring no compilation errors.
- Run existing tests (`bun run test`).
- Test manually according to the test plan (curl endpoints, verify output).
- If a test fails → fix and rerun until all tests pass.
- Report the test results to the user.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence
This project is indexed by GitNexus as seat-reservation (771 symbols, 1649 relationships, 61 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

>Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).
## Always Do
- MUST run impact analysis before editing any symbol. Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- MUST run `detect_changes()` before committing to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- MUST warn the user if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
## Never Do
- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.
## Resources
| Resource | Use for |
|---|---|
| `gitnexus://repo/seat-reservation/context` | Codebase overview, check index freshness |
| `gitnexus://repo/seat-reservation/clusters` | All functional areas |
| `gitnexus://repo/seat-reservation/processes` | All execution flows |
| `gitnexus://repo/seat-reservation/process/{name}` | Step-by-step execution trace |
## CLI
| Task | Read this skill file |
|---|---|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
