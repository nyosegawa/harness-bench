#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > server/router/api/v1/test/user_resource_name_mixed_case_hidden_test.go <<'GOEOF'
package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestHiddenMixedCaseUsernameResourceNamesWork(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "Gnammi")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	currentUser, err := ts.Service.GetCurrentUser(userCtx, &apiv1.GetCurrentUserRequest{})
	require.NoError(t, err)
	require.Equal(t, "users/Gnammi", currentUser.GetUser().Name)

	settings, err := ts.Service.ListUserSettings(userCtx, &apiv1.ListUserSettingsRequest{
		Parent: currentUser.GetUser().Name,
	})
	require.NoError(t, err)
	require.NotNil(t, settings)

	users, err := ts.Service.BatchGetUsers(ctx, &apiv1.BatchGetUsersRequest{
		Usernames: []string{"Gnammi"},
	})
	require.NoError(t, err)
	require.Len(t, users.Users, 1)
	require.Equal(t, "users/Gnammi", users.Users[0].Name)
}

func TestHiddenNumericUsernamesRemainInvalid(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	_, err := ts.Service.CreateUser(ctx, &apiv1.CreateUserRequest{
		User: &apiv1.User{
			Username: "12345",
			Email:    "numeric@example.com",
			Password: "password123",
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid username")
}
GOEOF

go test ./server/router/api/v1/test -run 'TestHiddenMixedCaseUsernameResourceNamesWork|TestHiddenNumericUsernamesRemainInvalid' -count=1
