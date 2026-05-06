#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > services/issue/commit_self_reference_hidden_core_test.go <<'GOEOF'
package issue

import (
	"reflect"
	"testing"

	issues_model "code.gitea.io/gitea/models/issues"
	repo_model "code.gitea.io/gitea/models/repo"
	"code.gitea.io/gitea/models/unittest"
	user_model "code.gitea.io/gitea/models/user"
	"code.gitea.io/gitea/modules/repository"

	"github.com/stretchr/testify/require"
)

func hiddenCoreUpdateIssuesCommit(t *testing.T, user *user_model.User, repo *repo_model.Repository, commits []*repository.PushCommit, branchName string, pushTrigger repository.PushTrigger, pullRequestID int64) error {
	t.Helper()
	fn := reflect.ValueOf(UpdateIssuesCommit)
	args := []reflect.Value{
		reflect.ValueOf(t.Context()),
		reflect.ValueOf(user),
		reflect.ValueOf(repo),
		reflect.ValueOf(commits),
		reflect.ValueOf(branchName),
	}
	fnType := fn.Type()
	for index := len(args); index < fnType.NumIn(); index++ {
		argType := fnType.In(index)
		if fnType.IsVariadic() && index == fnType.NumIn()-1 {
			elemType := argType.Elem()
			elem := reflect.New(elemType).Elem()
			if elem.Kind() == reflect.Struct {
				if field := elem.FieldByName("SkipPullRequestID"); field.IsValid() && field.CanSet() && field.Kind() == reflect.Int64 {
					field.SetInt(pullRequestID)
				}
				if field := elem.FieldByName("PullRequestID"); field.IsValid() && field.CanSet() && field.Kind() == reflect.Int64 {
					field.SetInt(pullRequestID)
				}
				if field := elem.FieldByName("SkipCommitSHA"); field.IsValid() && field.CanSet() && field.Kind() == reflect.String && len(commits) > 0 {
					field.SetString(commits[0].Sha1)
				}
				if field := elem.FieldByName("CommitSHA"); field.IsValid() && field.CanSet() && field.Kind() == reflect.String && len(commits) > 0 {
					field.SetString(commits[0].Sha1)
				}
			}
			variadic := reflect.MakeSlice(argType, 0, 1)
			variadic = reflect.Append(variadic, elem)
			args = append(args, variadic)
			result := fn.CallSlice(args)
			if len(result) == 0 || result[0].IsNil() {
				return nil
			}
			return result[0].Interface().(error)
		}
		switch {
		case argType == reflect.TypeOf(pushTrigger):
			args = append(args, reflect.ValueOf(pushTrigger))
		case argType.Kind() == reflect.Int64:
			args = append(args, reflect.ValueOf(pullRequestID))
		default:
			args = append(args, reflect.Zero(argType))
		}
	}
	result := fn.Call(args)
	if len(result) == 0 || result[0].IsNil() {
		return nil
	}
	return result[0].Interface().(error)
}

func TestHiddenUpdateIssuesCommitCoreSkipsMergedPullSelfReference(t *testing.T) {
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
	require.NoError(t, hiddenCoreUpdateIssuesCommit(t, user, repo, []*repository.PushCommit{selfMergeCommit}, repo.DefaultBranch, repository.PushTriggerPRMergeToBase, 2))
	unittest.AssertNotExistsBean(t, selfRefComment)
}
GOEOF

go test -tags sqlite,sqlite_unlock_notify ./services/issue -run TestHiddenUpdateIssuesCommitCore -count=1
