import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'

/**
 * Drain due `scheduled_messages` rows ("Mensagens agendadas", Área D).
 * Meant to be hit on a schedule by an external pinger — same shape as
 * src/app/api/automations/cron/route.ts, reusing its shared secret
 * (AUTOMATION_CRON_SECRET) rather than provisioning a second one. This
 * project has no in-repo cron scheduler (no vercel.json, no scheduled
 * GitHub Actions workflow) — whoever operates this deployment needs to
 * point an external pinger at this route on an interval (every 1-2
 * minutes is reasonable, since lateness here is user-facing).
 *
 * Claim step: the optimistic `UPDATE ... WHERE status='pending'` doubles
 * as both "claimed" and "done" — a second concurrent invocation's claim
 * for the same row affects 0 rows (status is no longer 'pending' after
 * the first commits), so it's naturally skipped without needing a
 * separate in-flight status value. If the actual send throws after the
 * claim, the row is flipped to 'failed' with the error recorded — no
 * automatic retry in v1, a failed scheduled message is a dead end an
 * agent can see in the "Mensagens agendadas" panel and act on manually.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ sent: 0, failed: 0 })

  let sent = 0
  let failed = 0

  for (const row of due) {
    const { data: claim } = await admin
      .from('scheduled_messages')
      .update({ status: 'sent' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      const result = await sendMessageToConversation(admin, row.account_id as string, {
        conversationId: row.conversation_id as string,
        messageType: row.content_type as string,
        contentText: row.content_text as string | null,
        mediaUrl: row.media_url as string | null,
        filename: row.filename as string | null,
        replyToMessageId: row.reply_to_message_id as string | null,
      })
      await admin
        .from('scheduled_messages')
        .update({ sent_message_id: result.messageId })
        .eq('id', row.id)
      sent++
    } catch (err) {
      const message =
        err instanceof SendMessageError ? err.message : err instanceof Error ? err.message : String(err)
      await admin
        .from('scheduled_messages')
        .update({ status: 'failed', error_message: message })
        .eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({ sent, failed })
}
