-- ============================================================================
-- OR-Nav v1.0 Hardened MVP Architecture — Supabase / PostgreSQL Schema
-- ============================================================================
-- Includes:
--   1. inventory_items (Tier-1 deterministic + phonetic Double Metaphone index)
--   2. knowledge_items (Tier-2 RAG + Global Educational Baseline vs Hospital Policy)
--   3. unanswered_questions (Layer-3 Passive Peer Q&A & Preceptor Verification)
--   4. Row-Level Security (RLS) policies for strict multi-tenant isolation
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch";

-- 1. Inventory Items Table (Layer 2 + Layer 3 Governance)
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    phonetic_code TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    aliases TEXT[] DEFAULT '{}',
    location_grid TEXT NOT NULL,        -- e.g. 'OR 21 · A · 2 · C'
    room TEXT NOT NULL,
    cabinet TEXT NOT NULL,
    shelf TEXT NOT NULL,
    container TEXT NOT NULL,
    human_alias TEXT NOT NULL DEFAULT '', -- e.g. 'OR 21 · Cart A (By Door) · Shelf 2 · Bin C'
    surgeon_notes TEXT DEFAULT '',
    pending_location TEXT DEFAULT '',
    verify_count INTEGER NOT NULL DEFAULT 0,
    verification_score NUMERIC(4,2) NOT NULL DEFAULT 1.0, -- 3.0 = Verified, 1.0 = Provisional
    status TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('verified', 'provisional', 'needs_reverification')),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_hospital_norm
    ON public.inventory_items (hospital_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_inventory_hospital_phonetic
    ON public.inventory_items (hospital_id, phonetic_code);

-- 2. Knowledge Items Table (Facility Orientation + GLOBAL_BASELINE)
CREATE TABLE IF NOT EXISTS public.knowledge_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id TEXT NOT NULL,          -- 'GLOBAL_BASELINE' or tenant_id
    category TEXT NOT NULL,             -- 'protocol', 'surgeon_pref', 'educational_baseline', 'peer_qa'
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_authority TEXT NOT NULL DEFAULT 'hospital_policy'
        CHECK (source_authority IN ('hospital_policy', 'educational_baseline', 'peer_verified')),
    verification_score NUMERIC(4,2) NOT NULL DEFAULT 3.0,
    status TEXT NOT NULL DEFAULT 'verified'
        CHECK (status IN ('verified', 'provisional', 'needs_reverification')),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_hospital_cat
    ON public.knowledge_items (hospital_id, category);

-- 3. Unanswered Department Questions Feed (Passive Peer Q&A)
CREATE TABLE IF NOT EXISTS public.unanswered_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    asked_by_role TEXT NOT NULL DEFAULT 'CVOR Orientee',
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'answered_tentative', 'answered_confident', 'verified')),
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_questions_hospital_status
    ON public.unanswered_questions (hospital_id, status);

-- 4. Row-Level Security (RLS) Multi-Tenant Isolation
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unanswered_questions ENABLE ROW LEVEL SECURITY;

-- Inventory: strictly isolated to the user's JWT hospital_id claim
CREATE POLICY tenant_isolation_inventory ON public.inventory_items
    FOR ALL
    USING (hospital_id = COALESCE(current_setting('request.jwt.claims', true)::json->>'hospital_id', 'general_memorial_cvor'));

-- Knowledge: allow reading hospital_id OR 'GLOBAL_BASELINE' educational fallback
CREATE POLICY tenant_read_knowledge ON public.knowledge_items
    FOR SELECT
    USING (
        hospital_id = COALESCE(current_setting('request.jwt.claims', true)::json->>'hospital_id', 'general_memorial_cvor')
        OR hospital_id = 'GLOBAL_BASELINE'
    );

CREATE POLICY tenant_write_knowledge ON public.knowledge_items
    FOR INSERT
    WITH CHECK (hospital_id = COALESCE(current_setting('request.jwt.claims', true)::json->>'hospital_id', 'general_memorial_cvor'));

-- Unanswered Questions: strictly isolated to the user's JWT hospital_id claim
CREATE POLICY tenant_isolation_questions ON public.unanswered_questions
    FOR ALL
    USING (hospital_id = COALESCE(current_setting('request.jwt.claims', true)::json->>'hospital_id', 'general_memorial_cvor'));
