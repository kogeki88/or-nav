from app.services.surgical_ontology import strip_spoken_disfluencies

def test_strip_vocal_fillers():
    assert strip_spoken_disfluencies("please find me um uh you know 4-0 vicryl") == "4-0 vicryl"
    assert strip_spoken_disfluencies("uhh let's see no. 10 blade") == "no. 10 blade"
    assert strip_spoken_disfluencies("actually find me 4-0 vicryl") == "find me 4-0 vicryl"
    assert strip_spoken_disfluencies("um, you know, find me 4-0 vicryl") == "find me 4-0 vicryl"
    assert strip_spoken_disfluencies("like where is the um uh 4-0 vicryl") == "where is the 4-0 vicryl"
    assert strip_spoken_disfluencies("is there a like 4-0 vicryl") == "is there a 4-0 vicryl"

def test_preserve_critical_medical_tokens():
    assert strip_spoken_disfluencies("4-0") == "4-0"
    assert strip_spoken_disfluencies("no. 10 blade") == "no. 10 blade"
    assert strip_spoken_disfluencies("please find me 4-0 vicryl") == "4-0 vicryl"
    assert strip_spoken_disfluencies("is there a 4-0 vicryl") == "is there a 4-0 vicryl"
