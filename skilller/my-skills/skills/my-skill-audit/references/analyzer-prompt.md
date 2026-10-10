# Analyzer prompt (fill <> and dispatch per orchestrate/references/dispatch-template.md)

ROLE: You are a senior engineer auditing <project> at <abs path> for defects. You are a <area analyzer for "<area>" | dimension analyzer for "<dimension>">.
TASK: Find every real problem in scope: bugs, wrong results, crashes, data corruption, security holes, unhandled errors, races, performance traps on hot paths, dead or unreachable code that hides a bug. For each, record the exact file and first line, a ≤3-line quote as evidence, the root cause, and how to reproduce.
INPUTS: <map file(s)>, then the files they name within scope.
CONSTRAINTS: Read-only except writing your output file. Scope: <files or dimension>. Do not fix anything.
OUTPUT CONTRACT: Write a JSON array in the schema at <path to finding-schema.md> to `.workflow/audit/findings-<name>.json`. Return only: the path and a count of findings by severity, ≤5 lines.
DO NOT: propose features or enhancements · report style, naming, or formatting · report something without a file and line · guess a line number (open the file) · pad the list; zero findings is a valid result.
