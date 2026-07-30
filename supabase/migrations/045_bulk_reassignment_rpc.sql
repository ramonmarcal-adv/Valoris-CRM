-- ============================================================
-- 045_bulk_reassignment_rpc.sql — "Redistribuir fila"
--
-- "Liberar meus leads" (bulk-unassign the caller's own conversations)
-- needs no RPC — it's a plain filtered UPDATE the caller already has
-- permission for under conversations_update (is_account_member(...,
-- 'agent')), no cross-row invariant to protect.
--
-- "Redistribuir fila" (round-robin reassign the unassigned queue)
-- DOES need a SECURITY DEFINER RPC: a client-side read-then-write
-- loop would race if two admins click at once, or if a new inbound
-- conversation lands mid-distribution. `FOR UPDATE SKIP LOCKED` makes
-- concurrent invocations partition the work instead of double-
-- assigning. Mirrors the RPC pattern from 018_account_member_rpcs.sql.
--
-- Known limitation (acceptable for a manual, occasional action): the
-- round-robin cursor always restarts at agents[0] on each call — no
-- state is persisted about "where the last run left off".
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE OR REPLACE FUNCTION public.redistribute_unassigned_queue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role account_role_enum;
  v_agents UUID[];
  v_agent_count INT;
  v_conv RECORD;
  v_idx INT := 0;
  v_total INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_account_id, v_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Redistribution touches other agents' queues — gate to admin+.
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(user_id ORDER BY user_id) INTO v_agents
  FROM profiles
  WHERE account_id = v_account_id
    AND account_role IN ('agent', 'admin', 'owner');

  v_agent_count := COALESCE(array_length(v_agents, 1), 0);
  IF v_agent_count = 0 THEN
    RAISE EXCEPTION 'No eligible agents to distribute to' USING ERRCODE = '22023';
  END IF;

  FOR v_conv IN
    SELECT id FROM conversations
    WHERE account_id = v_account_id
      AND assigned_agent_id IS NULL
      AND is_archived = false
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE conversations
    SET assigned_agent_id = v_agents[(v_idx % v_agent_count) + 1],
        updated_at = now()
    WHERE id = v_conv.id;
    v_idx := v_idx + 1;
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$$;

ALTER FUNCTION public.redistribute_unassigned_queue() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redistribute_unassigned_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redistribute_unassigned_queue() TO authenticated;
