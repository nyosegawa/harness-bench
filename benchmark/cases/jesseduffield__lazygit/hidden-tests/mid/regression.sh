#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > pkg/commands/git_commands/commit_whitespace_hidden_regression_test.go <<'GOEOF'
package git_commands

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHiddenAddCoAuthorToDescriptionRegressionPreservesIndentedBody(t *testing.T) {
	result := AddCoAuthorToDescription("Body line\n\n    indented detail", "Jane Doe <jane@example.com>")
	assert.Equal(t, "Body line\n\n    indented detail\n\nCo-authored-by: Jane Doe <jane@example.com>", result)
}
GOEOF

cat > pkg/gui/controllers/helpers/commit_message_whitespace_hidden_regression_test.go <<'GOEOF'
package helpers

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHiddenSplitCommitMessageAndDescriptionRegressionPreservesBodyWhitespace(t *testing.T) {
	message := "Summary\n\nBody line\n\n    indented detail\n"
	summary, description := (&CommitsHelper{}).SplitCommitMessageAndDescription(message)

	assert.Equal(t, "Summary", summary)
	assert.Equal(t, "Body line\n\n    indented detail\n", description)
}
GOEOF

go test ./pkg/commands/git_commands -run TestHiddenAddCoAuthorToDescriptionRegression -count=1
go test ./pkg/gui/controllers/helpers -run TestHiddenSplitCommitMessageAndDescriptionRegression -count=1
