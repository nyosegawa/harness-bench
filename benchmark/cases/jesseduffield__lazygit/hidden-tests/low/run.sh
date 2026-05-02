#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > pkg/commands/git_commands/github_owner_casing_hidden_test.go <<'GOEOF'
package git_commands

import (
	"testing"

	"github.com/jesseduffield/lazygit/pkg/commands/models"
	"github.com/stretchr/testify/assert"
)

func TestHiddenGithubPullRequestMapMatchesOwnerCaseInsensitively(t *testing.T) {
	pr := &models.GithubPullRequest{
		HeadRefName:         "bugfix/case-mismatch",
		Number:              77,
		Title:               "Fix casing mismatch",
		State:               "OPEN",
		HeadRepositoryOwner: models.GithubRepositoryOwner{Login: "JesseDuffield"},
	}
	branch := &models.Branch{
		Name:           "bugfix/case-mismatch",
		UpstreamRemote: "origin",
		UpstreamBranch: "bugfix/case-mismatch",
	}
	remote := &models.Remote{
		Name: "origin",
		Urls: []string{"git@github.com:jesseduffield/lazygit.git"},
	}

	result := GenerateGithubPullRequestMap(
		[]*models.GithubPullRequest{pr},
		[]*models.Branch{branch},
		[]*models.Remote{remote},
	)

	assert.Equal(t, pr, result["bugfix/case-mismatch"])
}

func TestHiddenGithubPullRequestMapStillRequiresExactBranchName(t *testing.T) {
	pr := &models.GithubPullRequest{
		HeadRefName:         "bugfix/case-mismatch",
		Number:              78,
		Title:               "Fix casing mismatch",
		State:               "OPEN",
		HeadRepositoryOwner: models.GithubRepositoryOwner{Login: "jesseduffield"},
	}
	branch := &models.Branch{
		Name:           "different-local-name",
		UpstreamRemote: "origin",
		UpstreamBranch: "bugfix/other-branch",
	}
	remote := &models.Remote{
		Name: "origin",
		Urls: []string{"git@github.com:jesseduffield/lazygit.git"},
	}

	result := GenerateGithubPullRequestMap(
		[]*models.GithubPullRequest{pr},
		[]*models.Branch{branch},
		[]*models.Remote{remote},
	)

	assert.Empty(t, result)
}
GOEOF

go test ./pkg/commands/git_commands -run 'TestHiddenGithubPullRequestMap' -count=1
