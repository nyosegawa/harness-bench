#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > pkg/commands/git_commands/commit_whitespace_hidden_test.go <<'GOEOF'
package git_commands

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHiddenAddCoAuthorToDescriptionTrimsOnlyTrailingNewlines(t *testing.T) {
	result := AddCoAuthorToDescription("Body line\n\n", "Jane Doe <jane@example.com>")
	assert.Equal(t, "Body line\n\nCo-authored-by: Jane Doe <jane@example.com>", result)
}

func TestHiddenAddCoAuthorToDescriptionPreservesIndentedBody(t *testing.T) {
	result := AddCoAuthorToDescription("Body line\n\n    indented detail", "Jane Doe <jane@example.com>")
	assert.Equal(t, "Body line\n\n    indented detail\n\nCo-authored-by: Jane Doe <jane@example.com>", result)
}
GOEOF

cat > pkg/gui/controllers/helpers/commit_message_whitespace_hidden_test.go <<'GOEOF'
package helpers

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHiddenSplitCommitMessageAndDescriptionPreservesBodyWhitespace(t *testing.T) {
	message := "Summary\n\nBody line\n\n    indented detail\n"
	summary, description := (&CommitsHelper{}).SplitCommitMessageAndDescription(message)

	assert.Equal(t, "Summary", summary)
	assert.Equal(t, "Body line\n\n    indented detail\n", description)
}
GOEOF

go test ./pkg/commands/git_commands -run 'TestHiddenAddCoAuthorToDescription' -count=1
go test ./pkg/gui/controllers/helpers -run 'TestHiddenSplitCommitMessageAndDescription' -count=1
