# Agent Instructions & Guidelines

## Git & Version Control Rules

1. **Push & Merge Confirmation (强制确认)**:
   - 涉及 **Git 远程推送 (`git push`)** 与 **分支合并 (`git merge`)** 等影响远程仓库或主干分支的敏感操作时，**严禁自动执行**。
   - 必须先向用户清晰列出将要提交/合并的内容摘要与目标分支，明确询问并获得用户确认（如用户回复“确认推送”或“确认合并”）后，方可执行操作。
2. **Local Commits**:
   - 本地代码提交前确保已通过 `npm run compile` 与 `npm test`。
