from app.services.inventory_search import split_compound_query


def test_split_compound_query_conjunction():
    # Stopwords are stripped out in split_compound_query during preprocessing
    assert split_compound_query("where is 2-0 and 3-0 prolene") == ["2-0 prolene", "3-0 prolene"]


def test_split_compound_query_comma():
    # the function strips where is, but doesn't strip 'and also'
    assert split_compound_query("Give me 3-0 silk, and also where is the bovie") == \
        ["Give me 3-0 silk", "and also where is the bovie"]


def test_split_compound_query_gauge():
    assert split_compound_query("10 gauge and 12 gauge needles") == ["10 gauge needles", "12 gauge needles"]
    assert split_compound_query("10 gauge, 12 gauge needles") == ["10 gauge needles", "12 gauge needles"]
