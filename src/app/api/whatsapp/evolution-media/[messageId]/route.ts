import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getEvolutionMediaBase64 } from '@/lib/whatsapp/evolution-api'

/**
 * GET /api/whatsapp/evolution-media/[messageId]
 *
 * WhatsApp media is protocol-encrypted at rest — the raw URL Evolution
 * reports on a message can't be rendered directly by a browser (see
 * getEvolutionMediaBase64()'s doc comment). This proxy fetches the
 * already-decrypted bytes from Evolution and serves them, mirroring
 * the Meta media route's shape (`/api/whatsapp/media/[mediaId]`) so
 * both providers' bubbles work the same way in the inbox.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const { messageId } = await params
    if (!messageId) {
      return NextResponse.json({ error: 'Message ID is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Confirm this message actually belongs to the caller's account
    // before serving anything — message_id isn't globally unique (same
    // caveat as the Meta webhook's own status-update handler), so a
    // guessed/leaked message id from another account must not work
    // here just because it happens to match.
    const { data: message } = await supabase
      .from('messages')
      .select('id, conversation:conversations!inner(account_id)')
      .eq('message_id', messageId)
      .eq('conversations.account_id', accountId)
      .limit(1)
      .maybeSingle()
    if (!message) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('api_type', 'evolution')
      .maybeSingle()
    if (configError || !config) {
      return NextResponse.json({ error: 'Evolution API not configured' }, { status: 400 })
    }

    const apiKey = decrypt(config.api_key)
    const { buffer, mimetype } = await getEvolutionMediaBase64(
      { apiUrl: config.api_url, apiKey, instanceName: config.instance_name },
      messageId,
    )

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimetype,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in Evolution media GET:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
