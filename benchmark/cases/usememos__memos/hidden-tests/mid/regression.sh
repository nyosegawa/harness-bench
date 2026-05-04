#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > server/router/api/v1/test/user_resource_name_mixed_case_hidden_regression_test.go <<'GOEOF'
package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestHiddenNumericUsernamesRegressionRemainInvalid(t *testing.T) {
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

go test ./server/router/api/v1/test -run TestHiddenNumericUsernamesRegression -count=1
