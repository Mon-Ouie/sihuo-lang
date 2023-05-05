# 死活浪 — sihuo-lang

Timed puzzle solving for Go, heavily inspired by [Puzzle Storm](lichess.org/storm).

Puzzles should be stored in an SGF file `puzzles.sgf`. All moves in the puzzles
are assumed to be valid solutions unless they contain the `BM` SGF tag.

# Run

    npm run build && ruby -run -ehttpd . -p8000

# License

AGPL-3.0, see COPYING.md and LICENSE.txt
