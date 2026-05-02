#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > modules/gitrepo/merge_base_hidden_test.go <<'GOEOF'
package gitrepo

import (
	"os"
	"path/filepath"
	"testing"

	"code.gitea.io/gitea/modules/git/gitcmd"
	"code.gitea.io/gitea/modules/util"

	"github.com/stretchr/testify/require"
)

type hiddenMergeBaseRepo struct {
	path string
}

func (r *hiddenMergeBaseRepo) RelativePath() string {
	return r.path
}

func TestHiddenMergeBaseUnrelatedBranchesReturnsNotExist(t *testing.T) {
	repoDir := filepath.Join(t.TempDir(), "repo.git")
	require.NoError(t, gitcmd.NewCommand("init").AddDynamicArguments(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("config").AddDynamicArguments("user.email", "user@example.com").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("config").AddDynamicArguments("user.name", "User").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, "main.txt"), []byte("main file\n"), 0o644))
	require.NoError(t, gitcmd.NewCommand("add").AddDynamicArguments("main.txt").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("commit").AddOptionValues("-m", "main commit").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("checkout").AddArguments("--orphan").AddDynamicArguments("orphan").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("rm").AddArguments("-rf").AddDynamicArguments(".").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, "orphan.txt"), []byte("orphan file\n"), 0o644))
	require.NoError(t, gitcmd.NewCommand("add").AddDynamicArguments("orphan.txt").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("commit").AddOptionValues("-m", "orphan commit").WithDir(repoDir).Run(t.Context()))

	mergeBase, err := MergeBase(t.Context(), &hiddenMergeBaseRepo{path: repoDir}, "master", "orphan")
	require.Empty(t, mergeBase)
	require.ErrorIs(t, err, util.ErrNotExist)
}
GOEOF

go test -tags sqlite,sqlite_unlock_notify ./modules/gitrepo -run TestHiddenMergeBaseUnrelatedBranchesReturnsNotExist -count=1
