#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > pkg/commands/git_commands/branch_loader_fast_hidden_test.go <<'GOEOF'
package git_commands

import (
	"testing"

	"github.com/jesseduffield/lazygit/pkg/commands/models"
	"github.com/jesseduffield/lazygit/pkg/commands/oscommands"
	"github.com/stretchr/testify/assert"
)

func TestHiddenFastBehindBaseBranchValuesResetMissingBranches(t *testing.T) {
	mainBranchRefs := []string{"refs/heads/master", "refs/remotes/origin/develop"}
	feature := &models.Branch{Name: "feature"}
	missing := &models.Branch{Name: "missing"}
	missing.BehindBaseBranch.Store(99)

	expectedFormat := "%(refname)%00%(ahead-behind:refs/heads/master)%00%(ahead-behind:refs/remotes/origin/develop)"
	output := "refs/heads/feature\x0040 1\x004 8\n"
	runner := oscommands.NewFakeRunner(t).
		ExpectGitArgs([]string{"for-each-ref", "--format=" + expectedFormat, "refs/heads"}, output, nil)

	gitCommon := buildGitCommon(commonDeps{
		runner:     runner,
		gitVersion: &GitVersion{2, 41, 0, ""},
	})
	loader := &BranchLoader{
		Common:    gitCommon.Common,
		GitCommon: gitCommon,
		cmd:       gitCommon.cmd,
	}
	mainBranches := &MainBranches{
		c:                    gitCommon.Common,
		cmd:                  gitCommon.cmd,
		existingMainBranches: mainBranchRefs,
		previousMainBranches: gitCommon.Common.UserConfig().Git.MainBranches,
	}

	rendered := false
	err := loader.GetBehindBaseBranchValuesForAllBranches(
		[]*models.Branch{feature, missing},
		mainBranches,
		func() { rendered = true },
	)
	assert.NoError(t, err)
	assert.True(t, rendered)
	assert.Equal(t, int32(8), feature.BehindBaseBranch.Load())
	assert.Equal(t, int32(0), missing.BehindBaseBranch.Load())
	runner.CheckForMissingCalls()
}
GOEOF

go test ./pkg/commands/git_commands -run TestHiddenFastBehindBaseBranchValuesResetMissingBranches -count=1
