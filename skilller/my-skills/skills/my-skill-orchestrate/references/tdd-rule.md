# TDD rule

Paste verbatim into CONSTRAINTS of implementer and debug-fix dispatches.

```
TEST-FIRST for logic changes and bug fixes:
1. Write the test at the public seam (mobile: ViewModel or pure function), expected values from the spec, not the code.
2. Run it. RED = an assertion failure for the stated reason (not a compile or setup error); a bug-fix test fails on unfixed code.
3. Write the least passing code; rerun.
4. Report `RED: <command> -> <failing line>` and `GREEN: <command> -> <result>`.
Mock only boundaries (network, disk, clock, platform). Never weaken or delete an existing assertion.
Exempt (`tests: none — <reason>`): config, copy, pure styling, generated code.
```

UI/e2e tests run only at phase gates.

Source: mattpocock/skills tdd (MIT), ideas only
Source: zakariaf/ReactNative-Skills tdd-workflow (MIT), ideas only
