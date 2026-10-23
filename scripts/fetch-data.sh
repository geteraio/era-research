#!/usr/bin/env bash
# Downloads the two public datasets the harness evaluates on into data/.
#   LoCoMo-10            https://github.com/snap-research/locomo        (CC BY-NC 4.0)
#   LongMemEval-S clean  https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned  (MIT)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
fetch() { [ -s "data/$1" ] && { echo "data/$1 present"; return; }; echo "downloading $1"; curl -fL --retry 3 -o "data/$1" "$2"; }
fetch locomo10.json https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json
fetch longmemeval_s_cleaned.json https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
ls -l data
