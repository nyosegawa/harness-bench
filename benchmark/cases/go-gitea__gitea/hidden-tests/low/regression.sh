#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > services/actions/schedule_payload_hidden_regression_test.go <<'GOEOF'
package actions

import (
	"testing"

	"code.gitea.io/gitea/modules/json"
	"github.com/stretchr/testify/require"
)

func decodeHiddenSchedulePayloadRegression(t *testing.T, payload string) map[string]any {
	t.Helper()
	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(payload), &got))
	return got
}

func TestHiddenSchedulePayloadRegressionPreservesExistingKeys(t *testing.T) {
	got := decodeHiddenSchedulePayloadRegression(t, withScheduleInEventPayload(`{"ref":"refs/heads/main","workflow":"nightly"}`, "0 0 * * *"))
	require.Equal(t, "refs/heads/main", got["ref"])
	require.Equal(t, "nightly", got["workflow"])
	require.Equal(t, "0 0 * * *", got["schedule"])
}
GOEOF

go test -tags sqlite,sqlite_unlock_notify ./services/actions -run TestHiddenSchedulePayloadRegression -count=1
