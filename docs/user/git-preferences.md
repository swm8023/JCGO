> 本文件记录本项目跨会话生效的 Git 工作流偏好。

# Git Preferences

- 基线：使用 `master`，禁止任何删除基线分支的操作。
- Branch/Worktree：所有任务直接在 `master` 上修改，不创建 feature branch 或 worktree。
- Sync：开始任务前同步远端最新状态；提交前 rebase 到远端最新状态；明确冲突自动解决，存在语义歧义时询问用户。
- Commit：任务完成且验证通过后自动 commit；未完成或验证失败时不提交。
- Merge：不创建 PR；所有任务直接提交到 `master`，不执行合并操作。
- Push：任务完成且验证通过后自动 push `origin/master`。
- Cleanup：不适用；不创建或清理分支与 worktree。
- 最后更新：2026-07-24。
