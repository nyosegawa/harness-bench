#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > server/router/api/v1/test/user_setting_internal_hidden_core_test.go <<'GOEOF'
package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	apiv1server "github.com/usememos/memos/server/router/api/v1"
)

func TestHiddenListUserSettingsCoreOmitsInternalSettings(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "settings-user")
	require.NoError(t, err)

	_, err = ts.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: user.ID,
		Key:    storepb.UserSetting_REFRESH_TOKENS,
		Value: &storepb.UserSetting_RefreshTokens{RefreshTokens: &storepb.RefreshTokensUserSetting{}},
	})
	require.NoError(t, err)

	_, err = ts.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: user.ID,
		Key:    storepb.UserSetting_SHORTCUTS,
		Value: &storepb.UserSetting_Shortcuts{Shortcuts: &storepb.ShortcutsUserSetting{}},
	})
	require.NoError(t, err)

	resp, err := ts.Service.ListUserSettings(ts.CreateUserContext(ctx, user.ID), &apiv1.ListUserSettingsRequest{
		Parent: apiv1server.BuildUserName(user.Username),
	})
	require.NoError(t, err)
	require.Empty(t, resp.Settings)
}
GOEOF

go test ./server/router/api/v1/test -run TestHiddenListUserSettingsCore -count=1
