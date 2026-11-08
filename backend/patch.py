import re

with open("tests/test_intent_parser.py", "r") as f:
    content = f.read()

# Let's inspect test_intent_parser_offline_mutation_replay_idempotency_extended
match = re.search(r"def test_intent_parser_offline_mutation_replay_idempotency_extended.*?(?=def test_)", content, re.DOTALL)
if match:
    print(match.group(0))
