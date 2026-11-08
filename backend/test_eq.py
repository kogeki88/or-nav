import asyncio
from app.intent_parser import parse_clinical_intent

input_str = "hospital_a::dept_1 move the 3-0 prolene to shelf B"
res1 = parse_clinical_intent(input_str)
res2 = parse_clinical_intent(input_str)
print(res1 == res2)
