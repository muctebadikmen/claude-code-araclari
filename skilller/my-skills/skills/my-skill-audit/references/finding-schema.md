# Finding schema (JSON, one array per analyzer file)

```json
[
  {
    "id": "TMP-security-1",
    "title": "SQL query built with string formatting",
    "file": "taskr/store.py",
    "line": 33,
    "evidence": "sql = f\"SELECT * FROM tasks WHERE title LIKE '%{term}%'\"",
    "root_cause": "user input interpolated into SQL instead of bound as a parameter",
    "severity_guess": "Critical",
    "dimension": "security",
    "reproduce": "call Store().search(\"' OR 1=1 --\") and observe all rows returned"
  }
]
```

Rules: `line` is the first line of the offending code. `evidence` is a quote of at most 3 lines. `reproduce` is a concrete call or command, or "read-only reasoning" if none exists. `severity_guess` ∈ Critical, High, Medium, Low. No entries for style, naming, or missing features.
