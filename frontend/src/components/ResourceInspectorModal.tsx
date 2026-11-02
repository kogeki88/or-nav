"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  X,
  Search,
  Plus,
  Trash2,
  Edit2,
  Save,
  RotateCcw,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  Package,
  Layers,
  FileText,
  Zap,
  Tag,
  Stethoscope,
  Building2,
  ExternalLink,
  ChevronRight,
  Filter,
  Check,
} from "lucide-react";
import {
  offlineDb,
  getOfflineInventory,
  updateOfflineInventoryItem,
  deleteOfflineInventoryItem,
  createOfflineInventoryItem,
  getOfflinePreferenceCards,
  saveOfflinePreferenceCard,
  deleteOfflinePreferenceCard,
  getOfflineLexiconAliases,
  saveOfflineLexiconAlias,
  deleteOfflineLexiconAlias,
  getOfflineDepartmentGuideline,
  saveOfflineDepartmentGuideline,
  exportTenantResourcesJson,
  importTenantResourcesJson,
  hydrateOrUpgradeOfflineInventory,
  type OfflineInventoryRecord,
  type OfflinePreferenceCard,
  type OfflineLexiconEntry,
  type InstalledResourcePack,
} from "@/lib/offlineDb";
import { getUserProfile, type UserProfile } from "@/lib/userProfile";
import { formatBytes } from "@/lib/resourceManager";
import { useModalA11y } from "@/hooks/useModalA11y";

export interface ResourceInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfile?: UserProfile;
  tenantId?: string;
  onDataChanged?: () => void;
}

type TabType = "inventory" | "preference_cards" | "slang_lexicon" | "protocols_management";

export default function ResourceInspectorModal({
  isOpen,
  onClose,
  activeProfile,
  tenantId,
  onDataChanged,
}: ResourceInspectorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, onClose, modalRef);

  const profile = activeProfile || getUserProfile();
  const activeTenant =
    tenantId ||
    (profile?.facilityId && profile?.departmentId
      ? `${profile.facilityId}::${profile.departmentId}`
      : "sacred_heart::or");

  const [activeTab, setActiveTab] = useState<TabType>("inventory");
  const [loading, setLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Tab 1: Inventory state
  const [inventory, setInventory] = useState<OfflineInventoryRecord[]>([]);
  const [inventorySearch, setInventorySearch] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedRoom, setSelectedRoom] = useState<string>("All");
  const [editingItem, setEditingItem] = useState<OfflineInventoryRecord | null>(null);
  const [isAddingItem, setIsAddingItem] = useState<boolean>(false);
  const [newItemData, setNewItemData] = useState<Partial<OfflineInventoryRecord>>({
    item: "",
    category: "General Supplies",
    room: "Main OR",
    cabinet: "A",
    shelf: "1",
    container: "A",
    surgeon_notes: "",
    aliases: "",
  });

  // Tab 2: Preference Cards state
  const [cards, setCards] = useState<OfflinePreferenceCard[]>([]);
  const [cardsSearch, setCardsSearch] = useState<string>("");
  const [selectedSurgeonFilter, setSelectedSurgeonFilter] = useState<string>("All");
  const [selectedCard, setSelectedCard] = useState<OfflinePreferenceCard | null>(null);
  const [isEditingCard, setIsEditingCard] = useState<boolean>(false);
  const [isAddingCard, setIsAddingCard] = useState<boolean>(false);
  const [newInstrumentInput, setNewInstrumentInput] = useState<string>("");
  const [newSutureInput, setNewSutureInput] = useState<string>("");
  const [newPearlInput, setNewPearlInput] = useState<string>("");

  // Tab 3: Slang & Aliases state
  const [aliases, setAliases] = useState<OfflineLexiconEntry[]>([]);
  const [aliasSearch, setAliasSearch] = useState<string>("");
  const [isAddingAlias, setIsAddingAlias] = useState<boolean>(false);
  const [newAliasData, setNewAliasData] = useState<Partial<OfflineLexiconEntry>>({
    spokenTerm: "",
    canonicalItem: "",
    category: "General",
  });

  // Tab 4: Protocols & Management state
  const [installedPacks, setInstalledPacks] = useState<InstalledResourcePack[]>([]);
  const [guidelineContent, setGuidelineContent] = useState<string>("");
  const [isGuidelineDirty, setIsGuidelineDirty] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus = (text: string, type: "success" | "error" | "info" = "success") => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, prCards, lex, guide] = await Promise.all([
        getOfflineInventory(activeTenant),
        getOfflinePreferenceCards(activeTenant),
        getOfflineLexiconAliases(activeTenant),
        Promise.resolve(getOfflineDepartmentGuideline(activeTenant)),
      ]);

      let packs: InstalledResourcePack[] = [];
      if (offlineDb) {
        try {
          packs = await offlineDb.installedPacks.toArray();
        } catch {}
      }

      setInventory(inv);
      setCards(prCards);
      setAliases(lex);
      setInstalledPacks(packs);
      setGuidelineContent(guide);
      setIsGuidelineDirty(false);

      if (prCards.length > 0 && !selectedCard) {
        setSelectedCard(prCards[0]);
      }
    } catch (err) {
      console.warn("Error loading resource inspector data:", err);
      showStatus("Error loading data from offline cache.", "error");
    } finally {
      setLoading(false);
    }
  }, [activeTenant, selectedCard]);

  useEffect(() => {
    if (isOpen) {
      loadAllData();
    }
  }, [isOpen, loadAllData]);

  // Distinct Categories & Rooms for Filter Pills
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    for (const item of inventory) {
      if (item.category && item.category.trim()) set.add(item.category.trim());
    }
    return ["All", ...Array.from(set).sort()];
  }, [inventory]);

  const roomsList = useMemo(() => {
    const set = new Set<string>();
    for (const item of inventory) {
      if (item.room && item.room.trim()) set.add(item.room.trim());
    }
    return ["All", ...Array.from(set).sort()];
  }, [inventory]);

  // Filtered Inventory
  const filteredInventory = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    return inventory.filter((item) => {
      if (selectedCategory !== "All" && item.category !== selectedCategory) return false;
      if (selectedRoom !== "All" && item.room !== selectedRoom) return false;
      if (!q) return true;
      return (
        item.item.toLowerCase().includes(q) ||
        (item.full_code && item.full_code.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        (item.surgeon_notes && item.surgeon_notes.toLowerCase().includes(q)) ||
        (item.aliases && item.aliases.toLowerCase().includes(q))
      );
    });
  }, [inventory, inventorySearch, selectedCategory, selectedRoom]);

  // Distinct Surgeons for Filter Pills
  const surgeonsList = useMemo(() => {
    const set = new Set<string>();
    for (const card of cards) {
      if (card.surgeon && card.surgeon.trim()) set.add(card.surgeon.trim());
    }
    return ["All", ...Array.from(set).sort()];
  }, [cards]);

  // Filtered Preference Cards
  const filteredCards = useMemo(() => {
    const q = cardsSearch.trim().toLowerCase();
    return cards.filter((card) => {
      if (selectedSurgeonFilter !== "All" && card.surgeon !== selectedSurgeonFilter) return false;
      if (!q) return true;
      return (
        card.surgeon.toLowerCase().includes(q) ||
        card.procedure.toLowerCase().includes(q) ||
        (card.specialty && card.specialty.toLowerCase().includes(q)) ||
        (card.instruments && card.instruments.some((i) => i.toLowerCase().includes(q))) ||
        (card.sutures && card.sutures.some((s) => s.toLowerCase().includes(q)))
      );
    });
  }, [cards, cardsSearch, selectedSurgeonFilter]);

  // Filtered Aliases
  const filteredAliases = useMemo(() => {
    const q = aliasSearch.trim().toLowerCase();
    if (!q) return aliases;
    return aliases.filter(
      (a) =>
        a.spokenTerm.toLowerCase().includes(q) ||
        a.canonicalItem.toLowerCase().includes(q) ||
        (a.category && a.category.toLowerCase().includes(q))
    );
  }, [aliases, aliasSearch]);

  // Helper to check if a suture in preference card exists in active hospital inventory
  const getSutureInventoryMatch = useCallback(
    (sutureName: string): OfflineInventoryRecord | null => {
      const norm = sutureName.toLowerCase().trim();
      return (
        inventory.find((inv) => {
          const invLower = inv.item.toLowerCase();
          return invLower.includes(norm) || norm.includes(invLower);
        }) || null
      );
    },
    [inventory]
  );

  // ---------------------------------------------------------------------------
  // Action Handlers: Inventory CRUD
  // ---------------------------------------------------------------------------

  const handleSaveEditItem = async () => {
    if (!editingItem) return;
    try {
      const updated = await updateOfflineInventoryItem(activeTenant, editingItem.id || editingItem.item, {
        item: editingItem.item,
        category: editingItem.category,
        room: editingItem.room,
        cabinet: editingItem.cabinet,
        shelf: editingItem.shelf,
        container: editingItem.container,
        surgeon_notes: editingItem.surgeon_notes,
        aliases: editingItem.aliases,
      });
      if (updated) {
        showStatus(`Updated "${updated.item}" at ${updated.full_code}`);
        setEditingItem(null);
        await loadAllData();
        onDataChanged?.();
      } else {
        showStatus("Failed to update item.", "error");
      }
    } catch {
      showStatus("Error saving inventory item.", "error");
    }
  };

  const handleDeleteItem = async (item: OfflineInventoryRecord) => {
    if (!confirm(`Are you sure you want to remove "${item.item}" from offline storage?`)) return;
    try {
      const ok = await deleteOfflineInventoryItem(activeTenant, item.id || item.item);
      if (ok) {
        showStatus(`Deleted "${item.item}" from local database.`);
        await loadAllData();
        onDataChanged?.();
      } else {
        showStatus("Could not delete item.", "error");
      }
    } catch {
      showStatus("Error deleting item.", "error");
    }
  };

  const handleCreateItem = async () => {
    if (!newItemData.item || !newItemData.item.trim()) {
      showStatus("Item name is required.", "error");
      return;
    }
    try {
      const created = await createOfflineInventoryItem(activeTenant, {
        item: newItemData.item.trim(),
        category: newItemData.category || "General Supplies",
        room: newItemData.room || "Main OR",
        cabinet: newItemData.cabinet || "A",
        shelf: newItemData.shelf || "1",
        container: newItemData.container || "A",
        surgeon_notes: newItemData.surgeon_notes || "",
        aliases: newItemData.aliases || "",
      });
      showStatus(`Created item "${created.item}" at ${created.full_code}`);
      setIsAddingItem(false);
      setNewItemData({
        item: "",
        category: "General Supplies",
        room: "Main OR",
        cabinet: "A",
        shelf: "1",
        container: "A",
        surgeon_notes: "",
        aliases: "",
      });
      await loadAllData();
      onDataChanged?.();
    } catch {
      showStatus("Error creating inventory item.", "error");
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers: Preference Cards CRUD
  // ---------------------------------------------------------------------------

  const handleSaveCard = async (cardToSave: OfflinePreferenceCard) => {
    if (!cardToSave.surgeon || !cardToSave.procedure) {
      showStatus("Surgeon and procedure are required.", "error");
      return;
    }
    try {
      const saved = await saveOfflinePreferenceCard(activeTenant, cardToSave);
      showStatus(`Saved preference card for ${saved.surgeon}`);
      setIsEditingCard(false);
      setIsAddingCard(false);
      setSelectedCard(saved);
      await loadAllData();
      onDataChanged?.();
    } catch {
      showStatus("Failed to save preference card.", "error");
    }
  };

  const handleDeleteCard = async (cardToDelete: OfflinePreferenceCard) => {
    if (!confirm(`Delete preference card for ${cardToDelete.surgeon} (${cardToDelete.procedure})?`)) return;
    try {
      const ok = await deleteOfflinePreferenceCard(activeTenant, cardToDelete.id);
      if (ok) {
        showStatus(`Deleted preference card for ${cardToDelete.surgeon}.`);
        setSelectedCard(null);
        await loadAllData();
        onDataChanged?.();
      } else {
        showStatus("Could not delete preference card.", "error");
      }
    } catch {
      showStatus("Error deleting preference card.", "error");
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers: Slang & Aliases CRUD
  // ---------------------------------------------------------------------------

  const handleCreateAlias = async () => {
    if (!newAliasData.spokenTerm || !newAliasData.canonicalItem) {
      showStatus("Both spoken term and canonical item are required.", "error");
      return;
    }
    try {
      const created = await saveOfflineLexiconAlias(activeTenant, {
        spokenTerm: newAliasData.spokenTerm.trim(),
        canonicalItem: newAliasData.canonicalItem.trim(),
        category: newAliasData.category || "General",
      });
      showStatus(`Added alias: "${created.spokenTerm}" → "${created.canonicalItem}"`);
      setIsAddingAlias(false);
      setNewAliasData({ spokenTerm: "", canonicalItem: "", category: "General" });
      await loadAllData();
      onDataChanged?.();
    } catch {
      showStatus("Error adding slang alias.", "error");
    }
  };

  const handleDeleteAlias = async (alias: OfflineLexiconEntry) => {
    if (!confirm(`Delete alias "${alias.spokenTerm}" → "${alias.canonicalItem}"?`)) return;
    try {
      const ok = await deleteOfflineLexiconAlias(activeTenant, alias.id);
      if (ok) {
        showStatus(`Deleted alias "${alias.spokenTerm}".`);
        await loadAllData();
        onDataChanged?.();
      }
    } catch {
      showStatus("Error deleting alias.", "error");
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers: Protocols & Backup
  // ---------------------------------------------------------------------------

  const handleSaveGuideline = () => {
    saveOfflineDepartmentGuideline(activeTenant, guidelineContent);
    setIsGuidelineDirty(false);
    showStatus("Saved department guidelines to offline storage.");
    onDataChanged?.();
  };

  const handleResyncSeed = async () => {
    if (!confirm("Re-sync with Master Catalog? This restores bundled seed items while preserving your custom edits.")) return;
    try {
      setLoading(true);
      const count = await hydrateOrUpgradeOfflineInventory(activeTenant, true);
      showStatus(`Re-synced catalog: ${count} active records.`);
      await loadAllData();
      onDataChanged?.();
    } catch {
      showStatus("Failed to re-sync with master catalog.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const json = await exportTenantResourcesJson(activeTenant);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tenant_resources_backup_${activeTenant.replace(/::/g, "_")}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus("Exported JSON backup successfully.");
    } catch {
      showStatus("Failed to export backup.", "error");
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target?.result as string;
      if (!content) return;
      try {
        setLoading(true);
        const res = await importTenantResourcesJson(activeTenant, content);
        if (res.success) {
          showStatus(
            `Imported ${res.importedItems} items, ${res.importedCards} cards, ${res.importedAliases} aliases!`
          );
          await loadAllData();
          onDataChanged?.();
        } else {
          showStatus(res.message || "Import failed.", "error");
        }
      } catch (err: any) {
        showStatus(err?.message || "Import error.", "error");
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-inspector-title"
    >
      <div
        ref={modalRef}
        data-testid="resource-inspector-modal"
        className="w-full max-w-5xl h-[92vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="resource-inspector-title"
                className="text-base font-semibold text-zinc-100 flex items-center gap-2"
              >
                Installed Resources Explorer & Studio
                <span className="text-xs font-mono py-0.5 px-2 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  Tier-0 Offline
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Tenant: <span className="text-cyan-300 font-mono">{activeTenant}</span> • IndexedDB (Dexie) • Edit-Protected
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              data-testid="btn-close-resource-inspector"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
              aria-label="Close Resource Inspector"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Toast Message */}
        {statusMessage && (
          <div
            data-testid="resource-inspector-status-toast"
            className={`px-4 py-2 text-xs flex items-center gap-2 font-medium border-b transition-all ${
              statusMessage.type === "success"
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/60"
                : statusMessage.type === "error"
                ? "bg-rose-950/80 text-rose-300 border-rose-800/60"
                : "bg-blue-950/80 text-blue-300 border-blue-800/60"
            }`}
          >
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : statusMessage.type === "error" ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-4 py-2 bg-zinc-900/30 border-b border-zinc-800/60 overflow-x-auto text-xs">
          <button
            onClick={() => setActiveTab("inventory")}
            data-testid="tab-inventory"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === "inventory"
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Inventory Catalog</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
              {inventory.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("preference_cards")}
            data-testid="tab-preference-cards"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === "preference_cards"
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Preference Cards</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
              {cards.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("slang_lexicon")}
            data-testid="tab-slang-lexicon"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === "slang_lexicon"
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Slang & Aliases</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
              {aliases.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("protocols_management")}
            data-testid="tab-protocols-management"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === "protocols_management"
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Protocols & Packs</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
              {installedPacks.length} packs
            </span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-3 py-16">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Loading local IndexedDB studio records...</p>
            </div>
          ) : activeTab === "inventory" ? (
            /* ===============================================================
             * TAB 1: INVENTORY CATALOG & INLINE EDITOR
             * =============================================================== */
            <div className="space-y-4" data-testid="tab-inventory-content">
              {/* Controls bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    placeholder="Search by name, room, cabinet, category, code..."
                    data-testid="input-inventory-search"
                    className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                  {inventorySearch && (
                    <button
                      onClick={() => setInventorySearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsAddingItem(true)}
                    data-testid="btn-add-inventory-item"
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ Add Item</span>
                  </button>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                  <span className="text-[11px] font-medium text-zinc-500 flex items-center gap-1 mr-1">
                    <Filter className="w-3 h-3" /> Category:
                  </span>
                  {categoriesList.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      data-testid={`filter-category-${cat.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                        selectedCategory === cat
                          ? "bg-cyan-500 text-black font-semibold"
                          : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {roomsList.length > 2 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                    <span className="text-[11px] font-medium text-zinc-500 flex items-center gap-1 mr-1">
                      <Building2 className="w-3 h-3" /> Room:
                    </span>
                    {roomsList.map((rm) => (
                      <button
                        key={rm}
                        onClick={() => setSelectedRoom(rm)}
                        data-testid={`filter-room-${rm.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                          selectedRoom === rm
                            ? "bg-zinc-200 text-black font-semibold"
                            : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {rm}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Item Modal / Inline Form */}
              {isAddingItem && (
                <div
                  data-testid="panel-add-inventory-item"
                  className="p-4 bg-zinc-900/90 border border-emerald-500/40 rounded-xl space-y-3"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                      <Plus className="w-4 h-4" /> Add New Inventory Item
                    </span>
                    <button
                      onClick={() => setIsAddingItem(false)}
                      className="text-zinc-400 hover:text-zinc-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="text-zinc-400 block mb-1">Item Name *</label>
                      <input
                        type="text"
                        value={newItemData.item || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, item: e.target.value })}
                        placeholder="e.g. 3-0 Prolene Suture"
                        data-testid="input-new-item-name"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Category</label>
                      <input
                        type="text"
                        value={newItemData.category || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, category: e.target.value })}
                        placeholder="e.g. Suture, Vascular, Supplies"
                        data-testid="input-new-item-category"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Room / Location</label>
                      <input
                        type="text"
                        value={newItemData.room || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, room: e.target.value })}
                        placeholder="e.g. Main OR or Core Supply"
                        data-testid="input-new-item-room"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Cabinet / Cart</label>
                      <input
                        type="text"
                        value={newItemData.cabinet || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, cabinet: e.target.value })}
                        placeholder="e.g. A, B, C"
                        data-testid="input-new-item-cabinet"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Shelf</label>
                      <input
                        type="text"
                        value={newItemData.shelf || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, shelf: e.target.value })}
                        placeholder="e.g. 1, 2, 3"
                        data-testid="input-new-item-shelf"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Bin / Container</label>
                      <input
                        type="text"
                        value={newItemData.container || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, container: e.target.value })}
                        placeholder="e.g. A, B, C"
                        data-testid="input-new-item-container"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-zinc-400 block mb-1">Aliases (separated by |)</label>
                      <input
                        type="text"
                        value={newItemData.aliases || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, aliases: e.target.value })}
                        placeholder="e.g. prolene suture|cardiac suture"
                        data-testid="input-new-item-aliases"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Surgeon / Clinical Notes</label>
                      <input
                        type="text"
                        value={newItemData.surgeon_notes || ""}
                        onChange={(e) => setNewItemData({ ...newItemData, surgeon_notes: e.target.value })}
                        placeholder="e.g. Dr. Patel prefers 2 packs on field"
                        data-testid="input-new-item-notes"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setIsAddingItem(false)}
                      className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateItem}
                      data-testid="btn-save-new-item"
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow"
                    >
                      Save Item
                    </button>
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/60 bg-zinc-900/40">
                <div className="px-4 py-2 bg-zinc-900/80 text-[11px] font-semibold text-zinc-400 flex items-center justify-between">
                  <span>
                    Showing {filteredInventory.length} of {inventory.length} items
                  </span>
                  <span className="text-zinc-500">
                    {inventory.filter((i) => i.isCustomEdited || i.status === "user_added").length} Custom Edited
                  </span>
                </div>

                {filteredInventory.length === 0 ? (
                  <div className="p-8 text-center text-xs text-zinc-500">
                    No items match the current search filters.
                  </div>
                ) : (
                  filteredInventory.map((item) => {
                    const isEditing = editingItem && (editingItem.id === item.id || editingItem.item === item.item);
                    return (
                      <div
                        key={item.id || item.item}
                        data-testid={`inventory-row-${item.item.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                        className="p-3 hover:bg-zinc-800/30 transition-colors"
                      >
                        {isEditing ? (
                          /* Inline Edit Mode */
                          <div className="space-y-3 bg-zinc-950/70 p-3 rounded-lg border border-cyan-500/40 text-xs">
                            <div className="flex items-center justify-between pb-1">
                              <span className="font-semibold text-cyan-400">Editing: {item.item}</span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setEditingItem(null)}
                                  className="px-2.5 py-1 text-zinc-400 hover:text-zinc-200"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={handleSaveEditItem}
                                  data-testid="btn-save-edit-item"
                                  className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg flex items-center gap-1"
                                >
                                  <Save className="w-3.5 h-3.5" /> Save Changes
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                              <div>
                                <label className="text-[10px] text-zinc-400">Item Name</label>
                                <input
                                  type="text"
                                  value={editingItem.item}
                                  onChange={(e) => setEditingItem({ ...editingItem, item: e.target.value })}
                                  className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-zinc-400">Category</label>
                                <input
                                  type="text"
                                  value={editingItem.category || ""}
                                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                                  className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-zinc-400">Room</label>
                                <input
                                  type="text"
                                  value={editingItem.room}
                                  onChange={(e) => setEditingItem({ ...editingItem, room: e.target.value })}
                                  className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                                />
                              </div>
                              <div className="grid grid-cols-3 gap-1">
                                <div>
                                  <label className="text-[10px] text-zinc-400">Cart</label>
                                  <input
                                    type="text"
                                    value={editingItem.cabinet}
                                    onChange={(e) => setEditingItem({ ...editingItem, cabinet: e.target.value })}
                                    className="w-full px-1.5 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs uppercase"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-zinc-400">Shelf</label>
                                  <input
                                    type="text"
                                    value={editingItem.shelf}
                                    onChange={(e) => setEditingItem({ ...editingItem, shelf: e.target.value })}
                                    className="w-full px-1.5 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-zinc-400">Bin</label>
                                  <input
                                    type="text"
                                    value={editingItem.container}
                                    onChange={(e) => setEditingItem({ ...editingItem, container: e.target.value })}
                                    className="w-full px-1.5 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs uppercase"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-zinc-400">Aliases (| separated)</label>
                                <input
                                  type="text"
                                  value={editingItem.aliases || ""}
                                  onChange={(e) => setEditingItem({ ...editingItem, aliases: e.target.value })}
                                  className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-zinc-400">Surgeon Notes</label>
                                <input
                                  type="text"
                                  value={editingItem.surgeon_notes || ""}
                                  onChange={(e) => setEditingItem({ ...editingItem, surgeon_notes: e.target.value })}
                                  className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* View Mode */
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-zinc-100 text-xs">{item.item}</span>
                                {item.category && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/60">
                                    {item.category}
                                  </span>
                                )}
                                {(item.isCustomEdited || item.status === "user_added") && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                    CUSTOM EDIT
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[11px] text-zinc-400 flex-wrap">
                                <span className="text-emerald-400 font-mono font-medium">
                                  {item.full_code || `${item.room} ${item.cabinet} ${item.shelf} ${item.container}`}
                                </span>
                                {item.aliases && (
                                  <span className="text-zinc-500">
                                    Aliases: <span className="text-zinc-400">{item.aliases}</span>
                                  </span>
                                )}
                              </div>

                              {item.surgeon_notes && (
                                <p className="text-[11px] text-zinc-400 italic">
                                  Note: &quot;{item.surgeon_notes}&quot;
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                              <button
                                onClick={() => setEditingItem({ ...item })}
                                data-testid={`btn-edit-item-${item.item.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                                title="Edit Item"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item)}
                                data-testid={`btn-delete-item-${item.item.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                                title="Delete Item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : activeTab === "preference_cards" ? (
            /* ===============================================================
             * TAB 2: PREFERENCE CARDS STUDIO
             * =============================================================== */
            <div className="space-y-4" data-testid="tab-preference-cards-content">
              {/* Controls bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={cardsSearch}
                    onChange={(e) => setCardsSearch(e.target.value)}
                    placeholder="Search by surgeon, procedure, instrument, suture..."
                    data-testid="input-cards-search"
                    className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>

                <button
                  onClick={() => {
                    const newCard: OfflinePreferenceCard = {
                      id: `${activeTenant}::card_${Date.now()}`,
                      tenant_id: activeTenant,
                      surgeon: "Dr. ",
                      procedure: "New Procedure",
                      specialty: "General Surgery",
                      gloves: "Size 7.5 Biogel",
                      positioning: "Supine",
                      prep: "ChloraPrep x2",
                      instruments: [],
                      sutures: [],
                      pearls: [],
                      notes: "",
                    };
                    setSelectedCard(newCard);
                    setIsEditingCard(true);
                    setIsAddingCard(true);
                  }}
                  data-testid="btn-add-preference-card"
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ New Preference Card</span>
                </button>
              </div>

              {/* Surgeon Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                <span className="text-[11px] font-medium text-zinc-500 flex items-center gap-1 mr-1">
                  <Stethoscope className="w-3 h-3" /> Surgeon:
                </span>
                {surgeonsList.map((surg) => (
                  <button
                    key={surg}
                    onClick={() => setSelectedSurgeonFilter(surg)}
                    data-testid={`filter-surgeon-${surg.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                      selectedSurgeonFilter === surg
                        ? "bg-cyan-500 text-black font-semibold"
                        : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {surg}
                  </button>
                ))}
              </div>

              {/* Master-Detail Split Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Left: Cards List */}
                <div className="md:col-span-4 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40 divide-y divide-zinc-800/60 max-h-[550px] overflow-y-auto">
                  <div className="px-3 py-2 bg-zinc-900/80 text-[11px] font-semibold text-zinc-400">
                    Cards ({filteredCards.length})
                  </div>
                  {filteredCards.length === 0 ? (
                    <div className="p-6 text-center text-xs text-zinc-500">No preference cards found.</div>
                  ) : (
                    filteredCards.map((c) => {
                      const isSel = selectedCard && (selectedCard.id === c.id || selectedCard.surgeon === c.surgeon);
                      return (
                        <button
                          key={c.id || c.surgeon}
                          onClick={() => {
                            setSelectedCard(c);
                            setIsEditingCard(false);
                            setIsAddingCard(false);
                          }}
                          data-testid={`card-item-${(c.surgeon || "surgeon").toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                          className={`w-full text-left p-3 transition-colors cursor-pointer flex items-center justify-between ${
                            isSel ? "bg-cyan-500/10 border-l-4 border-cyan-400" : "hover:bg-zinc-800/30"
                          }`}
                        >
                          <div className="space-y-0.5 overflow-hidden">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-xs text-zinc-100 truncate">{c.surgeon}</span>
                              {c.isCustomEdited && (
                                <span className="text-[8px] px-1 rounded bg-amber-500/20 text-amber-400 font-bold">
                                  CUSTOM
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-400 truncate">{c.procedure}</p>
                            <span className="text-[10px] text-cyan-400/80 font-mono">
                              {c.specialty || "Surgery"} • {c.sutures?.length || 0} sutures
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Right: Selected Card Detail / Editor */}
                <div className="md:col-span-8 border border-zinc-800 rounded-xl bg-zinc-900/60 p-4 space-y-4">
                  {selectedCard ? (
                    <div className="space-y-4 text-xs">
                      {/* Card Header & Controls */}
                      <div className="flex items-start justify-between pb-3 border-b border-zinc-800 gap-3">
                        <div className="space-y-1">
                          {isEditingCard ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={selectedCard.surgeon}
                                onChange={(e) => setSelectedCard({ ...selectedCard, surgeon: e.target.value })}
                                placeholder="Surgeon Name (e.g. Dr. Raj Patel)"
                                data-testid="input-edit-card-surgeon"
                                className="w-full px-3 py-1 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-semibold text-zinc-100"
                              />
                              <input
                                type="text"
                                value={selectedCard.procedure}
                                onChange={(e) => setSelectedCard({ ...selectedCard, procedure: e.target.value })}
                                placeholder="Procedure Title"
                                data-testid="input-edit-card-procedure"
                                className="w-full px-3 py-1 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-200"
                              />
                            </div>
                          ) : (
                            <>
                              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                                {selectedCard.surgeon}
                                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-zinc-800 text-cyan-400 border border-cyan-500/20">
                                  {selectedCard.specialty || "Surgery"}
                                </span>
                              </h3>
                              <p className="text-xs text-zinc-300 font-medium">{selectedCard.procedure}</p>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isEditingCard ? (
                            <>
                              <button
                                onClick={() => {
                                  setIsEditingCard(false);
                                  if (isAddingCard) setSelectedCard(cards[0] || null);
                                }}
                                className="px-3 py-1 rounded-lg text-zinc-400 hover:text-zinc-200"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveCard(selectedCard)}
                                data-testid="btn-save-preference-card"
                                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg flex items-center gap-1 shadow"
                              >
                                <Save className="w-3.5 h-3.5" /> Save Card
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setIsEditingCard(true)}
                                data-testid="btn-edit-preference-card"
                                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg flex items-center gap-1"
                              >
                                <Edit2 className="w-3.5 h-3.5" /> Edit
                              </button>
                              <button
                                onClick={() => handleDeleteCard(selectedCard)}
                                data-testid="btn-delete-preference-card"
                                className="p-1.5 bg-zinc-800 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-400 rounded-lg"
                                title="Delete Card"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Gloves & Positioning */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                            🧤 Gloves
                          </span>
                          {isEditingCard ? (
                            <input
                              type="text"
                              value={selectedCard.gloves || ""}
                              onChange={(e) => setSelectedCard({ ...selectedCard, gloves: e.target.value })}
                              placeholder="e.g. Size 7.5 Biogel Under / 7.5 Over"
                              className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                            />
                          ) : (
                            <p className="text-zinc-200 font-mono text-[11px]">{selectedCard.gloves || "Not specified"}</p>
                          )}
                        </div>

                        <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                            📐 Positioning
                          </span>
                          {isEditingCard ? (
                            <input
                              type="text"
                              value={selectedCard.positioning || ""}
                              onChange={(e) => setSelectedCard({ ...selectedCard, positioning: e.target.value })}
                              placeholder="e.g. Supine with shoulder roll"
                              className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                            />
                          ) : (
                            <p className="text-zinc-200 text-[11px]">{selectedCard.positioning || "Standard"}</p>
                          )}
                        </div>
                      </div>

                      {/* Prep & Draping */}
                      <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                          🧼 Skin Prep & Draping
                        </span>
                        {isEditingCard ? (
                          <input
                            type="text"
                            value={selectedCard.prep || ""}
                            onChange={(e) => setSelectedCard({ ...selectedCard, prep: e.target.value })}
                            placeholder="e.g. ChloraPrep x2, wide drape"
                            className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                          />
                        ) : (
                          <p className="text-zinc-200 text-[11px]">{selectedCard.prep || "Standard sterile prep"}</p>
                        )}
                      </div>

                      {/* Sutures List & Relational Inventory Presence */}
                      <div className="space-y-1.5 p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                            <Tag className="w-3 h-3" /> Suture Preferences & Relational Inventory Link
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {selectedCard.sutures?.length || 0} sutures
                          </span>
                        </div>

                        <div className="space-y-1.5 pt-1">
                          {(!selectedCard.sutures || selectedCard.sutures.length === 0) && (
                            <p className="text-zinc-500 text-[11px] italic">No sutures registered for this procedure.</p>
                          )}
                          {selectedCard.sutures?.map((suture, idx) => {
                            const match = getSutureInventoryMatch(suture);
                            return (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/80 border border-zinc-800 text-[11px]"
                              >
                                <span className="font-mono text-zinc-200">{suture}</span>
                                <div className="flex items-center gap-2">
                                  {match ? (
                                    <span
                                      data-testid={`inventory-link-match-${idx}`}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-medium"
                                    >
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                      <span>In Stock: {match.full_code}</span>
                                    </span>
                                  ) : (
                                    <span
                                      data-testid={`inventory-link-unmatched-${idx}`}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px]"
                                    >
                                      <AlertCircle className="w-3 h-3 text-amber-400" />
                                      <span>Check Catalog</span>
                                    </span>
                                  )}
                                  {isEditingCard && (
                                    <button
                                      onClick={() => {
                                        const next = [...(selectedCard.sutures || [])];
                                        next.splice(idx, 1);
                                        setSelectedCard({ ...selectedCard, sutures: next });
                                      }}
                                      className="text-zinc-500 hover:text-rose-400"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {isEditingCard && (
                            <div className="flex gap-2 pt-1">
                              <input
                                type="text"
                                value={newSutureInput}
                                onChange={(e) => setNewSutureInput(e.target.value)}
                                placeholder="Add suture (e.g. 5-0 Prolene RB-1)"
                                className="flex-1 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                              />
                              <button
                                onClick={() => {
                                  if (!newSutureInput.trim()) return;
                                  setSelectedCard({
                                    ...selectedCard,
                                    sutures: [...(selectedCard.sutures || []), newSutureInput.trim()],
                                  });
                                  setNewSutureInput("");
                                }}
                                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold"
                              >
                                + Add
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Instruments List */}
                      <div className="space-y-1.5 p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block">
                          🛠️ Instruments & Special Sets
                        </span>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {selectedCard.instruments?.map((inst, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-[11px]"
                            >
                              <span>{inst}</span>
                              {isEditingCard && (
                                <button
                                  onClick={() => {
                                    const next = [...(selectedCard.instruments || [])];
                                    next.splice(idx, 1);
                                    setSelectedCard({ ...selectedCard, instruments: next });
                                  }}
                                  className="text-zinc-500 hover:text-rose-400 ml-0.5"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>

                        {isEditingCard && (
                          <div className="flex gap-2 pt-2">
                            <input
                              type="text"
                              value={newInstrumentInput}
                              onChange={(e) => setNewInstrumentInput(e.target.value)}
                              placeholder="Add instrument (e.g. Javid Shunt Clamp)"
                              className="flex-1 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
                            />
                            <button
                              onClick={() => {
                                if (!newInstrumentInput.trim()) return;
                                setSelectedCard({
                                  ...selectedCard,
                                  instruments: [...(selectedCard.instruments || []), newInstrumentInput.trim()],
                                });
                                setNewInstrumentInput("");
                              }}
                              className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold"
                            >
                              + Add
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Pearls & Clinical Notes */}
                      <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80 space-y-1">
                        <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider block">
                          💡 Pearls & Surgeon Peculiarities
                        </span>
                        {isEditingCard ? (
                          <textarea
                            value={selectedCard.pearls?.join("\n") || ""}
                            onChange={(e) =>
                              setSelectedCard({
                                ...selectedCard,
                                pearls: e.target.value.split("\n").filter((l) => l.trim().length > 0),
                              })
                            }
                            rows={3}
                            placeholder="One pearl per line..."
                            className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs font-sans"
                          />
                        ) : (
                          <ul className="list-disc list-inside space-y-1 text-zinc-300 text-[11px]">
                            {selectedCard.pearls && selectedCard.pearls.length > 0 ? (
                              selectedCard.pearls.map((p, idx) => <li key={idx}>{p}</li>)
                            ) : (
                              <li className="italic text-zinc-500">No pearls noted.</li>
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="h-64 flex flex-col items-center justify-center text-zinc-500 text-xs">
                      Select a preference card to view and edit details.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === "slang_lexicon" ? (
            /* ===============================================================
             * TAB 3: SLANG & SPOKEN TERM ALIASES
             * =============================================================== */
            <div className="space-y-4" data-testid="tab-slang-lexicon-content">
              {/* Header Info */}
              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl text-xs text-amber-200/90 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Maps colloquial terms spoken by scrub techs & surgeons to official catalog items in &lt;5ms.
                  </span>
                </div>
                <button
                  onClick={() => setIsAddingAlias(true)}
                  data-testid="btn-add-slang-alias"
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg text-xs flex items-center gap-1 shadow cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> + Add Slang Alias
                </button>
              </div>

              {/* Add Alias Form */}
              {isAddingAlias && (
                <div className="p-4 bg-zinc-900/90 border border-amber-500/30 rounded-xl space-y-3 text-xs">
                  <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
                    <span className="font-semibold text-amber-400">Register New Colloquial Spoken Term</span>
                    <button onClick={() => setIsAddingAlias(false)} className="text-zinc-400 hover:text-zinc-200">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-zinc-400 block mb-1">Spoken Term (What the clinician says) *</label>
                      <input
                        type="text"
                        value={newAliasData.spokenTerm || ""}
                        onChange={(e) => setNewAliasData({ ...newAliasData, spokenTerm: e.target.value })}
                        placeholder="e.g. purple stapler, cherry, rat tooth"
                        data-testid="input-new-alias-spoken"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Canonical Inventory Item *</label>
                      <input
                        type="text"
                        value={newAliasData.canonicalItem || ""}
                        onChange={(e) => setNewAliasData({ ...newAliasData, canonicalItem: e.target.value })}
                        placeholder="Official catalog item name"
                        data-testid="input-new-alias-canonical"
                        className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setIsAddingAlias(false)}
                      className="px-3 py-1 text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateAlias}
                      data-testid="btn-save-new-alias"
                      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg shadow"
                    >
                      Save Alias
                    </button>
                  </div>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={aliasSearch}
                  onChange={(e) => setAliasSearch(e.target.value)}
                  placeholder="Filter spoken terms or canonical items..."
                  data-testid="input-aliases-search"
                  className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Aliases Table */}
              <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/60 bg-zinc-900/40">
                <div className="px-4 py-2 bg-zinc-900/80 text-[11px] font-semibold text-zinc-400 flex items-center justify-between">
                  <span>{filteredAliases.length} Registered Aliases</span>
                  <span className="text-zinc-500">Auto-trained & pre-seeded</span>
                </div>
                {filteredAliases.length === 0 ? (
                  <div className="p-8 text-center text-xs text-zinc-500">No spoken term aliases found.</div>
                ) : (
                  filteredAliases.map((a) => (
                    <div
                      key={a.id || a.spokenTerm}
                      data-testid={`alias-row-${a.spokenTerm.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                      className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-semibold text-amber-300 font-mono text-xs">
                          &quot;{a.spokenTerm}&quot;
                        </span>
                        <span className="text-zinc-500">→</span>
                        <span className="text-zinc-200 font-medium">{a.canonicalItem}</span>
                        {a.confidence && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/60">
                            {a.confidence}
                          </span>
                        )}
                        {a.usageCount !== undefined && (
                          <span className="text-[10px] text-zinc-500">{a.usageCount} uses</span>
                        )}
                      </div>

                      <button
                        onClick={() => handleDeleteAlias(a)}
                        data-testid={`btn-delete-alias-${a.spokenTerm.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-400 transition-colors"
                        title="Delete Alias"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* ===============================================================
             * TAB 4: PROTOCOLS, GUIDELINES & PACK MANAGEMENT
             * =============================================================== */
            <div className="space-y-6" data-testid="tab-protocols-management-content">
              {/* Disaster Recovery & Catalog Sync */}
              <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
                      <RotateCcw className="w-4 h-4 text-cyan-400" /> Catalog Synchronization & Backup
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Import, export, or refresh this department&apos;s offline Dexie IndexedDB knowledge base.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleResyncSeed}
                      data-testid="btn-resync-seed-catalog"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition-colors"
                      title="Re-hydrates missing seed items while preserving your custom edits"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Re-sync with Seed</span>
                    </button>

                    <button
                      onClick={handleExportBackup}
                      data-testid="btn-export-json-backup"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-semibold transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export JSON Backup</span>
                    </button>

                    <label
                      data-testid="btn-import-json-backup"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Import JSON Backup</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleImportBackup}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Installed Modular Hospital Resource Packs */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-400" /> Installed Modular Packs in IndexedDB (
                  {installedPacks.length})
                </h4>
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/60 bg-zinc-900/40 text-xs">
                  {installedPacks.length === 0 ? (
                    <div className="p-6 text-center text-zinc-500">No modular resource packs installed yet.</div>
                  ) : (
                    installedPacks.map((p) => (
                      <div key={p.packId} className="p-3 flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-zinc-100">{p.title}</span>
                            <span className="text-[10px] px-2 py-0.2 rounded-full bg-zinc-800 text-zinc-400 font-mono">
                              {p.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500 font-mono">
                            {p.filePath} • {formatBytes(p.sizeBytes || 0)}
                          </p>
                        </div>
                        <div className="text-right text-[11px] text-zinc-500 font-mono">
                          Installed: {new Date(p.installedAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Department Guidelines Markdown Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" /> Department Clinical Guidelines & Orientation (Markdown)
                  </h4>
                  {isGuidelineDirty && (
                    <button
                      onClick={handleSaveGuideline}
                      data-testid="btn-save-department-guidelines"
                      className="flex items-center gap-1.5 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shadow"
                    >
                      <Save className="w-3.5 h-3.5" /> Save Guidelines
                    </button>
                  )}
                </div>

                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <textarea
                    value={guidelineContent}
                    onChange={(e) => {
                      setGuidelineContent(e.target.value);
                      setIsGuidelineDirty(true);
                    }}
                    rows={12}
                    data-testid="textarea-department-guidelines"
                    className="w-full p-4 bg-transparent text-xs text-zinc-200 font-mono focus:outline-none resize-y"
                    placeholder="# Department Clinical Orientation Guide..."
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
