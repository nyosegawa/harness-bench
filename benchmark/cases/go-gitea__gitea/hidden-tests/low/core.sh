#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > services/actions/schedule_payload_hidden_core_test.go <<'GOEOF'
package actions

import (
	"testing"

	"code.gitea.io/gitea/modules/json"
	"github.com/stretchr/testify/require"
)

func decodeHiddenSchedulePayloadCore(t *testing.T, payload string) map[string]any {
	t.Helper()
	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(payload), &got))
	return got
}

func TestHiddenSchedulePayloadCoreHandlesNullAndEmptyObjects(t *testing.T) {
	got := decodeHiddenSchedulePayloadCore(t, withScheduleInEventPayload("null", "15 3 * * *"))
	require.Equal(t, "15 3 * * *", got["schedule"])

	got = decodeHiddenSchedulePayloadCore(t, withScheduleInEventPayload("{}", "@weekly"))
	require.Equal(t, "@weekly", got["schedule"])
}
GOEOF

go test -tags sqlite,sqlite_unlock_notify ./services/actions -run TestHiddenSchedulePayloadCore -count=1
