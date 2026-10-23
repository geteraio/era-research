# Third-party notices

## Mem0 (Apache License 2.0)

`harness/mem0ref/prompts.py` and `harness/mem0ref/llm_judge.py` are copied unmodified from
[mem0ai/mem0](https://github.com/mem0ai/mem0) at commit `aae5989e78a6188b3b047c104d960c9ad0927e75`
(`evaluation/prompts.py`, `evaluation/metrics/llm_judge.py`). The harness uses the `ANSWER_PROMPT_ZEP`
answer prompt and the `ACCURACY_PROMPT` judge prompt verbatim, so results are comparable with the
Mem0 paper's protocol.

Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0.
Unless required by applicable law or agreed to in writing, software distributed under the License is
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.

## LongMemEval (MIT License)

`harness/mem0ref/lme_run_generation.py` and `harness/mem0ref/lme_evaluate_qa.py` are copied unmodified
from [xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval) (`run_generation.py`,
`evaluate_qa.py`), MIT License. The LongMemEval-S cleaned dataset
([xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)) is MIT.

## LoCoMo (CC BY-NC 4.0)

The LoCoMo-10 dataset ([snap-research/locomo](https://github.com/snap-research/locomo); Maharana et al.,
"Evaluating Very Long-Term Conversational Memory of LLM Agents", ACL 2024) is licensed under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). It is not redistributed here
(`scripts/fetch-data.sh` downloads it). The result rows in `results/` and the cached LLM calls in
`llm-cache/` quote parts of it; those quotations remain under CC BY-NC 4.0 and are shared for
non-commercial research use with attribution.
