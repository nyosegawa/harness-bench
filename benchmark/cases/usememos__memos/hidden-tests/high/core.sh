#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > server/router/api/v1/test/missing_related_users_hidden_core_test.go <<'GOEOF'
package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func TestHiddenListMemosCoreSkipsReactionWithDeletedCreator(t *testing.T) {
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
GOEOF

go test ./server/router/api/v1/test -run TestHiddenListMemosCore -count=1
