#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > modules/gitrepo/merge_base_hidden_regression_test.go <<'GOEOF'
package gitrepo

import (
	"os"
	"path/filepath"
	"testing"

	"code.gitea.io/gitea/modules/git/gitcmd"

	"github.com/stretchr/testify/require"
)

type hiddenMergeBaseRegressionRepo struct {
	path string
}

func (r *hiddenMergeBaseRegressionRepo) RelativePath() string {
	return r.path
}

func TestHiddenMergeBaseRegressionRelatedBranchesStillReturnBase(t *testing.T) {
	repoDir := filepath.Join(t.TempDir(), "repo.git")
	require.NoError(t, gitcmd.NewCommand("init").AddDynamicArguments(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("config").AddDynamicArguments("user.email", "user@example.com").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("config").AddDynamicArguments("user.name", "User").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, "main.txt"), []byte("main file\n"), 0o644))
	require.NoError(t, gitcmd.NewCommand("add").AddDynamicArguments("main.txt").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("commit").AddOptionValues("-m", "main commit").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("checkout").AddArguments("-b").AddDynamicArguments("feature").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, "feature.txt"), []byte("feature file\n"), 0o644))
	require.NoError(t, gitcmd.NewCommand("add").AddDynamicArguments("feature.txt").WithDir(repoDir).Run(t.Context()))
	require.NoError(t, gitcmd.NewCommand("commit").AddOptionValues("-m", "feature commit").WithDir(repoDir).Run(t.Context()))

	mergeBase, err := MergeBase(t.Context(), &hiddenMergeBaseRegressionRepo{path: repoDir}, "master", "feature")
	require.NoError(t, err)
	require.NotEmpty(t, mergeBase)
}
GOEOF

go test -tags sqlite,sqlite_unlock_notify ./modules/gitrepo -run TestHiddenMergeBaseRegression -count=1
