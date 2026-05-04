#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > pkg/commands/git_commands/commit_whitespace_hidden_core_test.go <<'GOEOF'
package git_commands

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHiddenAddCoAuthorToDescriptionCoreTrimsOnlyTrailingNewlines(t *testing.T) {
	result := AddCoAuthorToDescription("Body line\n\n", "Jane Doe <jane@example.com>")
	assert.Equal(t, "Body line\n\nCo-authored-by: Jane Doe <jane@example.com>", result)
}
GOEOF

go test ./pkg/commands/git_commands -run TestHiddenAddCoAuthorToDescriptionCore -count=1
