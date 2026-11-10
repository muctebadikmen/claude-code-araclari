# Branch to main

Run SKILL.md steps 1-7 on the feature branch, then:

1. `git fetch origin main`, then `bash <skill path>/scripts/secret-gate.sh --range origin/main`, which also covers commits already pushed to the feature branch. Handle hits as SKILL step 3; for a hit in an already-pushed commit add "rotate it". If `origin/main` is not an ancestor of the branch, merge it into the branch once (merge, not rebase); on conflict `git merge --abort` and 🛑. Re-run verify if the merge brought anything in.
2. Fast-forward main to the branch tip (no merge commit), leaving the user's checkout and uncommitted files as they are:
   - main checked out in a worktree: `git -C <that worktree> merge --ff-only <branch>`. Git refuses on overlapping uncommitted changes: 🛑.
   - otherwise: `git fetch . <branch>:main`.
3. `git push origin main`. Rejected: repeat from 1 once, then 🛑.
4. Report the new main sha and that the feature branch is kept.
