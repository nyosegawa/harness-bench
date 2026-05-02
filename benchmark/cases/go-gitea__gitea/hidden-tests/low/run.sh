#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > services/actions/schedule_payload_hidden_test.go <<'GOEOF'
package actions

import (
	"testing"

	"code.gitea.io/gitea/modules/json"
	"github.com/stretchr/testify/require"
)

func decodeHiddenSchedulePayload(t *testing.T, payload string) map[string]any {
	t.Helper()
	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(payload), &got))
	return got
}

func TestHiddenSchedulePayloadHandlesNullAndEmptyObjects(t *testing.T) {
	got := decodeHiddenSchedulePayload(t, withScheduleInEventPayload("null", "15 3 * * *"))
	require.Equal(t, "15 3 * * *", got["schedule"])

	got = decodeHiddenSchedulePayload(t, withScheduleInEventPayload("{}", "@weekly"))
	require.Equal(t, "@weekly", got["schedule"])
}

func TestHiddenSchedulePayloadPreservesExistingKeys(t *testing.T) {
	got := decodeHiddenSchedulePayload(t, withScheduleInEventPayload(`{"ref":"refs/heads/main","workflow":"nightly"}`, "0 0 * * *"))
	require.Equal(t, "refs/heads/main", got["ref"])
	require.Equal(t, "nightly", got["workflow"])
	require.Equal(t, "0 0 * * *", got["schedule"])
}
GOEOF

go test -tags sqlite,sqlite_unlock_notify ./services/actions -run TestHiddenSchedulePayload -count=1
