import re

with open("backend/tests/test_intent_parser.py", "r") as f:
    content = f.read()

# Fix the UnboundLocalError by removing the local `import time`
content = content.replace(
    "    import time\n    time.sleep(0.05)\n    end_time = time.time()",
    "    time.sleep(0.05)\n    end_time = time.time()"
)

with open("backend/tests/test_intent_parser.py", "w") as f:
    f.write(content)
