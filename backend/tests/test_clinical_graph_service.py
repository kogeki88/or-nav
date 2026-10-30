import pytest
from app.services.clinical_graph import ClinicalEntityGraph

def test_node_addition():
    """Verify that nodes can be added and attributes are properly saved."""
    graph = ClinicalEntityGraph(tenant_id="or_main", department_name="OR")

    # Add a node without attributes
    graph.add_node("node1")
    assert "node1" in graph.nodes
    assert graph.nodes["node1"] == {}
    assert "node1" in graph.edges
    assert graph.edges["node1"] == []

    # Add a node with attributes
    graph.add_node("node2", {"type": "surgeon", "name": "Dr. Smith"})
    assert "node2" in graph.nodes
    assert graph.nodes["node2"]["type"] == "surgeon"

    # Update an existing node with new attributes
    graph.add_node("node1", {"visited": True})
    assert graph.nodes["node1"]["visited"] is True


def test_edge_connections():
    """Verify that edges can be established and implicit nodes are created if they didn't previously exist."""
    graph = ClinicalEntityGraph(tenant_id="or_main", department_name="OR")

    # Add an edge between non-existent nodes
    graph.add_edge("nodeA", "nodeB")

    assert "nodeA" in graph.nodes
    assert "nodeB" in graph.nodes
    assert "nodeB" in graph.edges["nodeA"]

    # Ensure directed nature (nodeB doesn't point back to nodeA by default)
    assert "nodeA" not in graph.edges["nodeB"]

    # Add edge to existing node
    graph.add_node("nodeC")
    graph.add_edge("nodeB", "nodeC")
    assert "nodeC" in graph.edges["nodeB"]

    # Add duplicate edge - shouldn't duplicate in the list
    graph.add_edge("nodeA", "nodeB")
    assert graph.edges["nodeA"].count("nodeB") == 1


def test_bfs_path_queries():
    """Verify that the shortest path is found for connected components and an empty list is returned for disjoint subgraphs."""
    graph = ClinicalEntityGraph(tenant_id="or_main", department_name="OR")

    # Set up a graph:
    # A -> B -> C -> E
    # A -> D -> E
    graph.add_edge("A", "B")
    graph.add_edge("B", "C")
    graph.add_edge("C", "E")
    graph.add_edge("A", "D")
    graph.add_edge("D", "E")

    # Add disjoint node
    graph.add_node("F")

    # Test path from A to E (should find A -> D -> E as it's shorter/visited first in this queue arrangement)
    path = graph.bfs_path("A", "E")
    assert path == ["A", "D", "E"] or path == ["A", "B", "E"] # B to E doesn't exist, but depends on traversal order if it did. Actually A->D->E is len 3.
    assert path == ["A", "D", "E"]

    # Test path to self
    assert graph.bfs_path("A", "A") == ["A"]

    # Test path to unreachable node
    assert graph.bfs_path("A", "F") == []

    # Test path from unreachable node
    assert graph.bfs_path("F", "A") == []

    # Test non-existent nodes
    assert graph.bfs_path("X", "Y") == []


def test_multi_tenant_isolation():
    """Instantiate ClinicalEntityGraph for different tenants and ensure nodes/edges added to one do not bleed into the other."""
    graph1 = ClinicalEntityGraph(tenant_id="or_main", department_name="OR")
    graph2 = ClinicalEntityGraph(tenant_id="sacred_heart::icu", department_name="ICU")

    graph1.add_node("G1_Node")
    graph1.add_edge("G1_Node", "G1_Target")

    graph2.add_node("G2_Node")

    assert "G1_Node" in graph1.nodes
    assert "G1_Node" not in graph2.nodes

    assert "G2_Node" in graph2.nodes
    assert "G2_Node" not in graph1.nodes
