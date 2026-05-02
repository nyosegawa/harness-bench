#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > services/issue/commit_self_reference_hidden_test.go <<'GOEOF'
package issue

import (
	"testing"

	issues_model "code.gitea.io/gitea/models/issues"
	repo_model "code.gitea.io/gitea/models/repo"
	"code.gitea.io/gitea/models/unittest"
	user_model "code.gitea.io/gitea/models/user"
	"code.gitea.io/gitea/modules/repository"

	"github.com/stretchr/testify/require"
)

func TestHiddenUpdateIssuesCommitSkipsOnlyMergedPullSelfReference(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())
	user := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 2})
	repo := unittest.AssertExistsAndLoadBean(t, &repo_model.Repository{ID: 1})
	repo.Owner = user

	selfMergeCommit := &repository.PushCommit{
		Sha1:           "1a8823cd1a9549fde083f992f6b9b87a7ab74fb3",
		CommitterEmail: "user2@example.com",
		CommitterName:  "User Two",
		AuthorEmail:    "user2@example.com",
		AuthorName:     "User Two",
		Message:        "Merge pull request 'issue2' (#2) from branch1 into master",
	}
	selfRefComment := &issues_model.Comment{
		Type:      issues_model.CommentTypeCommitRef,
		CommitSHA: selfMergeCommit.Sha1,
		PosterID:  user.ID,
		IssueID:   2,
	}

	unittest.AssertNotExistsBean(t, selfRefComment)
	require.NoError(t, UpdateIssuesCommit(t.Context(), user, repo, []*repository.PushCommit{selfMergeCommit}, repo.DefaultBranch))
	unittest.AssertNotExistsBean(t, selfRefComment)

	normalRefCommit := &repository.PushCommit{
		Sha1:           "benchmarkhidden1234567890abcdef1234567890abcd",
		CommitterEmail: "user2@example.com",
		CommitterName:  "User Two",
		AuthorEmail:    "user2@example.com",
		AuthorName:     "User Two",
		Message:        "Refs #1 from a normal merge cleanup",
	}
	normalRefComment := &issues_model.Comment{
		Type:      issues_model.CommentTypeCommitRef,
		CommitSHA: normalRefCommit.Sha1,
		PosterID:  user.ID,
		IssueID:   1,
	}

	unittest.AssertNotExistsBean(t, normalRefComment)
	require.NoError(t, UpdateIssuesCommit(t.Context(), user, repo, []*repository.PushCommit{normalRefCommit}, repo.DefaultBranch))
	unittest.AssertExistsAndLoadBean(t, normalRefComment)
}
GOEOF

go test -tags sqlite,sqlite_unlock_notify ./services/issue -run TestHiddenUpdateIssuesCommitSkipsOnlyMergedPullSelfReference -count=1
