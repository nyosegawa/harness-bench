#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > server/router/api/v1/test/missing_related_users_hidden_test.go <<'GOEOF'
package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func TestHiddenListMemosSkipsReactionWithDeletedCreator(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	reactor, err := ts.CreateRegularUser(ctx, "reactor")
	require.NoError(t, err)
	reactorCtx := ts.CreateUserContext(ctx, reactor.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "memo", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpsertMemoReaction(reactorCtx, &apiv1.UpsertMemoReactionRequest{
		Name: memo.Name,
		Reaction: &apiv1.Reaction{
			ContentId:    memo.Name,
			ReactionType: "thumbs-up",
		},
	})
	require.NoError(t, err)

	require.NoError(t, ts.Store.DeleteUser(ctx, &store.DeleteUser{ID: reactor.ID}))

	resp, err := ts.Service.ListMemos(ownerCtx, &apiv1.ListMemosRequest{PageSize: 10})
	require.NoError(t, err)
	require.Len(t, resp.Memos, 1)
	require.Equal(t, memo.Name, resp.Memos[0].Name)
	require.Empty(t, resp.Memos[0].Reactions)
}

func TestHiddenListMemosSkipsMemoWithDeletedCreatorButKeepsVisibleMemo(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "visible-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	deletedCreator, err := ts.CreateRegularUser(ctx, "deleted-creator")
	require.NoError(t, err)
	deletedCtx := ts.CreateUserContext(ctx, deletedCreator.ID)

	visible, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "visible", Visibility: apiv1.Visibility_PRIVATE},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateMemo(deletedCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "orphan", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)

	require.NoError(t, ts.Store.DeleteUser(ctx, &store.DeleteUser{ID: deletedCreator.ID}))

	resp, err := ts.Service.ListMemos(ownerCtx, &apiv1.ListMemosRequest{PageSize: 10})
	require.NoError(t, err)
	require.Len(t, resp.Memos, 1)
	require.Equal(t, visible.Name, resp.Memos[0].Name)
}

func TestHiddenListMemoCommentsSkipsCommentWithDeletedCreator(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "comment-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	commenter, err := ts.CreateRegularUser(ctx, "deleted-commenter")
	require.NoError(t, err)
	commenterCtx := ts.CreateUserContext(ctx, commenter.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "memo with comment", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateMemoComment(commenterCtx, &apiv1.CreateMemoCommentRequest{
		Name:    memo.Name,
		Comment: &apiv1.Memo{Content: "orphan comment", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)

	require.NoError(t, ts.Store.DeleteUser(ctx, &store.DeleteUser{ID: commenter.ID}))

	resp, err := ts.Service.ListMemoComments(ownerCtx, &apiv1.ListMemoCommentsRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Empty(t, resp.Memos)
}
GOEOF

go test ./server/router/api/v1/test -run 'TestHiddenListMemosSkipsReactionWithDeletedCreator|TestHiddenListMemosSkipsMemoWithDeletedCreatorButKeepsVisibleMemo|TestHiddenListMemoCommentsSkipsCommentWithDeletedCreator' -count=1
